import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { WorkspaceCreate, WorkspaceUpdate } from '@papier/core';
import { addMember, memberRole, userWorkspaces } from '../auth/sessions.ts';
import type { Db } from '../db/index.ts';
import { liveLineage } from '../db/lineage.ts';
import { pages, workspaces } from '../db/schema.ts';

export function workspaceRoutes(app: FastifyInstance, db: Db) {
  /** Create a new workspace; the caller becomes its owner. */
  app.post('/api/workspaces', async (req, reply) => {
    if (req.user?.isDemo) return reply.code(403).send({ error: 'Not available in demo mode' });
    const { name } = WorkspaceCreate.parse(req.body);
    const id = randomUUID();
    const now = Date.now();
    db.insert(workspaces).values({ id, name, createdAt: now }).run();
    addMember(db, id, req.user!.id, 'owner', now);
    return userWorkspaces(db, req.user!.id).find((w) => w.id === id);
  });

  /**
   * Rename a workspace, set its icon (owners), or choose its Home page (owners
   * and editors). Home must be a live page in this workspace.
   */
  app.patch<{ Params: { id: string } }>('/api/workspaces/:id', async (req, reply) => {
    const input = WorkspaceUpdate.parse(req.body);
    const role = req.user ? memberRole(db, req.params.id, req.user.id) : null;
    if (!role) return reply.code(404).send({ error: 'Workspace not found' });
    if (role === 'viewer' || ((input.name !== undefined || input.icon !== undefined) && role !== 'owner')) {
      return reply.code(403).send({ error: 'Not allowed in this workspace' });
    }
    if (input.homePageId) {
      const page = db.select({ workspaceId: pages.workspaceId }).from(pages).where(eq(pages.id, input.homePageId)).get();
      if (!page || page.workspaceId !== req.params.id || !liveLineage(db, input.homePageId)) {
        return reply.code(400).send({ error: 'Home must be a page in this workspace' });
      }
    }
    if (Object.keys(input).length) db.update(workspaces).set(input).where(eq(workspaces.id, req.params.id)).run();
    return userWorkspaces(db, req.user!.id).find((w) => w.id === req.params.id);
  });
}
