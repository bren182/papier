import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { WorkspaceUpdate } from '@papier/core';
import { memberRole, userWorkspaces } from '../auth/sessions.ts';
import type { Db } from '../db/index.ts';
import { liveLineage } from '../db/lineage.ts';
import { pages, workspaces } from '../db/schema.ts';

export function workspaceRoutes(app: FastifyInstance, db: Db) {
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
