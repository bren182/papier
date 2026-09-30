/**
 * Formulas: a small, Notion-like expression language for computed properties
 * and button/automation values — e.g. `if(prop("Done"), "✓", "")` or
 * `dateBetween(nextAnniversary(prop("Birthdate")), today(), "days")`.
 *
 * This module is zod-free and shared: it parses (to an AST with positions),
 * type-checks against a database's properties, and describes every function
 * (the in-app reference). The server compiles the AST to parameterised SQL
 * (apps/server/src/db/formula.ts) — only these functions exist, and no user
 * text ever becomes SQL.
 *
 * @typedef {'number' | 'text' | 'date' | 'boolean'} FormulaType
 * @typedef {{ k: 'num', v: number, pos: number } | { k: 'str', v: string, pos: number } | { k: 'bool', v: boolean, pos: number }
 *   | { k: 'prop', name: string, pos: number } | { k: 'call', name: string, args: Expr[], pos: number }
 *   | { k: 'bin', op: string, a: Expr, b: Expr, pos: number } | { k: 'un', op: string, a: Expr, pos: number }} Expr
 */

export class FormulaError extends Error {
  /** @param {string} message @param {number} pos offset in the source */
  constructor(message, pos) {
    super(message);
    this.pos = pos;
  }
}

/** Longest formula accepted, in characters. */
export const MAX_FORMULA = 2000;

// ── tokens ──────────────────────────────────────────────────────────────

/** @typedef {{ t: 'num' | 'str' | 'id' | 'op' | 'end', v: string, pos: number }} Token */

const OPERATORS = ['==', '!=', '<=', '>=', '<', '>', '+', '-', '*', '/', '%', '(', ')', ','];

/** @param {string} src @returns {Token[]} */
function tokenize(src) {
  /** @type {Token[]} */
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] ?? '';
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c) && /[0-9]/.test(src.slice(i, i + 2).replace('.', '') || c)) {
      const m = /^\d*\.?\d+(?:[eE][-+]?\d+)?/.exec(src.slice(i));
      if (!m) throw new FormulaError(`Unexpected “${c}”`, i);
      out.push({ t: 'num', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'" || c === '“' || c === '”') {
      const close = c === '“' ? '”' : c;
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== close && !(close === '"' && src[j] === '”')) {
        if (src[j] === '\\' && j + 1 < src.length) j++;
        s += src[j];
        j++;
      }
      if (j >= src.length) throw new FormulaError('This text is missing its closing quote', i);
      out.push({ t: 'str', v: s, pos: i });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      out.push({ t: 'id', v: /** @type {RegExpExecArray} */ (m)[0], pos: i });
      i += /** @type {RegExpExecArray} */ (m)[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i)) ?? (src.startsWith('&&', i) ? '&&' : src.startsWith('||', i) ? '||' : c === '!' ? '!' : null);
    if (!op) throw new FormulaError(`Unexpected “${c}”`, i);
    out.push({ t: 'op', v: op, pos: i });
    i += op.length;
  }
  out.push({ t: 'end', v: '', pos: src.length });
  return out;
}

// ── parser (Pratt) ────────────────────────────────────────────────────────

/** Binding power of infix operators; `and`/`or` are words too. */
const INFIX = /** @type {Record<string, number>} */ ({ or: 1, '||': 1, and: 2, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 });

/**
 * Parse a formula into an AST. Throws FormulaError with the offending position.
 * @param {string} src
 * @returns {Expr}
 */
export function parseFormula(src) {
  if (src.length > MAX_FORMULA) throw new FormulaError(`Formulas can be at most ${MAX_FORMULA} characters`, MAX_FORMULA);
  if (!src.trim()) throw new FormulaError('Write a formula', 0);
  const tokens = tokenize(src);
  let at = 0;
  const peek = () => /** @type {Token} */ (tokens[at]);
  const next = () => /** @type {Token} */ (tokens[at++]);
  /** @param {string} v */
  const expect = (v) => {
    const t = next();
    if (t.v !== v || t.t !== 'op') throw new FormulaError(t.t === 'end' ? `Missing “${v}” at the end` : `Expected “${v}” here`, t.pos);
  };

  /** @param {number} min @returns {Expr} */
  const expr = (min) => {
    let left = prefix();
    for (;;) {
      const t = peek();
      const op = t.t === 'op' || (t.t === 'id' && (t.v === 'and' || t.v === 'or')) ? t.v : null;
      const bp = op ? INFIX[op] : undefined;
      if (!op || bp === undefined || bp <= min) return left;
      next();
      const norm = op === '&&' ? 'and' : op === '||' ? 'or' : op;
      left = { k: 'bin', op: norm, a: left, b: expr(bp), pos: t.pos };
    }
  };

  /** @returns {Expr} */
  const prefix = () => {
    const t = next();
    if (t.t === 'num') return { k: 'num', v: Number(t.v), pos: t.pos };
    if (t.t === 'str') return { k: 'str', v: t.v, pos: t.pos };
    if (t.t === 'op' && t.v === '(') {
      const inner = expr(0);
      expect(')');
      return inner;
    }
    if (t.t === 'op' && (t.v === '-' || t.v === '!')) return { k: 'un', op: t.v === '-' ? '-' : 'not', a: expr(7), pos: t.pos };
    if (t.t === 'id') {
      if (t.v === 'true' || t.v === 'false') return { k: 'bool', v: t.v === 'true', pos: t.pos };
      if (t.v === 'not') return { k: 'un', op: 'not', a: expr(2), pos: t.pos };
      if (peek().v !== '(') throw new FormulaError(`Unknown word “${t.v}” — properties are written prop("Name")`, t.pos);
      next();
      /** @type {Expr[]} */
      const args = [];
      if (peek().v !== ')') {
        do args.push(expr(0));
        while (peek().v === ',' && next());
      }
      expect(')');
      if (t.v === 'prop') {
        const arg = args[0];
        if (args.length !== 1 || arg?.k !== 'str') throw new FormulaError('prop() takes a property name in quotes: prop("Name")', t.pos);
        return { k: 'prop', name: arg.v, pos: t.pos };
      }
      return { k: 'call', name: t.v, args, pos: t.pos };
    }
    throw new FormulaError(t.t === 'end' ? 'The formula ends too early' : `Unexpected “${t.v}”`, t.pos);
  };

  const ast = expr(0);
  const rest = peek();
  if (rest.t !== 'end') throw new FormulaError(`Unexpected “${rest.v}”`, rest.pos);
  return ast;
}

// ── functions ─────────────────────────────────────────────────────────────

/** Date units for dateAdd / dateSubtract / dateBetween. */
export const DATE_UNITS = ['days', 'weeks', 'months', 'years'];

/**
 * Every function: argument types ('any' accepts all; a trailing `?` is
 * optional; `...` repeats the last), result type (or 'same' = the type of the
 * second argument, for if), and the reference guide text.
 * @type {Record<string, { args: string[], returns: FormulaType | 'same', group: string, doc: string, example: string }>}
 */
export const FUNCTIONS = {
  if: { args: ['boolean', 'any', 'any'], returns: 'same', group: 'Logic', doc: 'The second value when the condition holds, else the third.', example: 'if(prop("Done"), "✓", "…")' },
  empty: { args: ['any'], returns: 'boolean', group: 'Logic', doc: 'True when the value is empty (no value, or blank text).', example: 'empty(prop("Due"))' },
  concat: { args: ['any', 'any', '...'], returns: 'text', group: 'Text', doc: 'Joins values into one text.', example: 'concat(prop("First"), " ", prop("Last"))' },
  length: { args: ['text'], returns: 'number', group: 'Text', doc: 'How many characters a text has.', example: 'length(prop("Name"))' },
  lower: { args: ['text'], returns: 'text', group: 'Text', doc: 'The text in lowercase.', example: 'lower(prop("Name"))' },
  upper: { args: ['text'], returns: 'text', group: 'Text', doc: 'The text in uppercase.', example: 'upper(prop("Code"))' },
  contains: { args: ['text', 'text'], returns: 'boolean', group: 'Text', doc: 'Whether the first text contains the second (ignoring case).', example: 'contains(prop("Tags"), "urgent")' },
  replace: { args: ['text', 'text', 'text'], returns: 'text', group: 'Text', doc: 'The text with every match of the second value replaced by the third.', example: 'replace(prop("Name"), "-", " ")' },
  format: { args: ['any'], returns: 'text', group: 'Text', doc: 'Any value as text.', example: 'format(prop("Points"))' },
  round: { args: ['number', 'number?'], returns: 'number', group: 'Number', doc: 'Rounds to whole numbers, or to a number of decimals.', example: 'round(prop("Price") * 1.15, 2)' },
  floor: { args: ['number'], returns: 'number', group: 'Number', doc: 'Rounds down.', example: 'floor(prop("Hours") / 8)' },
  ceil: { args: ['number'], returns: 'number', group: 'Number', doc: 'Rounds up.', example: 'ceil(prop("Hours") / 8)' },
  abs: { args: ['number'], returns: 'number', group: 'Number', doc: 'The value without its sign.', example: 'abs(prop("Balance"))' },
  min: { args: ['number', 'number', '...'], returns: 'number', group: 'Number', doc: 'The smallest of the values.', example: 'min(prop("A"), prop("B"))' },
  max: { args: ['number', 'number', '...'], returns: 'number', group: 'Number', doc: 'The largest of the values.', example: 'max(prop("A"), 0)' },
  toNumber: { args: ['any'], returns: 'number', group: 'Number', doc: 'Reads a number from text ("12.5" → 12.5); true is 1.', example: 'toNumber(prop("Code"))' },
  today: { args: [], returns: 'date', group: 'Date', doc: 'Today’s date (yours, where the formula is shown).', example: 'today()' },
  dateAdd: { args: ['date', 'number', 'unit'], returns: 'date', group: 'Date', doc: 'A date moved forward by days, weeks, months or years (month ends clamp: Jan 31 + 1 month = Feb 28).', example: 'dateAdd(prop("Due"), 7, "days")' },
  dateSubtract: { args: ['date', 'number', 'unit'], returns: 'date', group: 'Date', doc: 'A date moved back by days, weeks, months or years.', example: 'dateSubtract(today(), 1, "months")' },
  dateBetween: { args: ['date', 'date', 'unit'], returns: 'number', group: 'Date', doc: 'Whole days, weeks, months or years from the second date to the first.', example: 'dateBetween(prop("Due"), today(), "days")' },
  year: { args: ['date'], returns: 'number', group: 'Date', doc: 'The year of a date.', example: 'year(prop("Birthdate"))' },
  month: { args: ['date'], returns: 'number', group: 'Date', doc: 'The month of a date, 1–12.', example: 'month(prop("Due"))' },
  day: { args: ['date'], returns: 'number', group: 'Date', doc: 'The day of the month, 1–31.', example: 'day(prop("Due"))' },
  weekday: { args: ['date'], returns: 'number', group: 'Date', doc: 'The day of the week, Monday = 1 … Sunday = 7.', example: 'weekday(prop("Due"))' },
  formatDate: { args: ['date', 'pattern'], returns: 'text', group: 'Date', doc: 'A date as text: YYYY, MM, M, DD, D, MMM (Jan), MMMM (January), ddd (Mon), dddd (Monday).', example: 'formatDate(prop("Due"), "D MMM YYYY")' },
  nextAnniversary: { args: ['date'], returns: 'date', group: 'Date', doc: 'The next time the date’s month and day come round, from today (birthdays).', example: 'nextAnniversary(prop("Birthdate"))' },
};

/** The signature as shown in the reference, e.g. `dateAdd(date, number, "days")`. @param {string} name */
export function signature(name) {
  const f = FUNCTIONS[name];
  if (!f) return name;
  const shown = f.args.map((a) => (a === 'unit' ? '"days"' : a === 'pattern' ? '"pattern"' : a === '...' ? '…' : a.replace('?', ' (optional)')));
  return `${name}(${shown.join(', ')})`;
}

// ── type checking ─────────────────────────────────────────────────────────

/**
 * The formula type a property's value has (its formula result for formulas,
 * its result for rollups), or null when it can't be used in formulas.
 * @param {{ type: string, config?: { fn?: string | null, resultType?: string | null } }} prop
 * @returns {FormulaType | null}
 */
export function propFormulaType(prop) {
  switch (prop.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'select':
    case 'multi_select':
    case 'relation':
      return 'text';
    case 'number':
      return 'number';
    case 'checkbox':
      return 'boolean';
    case 'date':
    case 'created_time':
    case 'edited_time':
      return 'date';
    case 'rollup': {
      const fn = prop.config?.fn;
      if (fn === 'show_original' || !fn) return 'text';
      return fn === 'earliest' || fn === 'latest' ? 'date' : 'number';
    }
    case 'formula':
      return /** @type {FormulaType | null} */ (prop.config?.resultType ?? null);
    default:
      return null;
  }
}

/**
 * Check a parsed formula: every property exists, every function is known and
 * gets the right kinds of values. Returns the result type.
 * @param {Expr} ast
 * @param {(name: string) => FormulaType | null | undefined} typeOfProp  undefined: no such property; null: not usable
 * @returns {FormulaType}
 */
export function checkFormula(ast, typeOfProp) {
  /** @param {Expr} e @returns {FormulaType} */
  const check = (e) => {
    switch (e.k) {
      case 'num':
        return 'number';
      case 'str':
        // A date written out ("2026-09-30") is a date.
        return /^\d{4}-\d{2}-\d{2}$/.test(e.v) ? 'date' : 'text';
      case 'bool':
        return 'boolean';
      case 'prop': {
        const t = typeOfProp(e.name);
        if (t === undefined) throw new FormulaError(`There's no property called “${e.name}”`, e.pos);
        if (t === null) throw new FormulaError(`“${e.name}” can't be used in a formula`, e.pos);
        return t;
      }
      case 'un': {
        const t = check(e.a);
        if (e.op === '-') return need(t, 'number', e.a.pos, 'a number');
        return need(t, 'boolean', e.a.pos, 'true or false');
      }
      case 'bin': {
        const [a, b] = [check(e.a), check(e.b)];
        if (e.op === 'and' || e.op === 'or') {
          need(a, 'boolean', e.a.pos, 'true or false');
          need(b, 'boolean', e.b.pos, 'true or false');
          return 'boolean';
        }
        if (e.op === '==' || e.op === '!=') return 'boolean';
        if (['<', '>', '<=', '>='].includes(e.op)) {
          if (a !== b) throw new FormulaError(`Can't compare ${a} with ${b}`, e.pos);
          return 'boolean';
        }
        if (e.op === '+' && (a === 'text' || b === 'text' || a === 'date' || b === 'date')) return 'text';
        need(a, 'number', e.a.pos, 'a number');
        need(b, 'number', e.b.pos, 'a number');
        return 'number';
      }
      case 'call': {
        const f = FUNCTIONS[e.name];
        if (!f) throw new FormulaError(`There's no function called “${e.name}”`, e.pos);
        const variadic = f.args[f.args.length - 1] === '...';
        const fixed = variadic ? f.args.slice(0, -1) : f.args;
        const required = fixed.filter((a) => !a.endsWith('?')).length;
        if (e.args.length < required || (!variadic && e.args.length > fixed.length)) {
          const count = variadic ? `at least ${required}` : fixed.length === required ? String(required) : `${required}–${fixed.length}`;
          throw new FormulaError(`${signature(e.name)} takes ${count} ${count === '1' ? 'value' : 'values'}`, e.pos);
        }
        const types = e.args.map((arg, i) => {
          const want = (fixed[i] ?? fixed[fixed.length - 1] ?? 'any').replace('?', '');
          if (want === 'unit') {
            if (arg.k !== 'str' || !DATE_UNITS.includes(unitOf(arg.v))) throw new FormulaError(`Use "days", "weeks", "months" or "years" here`, arg.pos);
            return 'text';
          }
          if (want === 'pattern') {
            if (arg.k !== 'str') throw new FormulaError('The date pattern must be written in quotes, e.g. "D MMM YYYY"', arg.pos);
            return 'text';
          }
          const t = check(arg);
          if (want !== 'any') need(t, /** @type {FormulaType} */ (want), arg.pos, want === 'boolean' ? 'true or false' : `a ${want}`);
          return t;
        });
        if (f.returns === 'same') {
          const [x, y] = [types[1], types[2]];
          if (x && y && x !== y) throw new FormulaError(`Both answers of if() must be the same kind (${x} vs ${y})`, e.pos);
          return /** @type {FormulaType} */ (x);
        }
        return f.returns;
      }
    }
  };
  return check(ast);
}

/** @param {FormulaType} got @param {FormulaType} want @param {number} pos @param {string} words */
function need(got, want, pos, words) {
  if (got !== want) throw new FormulaError(`Expected ${words} here, not ${got === 'boolean' ? 'true/false' : `a ${got}`}`, pos);
  return got;
}

/** "day", "Days" → "days". @param {string} unit */
export function unitOf(unit) {
  const u = unit.trim().toLowerCase();
  return u.endsWith('s') ? u : `${u}s`;
}

/**
 * Parse and check in one go — what editors call on every keystroke.
 * @param {string} src
 * @param {(name: string) => FormulaType | null | undefined} typeOfProp
 * @returns {{ ok: true, type: FormulaType, ast: Expr } | { ok: false, error: string, pos: number }}
 */
export function analyzeFormula(src, typeOfProp) {
  try {
    const ast = parseFormula(src);
    return { ok: true, type: checkFormula(ast, typeOfProp), ast };
  } catch (err) {
    if (err instanceof FormulaError) return { ok: false, error: err.message, pos: err.pos };
    throw err;
  }
}

/** Every `prop("…")` name a formula uses. @param {Expr} ast @returns {string[]} */
export function propsUsed(ast) {
  /** @type {Set<string>} */
  const out = new Set();
  /** @param {Expr} e */
  const walk = (e) => {
    if (e.k === 'prop') out.add(e.name);
    else if (e.k === 'call') e.args.forEach(walk);
    else if (e.k === 'bin') {
      walk(e.a);
      walk(e.b);
    } else if (e.k === 'un') walk(e.a);
  };
  walk(ast);
  return [...out];
}
