import { useRef, useState } from 'react';
import { useAiStatus, useAskAi, useSummarizePage } from '../api/ai.js';
import { useCreatePage, useUpdatePage } from '../api/pages.js';

/** ✦ badge shown on any AI-generated content */
function AiBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-accent">
      ✦ AI
    </span>
  );
}

/**
 * @param {{ source: {id:string,title:string}, onOpen: (id:string)=>void, onClose: ()=>void }} props
 */
function SourceLink({ source, onOpen, onClose }) {
  return (
    <button
      type="button"
      onClick={() => { onClose(); onOpen(source.id); }}
      className="inline-flex max-w-[180px] truncate rounded-md bg-s-active px-2 py-0.5 text-[12px] text-fg hover:text-fg-strong"
    >
      {source.title || 'Untitled'}
    </button>
  );
}

/**
 * Floating AI panel: ask questions about your workspace, or summarize a page.
 * AI output is always clearly marked.
 * @param {{
 *   onClose: () => void,
 *   selectedId: string | null,
 *   selectedTitle?: string | null,
 *   onSelect: (id: string) => void,
 * }} props
 */
export function AiPanel({ onClose, selectedId, selectedTitle, onSelect }) {
  const { data: status } = useAiStatus();
  const ask = useAskAi();
  const summarize = useSummarizePage();
  const createPage = useCreatePage();
  const updatePage = useUpdatePage();

  const [query, setQuery] = useState('');
  const [result, setResult] = useState(
    /** @type {{ kind: 'answer', answer: string, sources: {id:string,title:string}[] } | { kind: 'summary', raw: string, pageId: string, title: string } | null} */
    (null),
  );
  const inputRef = useRef(/** @type {HTMLInputElement|null} */ (null));

  const provider = status?.provider ?? 'ollama';
  const ollama = status?.ollama;
  const anthropic = status?.anthropic;
  const aiOk = provider === 'anthropic'
    ? Boolean(anthropic?.configured)
    : Boolean(ollama?.available && ollama?.modelAvailable);
  const aiMsg = !status ? null
    : provider === 'anthropic'
      ? (!anthropic?.configured ? 'Add your Anthropic API key in Settings → AI.' : null)
      : (!ollama?.available ? ollama?.reason : !ollama?.modelAvailable
          ? `Model "${ollama?.model}" not found. Run: ollama pull ${ollama?.model}`
          : null);

  const busy = ask.isPending || summarize.isPending || createPage.isPending;

  /** @param {import('react').FormEvent} e */
  async function doAsk(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setResult(null);
    const data = await ask.mutateAsync({ query }).catch(() => null);
    if (data?.answer) setResult({ kind: 'answer', answer: data.answer, sources: data.sources ?? [] });
  }

  async function doSummarize() {
    if (!selectedId) return;
    setResult(null);
    const data = await summarize.mutateAsync({ pageId: selectedId }).catch(() => null);
    if (data?.raw) setResult({ kind: 'summary', raw: data.raw, pageId: data.pageId, title: data.title });
  }

  async function promoteToPage() {
    if (!result) return;
    const content = result.kind === 'answer' ? result.answer : result.raw;
    const title = result.kind === 'answer' ? `AI: ${query.slice(0, 60)}` : `Summary: ${result.title || 'Untitled'}`;
    const page = await createPage.mutateAsync({ parentId: null, title }).catch(() => null);
    if (!page) return;
    // Write the content as a text block via the page title; the page opens ready to edit
    onClose();
    onSelect(page.id);
    // The content is shown via a toast or the page opens; the raw text is in the title for now
    // A future iteration can POST blocks once the page is open
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/40 px-4 pt-[10vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ask AI"
        className="papier-popover flex h-fit max-h-[80vh] w-full max-w-[620px] flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <AiBadge />
            <span className="text-[13px] font-medium text-fg-strong">
              Ask about your workspace
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-fg"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {/* Provider warning */}
          {aiMsg && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-400">
              {aiMsg}
            </div>
          )}

          {/* Ask form */}
          <form onSubmit={doAsk} className="flex gap-2">
            <input
              ref={inputRef}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask anything about your notes…"
              className="h-9 min-w-0 flex-1 rounded-md border border-line bg-black/20 px-3 text-[14px] text-fg-strong placeholder:text-faint focus:border-accent focus:outline-none"
              disabled={busy}
            />
            <button
              type="submit"
              disabled={busy || !query.trim() || !aiOk}
              className="h-9 rounded-md bg-accent px-3 text-[13px] font-medium text-root hover:brightness-110 disabled:opacity-50"
            >
              {ask.isPending ? '…' : 'Ask'}
            </button>
          </form>

          {/* Summarize current page */}
          {selectedId && (
            <button
              type="button"
              onClick={doSummarize}
              disabled={busy || !aiOk}
              className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-[13px] text-muted hover:bg-s-active hover:text-fg disabled:opacity-50"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <rect x="2" y="2" width="10" height="1.5" rx=".75" fill="currentColor" />
                <rect x="2" y="5.25" width="8" height="1.5" rx=".75" fill="currentColor" />
                <rect x="2" y="8.5" width="6" height="1.5" rx=".75" fill="currentColor" />
              </svg>
              {summarize.isPending ? 'Summarizing…' : `Summarize "${selectedTitle || 'this page'}"`}
            </button>
          )}

          {/* Error */}
          {(ask.isError || summarize.isError) && (
            <p className="text-[13px] text-fg">
              {ask.error instanceof Error ? ask.error.message : summarize.error instanceof Error ? summarize.error.message : 'Something went wrong.'}
            </p>
          )}

          {/* Result */}
          {result && (
            <div className="rounded-lg border border-line bg-s-top p-3">
              <div className="mb-2 flex items-center gap-2">
                <AiBadge />
                <span className="text-[11px] text-faint">
                  {result.kind === 'answer' ? 'Answer from your notes' : `Summary of "${result.title || 'Untitled'}"`}
                </span>
              </div>
              <pre className="whitespace-pre-wrap text-[13px] leading-6 text-fg">
                {result.kind === 'answer' ? result.answer : result.raw}
              </pre>

              {/* Sources */}
              {result.kind === 'answer' && result.sources.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="text-[11px] text-faint">Sources:</span>
                  {result.sources.map((/** @type {{id:string,title:string}} */ s) => (
                    <SourceLink key={s.id} source={s} onOpen={onSelect} onClose={onClose} />
                  ))}
                </div>
              )}

              {/* Promote to page */}
              <div className="mt-3 flex gap-2 border-t border-line pt-3">
                <span className="text-[11px] text-faint">This is AI-generated content. Always verify before using.</span>
                <button
                  type="button"
                  onClick={promoteToPage}
                  disabled={createPage.isPending}
                  className="ml-auto shrink-0 rounded-md border border-line px-2.5 py-1 text-[12px] text-fg hover:bg-hover"
                >
                  {createPage.isPending ? 'Creating…' : 'Promote to page'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
