// A Notion page body (markdown) → a flat list of blocks; nesting is indentation,
// as in the editor's document (apps/web/src/editor/convert.js turns it into a tree).

import { isExternal, parseInline, type Inline } from './inline.ts';

export type MdBlockType = 'paragraph' | 'heading' | 'bulleted_list' | 'numbered_list' | 'todo' | 'quote' | 'code' | 'divider' | 'page';

export type MdBlock = {
  type: MdBlockType;
  indent: number;
  props: Record<string, unknown>;
  content: Inline[];
  /** `page` blocks: the (URL-encoded, relative) link target, resolved by the importer. */
  link?: string;
  /** `page` blocks: the link text, kept if the target isn't imported. */
  linkText?: string;
};

/** Same cap as the editor's `MAX_INDENT`. */
const MAX_INDENT = 12;

/** Spaces per nesting level in Notion's export. */
const INDENT_WIDTH = 4;

type Line = { indent: number; text: string; raw: string };

/** Parse a page body. `warn` hears about constructs kept as plain text. */
export function parseBody(md: string, warn: (msg: string) => void = () => {}): MdBlock[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  /** The block the next plain line continues (no blank line between), if any. */
  let open: MdBlock | null = null;
  /** The previous line ended in `\` — a hard break inside the block. */
  let softBreak = false;

  const add = (b: Omit<MdBlock, 'indent'>, indent: number) => {
    const prev = blocks[blocks.length - 1];
    const block: MdBlock = { ...b, indent: Math.max(0, Math.min(indent, prev ? prev.indent + 1 : 0, MAX_INDENT)) };
    blocks.push(block);
    return block;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = measure(lines[i]!);
    if (!line.text) {
      open = null;
      softBreak = false;
      continue;
    }

    // Fenced code: everything up to the closing fence, de-indented by the fence's indent.
    const fence = /^(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/.exec(line.text);
    if (fence) {
      const body: string[] = [];
      const cut = line.raw.length - line.raw.trimStart().length;
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (lines[j]!.trim().startsWith(fence[1]!)) break;
        body.push(lines[j]!.slice(Math.min(cut, lines[j]!.length - lines[j]!.trimStart().length)));
      }
      const code = body.join('\n').replace(/^\n+|\n+$/g, '');
      add({ type: 'code', props: fence[2] ? { language: fence[2] } : {}, content: code ? [{ type: 'text', text: code, styles: {} }] : [] }, line.indent);
      i = j;
      open = null;
      softBreak = false;
      continue;
    }

    let text = line.text;
    const breaks = /\s*\\$/.test(text);
    if (breaks) text = text.replace(/\s*\\$/, '');

    const m = matchBlock(text);
    if (!m && open && (softBreak || (open.type === 'paragraph' && line.indent === open.indent))) {
      // A continuation line: a hard break inside the open block.
      append(open, text);
    } else {
      const b = m ?? { type: 'paragraph' as const, props: {}, text };
      if (b.type === 'divider') add({ type: 'divider', props: {}, content: [] }, line.indent);
      else if (b.type === 'page') add({ type: 'page', props: {}, content: [], link: b.link, linkText: b.text }, line.indent);
      else {
        if (/^<(aside|details|table|img|figure)\b/i.test(text) || /^!\[/.test(text) || /^\|.*\|$/.test(text)) warn(`Kept as text: ${text.slice(0, 40)}`);
        open = add({ type: b.type, props: b.props, content: parseInline(b.text) }, line.indent);
      }
      if (b.type === 'divider' || b.type === 'page') open = null;
    }
    softBreak = breaks && open !== null;
  }
  return blocks;
}

type Match = { type: MdBlockType; props: Record<string, unknown>; text: string; link?: string };

/** The block a line starts, or null for plain text. */
function matchBlock(text: string): Match | null {
  let m: RegExpExecArray | null;
  if ((m = /^(#{1,3})\s+(.*)$/.exec(text))) return { type: 'heading', props: { level: m[1]!.length }, text: m[2]! };
  if ((m = /^[-*+] \[([ xX])\](?: (.*))?$/.exec(text))) return { type: 'todo', props: m[1] === ' ' ? {} : { checked: true }, text: m[2] ?? '' };
  if ((m = /^[-*+](?: (.*))?$/.exec(text)) && !/^(-{3,}|\*{3,})$/.test(text)) return { type: 'bulleted_list', props: {}, text: m[1] ?? '' };
  if ((m = /^\d+[.)](?: (.*))?$/.exec(text))) return { type: 'numbered_list', props: {}, text: m[1] ?? '' };
  if ((m = /^>(?: ?(.*))$/.exec(text))) return { type: 'quote', props: {}, text: m[1] ?? '' };
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(text)) return { type: 'divider', props: {}, text: '' };
  if ((m = /^\[([^\]]*)\]\(([^)]+)\)$/.exec(text)) && !isExternal(m[2]!)) return { type: 'page', props: {}, text: m[1]!, link: m[2]! };
  return null;
}

function append(block: MdBlock, text: string) {
  block.content.push({ type: 'text', text: '\n', styles: {} }, ...parseInline(text));
  // Merge the break into neighbouring runs with the same styles.
  block.content = block.content.reduce<Inline[]>((acc, n) => {
    const last = acc[acc.length - 1];
    if (last?.type === 'text' && n.type === 'text' && JSON.stringify(last.styles) === JSON.stringify(n.styles)) last.text += n.text;
    else acc.push(n.type === 'text' ? { ...n } : n);
    return acc;
  }, []);
}

function measure(raw: string): Line {
  const expanded = raw.replace(/\t/g, ' '.repeat(INDENT_WIDTH));
  const spaces = expanded.length - expanded.trimStart().length;
  return { indent: Math.floor(spaces / INDENT_WIDTH), text: expanded.trim(), raw: expanded };
}
