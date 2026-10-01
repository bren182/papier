# ── Stage 1: install & build ──────────────────────────────────────────────────
FROM node:24-slim AS builder

# pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/package.json   packages/core/
COPY packages/ui/package.json     packages/ui/
COPY apps/server/package.json     apps/server/
COPY apps/web/package.json        apps/web/

# Install all deps (including dev — needed for the web build)
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/ packages/
COPY apps/     apps/

# Build the web (Vite → apps/web/dist/)
RUN pnpm --filter @papier/web build

# ── Stage 2: production runtime ───────────────────────────────────────────────
FROM node:24-slim AS runner

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/package.json   packages/core/
COPY packages/ui/package.json     packages/ui/
COPY apps/server/package.json     apps/server/

# Production-only deps (no web devDeps)
RUN pnpm install --frozen-lockfile --prod --filter @papier/server...

# Server source + migrations
COPY apps/server/src/     apps/server/src/
COPY apps/server/drizzle/ apps/server/drizzle/

# Core source (server imports @papier/core via the workspace symlink)
COPY packages/core/src/  packages/core/src/

# Pre-built web
COPY --from=builder /app/apps/web/dist/ /app/web/

# Data dir (SQLite file + uploads)
RUN mkdir -p /data/uploads

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/papier.db \
    STATIC_DIR=/app/web

EXPOSE 3000

CMD ["node", "apps/server/src/index.ts"]
