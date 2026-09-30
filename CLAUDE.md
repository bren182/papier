# Papier

Self-hosted, block-based workspace (a personal Notion). `README.md` is the living scope
doc — milestones, stack, data model, scale rules, visual style, open questions. Read it
before planning a feature; tick its checkboxes when items land.

## Commands

```bash
pnpm dev                                   # server :3000 + web :5173 (Vite proxies /api)
pnpm test                                  # Vitest, all packages
pnpm test:e2e                              # Playwright (apps/web/e2e), own server + DB
pnpm --filter @papier/web shot "/?p=<id>" out.png   # screenshot a running `pnpm dev`
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
- Headless editor tests run a real TipTap editor in jsdom (`editor.test.js`). Anything
  geometric (drag-and-drop, handles, menus) goes in Playwright: `apps/web/e2e/`, specs
  seed pages via the API (`createPage` in `helpers.js`) and compare `outline(page)`.
  e2e boots its own server (:3100, `:memory:` DB) and Vite (:5174) — no dev DB touched.

## Page hierarchy (`apps/server/src/db/pageTree.ts`)

Sub-pages live in their parent's content as `page` blocks (`props.pageId`; editor node
`pageBlock`, `editor/PageBlock.js`). Invariant, enforced server-side: a child page is
live exactly when its parent's content has a page block for it — creating a sub-page
appends one (`block: false` when the editor inserts its own), deleting the block trashes
the page, re-adding it (undo) restores it, `POST /api/pages/:id/move` moves the block
between parents. A page block for a non-child is just a link. When the server changes an
open page's blocks, the client calls `reloadContent` (`api/blocks.js`) to remount it.
Sidebar order (`pages.order_key`) and block order are independent.

## Databases (`apps/server/src/routes/databases.ts`, `apps/web/src/components/database/`)

A database is a page with `kind: 'database'`; its **rows are its child pages** — exempt
from the page-block invariant (no blocks, never in the sidebar: `hasChildren` is false for
databases, `backfillPageBlocks` skips them; `move` refuses rows in/out). Inline databases
are a `database` block (`props.pageId`, `props.viewId`) that owns its database exactly like
a page block (`OWNING_BLOCKS` in `pageTree.ts`). Properties: `db_properties`; values:
`page_props` — `value` JSON is the truth, `sort_text`/`sort_num` come from `sortKeys` on
every write (always go through `writeValue`). Title is the pseudo-property `title`.
Type/option changes rewrite values (`coerceValue`) and scrub view configs. Views
(`db_views`) hold sorts/filters/hidden/widths/propOrder/groupBy; `POST …/query` builds one
SQL query (a left join per referenced property), offset-paginated. Value/filter helpers
are zod-free in `@papier/core/props` (client-safe). Client: `api/databases.js`; the UI is a
lazy chunk; menus use `database/Popover.jsx` (portalled). Drags inside a view set
`DB_DRAG_TYPE` so the inline node view keeps them from ProseMirror.

## Search (`apps/server/src/db/search.ts`)

The only SQLite-specific module. `search_rows` holds plain text per block (+ one row per
page title, `block_id` null); `search_fts` is an FTS5 external-content index over it,
kept in sync by triggers (hand-written migration `0004_search_fts.sql`). Block and title
routes call `indexBlocks` / `indexTitle` inside their transactions; block deletes
cascade. `backfillSearch` indexes unindexed blocks on startup. User input goes through
`toFtsQuery` (quoted prefix terms) — never pass raw input to `MATCH`. Results: one hit
per page, best of the top `CANDIDATES` rows; snippets only for returned rows, marked
with `HIT_START`/`HIT_END` from `@papier/core` (render via `snippetParts`, not HTML).

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
- e2e files are Node code: typechecked by `apps/web/e2e/jsconfig.json` and opted in
  with `// @ts-check` (checkJs there would also check the `punycode` jsdom hoists).
- `@papier/core` pulls in zod; client code in the main bundle should import
  zod-free helpers from `@papier/core/text` to keep zod out of it.
- HTML5 drag: never unmount or `preventDefault()` the mousedown of the drag source
  (the block handle) — the drag silently dies and `dragend` never fires. Don't insert
  elements during `dragstart` either (e.g. a column that only shows while dragging).
- React node views (`ReactNodeViewRenderer`) wrap the component in their own element:
  put block classes/data attributes on it via the `className`/`attrs` options, so the
  block stays a direct `.papier-editor > .pb` child.
- e2e ports are overridable (`E2E_API_PORT`, `E2E_WEB_PORT`) when 3100/5174 are taken.

## Workflow

- Iterate, then stop with changes **uncommitted** for the user to review; commit/push
  only when asked. Repo: github.com/bren182/papier (private), branch `main`.
- Use plan mode for big features (editor, Yjs sync, databases).
- Stop dev servers you start before finishing.
