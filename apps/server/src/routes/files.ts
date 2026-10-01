import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml',
  'application/pdf',
]);

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/avif': '.avif', 'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
};

const EXT_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
};

export function fileRoutes(app: FastifyInstance, uploadsDir: string) {
  // Upload (auth required — authPlugin covers /api/*)
  app.post('/api/files', async (req, reply) => {
    const part = await (req as any).file();
    if (!part) return reply.code(400).send({ error: 'No file' });
    const mime = part.mimetype as string;
    if (!ALLOWED_TYPES.has(mime)) return reply.code(415).send({ error: 'Unsupported file type' });
    const ext = MIME_EXT[mime] ?? extname(part.filename as string) ?? '';
    const id = randomUUID();
    const name = `${id}${ext}`;
    await pipeline(part.file, createWriteStream(join(uploadsDir, name)));
    return { id, url: `/files/${name}` };
  });

  // Fetch a remote image URL and store it locally — SSRF-safe: only images.unsplash.com.
  app.post('/api/files/fetch', async (req, reply) => {
    const { url } = z.object({ url: z.string().url() }).parse(req.body);
    const parsed = new URL(url);
    if (parsed.hostname !== 'images.unsplash.com') {
      return reply.code(400).send({ error: 'Only Unsplash image URLs are supported.' });
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok || !res.body) return reply.code(502).send({ error: 'Could not fetch image.' });
    const ct = ((res.headers.get('content-type') ?? '').split(';')[0] ?? '').trim();
    if (!ALLOWED_TYPES.has(ct) && !ct.startsWith('image/')) {
      return reply.code(415).send({ error: 'Unsupported file type.' });
    }
    const ext = MIME_EXT[ct] ?? '.jpg';
    const id = randomUUID();
    const name = `${id}${ext}`;
    await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), createWriteStream(join(uploadsDir, name)));
    return { id, url: `/files/${name}` };
  });

  // Serve (no auth — not under /api, immutable CDN-style URLs)
  app.get('/files/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!/^[0-9a-f-]{36}\.[a-z0-9]+$/i.test(name)) return reply.code(404).send();
    const file = join(uploadsDir, name);
    if (!existsSync(file)) return reply.code(404).send();
    const ct = EXT_MIME[extname(name).toLowerCase()] ?? 'application/octet-stream';
    return reply
      .header('Content-Type', ct)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(createReadStream(file));
  });
}
