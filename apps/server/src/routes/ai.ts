import { homedir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { plainText } from '@papier/core';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.ts';
import { getSetting, setSetting } from '../db/settings.ts';
import { searchPages, type SearchHit } from '../db/search.ts';

// --- Provider config ---

type Provider = 'ollama' | 'anthropic';

function getProvider(db: Db): Provider {
  return (getSetting(db, 'ai_provider') ?? 'ollama') as Provider;
}
function getAnthropicKey(db: Db): string {
  return getSetting(db, 'anthropic_api_key') ?? '';
}
function getAnthropicModel(db: Db): string {
  return getSetting(db, 'anthropic_model') ?? 'claude-haiku-4-5';
}
function getAnthropicWorkspaceId(db: Db): string {
  return getSetting(db, 'anthropic_workspace_id') ?? '';
}
function getGiphyKey(db: Db): string {
  return getSetting(db, 'giphy_api_key') ?? '';
}
function getUnsplashKey(db: Db): string {
  return getSetting(db, 'unsplash_access_key') ?? '';
}

// --- Ollama ---

// Use 127.0.0.1 instead of localhost — on Windows 11, localhost resolves to ::1 first
// and Ollama only listens on 127.0.0.1:11434.
const DEFAULT_OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2';

function getOllamaUrl(db: Db) {
  return getSetting(db, 'ollama_url') ?? DEFAULT_OLLAMA_URL;
}
function getOllamaModel(db: Db) {
  return getSetting(db, 'ollama_model') ?? DEFAULT_OLLAMA_MODEL;
}

/** Estimated path where Ollama stores models on this OS. */
function modelsDir(): string {
  const fromEnv = process.env.OLLAMA_MODELS;
  if (fromEnv) return fromEnv;
  return join(homedir(), '.ollama', 'models');
}

type OllamaModel = { name: string; size: number; modified_at: string; digest: string };

async function ollamaFetch(url: string, path: string, options?: RequestInit) {
  return fetch(`${url}${path}`, { signal: AbortSignal.timeout(5_000), ...options });
}

async function ollamaStatus(db: Db) {
  const url = getOllamaUrl(db);
  const model = getOllamaModel(db);
  try {
    const res = await ollamaFetch(url, '/api/tags');
    if (!res.ok) return { available: false, reason: `Ollama returned ${res.status}`, url, model, models: [] };
    const data = (await res.json()) as { models?: OllamaModel[] };
    const models = data.models ?? [];
    const modelAvailable = models.some((m) => m.name === model || m.name.startsWith(`${model}:`));
    return { available: true, modelAvailable, url, model, models, modelsDir: modelsDir() };
  } catch {
    return { available: false, reason: 'Ollama not reachable — is it running?', url, model, models: [], modelsDir: modelsDir() };
  }
}

async function ollamaChat(url: string, model: string, messages: { role: string; content: string }[]) {
  const res = await fetch(`${url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Ollama responded ${res.status}`);
  const data = (await res.json()) as { message?: { content: string } };
  return data.message?.content ?? '';
}

// --- Anthropic ---

async function anthropicChat(apiKey: string, model: string, workspaceId: string, messages: { role: string; content: string }[]) {
  const client = new Anthropic({
    apiKey,
    ...(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {}),
  });
  const sysMsg = messages.find((m) => m.role === 'system');
  const userMsgs = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    ...(sysMsg ? { system: sysMsg.content } : {}),
    messages: userMsgs,
  });
  const block = response.content.find((b) => b.type === 'text');
  return block?.type === 'text' ? block.text : '';
}

/** Mask an API key: show only the last 4 chars. */
function maskKey(key: string): string | null {
  if (!key) return null;
  return `...${key.slice(-4)}`;
}

// --- Unified chat router ---

async function aiChat(db: Db, messages: { role: string; content: string }[]): Promise<string> {
  const provider = getProvider(db);
  if (provider === 'anthropic') {
    const key = getAnthropicKey(db);
    if (!key) throw new Error('Anthropic API key not configured.');
    return anthropicChat(key, getAnthropicModel(db), getAnthropicWorkspaceId(db), messages);
  }
  return ollamaChat(getOllamaUrl(db), getOllamaModel(db), messages);
}

// --- Page context helpers (unchanged) ---

function pageContext(db: Db, pageId: string, anchorBlockId: string | null, limit = 40): string {
  const toText = (r: { content: string }) => {
    try { return plainText(JSON.parse(r.content) as Parameters<typeof plainText>[0]); }
    catch { return ''; }
  };

  const meta = db.get<{ kind: string }>(sql`select kind from pages where id = ${pageId}`);
  if (meta?.kind === 'database') {
    const rows = db.all<{ title: string; props: string }>(sql`
      select p.title, coalesce(
        (select json_group_array(json_object('k', d.name, 'v', pv.value))
         from page_props pv join db_properties d on d.id = pv.prop_id
         where pv.page_id = p.id and d.type not in ('button','formula','rollup')
         limit 10), '[]'
      ) as props
      from pages p
      where p.parent_id = ${pageId} and p.archived_at is null and p.is_template = 0
      order by p.order_key limit ${limit}
    `);
    return rows.map((r) => {
      let line = r.title || 'Untitled';
      try {
        const props = JSON.parse(r.props) as { k: string; v: string }[];
        const extras = props
          .filter((p) => p.v && p.v !== '{}' && p.v !== '[]' && p.v !== 'null')
          .map((p) => `${p.k}: ${typeof p.v === 'string' ? p.v.replace(/^"|"$/g, '') : p.v}`)
          .join(', ');
        if (extras) line += ` — ${extras}`;
      } catch { /* ignore */ }
      return line;
    }).join('\n');
  }

  if (anchorBlockId) {
    const all = db.all<{ id: string; content: string }>(
      sql`select id, content from blocks where page_id = ${pageId} order by order_key`,
    );
    const idx = all.findIndex((r) => r.id === anchorBlockId);
    const start = Math.max(0, (idx >= 0 ? idx : 0) - 5);
    return all.slice(start, start + limit).map(toText).filter(Boolean).join('\n');
  }

  const rows = db.all<{ content: string }>(
    sql`select content from blocks where page_id = ${pageId} order by order_key limit ${limit}`,
  );
  return rows.map(toText).filter(Boolean).join('\n');
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'not', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'from',
  'is', 'are', 'was', 'were', 'be', 'been', 'am', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'can', 'may', 'might',
  'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'she', 'it', 'they', 'them', 'their',
  'this', 'that', 'these', 'those', 'there', 'here', 'now',
  'what', 'who', 'how', 'why', 'when', 'where', 'which',
  'some', 'any', 'all', 'about',
]);

function isoDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

// --- Routes ---

/** 403 unless the user is an admin. Blocks demo accounts and non-admin editors/viewers from changing server config. */
function requireAdmin(req: { user: { isAdmin: boolean; isDemo: boolean } | null }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
  if (!req.user?.isAdmin) return reply.code(403).send({ error: 'Admin access required' });
}

export function aiRoutes(app: FastifyInstance, db: Db) {
  /** Full status: active provider + per-provider config/availability. */
  app.get('/api/ai/status', async () => {
    const provider = getProvider(db);
    const ollama = await ollamaStatus(db);
    const anthropicKey = getAnthropicKey(db);
    return {
      provider,
      ollama,
      anthropic: {
        configured: !!anthropicKey,
        keyMasked: maskKey(anthropicKey),
        model: getAnthropicModel(db),
        workspaceId: getAnthropicWorkspaceId(db),
      },
      giphy: { configured: !!getGiphyKey(db) },
      unsplash: { configured: !!getUnsplashKey(db) },
    };
  });

  /** Search Giphy — proxied server-side to keep the API key out of the browser. */
  app.get('/api/ai/giphy', async (req, reply) => {
    const key = getGiphyKey(db);
    if (!key) return reply.code(503).send({ error: 'Giphy API key not configured.' });
    const { q } = z.object({ q: z.string().trim().min(1).max(200) }).parse(req.query);
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&limit=12&rating=g&lang=en`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return reply.code(res.status).send({ error: `Giphy returned ${res.status}` });
    const data = await res.json() as { data?: { images?: { original?: { url?: string }, fixed_height_small?: { url?: string } } }[] };
    const results = (data.data ?? []).map((g) => ({
      url: g.images?.original?.url ?? '',
      preview: g.images?.fixed_height_small?.url ?? g.images?.original?.url ?? '',
    })).filter((r) => r.url);
    return { results };
  });

  /** Search Unsplash photos — proxied server-side to keep the access key out of the browser. */
  app.get('/api/ai/unsplash', async (req, reply) => {
    const key = getUnsplashKey(db);
    if (!key) return reply.code(503).send({ error: 'Unsplash access key not configured.' });
    const { q } = z.object({ q: z.string().trim().min(1).max(200) }).parse(req.query);
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=12&orientation=landscape&client_id=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return reply.code(res.status).send({ error: `Unsplash returned ${res.status}` });
    const data = await res.json() as { results?: { urls?: { thumb?: string; regular?: string }; links?: { download_location?: string }; alt_description?: string | null }[] };
    const results = (data.results ?? []).map((p) => ({
      thumb: p.urls?.thumb ?? '',
      regular: p.urls?.regular ?? '',
      downloadLocation: p.links?.download_location ?? '',
      alt: p.alt_description ?? '',
    })).filter((r) => r.thumb);
    return { results };
  });

  /** Trigger Unsplash download event (required by API ToS) — fire-and-forget from the client. */
  app.post('/api/ai/unsplash/download', async (req, reply) => {
    const key = getUnsplashKey(db);
    if (!key) return reply.code(503).send({ error: 'Unsplash access key not configured.' });
    const { downloadLocation } = z.object({ downloadLocation: z.string().url() }).parse(req.body);
    if (!downloadLocation.startsWith('https://api.unsplash.com/')) {
      return reply.code(400).send({ error: 'Invalid download location.' });
    }
    fetch(`${downloadLocation}&client_id=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(5_000) }).catch(() => {});
    return { ok: true };
  });

  /** Save any combination of provider, Ollama URL/model, or Anthropic key/model. */
  app.patch('/api/ai/config', async (req, reply) => {
    if (requireAdmin(req, reply)) return;
    const body = z.object({
      provider: z.enum(['ollama', 'anthropic']).optional(),
      url: z.string().url().optional(),
      model: z.string().min(1).optional(),
      anthropicKey: z.string().optional(),
      anthropicModel: z.string().min(1).optional(),
      anthropicWorkspaceId: z.string().optional(),
      giphyKey: z.string().optional(),
      unsplashKey: z.string().optional(),
    }).parse(req.body);

    if (body.provider !== undefined) setSetting(db, 'ai_provider', body.provider);
    if (body.url !== undefined) setSetting(db, 'ollama_url', body.url);
    if (body.model !== undefined) setSetting(db, 'ollama_model', body.model);
    if (body.anthropicKey !== undefined) setSetting(db, 'anthropic_api_key', body.anthropicKey);
    if (body.anthropicModel !== undefined) setSetting(db, 'anthropic_model', body.anthropicModel);
    if (body.anthropicWorkspaceId !== undefined) setSetting(db, 'anthropic_workspace_id', body.anthropicWorkspaceId);
    if (body.giphyKey !== undefined) setSetting(db, 'giphy_api_key', body.giphyKey);
    if (body.unsplashKey !== undefined) setSetting(db, 'unsplash_access_key', body.unsplashKey);

    const provider = getProvider(db);
    const ollama = await ollamaStatus(db);
    const anthropicKey = getAnthropicKey(db);
    return {
      provider,
      ollama,
      anthropic: {
        configured: !!anthropicKey,
        keyMasked: maskKey(anthropicKey),
        model: getAnthropicModel(db),
        workspaceId: getAnthropicWorkspaceId(db),
      },
      giphy: { configured: !!getGiphyKey(db) },
      unsplash: { configured: !!getUnsplashKey(db) },
    };
  });

  /**
   * Pull a model from the Ollama registry — streams SSE progress events.
   * Only relevant when the provider is Ollama.
   */
  app.post('/api/ai/pull', async (req, reply) => {
    if (requireAdmin(req, reply)) return;
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    const url = getOllamaUrl(db);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    try {
      const res = await fetch(`${url}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, stream: true }),
        signal: AbortSignal.timeout(30 * 60_000),
      });
      if (!res.ok || !res.body) {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: `Ollama returned ${res.status}` })}\n\n`);
        reply.raw.end();
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim()) reply.raw.write(`data: ${line}\n\n`);
        }
      }
      if (buf.trim()) reply.raw.write(`data: ${buf}\n\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
    }
    reply.raw.end();
  });

  /** Delete a pulled Ollama model. */
  app.delete('/api/ai/models/:name', async (req, reply) => {
    if (requireAdmin(req, reply)) return;
    const { name } = req.params as { name: string };
    const url = getOllamaUrl(db);
    try {
      const res = await ollamaFetch(url, '/api/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return reply.code(res.status).send({ error: `Ollama returned ${res.status}` });
      return { deleted: name };
    } catch (err) {
      return reply.code(503).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Ask a question answered from workspace content. */
  app.post('/api/ai/ask', async (req, reply) => {
    const { query } = z.object({ query: z.string().trim().min(1).max(500) }).parse(req.body);
    const today = isoDate();

    const expanded = query
      .replace(/\btoday\b/gi, `today ${today}`)
      .replace(/\byesterday\b/gi, `yesterday ${isoDate(-1)}`);

    const terms = expanded
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

    const sortedTerms = [...terms].sort((a, b) => {
      const aDate = a === 'today' || a === 'yesterday' || /^\d{4}-\d{2}-\d{2}$/.test(a);
      const bDate = b === 'today' || b === 'yesterday' || /^\d{4}-\d{2}-\d{2}$/.test(b);
      if (aDate !== bDate) return aDate ? -1 : 1;
      return b.length - a.length;
    });

    const scores = new Map<string, { score: number; hit: SearchHit }>();
    for (const term of sortedTerms.slice(0, 8)) {
      for (const h of searchPages(db, term, { limit: 5, offset: 0 }).items) {
        const e = scores.get(h.pageId);
        if (e) e.score++;
        else scores.set(h.pageId, { score: 1, hit: h });
      }
    }
    const hits = [...scores.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ hit }) => hit);

    if (!hits.length) {
      return { answer: "I couldn't find any relevant pages in your workspace for that question.", sources: [] };
    }

    const sources = hits.map((h) => ({ id: h.pageId, title: h.title || 'Untitled' }));
    const context = hits
      .map((h) => `## ${h.title || 'Untitled'}\n${pageContext(db, h.pageId, h.blockId)}`)
      .join('\n\n---\n\n');

    const messages = [
      {
        role: 'system',
        content:
          `You are a helpful assistant for a personal notes workspace called Papier. Today is ${today}. ` +
          'Answer the question using ONLY the provided notes — do not add any information not explicitly stated in the notes. ' +
          'Be concise: 1–3 short paragraphs or a brief bullet list. ' +
          'If the notes do not contain enough information to fully answer, say so explicitly.',
      },
      { role: 'user', content: `Relevant pages from the workspace:\n\n${context}\n\n---\n\nQuestion: ${query}` },
    ];

    try {
      const answer = await aiChat(db, messages);
      return { answer, sources };
    } catch (err) {
      reply.code(503);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  /** Summarize a page. */
  app.post('/api/ai/summarize', async (req, reply) => {
    const { pageId } = z.object({ pageId: z.string() }).parse(req.body);

    const page = db.get<{ id: string; title: string; archived_at: number | null }>(
      sql`select id, title, archived_at from pages where id = ${pageId} limit 1`,
    );
    if (!page || page.archived_at) return reply.code(404).send({ error: 'Page not found' });

    const body = pageContext(db, pageId, null, 60);
    if (!body.trim()) return { pageId, title: page.title, raw: 'This page has no content to summarize.' };

    const messages = [
      { role: 'system', content: 'You are a concise summarizer. Given a page from a personal notes app, produce:\n1. A one-sentence summary (labelled "Summary:")\n2. 3–5 key points as a bullet list (labelled "Key points:")\nKeep it brief and plain.' },
      { role: 'user', content: `Title: ${page.title || 'Untitled'}\n\nContent:\n${body}` },
    ];

    try {
      const raw = await aiChat(db, messages);
      return { pageId, title: page.title, raw };
    } catch (err) {
      reply.code(503);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
