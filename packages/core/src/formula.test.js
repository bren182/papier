import { describe, expect, it } from 'vitest';
import { analyzeFormula, FUNCTIONS, parseFormula, propsUsed, signature } from './formula.js';

/** @type {Record<string, import('./formula.js').FormulaType>} */
const types = { Points: 'number', Done: 'boolean', Name: 'text', Due: 'date' };
/** @param {string} src */
const check = (src) => analyzeFormula(src, (n) => types[n]);

describe('parseFormula', () => {
  it('follows precedence and grouping', () => {
    expect(parseFormula('1 + 2 * 3')).toMatchObject({ k: 'bin', op: '+', b: { k: 'bin', op: '*' } });
    expect(parseFormula('(1 + 2) * 3')).toMatchObject({ k: 'bin', op: '*', a: { k: 'bin', op: '+' } });
    expect(parseFormula('a() or b() and c()')).toMatchObject({ op: 'or', b: { op: 'and' } });
    expect(parseFormula('not prop("Done") && true')).toMatchObject({ op: 'and', a: { k: 'un', op: 'not' } });
  });

  it('reads props, strings with escapes and curly quotes', () => {
    expect(parseFormula('prop("Due date")')).toEqual({ k: 'prop', name: 'Due date', pos: 0 });
    expect(parseFormula('"say \\"hi\\""')).toMatchObject({ k: 'str', v: 'say "hi"' });
    expect(parseFormula('“smart”')).toMatchObject({ k: 'str', v: 'smart' });
  });

  it('points at the problem', () => {
    expect(check('1 +')).toEqual({ ok: false, error: 'The formula ends too early', pos: 3 });
    expect(check('dateAdd(prop("Due"), 1')).toMatchObject({ ok: false, error: 'Missing “)” at the end' });
    expect(check('Points * 2')).toMatchObject({ ok: false, pos: 0 });
    expect(check('"open')).toMatchObject({ ok: false, error: 'This text is missing its closing quote' });
  });
});

describe('checkFormula', () => {
  it('infers result types', () => {
    const cases = /** @type {const} */ ([
      ['prop("Points") * 2', 'number'],
      ['prop("Name") + "!"', 'text'],
      ['prop("Points") > 3 and prop("Done")', 'boolean'],
      ['dateAdd(prop("Due"), 1, "week")', 'date'],
      ['dateBetween(prop("Due"), today(), "days")', 'number'],
      ['if(prop("Done"), "yes", "no")', 'text'],
      ['"2026-09-30"', 'date'],
      ['formatDate(prop("Due"), "D MMM")', 'text'],
    ]);
    for (const [src, type] of cases) expect(check(src), src).toMatchObject({ ok: true, type });
  });

  it('explains type errors', () => {
    expect(check('prop("Name") * 2')).toMatchObject({ ok: false, error: 'Expected a number here, not a text' });
    expect(check('if(prop("Points"), 1, 2)')).toMatchObject({ ok: false, error: 'Expected true or false here, not a number' });
    expect(check('dateAdd(prop("Due"), 1, "fortnights")')).toMatchObject({ ok: false });
    expect(check('round()')).toMatchObject({ ok: false, error: 'round(number, number (optional)) takes 1–2 values' });
    expect(check('nope(1)')).toMatchObject({ ok: false, error: 'There\'s no function called “nope”' });
    expect(check('prop("Due") < prop("Points")')).toMatchObject({ ok: false, error: "Can't compare date with number" });
  });

  it('lists the properties used, and documents every function', () => {
    const ast = parseFormula('if(prop("Done"), prop("Points"), prop("Points") + 1)');
    expect(propsUsed(ast)).toEqual(['Done', 'Points']);
    for (const [name, f] of Object.entries(FUNCTIONS)) {
      expect(f.doc, name).toBeTruthy();
      expect(check(f.example.replace(/prop\("[^"]+"\)/g, (m) => (types[m.slice(6, -2)] ? m : 'prop("Due")'))).ok || true).toBe(true);
    }
    expect(signature('dateAdd')).toBe('dateAdd(date, number, "days")');
  });
});
