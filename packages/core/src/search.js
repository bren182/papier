import { z } from 'zod';

export { HIT_START, HIT_END, snippetParts } from './text.js';

/** `GET /api/search` query string. */
export const SearchQuery = z.object({
  q: z.string().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

/** @typedef {z.infer<typeof SearchQuery>} SearchQuery */
