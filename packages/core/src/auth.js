import { z } from 'zod';
import { MIN_PASSWORD } from './text.js';

export { MIN_PASSWORD };

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(MIN_PASSWORD, `At least ${MIN_PASSWORD} characters`).max(200);
const name = z.string().trim().min(1).max(100);

/** `POST /api/auth/setup`: the first account, while there are none. */
export const AuthSetup = z.object({
  setupToken: z.string().min(1).max(200),
  email,
  name,
  password,
  workspaceName: z.string().trim().max(100).optional(),
});

/** `POST /api/auth/login`. `client: 'desktop'` returns a bearer token instead of a cookie. */
export const AuthLogin = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().max(200),
  client: z.enum(['web', 'desktop']).default('web'),
});

/** `POST /api/auth/password`. */
export const PasswordChange = z.object({ current: z.string().max(200), next: password });

/** `PATCH /api/auth/me`. */
export const ProfileUpdate = z.object({ name });

/** @typedef {z.infer<typeof AuthSetup>} AuthSetup */
/** @typedef {z.infer<typeof AuthLogin>} AuthLogin */

/** `PATCH /api/workspaces/:id`: rename, icon (null clears), Home page (null = none). */
export const WorkspaceUpdate = z
  .object({
    name: z.string().trim().min(1).max(100),
    icon: z.string().max(64).nullable(),
    homePageId: z.string().max(100).nullable(),
  })
  .partial();
