# Papier

A self-hosted, block-based workspace — my own Notion. Pages, nested blocks, databases
with views, full-text search, realtime collaboration, offline-capable desktop apps for
Windows / Linux / macOS, and a server small enough to run on a single cheap GCE VM.

> **Status:** v0.1 in progress — monorepo scaffolded, ambient shell running. This README is the living scope doc — jot
> freely under the `📝` markers and strike through anything that turns out to be a bad
> idea. Decisions get promoted out of "Open questions" into the relevant section.

---

## 1. Why

📝 *Why build this instead of using Notion / Obsidian / AnyType?*

- I want my data in a file/DB I own, on a box I control.
- No per-seat pricing, no vendor lock-in, no cloud outage taking my notes with it.
- I want to be able to script and query my own notes.
- I want control of the codebase and stack used, so I can gain a deeper understanding of a new tech stack.
- I want easier access to important things like birthdays, calendar events, and jotting down meeting notes. 

## 2. Non-goals

Explicitly out of scope so the project can actually ship:

- Not a Notion clone pixel-for-pixel. Notion-*class*, not Notion-*shaped*.
- No multi-tenant SaaS. One deployment = one workspace owner (+ invited members).
- No mobile native apps in v1. Responsive web in the browser is the mobile story.
- Notion AI duplicate
- No LLMs/AI in the server. The server is a small VM, not a GPU cluster.

---

## 3. Core concepts

The whole product is four nouns. Getting these right early is most of the design work.

| Concept | Description |
| --- | --- |
| **Workspace** | Top-level container. Owns users, pages, settings, uploads. |
| **Page** | A document. Has a title, icon, cover, parent, and an ordered tree of blocks. Pages are themselves blocks, so they nest arbitrarily. |
| **Block** | The atom. `{ id, type, parentId, order, props, content }`. Text, heading, todo, toggle, code, quote, callout, divider, image, file, embed, table, child-page, link-to-page, database-view. |
| **Database** | A page whose children are pages with a shared schema (typed properties). Rendered through **views**: table, board, list, calendar, gallery. |

📝 *Extra concepts I might need: templates, relations/rollups, comments, mentions,
tags, favourites, trash, version history.*

Yeah the rollups + relations idea is key: being able to look at data in a tabular format and rollup/count relations up. For example sometimes I want to track a Kanban board task completion rate, and maybe do some estimation calculations based on a gantt chart. So these Views are also important to bring in. 

Templates for types of pages being created, so when in birthday db/page and want to add a row/page should be able to create a template to easily capture that birthday information. 


---

## 4. Feature scope

Tick boxes as they land. Anything unticked in a shipped milestone moves to the next one.

### v0.1 — "it holds my notes" (MVP)

- [x] Auth: single owner account, email + password, session cookie (setup token on first run, bearer tokens for the desktop app, `user` CLI for recovery)
- [x] Page tree sidebar: create / rename / nest / drag-reorder / delete to trash
- [x] Block editor: paragraph, H1–H3, bullet + numbered list, todo, quote, code, divider
- [x] Markdown-style input rules (`# `, `- `, `[] `, ` ``` `) and `/` slash menu
- [x] `@` date mentions in text and titles: `@today`, `@2 days ago`, `@last fri`, `@oct 5` — stored as plain `YYYY-MM-DD`, shown live and relative ("Today", "3 weeks ago") until far off, then as a date
- [x] Keyboard-first editing: Enter/Backspace/Tab semantics that feel like Notion
- [x] Autosave, per-block, no save button, ever
- [x] Full-text search across all pages (SQLite FTS5)
- [x] Dark mode ONLY
- [ ] Runs as one `docker compose up` on a Linux VM behind HTTPS

### v0.2 — "it's actually nice"

- [ ] Image + file uploads (drag, paste, resize) with local disk storage
- [x] Toggle blocks, callouts, nested/indented everything
- [ ] Tables (simple) and `/embed` for links with preview
- [x] Trash with restore, 30-day retention (auto-purge; Delete forever)
- [x] Page icons + covers, emoji picker — plus layout (full width, small text, font), per-page mood and app colour themes; image covers wait for uploads
- [x] Command palette (`Ctrl/Cmd-K`): jump to page, run command (`>` for commands only)
- [x] Favourites + Recent in the sidebar; inline page links (`[[` or `@`, live title); database rows open in a side peek (‹ › through the view, Open as page); richer board cards (buttons, labelled numbers, row menu); toggle headings and accent callouts
- [ ] Copy/paste of rich content in and out (markdown + HTML clipboard)

### v0.3 — "databases"

- [ ] Typed properties: text, number, select, multi-select, date, checkbox, URL, person, file, created/edited time — all but person + file landed (those wait on auth + uploads)
- [x] Table view with sort, filter, group, hide/show columns (plus column resize/reorder, manual row order, row selection + bulk actions, Excel-style fill, move/copy rows to another database)
- [x] Board (kanban) view grouped by select property
- [ ] List, gallery, calendar views — calendar landed
- [x] Inline databases embedded in a page
- [x] Relations + rollups (count, sum, % complete, etc.) — core, not optional. Two-way by default (`property_links`, each link stored once), rollups computed in SQL so they sort and filter; property values are searchable too
- [x] Buttons + automations: button property and page button blocks (set / today / move date / check / +number / link / add row, Undo toast); automations when a row is added, when a property changes, or on a schedule (per database, ⚡ panel)
- [x] Templates: save any page as a template (library), database templates with a default per view, "Today ↻" dates that resolve on use; Duplicate
- [x] Formulas: a Notion-like formula property (sorts/filters in SQL, in-app function reference) and "Set to a formula" in buttons/automations
- [ ] Built-in template library — decided after importing + analysing my Notion workspace

### v0.4 — "not alone"

- [ ] Invite members, roles (owner / editor / viewer)
- [ ] Realtime multiplayer editing with presence cursors (CRDT)
- [ ] Comments on blocks, `@mentions`, unresolved-comment inbox
- [ ] Per-page sharing + optional public read-only publish link

### v1.0 — "shipped"

- [ ] Desktop apps: signed-ish installers for Windows (`.msi`), macOS (`.dmg`), Linux (`.AppImage` + `.deb`)
- [ ] Offline editing with sync-on-reconnect
- [ ] Import from Notion export (`.zip` of markdown/CSV) — converter script landed (`pnpm --filter @papier/server import:notion`, unzipped folder in, pages/databases/rows/blocks out); upload UI + zip still to do
- [ ] Export: markdown, HTML, PDF, full JSON backup
- [ ] Version history / page snapshots
- [ ] Automated nightly backups off-box
- [ ] Docs: install guide, backup/restore guide, upgrade guide

### Later / someday

- [ ] Mobile apps
- [ ] Public HTTP API + webhooks
- [ ] Plugin/extension system for custom blocks
- [ ] Local LLM hooks (summarise page, ask-my-notes)
- [ ] End-to-end encryption
- [ ] 📝

---

## 5. Architecture

```
┌─────────────────────────────┐   ┌─────────────────────────────┐
│  Desktop shell (Tauri)      │   │  Browser                    │
│  ┌───────────────────────┐  │   │  ┌───────────────────────┐  │
│  │  Web client (React)   │  │   │  │  Web client (React)   │  │
│  │  editor + local cache │  │   │  │  editor               │  │
│  └───────────┬───────────┘  │   │  └───────────┬───────────┘  │
└──────────────┼──────────────┘   └──────────────┼──────────────┘
               │  HTTPS + WebSocket (CRDT sync)  │
               └────────────────┬────────────────┘
                                ▼
                  ┌──────────────────────────────┐
                  │  Caddy  (TLS, reverse proxy) │
                  └──────────────┬───────────────┘
                                 ▼
                  ┌──────────────────────────────┐
                  │  papier-server (Node/TS)     │
                  │  REST + WS + auth + search   │
                  └──────┬────────────────┬──────┘
                         ▼                ▼
                  ┌────────────┐   ┌─────────────┐
                  │  SQLite    │   │  ./uploads  │
                  │  (+ FTS5)  │   │  disk vol   │
                  └────────────┘   └─────────────┘
                     GCE VM, one docker compose
```

**One client codebase, two shells.** The React app is the product; the desktop build
wraps the exact same bundle in Tauri and points it at a configured server URL. No
forked UI.

**The server is the source of truth**, but the client is CRDT-backed so it stays
editable while offline and merges on reconnect rather than showing a conflict dialog.

### Repo layout (monorepo)

```
papier/
├── apps/
│   ├── server/      # Node + TypeScript API, WS sync, migrations
│   ├── web/         # React client — the actual editor UI
│   └── desktop/     # Tauri shell, auto-update, native menus
├── packages/
│   ├── core/        # block model, CRDT schema, zod schemas (JS + JSDoc types)
│   └── ui/          # design system: primitives, icons, theme tokens
├── deploy/
│   ├── docker-compose.yml
│   ├── Caddyfile
│   └── scripts/     # provision, backup, restore
└── docs/
```

---

## 6. Tech stack

Recommended starting point — all of it up for debate, none of it written yet.

| Layer | Pick | Why |
| --- | --- | --- |
| Language | TypeScript on server, JavaScript (+ JSDoc) on client | types where the data lives (DB, sync, auth, Drizzle); client stays plain JS. Shared block model in `packages/core` is JS + zod with JSDoc types, so the server still type-checks against it and the client gets runtime validation. |
| Server | Node 24 + Fastify | fast, tiny, good WS story, low memory on a small VM |
| DB | SQLite (WAL) + FTS5, Drizzle ORM | zero ops, single file to back up, fits a 1 GB VM. Postgres is a later swap if it ever needs one. |
| Realtime | Yjs + `y-websocket`, persisted per page | mature CRDT, gives offline + multiplayer from the same primitive |
| Editor | ProseMirror via TipTap (or BlockNote on top) | ProseMirror is the only serious option for this; BlockNote gets a Notion-like block UX for free |
| Client | React + Vite + TanStack Query + Zustand | |
| Styling | Tailwind + CSS variables for theming | dark-only, but colours live in one set of tokens so a light theme stays a small change if ever wanted |
| Desktop | **Tauri 2** | ~10 MB installers vs ~120 MB Electron, native webview, cross-compiles to all three targets. Fallback: Electron if Tauri's webview differences bite. |
| Auth | Argon2id + httpOnly session cookies | boring on purpose. OIDC/Google login optional later. |
| Files | local disk volume → optional GCS bucket | |
| Tests | Vitest (unit), Playwright (e2e) | |
| CI | GitHub Actions: lint, test, build server image, build 3 desktop targets | |

📝 *Alternatives I want to consider: Go or Rust server; Postgres + `ElectricSQL`;
SolidJS; Electron over Tauri; Automerge over Yjs.*

### Visual style

Mockups: [Papier Style Exploration](https://claude.ai/artifact/22sg3vHzuZ21ssuxRARkoZ)
(palette source: `color_palette.png`).

**Colour lives behind the glass. Everything you read is grayscale.**

- **Undertones (the "outside")** — only ever in the ambient backdrop: blurred glows, a
  treeline, slow drift/sway, floating motes.
  Deep Walnut `#46351D` · Dusty Olive `#646F4B` · Cool Steel `#839D9A` ·
  Sky Reflection `#7BB2D9` · Ash Grey `#BFD2BF`.
- **Surfaces + text (the page)** — Notion-style neutral greys: root `#141414`, page
  `#191919`, sidebar `#202020`, hover `#2A2A2A`, line `#2F2F2F`, faint `#6E6E6E`,
  muted `#8A8A8A`, text `#D4D4D4`, strong `#EDEDED`.
- **One accent:** Sky Reflection for focus, links, selection, checked boxes.
- **Three modes** (user setting):
  - *Ambient / frosted* — page + sidebar are glass (`rgba(20,21,20,.68)` +
    `blur(28px)`), cover is a clear window onto the backdrop.
  - *Ambient / clear glass* — near see-through (`rgba(16,17,16,.30)` + `blur(4px)`),
    subtle text-shadow for legibility.
  - *Grayscale* — solid greys, backdrop desaturated and only visible through the cover.
- **Type:** Newsreader (page titles), Geist (UI + body), Geist Mono (code).
- **Motion:** slow and ambient only; pausable; off under `prefers-reduced-motion`.
  Backdrop should be one GPU-cheap layer so it doesn't hurt typing latency.

---

## 7. Data model sketch

```sql
users        (id, email, password_hash, name, avatar_url, created_at)
workspaces   (id, name, icon, owner_id, created_at)
members      (workspace_id, user_id, role)                  -- owner|editor|viewer
pages        (id, workspace_id, parent_page_id, title, icon, cover,
              is_database, db_schema_json, order_key, archived_at,
              created_by, created_at, updated_at)
blocks       (id, page_id, parent_block_id, type, order_key,
              props_json, text_json, created_at, updated_at)
page_props   (page_id, prop_id, value_json, sort_text, sort_num)  -- database row values
db_properties (id, database_id, name, type, config_json, order_key)
db_views     (id, database_id, name, type, config_json, order_key)  -- table|board + sorts/filters/…
ydocs        (page_id, state_vector BLOB, update_log BLOB)  -- CRDT persistence
uploads      (id, workspace_id, page_id, filename, mime, size, path, created_at)
sessions     (id, user_id, expires_at, user_agent)
search_index (VIRTUAL TABLE fts5: page_id, title, body)
```

- `order_key` is a **fractional index** (e.g. `"a0"`, `"a0V"`, `"a1"`) so drag-reorder
  is a single-row write with no renumbering and merges cleanly under CRDT.
- 📝 *Open: do blocks live in SQL rows at all, or only inside the Yjs doc with SQL as a
  derived read/search projection? The second is simpler to keep consistent, harder to
  query. Leaning: Yjs is truth for block content, SQL rows are a projection rebuilt on
  save for search and API reads.*
- **Until Yjs lands (v0.4), the `blocks` rows *are* the truth.** One row per block:
  `parent_id` nests blocks within a page, `order_key` orders siblings, `props` holds
  type settings (heading level, checked, language), `content` holds inline rich text as
  JSON. The editor autosaves changed/removed blocks as one atomic batch.

---

## 8. Scale & longevity

This has to hold a decade of notes, not a demo. Design for a heavy 10-year workspace:

| | Rough size | Risk |
| --- | --- | --- |
| Pages | 10k–50k | trivial for SQLite |
| Blocks | 1M–5M rows | fine with the right indexes |
| Text + metadata | 0.5–3 GB | fine |
| FTS5 index | ~same order as text | fine, handles millions of rows |
| **Uploads** | **10–100+ GB** | **outgrows the 30 GB free-tier disk** |
| **Yjs history** | **unbounded if untouched** | **slow loads, bloated DB** |

### Rules

- **Compact Yjs docs.** Periodically merge `update_log` into a single snapshot
  (`Y.encodeStateAsUpdate`) and truncate. Keep Yjs GC on. Version history = separate
  periodic snapshots, not "keep every update forever".
- **Never let Yjs binary be the only copy.** The SQL projection (or a JSON/markdown
  export) must be complete enough to rebuild everything without Yjs. Nightly
  plain-format dump next to the backups. Owning my data means owning it in a readable
  format.
- **Uploads behind a storage interface** (`local` | `gcs`) from day one. Store
  content-hashed keys in the DB, not disk paths. Backups incremental (`gsutil rsync` /
  restic), not a full nightly tar.
- **Databases (landed v0.3 slice 1):** a database is a page with `kind = 'database'`; its
  child pages are its rows. Values live in `page_props` with typed `sort_text` /
  `sort_num` columns derived on write and indexed per property; filters and sorts are
  built into one SQL query. Views are saved per database and shared by every place that
  shows it.
- **Database props must be indexable.** `page_props.value_json` alone means full scans
  on filter/sort. Add typed columns (`value_text`, `value_num`, `value_date`) or SQLite
  generated columns + indexes. Filter/sort in SQL, never client-side over all rows.
- **Nothing loads "everything".** Sidebar lazy-loads children on expand; search is
  paginated with FTS5 snippets; database views are paginated/virtualized (TanStack
  Virtual); desktop offline cache is a bounded LRU of recent + pinned pages (full mirror
  is opt-in).
- **Huge single pages.** ProseMirror slows past a few thousand blocks. Rare, but Notion
  imports can produce them — warn or split on import.
- **Keep the Postgres swap real.** Stick to portable Drizzle features; SQLite-specific
  code lives only in the search module.

### Big-data test (v0.1)

A seed script that generates a synthetic "10 years" workspace — ~30k pages, ~2M
blocks, a few 20k-row databases, pages with long edit histories. Measure cold start,
sidebar, search and a big database view **on the actual e2-micro**. Rerun it every
milestone.

---

## 9. Deployment target

**Google Compute Engine, one VM.**

| | |
| --- | --- |
| Machine | `e2-micro` (2 vCPU burst, 1 GB) to start — free tier in `us-central1`/`us-west1`/`us-east1`. Bump to `e2-small` (2 GB) if Node + build headroom gets tight. |
| OS | Debian 12 |
| Disk | 30 GB pd-standard (free-tier limit), uploads on the same disk |
| Runtime | Docker + Compose: `papier-server`, `caddy` |
| TLS | Caddy with automatic Let's Encrypt on a real domain |
| Firewall | 80/443 only; SSH via IAP tunnel, no public port 22 |
| Backups | nightly `sqlite3 .backup` + `uploads/` tar → GCS bucket, 30-day lifecycle rule. **Restore must be tested, not assumed.** |
| Monitoring | container healthcheck + uptime check; 📝 *maybe just a cron curl + email* |

📝 *Domain name:*
📝 *GCP project / region:*

---

## 10. Cross-platform builds

| Target | Artifact | Notes |
| --- | --- | --- |
| Windows | `.msi` / `.exe` | unsigned initially; SmartScreen warning is expected |
| macOS | `.dmg` (arm64 + x64) | needs an Apple Developer cert ($99/yr) to avoid Gatekeeper pain — 📝 decide |
| Linux | `.AppImage`, `.deb` | |
| Web | any modern browser | the fallback that always works |

Built in CI on matching runners (`windows-latest`, `macos-latest`, `ubuntu-latest`).
Dev machine is Windows, so Linux/macOS builds only ever get verified by CI + a VM.

---

## 11. Security

- Argon2id password hashing, httpOnly + `SameSite=Lax` + Secure session cookies
- Rate limiting on auth endpoints, CSRF token on state-changing requests
- Per-request authorization on every page/block read *and* write — never trust an ID
- Uploads: extension + magic-byte allowlist, served from a separate path with
  `Content-Disposition: attachment` and a strict CSP
- Server never evaluates user content; embeds are sandboxed iframes
- Secrets via env file outside the image; no credentials in git
- 📝 *Sign-up disabled by default — invite-only, since it's my box*

---

## 12. Open questions / decisions to make

| # | Question | Leaning |
| --- | --- | --- |
| 1 | Yjs-as-truth or SQL-as-truth for block content? | Yjs, SQL as projection |
| 2 | TipTap from scratch, or BlockNote for a head start? | **Decided: TipTap v3, our own schema** (tried BlockNote first; swapped for control over styling and menus). The editor doc is a *flat* list of blocks with an `indent` attr — any block can have children, and storage turns indentation back into the `parent_id` tree (`apps/web/src/editor/convert.js`). Stored data is editor-agnostic. |
| 3 | Tauri or Electron? | Tauri 2 |
| 4 | SQLite or Postgres? | SQLite, keep the swap possible |
| 5 | Multiplayer in v1 at all, or solo-first and add it later? | 📝 |
| 6 | Relations/rollups in v1? | Yes — core to how I use databases (e.g. kanban completion rate). Rollups computed in SQL over indexed props (see §8), not client-side. |
| 7 | Buy the Apple cert? | 📝 |
| 8 | License — MIT, AGPL, or private? | 📝 |
| 9 | Yjs compaction: when and how? (on idle, on N updates, nightly job?) And how many version-history snapshots to keep? | 📝 compact on idle + nightly; snapshots thinned over time (hourly → daily → weekly) |
| 10 | Is the SQL projection a *complete* copy (rebuildable without Yjs), or just enough for search/API? | Complete — no Yjs-only data |
| 11 | 📝 | |

---

## 13. Roadmap

```
v0.1  MVP editor + pages + search, deployed
v0.2  Polish, uploads, import
v0.3  Databases + views
v0.4  Collaboration
v1.0  Desktop installers, offline, backups, docs
```

📝 *Rough dates / effort budget:*

---

## 14. Development

```bash
git clone <repo> && cd papier
pnpm install
pnpm dev            # server on :3000, web on :5173
pnpm dev:desktop    # Tauri shell against the local server (not yet — v1.0)
pnpm test
pnpm build
```

Prerequisites: Node 24+, pnpm, Rust toolchain (for Tauri), Docker (for deploy testing).

Works today: `pnpm dev`, `pnpm test`, `pnpm typecheck`, `pnpm build`. The server runs
`.ts` directly via Node 24 type stripping — no build step.

---

## 15. Scratch

📝 *Dumping ground. Ideas, links, things Notion does that I want, things Notion does
that I hate.*

- Notifications being customsiable, i.e. I can @Remind tomorrow or @Remind + datepicker value to set a reminder
- Schedules or specials actions/automations. I can setup a system where if I click a button it updates a property. Values are dynamic, going off of the birthday calendar, I can click "celebrate" which will shift the date of remind one year back so I can be reminded next year. 
- Notion has a huge library of prebuilt templates, it would be cool to add a similar "plugin" library, where we can add stuff like "plugin for a recipe book" which can be a combination of pages and some other external tools/integrations like a recipe API + cart API that can put things in a shopping list for you. 
- Being able to setup a custom "Home" page. So where you land you can see certain important blocks that you can customise. 
- Uploading images for backgrounds for the app, and background for headers, background for pages etc. For now we'll assume storage stays local on a user's computer so no syncing yet.
- ~~Shortcut minigame: a "Practice" button in the keyboard shortcuts dialog (Ctrl+/) starts a Dance Dance Revolution–style drill (like Discord's keybinds easter egg) — shortcuts scroll up as falling prompts, press the right combo in time, streaks + a best score. A fun way to actually learn them.~~ Landed: 🕹 Practice tab in Ctrl+/ dialog, 4-lane DDR with Web Audio music, health bar, combos, scores.
- ~~A small templating language for custom button logic~~ — landed as formulas (formula property + "Set to a formula" action).
- ~~Noticed a small UX bug with the datepicker, some click actions close the popup immediately like using arrows to click to next month.~~ Fixed: our own calendar replaces the native date popup.
- ~~The top header space on each page shoul.d be hideable and not shown by dfeefulat i think also the image does not get bluyrred in this header curently~~ Fixed: no header band unless the page has a cover; the "Clear" cover is blurred like the glass.
- Scratch pad idea covering ollama from another session chat:

Yep — absolutely. With 32 GB RAM and an RTX 5060, you can run a small local Ollama model that is perfectly capable of the “Notion AI-lite” stuff you’re describing.

For Papier, I’d think of it less as “AI that knows the whole app” and more as:

**user question → retrieve relevant Papier content → send only that context to Ollama → return answer**

So for:

> “Give me a summary of this week’s standups in @Engineering Standups”

your app would resolve `@Engineering Standups` to that database, fetch entries from the current week, serialize the useful fields/content, and pass that bundle to the model with a prompt like “Summarize these standups, call out blockers, repeated themes, and completed work.”

That architecture is very doable locally.

A sensible first version would be:

- **Model:** something in the 7B–14B range, quantized
- **Runtime:** Ollama
- **Papier backend:** your existing Node/C# backend calls Ollama over localhost HTTP
- **Context system:** initially just SQL/filtering, no vector DB needed
- **Features:** summarize page, summarize database selection, ask question about selected content, extract tasks/action items

For your machine, models around this size should be comfortable:
- `qwen3:8b`
- `llama3.1:8b`
- `gemma3:12b`
- potentially a 14B quantized model if you’re okay with a bit less speed

For this specific use case, I’d lean toward **Qwen 8B-ish** because you care more about instruction following, summarization, and structured output than creative writing.

And you do **not** need RAG/vector embeddings on day one. Your Papier data is already structured. If the user explicitly says `@Standups`, you know exactly where to fetch context from. That’s actually a big advantage over a generic chatbot.

A very simple flow could look like:

```text
User:
"Summarize this week's standups in @Engineering Standups"

        ↓

Papier parses mention
@Engineering Standups
        ↓

Database query
created_at >= Monday
        ↓

Fetch:
- date
- author
- yesterday
- today
- blockers
- notes

        ↓

Build prompt:
"You are Papier AI.
Summarize the following standup entries.
Highlight:
1. major progress
2. blockers
3. recurring topics
4. upcoming work

<standup data>"
        ↓

Ollama
qwen3:8b
        ↓

Papier UI:
"This week the team..."
```

The **important architectural bit** is that Ollama shouldn't directly query your database. Let Papier own permissions, filtering, mentions and context retrieval. Ollama just receives a clean chunk of text and reasons over it.

That also makes privacy much nicer: everything can stay on your PC/server with **zero OpenAI/Anthropic calls**.

For implementation, I’d expose something like:

```http
POST /api/ai/query
```

with:

```json
{
  "prompt": "Summarize this week's standups",
  "context": {
    "type": "database",
    "databaseId": "engineering-standups",
    "filters": {
      "from": "2026-09-28"
    }
  }
}
```

Your backend turns that into actual context, then calls:

```http
POST http://localhost:11434/api/chat
```

and streams the answer back to the UI.

The next step up is where Papier starts feeling genuinely clever: support references like:

```text
@Standups
@Project Phoenix
@Brendan
this week
last month
open tasks
```

Then you build a tiny resolver layer that converts those into deterministic database queries before involving the LLM.

Later, if you want questions like:

> “What did we decide about authentication a few months ago?”

where the user doesn't know which page/database contains it, **that's** where embeddings + semantic search become worthwhile.

So I'd build this in three levels:

1. **Explicit context**
   - Summarize current page
   - Summarize selected blocks
   - Ask about `@database`

2. **Structured Papier context**
   - date ranges
   - people
   - task status
   - projects
   - tags

3. **Global semantic search**
   - embeddings across pages
   - retrieve top relevant chunks
   - answer across the entire workspace

Level 1 + 2 alone gets you surprisingly close to the useful part of Notion AI without needing an enormous model.

And your RTX 5060 doesn't need to host some monster 70B model for this. The quality bottleneck for this particular feature will probably be **how well you prepare the context**, not whether you're running 8B versus 32B. A clean 8B model seeing exactly the right 15 standup entries will usually beat a much larger model being dumped an entire workspace.

For Papier specifically, I'd probably make the first AI UI something lightweight like a `/` command:

```text
/ask
/summarize
/action-items
```

and then allow:

```text
/ask What were our main blockers this week? @Standups
```

That gives you a genuinely useful first “Papier AI” without building a giant agent system.

- ~~Have giphy integration to insert inline gifs / images~~ Landed: `image` block type (`/image` in editor), paste any image/GIF URL, optional Giphy search (set key in Settings → AI). `animation` prop reserved for future slidedeck timing.

- our side menu and opening closnig pages or collpasing to the right does not do a good animation yet, and we have the claude forntend style library, i'd like a full session or round to use the new forntend deisg tno make sure our layout and app styling is working correctly./ 