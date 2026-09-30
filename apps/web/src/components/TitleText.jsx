import { formatDateLong, formatDateMention } from '../editor/dates.js';

/**
 * A page title as text, with date mentions shown live and relative ("Today",
 * "2 days ago") — the same labels the editor shows. Used wherever a title is
 * displayed outside the title editor (sidebar, breadcrumbs, loading state).
 * @param {{ title: string, titleContent?: import('@papier/core').InlineContent | null, placeholder?: string }} props
 */
export function TitleText({ title, titleContent, placeholder = 'Untitled' }) {
  if (!titleContent?.length) return <>{title || placeholder}</>;
  return (
    <>
      {titleContent.map((node, i) => {
        if (node.type === 'date') {
          const date = String(/** @type {{ date?: unknown }} */ (node.props)?.date ?? '');
          return (
            <time key={i} dateTime={date} title={formatDateLong(date)}>
              {formatDateMention(date)}
            </time>
          );
        }
        return typeof node.text === 'string' ? <span key={i}>{node.text}</span> : null;
      })}
    </>
  );
}
