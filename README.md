# Episode

Open-source TV series tracker — focused, mobile-first, self-hostable.

Episode is a lightweight alternative to TV Time, dedicated to **TV series only** — no movies, no social network, no recommendations. Your data stays on your server.

## Features

- **À voir** — episodes that have already aired, ready to mark watched
- **À venir** — upcoming episodes for the next 7 days
- Swipe right to mark watched, swipe left to remove a series (with confirmation)
- **Recherche** — TMDB-powered, with weekly trending shown by default
- **Fiche série** — seasons & episodes, bulk-tick a season or the entire series
- **Profil** — total watch time, episodes watched, recent history
- **Paramètres** — import TV Time export, TMDB API key, light/dark theme, accessibility (reduced motion, high contrast, text size)
- Onboarding on first launch (name, avatar, optional import)
- Bauhaus-inspired design with light and dark themes

## Tech stack

- **SvelteKit** + **TypeScript** — server endpoints + progressive UI
- **Drizzle ORM** + **SQLite** (better-sqlite3) — single-file local database
- **Zod** — runtime validation of TMDB responses and TV Time imports
- **TMDB API** — series metadata (user provides their own key)
- **Vitest** — unit tests with a hard build gate
- **Playwright** — end-to-end tests
- **Adapter Node** — runs anywhere Node 22+ does

## Quickstart (development)

```bash
cp .env.example .env
npm install
npm run db:generate   # generate initial Drizzle migration from schema
npm run db:migrate    # apply to SQLite
npm run dev
```

Open http://localhost:5173 — on first visit you will be redirected to onboarding.

## Tests

```bash
npm run test:unit          # vitest, watch mode
npm run test:unit -- --run # one-shot run (used by CI and prebuild)
npm run test:e2e           # playwright
npm run coverage           # coverage report
```

> **Hard gate**: `npm run build` runs `prebuild` which runs the unit-test suite. **If any test fails, the build does not produce an artifact.** CI enforces the same.

## Self-hosting (Docker, homelab)

### 1. Clone and configure

```bash
git clone https://github.com/yourself/episode.git
cd episode
cp .env.example .env
# edit .env — at minimum set EPISODE_ORIGIN to the URL you'll access from
```

`.env` example for a homelab behind a reverse proxy at `https://episode.home.lan`:

```env
EPISODE_ORIGIN=https://episode.home.lan
EPISODE_TMDB_API_KEY=               # optional — can also be set in /settings
```

### 2. Build and run

```bash
docker compose up -d --build
```

The first build takes ~2-4 minutes — it installs deps, **runs the full test suite (123 tests, hard gate)**, then builds the SvelteKit bundle. If any test fails the image is not produced.

Episode is now serving on `http://<homelab-ip>:3000`. The container runs migrations automatically on every start, then launches the Node server.

### 3. Put it behind HTTPS

PWA install on mobile **requires HTTPS** (Chrome refuses to install a non-secure origin). Easiest setup with Caddy on the homelab:

```caddy
episode.home.lan {
  reverse_proxy 127.0.0.1:3000
}
```

Caddy will issue a Let's Encrypt cert automatically if DNS resolves publicly, or you can use an internal CA (e.g. mkcert) for `.lan` domains.

### 4. Install as a "phone app" (PWA shortcut)

On your phone:

1. Open `https://episode.home.lan` in **Chrome** (Android) or **Safari** (iOS)
2. **Chrome → menu (⋮) → "Installer l'application"** (or "Ajouter à l'écran d'accueil")
3. **Safari → bouton Partager → "Sur l'écran d'accueil"**

You'll get an icon on the home screen. Tapping it opens Episode in standalone mode — no browser chrome, splash-style theme color on the status bar, full-screen experience. It's not a `.apk` file but it behaves exactly like a native app.

### Backup

The SQLite database is in the `episode-data` named volume.

```bash
# Backup
docker run --rm -v episode_episode-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/episode-backup-$(date +%F).tar.gz -C /data .

# Restore
docker run --rm -v episode_episode-data:/data -v $(pwd):/backup \
  alpine sh -c "cd /data && tar xzf /backup/episode-backup-YYYY-MM-DD.tar.gz"
```

Or just copy `/var/lib/docker/volumes/episode_episode-data/_data/episode.sqlite*` directly.

### Updating

```bash
git pull
docker compose up -d --build
```

Migrations run automatically on every container start.

## TMDB API key

You need a free TMDB v3 API key:

1. Sign up at <https://www.themoviedb.org>
2. Request a key at <https://www.themoviedb.org/settings/api>
3. Paste it in **Paramètres → API TMDB** (or set `EPISODE_TMDB_API_KEY` as a fallback default)

## Project structure

```
src/
├── app.css                       Design system (Bauhaus tokens, components)
├── app.html                      HTML shell
├── hooks.server.ts               Onboarding redirect
├── lib/
│   ├── components/               Reusable UI (Mark, BottomNav, EpisodeRow)
│   ├── server/
│   │   ├── db/                   Drizzle schema, queries, migrations
│   │   ├── tmdb.ts               Typed TMDB client (Zod-validated)
│   │   └── tvtime-import.ts      TV Time JSON parser
│   └── utils/                    Date, format, theme, image helpers
└── routes/
    ├── +layout.svelte            Root layout + theme bootstrap
    ├── +page.svelte              "À voir" home
    ├── onboarding/               First-launch form
    ├── search/                   TMDB search + trending
    ├── series/[id]/              Series detail + bulk tick
    ├── profile/                  Stats + history
    └── settings/                 Profile, TMDB key, import, theme, a11y

tests/
├── unit/                         Vitest specs
└── e2e/                          Playwright specs

mockups/                          Static HTML/CSS wireframes (design source)
```

## Roadmap

- [ ] Capacitor wrapper for a real Android `.apk` (currently the PWA install covers most use cases)
- [ ] Background TMDB sync (job to refresh series airing status)
- [ ] Trakt OAuth import (cleaner than TV Time scraping, real public API)
- [ ] Optional password protection for self-host
- [ ] Pre-generated PNG icons for the manifest (currently SVG-only)

## License

MIT — see [`LICENSE`](./LICENSE).
