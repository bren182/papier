import { useSharedPage } from '../api/share.js';

/**
 * Render plain inline content (text + basic marks) as a React node.
 * @param {{ content: Array<Record<string, unknown>> }} props
 */
function Inline({ content }) {
  if (!Array.isArray(content) || content.length === 0) return null;
  return content.map((node, i) => {
    if (node.type === 'text') {
      const styles = /** @type {Record<string, unknown>} */ (node.styles ?? {});
      let el = /** @type {import('react').ReactNode} */ (/** @type {string} */ (node.text));
      if (styles['code']) el = <code key={i} className="rounded bg-s-hover px-1 py-0.5 font-mono text-[0.85em]">{el}</code>;
      else if (styles['bold'] && styles['italic']) el = <strong key={i}><em>{el}</em></strong>;
      else if (styles['bold']) el = <strong key={i}>{el}</strong>;
      else if (styles['italic']) el = <em key={i}>{el}</em>;
      else if (styles['strikethrough']) el = <s key={i}>{el}</s>;
      else if (styles['underline']) el = <u key={i}>{el}</u>;
      else el = <span key={i}>{el}</span>;
      return el;
    }
    if (node.type === 'link') {
      const href = /** @type {string} */ (/** @type {any} */ (node.href) ?? '');
      return (
        <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
          <Inline content={/** @type {any} */ (node.content ?? [])} />
        </a>
      );
    }
    if (node.type === 'date') {
      const dateVal = /** @type {any} */ (node.props);
      return <span key={i} className="text-accent">{dateVal?.date}</span>;
    }
    return null;
  });
}

/**
 * Render a flat list of blocks as readable HTML, respecting indent.
 * @param {{ blocks: Array<{ id: string, type: string, parentId: string | null, order: string, props: Record<string, unknown>, content: unknown[] }> }} props
 */
function Blocks({ blocks }) {
  if (!blocks.length) return null;

  return (
    <div className="prose-share">
      {blocks.map((block) => {
        const indent = /** @type {number} */ (block.props.indent ?? 0);
        const style = indent ? { paddingLeft: `${indent * 24}px` } : undefined;
        const content = /** @type {any[]} */ (block.content ?? []);

        switch (block.type) {
          case 'heading': {
            const level = /** @type {number} */ (block.props.level ?? 1);
            const headingClass = level === 1
              ? 'text-[1.5rem] font-semibold'
              : level === 2
              ? 'text-[1.25rem] font-semibold'
              : 'text-[1.1rem] font-medium';
            return (
              <p key={block.id} role="heading" aria-level={level} style={style} className={`mt-5 mb-1 leading-tight text-fg-strong ${headingClass}`}>
                <Inline content={content} />
              </p>
            );
          }
          case 'bulletListItem':
            return (
              <div key={block.id} style={style} className="flex gap-2 py-0.5 text-[15px] leading-relaxed text-fg">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted/50" />
                <span><Inline content={content} /></span>
              </div>
            );
          case 'numberedListItem':
            return (
              <div key={block.id} style={style} className="flex gap-2 py-0.5 text-[15px] leading-relaxed text-fg">
                <span className="shrink-0 text-[12px] text-muted tabular-nums">{/** @type {number} */ (block.props.index ?? 1)}.</span>
                <span><Inline content={content} /></span>
              </div>
            );
          case 'blockquote':
            return (
              <blockquote key={block.id} style={style} className="my-1 border-l-2 border-muted/40 pl-4 text-[15px] italic leading-relaxed text-muted">
                <Inline content={content} />
              </blockquote>
            );
          case 'callout': {
            const icon = /** @type {string} */ (block.props.icon ?? '💡');
            return (
              <div key={block.id} style={style} className="my-2 flex gap-3 rounded-lg bg-s-hover px-4 py-3 text-[14px] leading-relaxed text-fg">
                <span className="text-base">{icon}</span>
                <span><Inline content={content} /></span>
              </div>
            );
          }
          case 'codeBlock':
            return (
              <pre key={block.id} style={style} className="my-2 overflow-x-auto rounded-lg bg-s-hover p-4 font-mono text-[13px] leading-relaxed text-fg">
                <code><Inline content={content} /></code>
              </pre>
            );
          case 'image': {
            const url = /** @type {string} */ (block.props.url ?? '');
            if (!url) return null;
            return (
              <div key={block.id} style={style} className="my-3">
                <img src={url} alt={/** @type {string} */ (block.props.alt ?? '')} className="max-w-full rounded-lg" loading="lazy" />
              </div>
            );
          }
          case 'horizontalRule':
            return <hr key={block.id} className="my-4 border-line" />;
          case 'toggleListItem':
            return (
              <details key={block.id} style={style} className="py-0.5">
                <summary className="cursor-pointer text-[15px] leading-relaxed text-fg marker:text-muted">
                  <Inline content={content} />
                </summary>
              </details>
            );
          default:
            if (!content.length) return null;
            return (
              <p key={block.id} style={style} className="py-0.5 text-[15px] leading-relaxed text-fg">
                <Inline content={content} />
              </p>
            );
        }
      })}
    </div>
  );
}

/**
 * Public read-only view of a shared page.
 * Shown when the URL contains ?share=<token> and the user is not signed in.
 * @param {{ token: string, onSignIn: () => void }} props
 */
export function SharePageView({ token, onSignIn }) {
  const { data, isLoading, isError } = useSharedPage(token);

  if (isLoading) {
    return (
      <div className="grid h-full place-items-center text-[13px] text-muted">
        Loading…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="grid h-full place-items-center text-center">
        <div>
          <p className="mb-4 text-[14px] text-muted">This shared page isn't available.</p>
          <button
            type="button"
            onClick={onSignIn}
            className="rounded-lg border border-line px-4 py-2 text-[13px] text-muted hover:bg-s-hover hover:text-fg"
          >
            Sign in to Papier
          </button>
        </div>
      </div>
    );
  }

  const { page, blocks } = data;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-s-page">
      <div className="mx-auto w-full max-w-2xl px-8 py-16">
        {page.icon && (
          <div className="mb-4 text-5xl leading-none">{page.icon}</div>
        )}
        <h1 className="mb-8 text-[2rem] font-semibold leading-tight text-fg-strong">
          {page.title || 'Untitled'}
        </h1>
        <Blocks blocks={blocks} />
      </div>

      <div className="flex items-center justify-center gap-3 border-t border-line py-6">
        <span className="text-[12px] text-faint">Shared from</span>
        <button
          type="button"
          onClick={onSignIn}
          className="text-[12px] text-accent hover:underline"
        >
          Papier
        </button>
      </div>
    </div>
  );
}
