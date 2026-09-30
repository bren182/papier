/**
 * Text helpers with no dependencies (no zod), safe to import from the web
 * client's main bundle via `@papier/core/text`.
 */

/** @typedef {{ type: string, [key: string]: unknown }} InlineNode */

/**
 * Plain text of inline content (search, titles, previews).
 * @param {InlineNode[]} content
 * @returns {string}
 */
export function plainText(content) {
  return content
    .map((node) => {
      if (typeof node.text === 'string') return node.text;
      // Inline date mention: { type: 'date', props: { date: 'YYYY-MM-DD' } }
      if (node.type === 'date') return /** @type {{ date?: string } | undefined} */ (node.props)?.date ?? '';
      if (Array.isArray(node.content)) return plainText(/** @type {InlineNode[]} */ (node.content));
      return '';
    })
    .join('');
}

/** Markers around matched terms in search snippets (plain text, never HTML). */
export const HIT_START = '\u0002';
export const HIT_END = '\u0003';

/**
 * A search snippet split into plain runs and matched runs, for rendering
 * highlights without HTML.
 * @param {string} snippet
 * @returns {{ text: string, hit: boolean }[]}
 */
export function snippetParts(snippet) {
  /** @type {{ text: string, hit: boolean }[]} */
  const parts = [];
  let hit = false;
  let run = '';
  for (const ch of snippet) {
    if (ch === HIT_START || ch === HIT_END) {
      if (run) parts.push({ text: run, hit });
      run = '';
      hit = ch === HIT_START;
    } else {
      run += ch;
    }
  }
  if (run) parts.push({ text: run, hit });
  return parts;
}
