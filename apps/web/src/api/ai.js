import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export const aiStatusKey = ['ai', 'status'];

/** Full Ollama status: availability, current model, all pulled models, models dir. */
export function useAiStatus() {
  return useQuery({
    queryKey: aiStatusKey,
    queryFn: () => api('/ai/status'),
    staleTime: 15_000,
    retry: false,
  });
}

/** Save any combination of AI config fields. Invalidates the status query on success. */
export function useSaveAiConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (/** @type {{ provider?: string, url?: string, model?: string, anthropicKey?: string, anthropicModel?: string, anthropicWorkspaceId?: string, giphyKey?: string, unsplashKey?: string }} */ patch) =>
      api('/ai/config', { method: 'PATCH', body: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiStatusKey }),
  });
}

/**
 * Pull a model from the Ollama registry.
 * Calls `onProgress` with each parsed JSON line from Ollama's streaming response.
 * @returns {(name: string, onProgress: (line: Record<string,unknown>) => void) => Promise<void>}
 */
export function usePullModel() {
  const qc = useQueryClient();
  return async (
    /** @type {string} */ name,
    /** @type {(line: Record<string,unknown>) => void} */ onProgress,
  ) => {
    const res = await fetch('/api/ai/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Papier': '1' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok || !res.body) throw new Error(`Pull failed: ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n\n');
      buf = lines.pop() ?? '';
      for (const block of lines) {
        const data = block.replace(/^data: /, '').trim();
        if (data) {
          try { onProgress(JSON.parse(data)); }
          catch { /* ignore non-JSON */ }
        }
      }
    }
    qc.invalidateQueries({ queryKey: aiStatusKey });
  };
}

/** Delete a pulled model. */
export function useDeleteModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (/** @type {string} */ name) =>
      api(`/ai/models/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiStatusKey }),
  });
}

/** Ask a question answered from workspace content. */
export function useAskAi() {
  return useMutation({
    mutationFn: (/** @type {{ query: string }} */ input) =>
      api('/ai/ask', { method: 'POST', body: input }),
  });
}

/** Summarize a page. */
export function useSummarizePage() {
  return useMutation({
    mutationFn: (/** @type {{ pageId: string }} */ input) =>
      api('/ai/summarize', { method: 'POST', body: input }),
  });
}
