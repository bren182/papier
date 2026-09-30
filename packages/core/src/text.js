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
