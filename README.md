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

## Self-hosting (Docker)

```bash
docker compose up -d --build
```

Episode is now on `http://localhost:3000`. Put it behind a reverse proxy (Caddy / nginx) for HTTPS.

The SQLite database is stored in the `episode-data` named volume — back it up by copying the volume contents.

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

- [ ] Capacitor wrapper for Android APK builds
- [ ] Background TMDB sync (job to refresh series airing status)
- [ ] CSV/Trakt importers
- [ ] Optional password protection for self-host

## License

MIT — see [`LICENSE`](./LICENSE).
