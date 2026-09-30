# Papier

Self-hosted, block-based workspace (a personal Notion). `README.md` is the living scope
doc — milestones, stack, data model, scale rules, visual style, open questions. Read it
before planning a feature; tick its checkboxes when items land.

## Commands

```bash
pnpm dev                                   # server :3000 + web :5173 (Vite proxies /api)
pnpm test                                  # Vitest, all packages
pnpm typecheck                             # tsc on server (TS) and web (JSDoc via jsconfig)
pnpm build
pnpm --filter @papier/server db:generate   # drizzle-kit: new SQL migration from schema.ts
```

Migrations in `apps/server/drizzle/` are committed and applied on server start. Dev DB:
`apps/server/data/papier.db` (gitignored; override with `DATABASE_PATH`).

## Layout

- `apps/server` — Fastify, **TypeScript**, run directly by Node 24 type stripping (no
  build). `app.ts` builds the app (`buildApp({ dbPath, logger })`), routes in
  `src/routes/`, Drizzle schema in `src/db/schema.ts`.
- `apps/web` — React + Vite + Tailwind v4, **plain JS + JSDoc types** (`checkJs`).
  Server state via TanStack Query hooks in `src/api/`; open page lives in the URL (`?p=`).
- `packages/core` — shared zod schemas + helpers (JS + JSDoc), e.g. `Page`, `Block`,
  `orderBetween` (fractional indexing). Validate API input with these.
- `packages/ui` — `theme.css` tokens and `Backdrop`. Tailwind maps tokens in
  `apps/web/src/index.css` (`bg-s-page`, `text-muted`, `text-fg-strong`, …).

## Conventions

- Server TS: `erasableSyntaxOnly` — no `enum`/`namespace`/parameter properties; import
  local files with the `.ts` extension.
- Client JS: type with JSDoc (`@typedef`, `@param`); keep `pnpm typecheck` clean.
- Styling: **colour lives behind the glass, everything you read is grayscale.** Palette
  colours only in the backdrop; UI uses the grey ramp + one accent (Sky `#7BB2D9`).
  Use the surface tokens (`--s-*`) so ambient / clear-glass / grayscale modes all work.
- Scale: nothing loads "everything" — lists are per-parent/paginated, filtering in SQL.
- Trash = `archived_at` set; descendants are hidden with their ancestor.
- Tests: server routes via `app.inject` on an in-memory DB (`buildApp({ logger: false })`).

## Gotchas

- Drizzle renders `${table.column}` **unqualified** in single-table queries — inside a
  correlated subquery it binds to the inner row. Write `pages.id` literally there.
- pnpm blocks install scripts by default; allowed ones are listed under `allowBuilds` in
  `pnpm-workspace.yaml` (esbuild, for drizzle-kit).
- Git Bash on Windows can mangle non-ASCII in `curl -d '…'` args; use a heredoc with
  `--data-binary @-` when smoke-testing.

## Workflow

- Iterate, then stop with changes **uncommitted** for the user to review; commit/push
  only when asked. Repo: github.com/bren182/papier (private), branch `main`.
- Use plan mode for big features (editor, Yjs sync, databases).
- Stop dev servers you start before finishing.
