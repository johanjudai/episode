#syntax=docker/dockerfile:1.7

# ---- Builder ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Build (this also runs unit tests via the `prebuild` script — hard gate)
RUN npx svelte-kit sync && npm run build

# ---- Runtime ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    EPISODE_PORT=3000 \
    EPISODE_HOST=0.0.0.0 \
    EPISODE_DB_URL=/data/episode.sqlite

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -r episode && useradd -r -g episode episode \
 && mkdir -p /data && chown -R episode:episode /data

COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/src/lib/server/db/migrations ./src/lib/server/db/migrations
COPY --from=builder /app/src/lib/server/db/migrate.ts ./src/lib/server/db/migrate.ts

USER episode
EXPOSE 3000
VOLUME ["/data"]

# Run migrations before starting the server
CMD ["sh", "-c", "node --experimental-strip-types ./src/lib/server/db/migrate.ts && node build"]
