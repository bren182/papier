import { useEffect, useRef, useState } from 'react';
import { useAiStatus, useDeleteModel, usePullModel, useSaveAiConfig } from '../api/ai.js';
import { useAuthState } from '../api/auth.js';

const CLAUDE_MODELS = [
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', desc: 'Fastest · $1/$5 per M tokens', recommended: true },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', desc: 'Balanced · $2/$10 per M tokens', recommended: false },
];

/** Bytes → human-readable string @param {number} bytes */
function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

/**
 * Green / amber / red dot
 * @param {{ ok: boolean, warn: boolean }} props
 */
function StatusDot({ ok, warn }) {
  const color = ok ? 'bg-green-500' : warn ? 'bg-amber-400' : 'bg-red-500/80';
  return <span className={`inline-block size-2 shrink-0 rounded-full ${color}`} aria-hidden="true" />;
}

/**
 * @param {{ m: {name:string,size:number}, current: boolean, onSelect: (name:string)=>void }} props
 */
function ModelRow({ m, current, onSelect }) {
  const del = useDeleteModel();
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-s-active group">
      <button
        type="button"
        onClick={() => onSelect(m.name)}
        className={`flex flex-1 items-center gap-2 text-left text-[13px] ${current ? 'text-fg-strong' : 'text-fg'}`}
        title="Use this model"
      >
        {current && <span className="text-accent text-[10px] font-semibold">●</span>}
        <span className="flex-1 truncate font-mono">{m.name}</span>
        <span className="shrink-0 text-[11px] text-faint">{fmtSize(m.size)}</span>
      </button>
      <button
        type="button"
        onClick={() => del.mutate(m.name)}
        disabled={del.isPending}
        aria-label={`Delete ${m.name}`}
        className="hidden size-5 shrink-0 items-center justify-center rounded text-faint hover:text-fg group-hover:flex"
        title="Delete model"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Ollama-specific settings section.
 * @param {{ status: any, isLoading: boolean, refetch: ()=>void }} props
 */
function OllamaSection({ status, isLoading, refetch }) {
  const saveConfig = useSaveAiConfig();
  const pullModel = usePullModel();

  const [urlDraft, setUrlDraft] = useState(/** @type {string|null} */ (null));
  const [pullName, setPullName] = useState('');
  const [pullProgress, setPullProgress] = useState(/** @type {Record<string,unknown>|null} */ (null));
  const [pulling, setPulling] = useState(false);
  const [pullError, setPullError] = useState('');
  const inputRef = useRef(/** @type {HTMLInputElement|null} */ (null));

  const ollama = status?.ollama ?? {};
  const url = urlDraft ?? ollama.url ?? 'http://localhost:11434';
  const currentModel = ollama.model ?? '';
  const models = ollama.models ?? [];

  useEffect(() => {
    if (ollama.url && urlDraft === null) setUrlDraft(ollama.url);
  }, [ollama.url]);

  function saveUrl() {
    if (url !== ollama.url) saveConfig.mutate({ url });
  }

  /** @param {string} name */
  function selectModel(name) {
    saveConfig.mutate({ model: name });
  }

  /** @param {import('react').FormEvent} e */
  async function doPull(e) {
    e.preventDefault();
    const name = pullName.trim();
    if (!name || pulling) return;
    setPulling(true);
    setPullError('');
    setPullProgress({ status: 'Starting…' });
    try {
      await pullModel(name, (line) => setPullProgress(line));
      setPullName('');
      setPullProgress(null);
    } catch (err) {
      setPullError(err instanceof Error ? err.message : String(err));
      setPullProgress(null);
    } finally {
      setPulling(false);
    }
  }

  const total = typeof pullProgress?.total === 'number' ? pullProgress.total : 0;
  const completed = typeof pullProgress?.completed === 'number' ? pullProgress.completed : 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : null;

  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-faint">Connection</div>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={url}
            onChange={(e) => setUrlDraft(e.target.value)}
            onBlur={saveUrl}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            placeholder="http://localhost:11434"
            className="h-8 min-w-0 flex-1 rounded-md border border-line bg-black/20 px-2.5 font-mono text-[13px] text-fg-strong placeholder:text-faint focus:border-accent focus:outline-none"
            aria-label="Ollama URL"
          />
          <button
            type="button"
            onClick={() => refetch()}
            className="h-8 rounded-md border border-line px-2.5 text-[12px] text-muted hover:bg-hover hover:text-fg"
          >
            {isLoading ? '…' : 'Test'}
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          {isLoading ? (
            <span className="text-[12px] text-faint">Checking…</span>
          ) : ollama.available ? (
            <>
              <StatusDot ok={true} warn={false} />
              <span className="text-[12px] text-fg">Ollama connected</span>
              {!ollama.modelAvailable && (
                <span className="ml-1 text-[12px] text-amber-400">— model "{ollama.model}" not pulled yet</span>
              )}
            </>
          ) : (
            <>
              <StatusDot ok={false} warn={false} />
              <span className="text-[12px] text-fg">{ollama.reason ?? 'Not reachable'}</span>
            </>
          )}
        </div>
      </section>

      {ollama.modelsDir && (
        <section>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">Models directory</div>
          <div className="flex items-center gap-2 rounded-md border border-line bg-black/20 px-2.5 py-1.5">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true" className="shrink-0 text-faint">
              <path d="M1.5 3.5h4l1 1.5h5v6h-10v-7.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted" title={ollama.modelsDir}>{ollama.modelsDir}</span>
          </div>
        </section>
      )}

      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <div className="text-[11px] font-medium uppercase tracking-wide text-faint">
            Installed models {models.length > 0 && <span className="font-normal normal-case">({models.length})</span>}
          </div>
          {models.length > 0 && <span className="text-[11px] text-faint">Click to use as active model</span>}
        </div>
        {models.length === 0 ? (
          <div className="rounded-md border border-dashed border-line px-3 py-3 text-center text-[13px] text-faint">
            {ollama.available ? 'No models installed. Pull one below.' : 'Connect Ollama to see models.'}
          </div>
        ) : (
          <div className="rounded-md border border-line bg-black/10 py-0.5">
            {models.map((/** @type {{name:string,size:number,modified_at:string,digest:string}} */ m) => (
              <ModelRow
                key={m.name}
                m={m}
                current={m.name === currentModel || m.name.startsWith(`${currentModel}:`)}
                onSelect={selectModel}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">Pull a model</div>
        <form onSubmit={doPull} className="flex gap-2">
          <input
            value={pullName}
            onChange={(e) => setPullName(e.target.value)}
            placeholder="e.g. llama3.1:8b  or  qwen3:8b"
            disabled={pulling}
            className="h-8 min-w-0 flex-1 rounded-md border border-line bg-black/20 px-2.5 font-mono text-[13px] text-fg-strong placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-50"
            aria-label="Model name to pull"
          />
          <button
            type="submit"
            disabled={pulling || !pullName.trim() || !ollama.available}
            className="h-8 shrink-0 rounded-md bg-accent px-3 text-[13px] font-medium text-root hover:brightness-110 disabled:opacity-50"
          >
            {pulling ? 'Pulling…' : 'Pull'}
          </button>
        </form>
        {pulling && pullProgress && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-[12px] text-muted">
              <span className="truncate">{String(pullProgress.status ?? '')}</span>
              {pct !== null && <span>{pct}%</span>}
            </div>
            {pct !== null && (
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-s-active">
                <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        )}
        {pullError && <p className="mt-1.5 text-[12px] text-fg">{pullError}</p>}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {['llama3.1:8b', 'qwen3:8b', 'gemma3:12b', 'llama3.2'].map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setPullName(name)}
              className="rounded-md border border-line px-2 py-0.5 font-mono text-[11px] text-faint hover:border-accent/40 hover:text-fg"
            >
              {name}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-faint">
          Models are downloaded from the Ollama registry and stored locally. Larger models produce better results but need more RAM.
        </p>
      </section>
    </div>
  );
}

/**
 * Claude API settings section.
 * @param {{ status: any }} props
 */
function ClaudeSection({ status }) {
  const saveConfig = useSaveAiConfig();
  const anthropic = status?.anthropic ?? {};
  const currentModel = anthropic.model ?? 'claude-haiku-4-5';

  const [keyDraft, setKeyDraft] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [wsDraft, setWsDraft] = useState(/** @type {string|null} */ (null));

  const currentWsId = wsDraft ?? anthropic.workspaceId ?? '';

  useEffect(() => {
    if (anthropic.workspaceId !== undefined && wsDraft === null) setWsDraft(anthropic.workspaceId);
  }, [anthropic.workspaceId]);

  function saveKey() {
    const k = keyDraft.trim();
    if (!k) return;
    saveConfig.mutate({ anthropicKey: k }, {
      onSuccess: () => {
        setKeyDraft('');
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      },
    });
  }

  function saveWorkspaceId() {
    const id = currentWsId.trim();
    if (id !== anthropic.workspaceId) saveConfig.mutate({ anthropicWorkspaceId: id });
  }

  /** @param {string} id */
  function selectModel(id) {
    saveConfig.mutate({ anthropicModel: id });
  }

  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-faint">API key</div>
        {anthropic.configured && !keyDraft && (
          <div className="mb-2 flex items-center gap-2">
            <StatusDot ok={true} warn={false} />
            <span className="text-[12px] text-fg">Key saved <span className="font-mono text-faint">{anthropic.keyMasked}</span></span>
          </div>
        )}
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveKey()}
              placeholder={anthropic.configured ? 'Enter new key to replace…' : 'sk-ant-…'}
              className="h-8 w-full rounded-md border border-line bg-black/20 px-2.5 pr-8 font-mono text-[13px] text-fg-strong placeholder:text-faint focus:border-accent focus:outline-none"
              aria-label="Anthropic API key"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-fg"
              aria-label={showKey ? 'Hide key' : 'Show key'}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                {showKey ? (
                  <path d="M1 7s2-4 6-4 6 4 6 4-2 4-6 4-6-4-6-4zm6 2a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                ) : (
                  <>
                    <path d="M1 7s2-4 6-4 6 4 6 4-2 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                    <path d="M2 2l10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </>
                )}
              </svg>
            </button>
          </div>
          <button
            type="button"
            onClick={saveKey}
            disabled={!keyDraft.trim() || saveConfig.isPending}
            className="h-8 shrink-0 rounded-md bg-accent px-3 text-[13px] font-medium text-root hover:brightness-110 disabled:opacity-50"
          >
            {saved ? 'Saved ✓' : 'Save'}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-faint">
          Get your key at <span className="font-mono">console.anthropic.com</span>. It's stored only on your server.
        </p>
      </section>

      <section>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-faint">Workspace ID <span className="normal-case font-normal text-faint/60">(if required)</span></div>
        <input
          value={currentWsId}
          onChange={(e) => setWsDraft(e.target.value)}
          onBlur={saveWorkspaceId}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          placeholder="wrkspc_…"
          className="h-8 w-full rounded-md border border-line bg-black/20 px-2.5 font-mono text-[13px] text-fg-strong placeholder:text-faint focus:border-accent focus:outline-none"
          aria-label="Anthropic workspace ID"
        />
        <p className="mt-1.5 text-[11px] text-faint">
          Required when your API key isn't scoped to a specific workspace. Find it in your Anthropic console under Settings → Workspaces.
        </p>
      </section>

      <section>
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">Model</div>
        <div className="rounded-md border border-line bg-black/10 py-0.5">
          {CLAUDE_MODELS.map((m) => {
            const active = currentModel === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => selectModel(m.id)}
                className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left hover:bg-s-active"
              >
                <span className={`text-[10px] font-semibold ${active ? 'text-accent' : 'text-transparent'}`}>●</span>
                <span className="flex-1">
                  <span className={`text-[13px] ${active ? 'text-fg-strong' : 'text-fg'}`}>{m.label}</span>
                  {m.recommended && (
                    <span className="ml-1.5 rounded bg-accent/15 px-1 py-0.5 text-[10px] font-medium text-accent">recommended</span>
                  )}
                  <span className="ml-2 text-[11px] text-faint">{m.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-faint">
          Haiku 4.5 is ideal for summarizing and answering questions from notes — fast, accurate, and a fraction of a cent per call.
        </p>
      </section>
    </div>
  );
}

/**
 * Giphy API key for GIF search in image blocks.
 * @param {{ status: any }} props
 */
function GiphySection({ status }) {
  const saveConfig = useSaveAiConfig();
  const [keyDraft, setKeyDraft] = useState('');
  const [saved, setSaved] = useState(false);
  const configured = status?.giphy?.configured ?? false;

  function saveKey() {
    const k = keyDraft.trim();
    if (!k) return;
    saveConfig.mutate({ giphyKey: k }, {
      onSuccess: () => { setKeyDraft(''); setSaved(true); setTimeout(() => setSaved(false), 2000); },
    });
  }

  return (
    <section>
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-faint">Giphy — GIF search</div>
      {configured && !keyDraft && (
        <div className="mb-2 flex items-center gap-2">
          <StatusDot ok={true} warn={false} />
          <span className="text-[12px] text-fg">API key saved — GIF search enabled in image blocks</span>
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="password"
          value={keyDraft}
          onChange={(e) => setKeyDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveKey()}
          placeholder={configured ? 'Enter new key to replace…' : 'Giphy API key…'}
          className="h-8 min-w-0 flex-1 rounded-md border border-line bg-black/20 px-2.5 font-mono text-[13px] text-fg-strong placeholder:text-faint focus:border-accent focus:outline-none"
          aria-label="Giphy API key"
        />
        <button
          type="button"
          onClick={saveKey}
          disabled={!keyDraft.trim() || saveConfig.isPending}
          className="h-8 shrink-0 rounded-md bg-accent px-3 text-[13px] font-medium text-root hover:brightness-110 disabled:opacity-50"
        >
          {saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-faint">
        Free developer key at <span className="font-mono">developers.giphy.com</span>. Enables GIF search inside image blocks (type <span className="font-mono">/image</span> in the editor).
      </p>
    </section>
  );
}

/**
 * Unsplash access key for photo search in page covers.
 * @param {{ status: any }} props
 */
function UnsplashSection({ status }) {
  const saveConfig = useSaveAiConfig();
  const [keyDraft, setKeyDraft] = useState('');
  const [saved, setSaved] = useState(false);
  const configured = status?.unsplash?.configured ?? false;

  function saveKey() {
    const k = keyDraft.trim();
    if (!k) return;
    saveConfig.mutate({ unsplashKey: k }, {
      onSuccess: () => { setKeyDraft(''); setSaved(true); setTimeout(() => setSaved(false), 2000); },
    });
  }

  return (
    <section>
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-faint">Unsplash — photo covers</div>
      {configured && !keyDraft && (
        <div className="mb-2 flex items-center gap-2">
          <StatusDot ok={true} warn={false} />
          <span className="text-[12px] text-fg">Access key saved — photo search enabled in cover picker</span>
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="password"
          value={keyDraft}
          onChange={(e) => setKeyDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveKey()}
          placeholder={configured ? 'Enter new key to replace…' : 'Unsplash access key…'}
          className="h-8 min-w-0 flex-1 rounded-md border border-line bg-black/20 px-2.5 font-mono text-[13px] text-fg-strong placeholder:text-faint focus:border-accent focus:outline-none"
          aria-label="Unsplash access key"
        />
        <button
          type="button"
          onClick={saveKey}
          disabled={!keyDraft.trim() || saveConfig.isPending}
          className="h-8 shrink-0 rounded-md bg-accent px-3 text-[13px] font-medium text-root hover:brightness-110 disabled:opacity-50"
        >
          {saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-faint">
        Free access key at <span className="font-mono">unsplash.com/developers</span>. Adds a "Photos" tab to the page cover picker — photos download and store locally.
      </p>
    </section>
  );
}

/**
 * AI settings panel — provider toggle (Ollama / Claude) with per-provider config.
 */
export function AiPanel() {
  const { data: auth } = useAuthState();
  const { data: status, isLoading, refetch } = useAiStatus();
  const saveConfig = useSaveAiConfig();

  if (auth?.user?.isDemo) {
    return (
      <div className="rounded-md border border-dashed border-line px-4 py-5 text-center text-[13px] text-muted">
        AI and integration settings are not available in demo mode.
      </div>
    );
  }

  const provider = status?.provider ?? 'ollama';

  /** @param {string} p */
  function setProvider(p) {
    saveConfig.mutate({ provider: p });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Provider toggle */}
      <section>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-faint">Provider</div>
        <div className="flex gap-1 rounded-md border border-line bg-black/10 p-1">
          {[
            { id: 'ollama', label: 'Ollama (local)' },
            { id: 'anthropic', label: 'Claude (cloud)' },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setProvider(opt.id)}
              className={`flex-1 rounded py-1.5 text-[13px] transition-colors ${
                provider === opt.id
                  ? 'bg-s-page text-fg-strong shadow-sm'
                  : 'text-muted hover:text-fg'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {provider === 'ollama' ? (
        <OllamaSection status={status} isLoading={isLoading} refetch={refetch} />
      ) : (
        <ClaudeSection status={status} />
      )}

      <div className="border-t border-line/50 pt-5 flex flex-col gap-5">
        <GiphySection status={status} />
        <UnsplashSection status={status} />
      </div>
    </div>
  );
}

/** @deprecated Use AiPanel instead */
export const OllamaPanel = AiPanel;
