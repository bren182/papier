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

## Editor (`apps/web/src/editor/`)

TipTap v3 with our own schema, not a kit. Lazy-loaded as one chunk (`editor/index.js`).

- The ProseMirror doc is a **flat list of blocks** with `id` + `indent` attrs; nesting
  is indentation. `convert.js` maps it to/from stored rows (a `parent_id` tree with
  fractional `order` keys) and maps marks to the stored, editor-agnostic inline format
  (`{type:'text',text,styles}`, `{type:'link',…}`, `{type:'date',props:{date}}`).
- `schema.js`: nodes, plus `TreeInvariants` (clamps indents, gives every block a
  unique id) and list numbering. `keymap.js` / `inputRules.js`: Notion-style keys.
  `blockOps.js`: shared block operations. `dropPlan.js`: drag-and-drop gap/level/type.
- Autosave: `blockSaver.js` diffs rows against what the server confirmed and posts
  one batch (`POST /api/pages/:id/blocks/batch`).
- Dates are stored as `YYYY-MM-DD` and rendered live and relative (`dates.js`). Page
  titles with dates use `pages.title_content`; plain `title` is derived for search.
- Headless editor tests run a real TipTap editor in jsdom (`editor.test.js`); drag
  geometry and visuals still need a browser (Playwright harness planned).

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
- Long inline scripts with quotes can break the Bash tool's heredoc parsing; write the
  script to the scratchpad and run the file instead.
- `@papier/core` pulls in zod; client code in the main bundle should import
  zod-free helpers from `@papier/core/text` to keep zod out of it.
- HTML5 drag: never unmount or `preventDefault()` the mousedown of the drag source
  (the block handle) — the drag silently dies and `dragend` never fires.

## Workflow

- Iterate, then stop with changes **uncommitted** for the user to review; commit/push
  only when asked. Repo: github.com/bren182/papier (private), branch `main`.
- Use plan mode for big features (editor, Yjs sync, databases).
- Stop dev servers you start before finishing.
