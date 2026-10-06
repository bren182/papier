# Papier

A self-hosted, block-based workspace — your notes, pages and databases, hosted by you.

Papier is a personal Notion-class tool: a block editor, nested pages, typed databases with
multiple views, full-text search, and a real automation engine. It runs as a single Docker
container on a cheap VM and stores everything in SQLite.

---

## Features

### Pages & editor
- Block editor with paragraphs, headings, bullets, numbered lists, todos, toggles, callouts, code, quotes, dividers
- Nested pages — sub-pages live as blocks, so the tree is unlimited
- Inline page links (`[[` or `@`), inline date mentions (`@today`, `@last friday`, `@oct 5`) — stored as `YYYY-MM-DD`, shown live and relative
- Page icons, covers, full-width layout, small-text mode, per-page font and colour mood
- Autosave (per-block, no save button)

### Databases
- Any page can become a database; its child pages are its rows
- Typed properties: text, number, select, multi-select, date, checkbox, URL, created/modified time, formula, relation, rollup, button
- **Table view** — sort, filter, group by, hide columns, resize/reorder, manual row order, bulk actions, Excel-style fill handle
- **Board view** — kanban grouped by select or multi-select
- **Calendar view** — drag cards to change a date value
- Relations between databases (two-way by default, links stored once, filters in SQL), rollups (count, sum, %, etc.)
- Formulas (Notion-like language, compiled to SQL so they sort and filter server-side)
- Buttons and automations: set values, shift dates, add rows — run on a button press, a property change, or a schedule

### Organisation
- Page tree sidebar with drag-reorder, favourites, and recent pages
- Full-text search (SQLite FTS5) with snippets
- Trash with restore and 30-day auto-purge
- Templates: save any page as a template, database row templates, "Today ↻" dynamic dates
- Command palette (`Ctrl/Cmd-K`) — jump to page, run command, search

### Auth & accounts
- Single-owner local accounts (email + password, scrypt)
- Setup token on first run; bearer tokens for scripts / desktop; recovery CLI (`pnpm user`)
- Invite more members (owner / editor / viewer roles)

### AI extras (optional, bring your own key/server)
- Ollama integration — ask questions about the open page (needs a local Ollama server)
- Giphy search for image blocks
- Unsplash photo search for page covers

---

## Install

### Desktop app (Windows / Linux)

Download the installer from the [latest release](https://github.com/bren182/papier/releases/latest):

| Platform | Download |
| --- | --- |
| Windows 64-bit | `Papier-Setup-x.x.x.exe` (NSIS installer) |
| Linux 64-bit | `Papier-x.x.x.AppImage` or `papier_x.x.x_amd64.deb` |

**Windows:** Run the `.exe` installer — it adds a start menu shortcut and a system tray icon. Papier starts on login and lives in the tray; click it to open the window.

**Linux (AppImage):** `chmod +x Papier-*.AppImage && ./Papier-*.AppImage`

**Linux (deb):** `sudo dpkg -i papier_*_amd64.deb && papier`

On first launch a dialog shows your **setup token** — enter it on the setup screen to create the owner account. The token is also saved to `%APPDATA%\Papier\setup-token.txt` (Windows) or `~/.config/Papier/setup-token.txt` (Linux) in case you need it later.

Data (the SQLite database and uploads) lives in the same directory as the token file. Back it up with:

```bash
sqlite3 ~/.config/Papier/papier.db ".backup ~/papier-backup.db"
```

> **Local data only for now.** The desktop app stores everything on your machine. Cross-device sync (installing on a second machine and keeping them in sync) is planned but not yet implemented.

---

### Self-hosting with Docker

```yaml
# docker-compose.yml
services:
  papier:
    image: ghcr.io/bren182/papier:latest
    restart: unless-stopped
    environment:
      PAPIER_SETUP_TOKEN: changeme
    volumes:
      - papier_data:/data
    ports:
      - "3000:3000"

volumes:
  papier_data:
```

1. Copy the snippet above, set a strong `PAPIER_SETUP_TOKEN`, and run `docker compose up -d`.
2. Open the server in your browser — the setup screen will guide you through creating the owner account.
3. (Optional) Put Caddy or nginx in front for HTTPS; add the public URL as `PAPIER_ORIGIN=https://yourdomain.com`.

The data directory holds the SQLite file and uploads. Back it up with:

```bash
sqlite3 /data/papier.db ".backup /backup/papier.db"
```

---

## Development

Prerequisites: Node 24+, pnpm.

```bash
git clone https://github.com/bren182/papier && cd papier
pnpm install
pnpm dev          # server :3000  +  web :5173 (Vite proxies /api)
pnpm test         # Vitest unit tests
pnpm test:e2e     # Playwright e2e (runs its own server + DB)
pnpm typecheck    # tsc on server (TS) + web (JSDoc via checkJs)
pnpm build        # production build

# Desktop installers (requires the desktop package deps installed)
pnpm desktop:win    # → apps/desktop/release/Papier-Setup-*.exe
pnpm desktop:linux  # → apps/desktop/release/Papier-*.AppImage + .deb
```

The server runs `.ts` directly via Node 24 type stripping — no build step in development.

### Repo layout

```
papier/
├── apps/
│   ├── server/   # Fastify + TypeScript — REST API, auth, search, migrations
│   ├── web/      # React + Vite + Tailwind v4 — the editor UI
│   └── desktop/  # Electron wrapper — bundles server + web as a native app
├── packages/
│   ├── core/     # shared block model, zod schemas, formula parser (JS + JSDoc)
│   └── ui/       # design tokens, theme CSS
```

### Database migrations

Migrations live in `apps/server/drizzle/` and apply automatically on server start.
To generate a new migration from a schema change:

```bash
pnpm --filter @papier/server db:generate
```

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Server | Node 24 + Fastify, TypeScript (type-stripped, no build) |
| Database | SQLite (WAL + FTS5) via Drizzle ORM |
| Editor | TipTap v3 (ProseMirror), custom block schema |
| Client | React + Vite + TanStack Query |
| Styling | Tailwind v4 + CSS variable tokens |
| Tests | Vitest (unit), Playwright (e2e) |
| CI / deploy | GitHub Actions → Docker image → ghcr.io |

**Visual style:** colour lives behind the glass — the backdrop carries the palette, everything readable is grayscale. One accent (Sky `#7BB2D9`). Three ambient modes: frosted glass, clear glass, grayscale.

---

## Roadmap

- **v0.1** — MVP editor + pages + search ✓
- **v0.2** — Polish, uploads, tables, copy/paste (in progress)
- **v0.3** — Databases + views, relations, formulas, automations ✓
- **v0.4** — Auth, multi-user invites, Windows/Linux desktop apps ✓
- **v0.5** — Multiplayer editing with presence (Yjs)
- **v1.0** — Cross-device sync, offline mode, export, docs

---

## License

MIT — see [LICENSE](LICENSE).
