// One line of Notion markdown → the stored inline format (see apps/web/src/editor/convert.js).

import { isoFromParts, MONTH_DATE } from './dates.ts';

export type Styles = { bold?: true; italic?: true; underline?: true; strike?: true; code?: true };
export type TextNode = { type: 'text'; text: string; styles: Styles };
export type LinkNode = { type: 'link'; href: string; content: TextNode[] };
export type DateNode = { type: 'date'; props: { date: string } };
export type Inline = TextNode | LinkNode | DateNode;

const STYLE_ORDER = ['bold', 'italic', 'underline', 'strike', 'code'] as const;
type Style = (typeof STYLE_ORDER)[number];

/** Links that leave the export (anything with a scheme, or a bare domain like `draw.io`). */
export const isExternal = (href: string) => /^[a-z][a-z0-9+.-]*:/i.test(href) || /^www\./i.test(href);

const DATE_MENTION = new RegExp(`^@${MONTH_DATE.source}`);

/**
 * Parse inline markdown: `**bold**`, `*italic*` / `_italic_`, `~~strike~~`, `` `code` ``,
 * `[text](href)` and `@Month D, YYYY` date mentions. Links into the export (relative
 * `.md` paths) keep only their text — the caller decides what a page link becomes.
 */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const active = new Set<Style>();

  const styles = (extra?: Style): Styles => {
    const s: Styles = {};
    for (const k of STYLE_ORDER) if (active.has(k) || k === extra) s[k] = true;
    return s;
  };
  const push = (text: string, into: Inline[] = out, st: Styles = styles()) => {
    if (!text) return;
    const last = into[into.length - 1];
    if (last?.type === 'text' && sameStyles(last.styles, st)) last.text += text;
    else into.push({ type: 'text', text, styles: st });
  };

  /** A closing delimiter exists later on (non-space before it, for `*`/`_`/`~~`/`**`). */
  const closes = (delim: string, from: number) => {
    for (let j = src.indexOf(delim, from); j !== -1; j = src.indexOf(delim, j + 1)) {
      if (j > from && src[j - 1] !== ' ') {
        // `_` must end a word: `snake_case_name` isn't italic.
        if (delim === '_' && /\w/.test(src[j + 1] ?? '')) continue;
        return true;
      }
    }
    return false;
  };

  let i = 0;
  let buf = '';
  const flush = () => {
    push(buf);
    buf = '';
  };
  const toggle = (style: Style, delim: string) => {
    flush();
    if (active.has(style)) active.delete(style);
    else active.add(style);
    i += delim.length;
  };

  while (i < src.length) {
    const rest = src.slice(i);
    const c = src[i]!;

    if (c === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        push(src.slice(i + 1, end), out, styles('code'));
        i = end + 1;
        continue;
      }
    }

    if (c === '[') {
      const link = /^\[([^\]]*)\]\(([^)\s]*)\)/.exec(rest);
      if (link) {
        flush();
        const [, text = '', href = ''] = link;
        const inner = parseInline(text).flatMap((n) => (n.type === 'text' ? [n] : n.type === 'link' ? n.content : []));
        // Text inside the link carries the styles open around it.
        for (const n of inner) n.styles = { ...styles(), ...n.styles };
        if (isExternal(href)) out.push({ type: 'link', href, content: inner.length ? inner : [{ type: 'text', text: href, styles: styles() }] });
        else for (const n of inner) push(n.text, out, n.styles);
        i += link[0].length;
        continue;
      }
    }

    if (c === '@') {
      const m = DATE_MENTION.exec(rest);
      const iso = m && isoFromParts(m[1]!, m[2]!, m[3]!);
      if (m && iso) {
        flush();
        out.push({ type: 'date', props: { date: iso } });
        i += m[0].length;
        continue;
      }
    }

    // An opener needs a closer later on and no space after it; a closer no space before.
    const opens = (style: Style, delim: string) =>
      active.has(style) ? src[i - 1] !== ' ' : src[i + delim.length] !== ' ' && closes(delim, i + delim.length);
    if (rest.startsWith('**') && opens('bold', '**')) {
      toggle('bold', '**');
      continue;
    }
    if (rest.startsWith('~~') && opens('strike', '~~')) {
      toggle('strike', '~~');
      continue;
    }
    if (c === '*' && opens('italic', '*')) {
      toggle('italic', '*');
      continue;
    }
    if (c === '_' && (active.has('italic') ? !/\w/.test(src[i + 1] ?? '') : !/\w/.test(src[i - 1] ?? '') && src[i + 1] !== ' ' && closes('_', i + 1))) {
      toggle('italic', '_');
      continue;
    }

    buf += c;
    i++;
  }
  flush();
  return out;
}

function sameStyles(a: Styles, b: Styles) {
  return STYLE_ORDER.every((k) => !!a[k] === !!b[k]);
}

/** Plain text of inline nodes (dates as ISO) — for titles and reports. */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.type === 'text' ? n.text : n.type === 'link' ? inlineText(n.content) : n.props.date)).join('');
}
