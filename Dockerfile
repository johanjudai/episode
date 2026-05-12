#syntax=docker/dockerfile:1.7

# ============================================================
# Builder — installs all deps, runs unit + integration tests
# via `prebuild`, then `vite build`. Test failure = no artifact.
# ============================================================
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# better-sqlite3 has prebuilt binaries for linux/amd64 + arm64 on glibc.
# If a prebuild is unavailable on your platform the install will compile
# from source; uncomment the apt step below to provide the toolchain.
# RUN apt-get update && apt-get install -y --no-install-recommends \
#     python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --include=dev

COPY . .
RUN npx svelte-kit sync && npm run build

# ============================================================
# Production deps — clean install with --omit=dev, so we ship
# only what the running server needs (and the native better-sqlite3
# binary still compiles/extracts correctly).
# ============================================================
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ============================================================
# Runtime — small image, non-root user, volume for the SQLite file
# ============================================================
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    EPISODE_PORT=3000 \
    EPISODE_HOST=0.0.0.0 \
    EPISODE_DB_URL=/data/episode.sqlite \
    EPISODE_MIGRATIONS_FOLDER=/app/migrations

RUN groupadd -r episode \
 && useradd -r -g episode -m -d /home/episode episode \
 && mkdir -p /data \
 && chown -R episode:episode /data

COPY --from=builder /app/build ./build
COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/drizzle ./migrations
COPY scripts/migrate.mjs ./migrate.mjs
COPY scripts/entrypoint.sh ./entrypoint.sh

RUN chmod +x /app/entrypoint.sh && chown -R episode:episode /app

USER episode
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/app/entrypoint.sh"]
