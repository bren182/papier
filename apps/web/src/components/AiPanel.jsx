import { useEffect, useRef, useState } from 'react';
import { useAiStatus, streamAiAsk, useSummarizePage } from '../api/ai.js';
import { useCreatePage } from '../api/pages.js';

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
 * A pill showing a tool call in progress or complete.
 * @param {{ label: string, done: boolean }} props
 */
function ToolPill({ label, done }) {
  return (
    <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] ${done ? 'border-line text-faint' : 'border-accent/40 text-accent'}`}>
      {!done && (
        <span className="inline-block size-2 animate-spin rounded-full border border-accent border-t-transparent" />
      )}
      {done && (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {label}
    </div>
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
  const summarize = useSummarizePage();
  const createPage = useCreatePage();

  const [query, setQuery] = useState('');

  /** @type {[{label:string,done:boolean}[], React.Dispatch<any>]} */
  const [tools, setTools] = useState([]);
  const [answer, setAnswer] = useState('');
  /** @type {[{id:string,title:string}[], React.Dispatch<any>]} */
  const [sources, setSources] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState(/** @type {string|null} */ (null));

  const [summaryResult, setSummaryResult] = useState(
    /** @type {{ raw: string, pageId: string, title: string } | null} */ (null),
  );

  const cancelRef = useRef(/** @type {(() => void) | null} */ (null));
  const inputRef = useRef(/** @type {HTMLInputElement|null} */ (null));

  useEffect(() => () => cancelRef.current?.(), []);

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

  const busy = streaming || summarize.isPending || createPage.isPending;
  const hasAnswer = !!answer;

  /** @param {import('react').FormEvent} e */
  function doAsk(e) {
    e.preventDefault();
    if (!query.trim() || streaming) return;
    cancelRef.current?.();
    setTools([]);
    setAnswer('');
    setSources([]);
    setStreamError(null);
    setSummaryResult(null);
    setStreaming(true);

    cancelRef.current = streamAiAsk({ query }, (event) => {
      if (event.type === 'tool') {
        setTools((/** @type {{label:string,done:boolean}[]} */ prev) => {
          const next = prev.map((t) => ({ ...t, done: true }));
          return [...next, { label: String(event.label ?? ''), done: false }];
        });
      } else if (event.type === 'text') {
        setAnswer((/** @type {string} */ prev) => prev + String(event.delta ?? ''));
      } else if (event.type === 'done') {
        setTools((/** @type {{label:string,done:boolean}[]} */ prev) => prev.map((t) => ({ ...t, done: true })));
        setSources(/** @type {any} */ (event.sources) ?? []);
        setStreaming(false);
      } else if (event.type === 'error') {
        setStreamError(String(event.error ?? 'Something went wrong.'));
        setStreaming(false);
      }
    });
  }

  async function doSummarize() {
    if (!selectedId) return;
    cancelRef.current?.();
    setTools([]);
    setAnswer('');
    setSources([]);
    setStreamError(null);
    setSummaryResult(null);
    const data = await summarize.mutateAsync({ pageId: selectedId }).catch(() => null);
    if (data?.raw) setSummaryResult({ raw: data.raw, pageId: data.pageId, title: data.title });
  }

  async function promoteToPage() {
    const content = summaryResult ? summaryResult.raw : answer;
    const title = summaryResult
      ? `Summary: ${summaryResult.title || 'Untitled'}`
      : `AI: ${query.slice(0, 60)}`;
    const page = await createPage.mutateAsync({ parentId: null, title }).catch(() => null);
    if (!page) return;
    onClose();
    onSelect(page.id);
  }

  const showResult = hasAnswer || summaryResult;

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
              {streaming ? '…' : 'Ask'}
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

          {/* Tool-call progress pills */}
          {tools.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tools.map((t, i) => (
                <ToolPill key={i} label={t.label} done={t.done} />
              ))}
            </div>
          )}

          {/* Error */}
          {(streamError || summarize.isError) && (
            <p className="text-[13px] text-fg">
              {streamError ?? (summarize.error instanceof Error ? summarize.error.message : 'Something went wrong.')}
            </p>
          )}

          {/* Result */}
          {showResult && (
            <div className="rounded-lg border border-line bg-s-top p-3">
              <div className="mb-2 flex items-center gap-2">
                <AiBadge />
                <span className="text-[11px] text-faint">
                  {summaryResult ? `Summary of "${summaryResult.title || 'Untitled'}"` : 'Answer from your notes'}
                </span>
              </div>
              <pre className="whitespace-pre-wrap text-[13px] leading-6 text-fg">
                {summaryResult ? summaryResult.raw : answer}
                {streaming && <span className="inline-block w-0.5 animate-pulse bg-accent align-middle">&nbsp;</span>}
              </pre>

              {/* Sources (answer only) */}
              {!summaryResult && sources.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="text-[11px] text-faint">Sources:</span>
                  {sources.map((s) => (
                    <SourceLink key={s.id} source={s} onOpen={onSelect} onClose={onClose} />
                  ))}
                </div>
              )}

              {/* Promote to page */}
              {!streaming && (
                <div className="mt-3 flex gap-2 border-t border-line pt-3">
                  <span className="text-[11px] text-faint">AI-generated content — always verify.</span>
                  <button
                    type="button"
                    onClick={promoteToPage}
                    disabled={createPage.isPending}
                    className="ml-auto shrink-0 rounded-md border border-line px-2.5 py-1 text-[12px] text-fg hover:bg-hover"
                  >
                    {createPage.isPending ? 'Creating…' : 'Promote to page'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
