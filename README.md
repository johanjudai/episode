# Episode

Open-source TV series tracker — focused, mobile-first, self-hostable.

Episode is a lightweight alternative to TV Time, dedicated to **TV series only** — no movies, no social network, no recommendations. Your data stays with you: install the `.apk` on your phone or self-host a Docker container.

---

## 📸 Screenshots

<p align="center">
  <img src="screenshots/Screenshot_20260514-173847.png" alt="Home — episodes to watch" width="22%" />
  <img src="screenshots/Screenshot_20260514-173855.png" alt="Series detail" width="22%" />
  <img src="screenshots/Screenshot_20260514-173914.png" alt="Profile + stats" width="22%" />
  <img src="screenshots/Screenshot_20260514-173930.png" alt="Settings + theme picker" width="22%" />
</p>

<p align="center"><a href="screenshots/"><sub>📂 See all screenshots →</sub></a></p>

## Features

- **À voir / À venir** — aired episodes ready to mark, plus the next 7 days
- Swipe right to mark watched, left to remove a series
- **Recherche** TMDB-powered, with weekly trending by default
- **Fiche série** with bulk-tick (season or full series)
- **Profil** — total watch time, episodes watched, history
- TV Time import, light/dark themes, accessibility options (reduced motion, high contrast, text size)

---

## 📱 Android (APK)

Download the latest signed APK from
**[github.com/johanjudai/episode/releases/latest](https://github.com/johanjudai/episode/releases/latest)**
and sideload it (Settings → Apps → _Install unknown apps_ → allow your browser / file manager).

Fully offline — no server, no account, everything lives on the device.

<details>
<summary>Build it yourself</summary>

Requires Android SDK + JDK 17+.

```bash
npm install
npm run cap:sync                  # build:local + copy into android/
cd android && ./gradlew assembleDebug
```

APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`. Install with `adb install <path>` or open in Android Studio (`npm run cap:open:android`) for a signed build.

Data lives in IndexedDB inside the app's sandbox (`/data/data/fr.iagona.episode/`). Uninstalling wipes it.

</details>

---

## 🐳 Self-host (Docker)

```bash
git clone https://github.com/johanjudai/episode.git
cd episode
cp .env.example .env              # set EPISODE_ORIGIN to your URL
docker compose up -d --build
```

Episode is live on **http://localhost:3000**. The build runs the full test suite as a hard gate — no artifact if tests fail. Migrations apply automatically on every container start.

The SQLite database lives in the `episode-data` named volume:

```bash
docker run --rm -v episode_episode-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/episode-backup-$(date +%F).tar.gz -C /data .
```

**Put it behind HTTPS** — PWA install on mobile requires it. Caddy example:

```caddy
episode.home.lan {
  reverse_proxy 127.0.0.1:3000
}
```

To update: `git pull && docker compose up -d --build`.

---

## TMDB API key

Episode needs a free TMDB v3 key (<https://www.themoviedb.org/settings/api>). Paste it in **Paramètres → API TMDB**, or pre-seed via `EPISODE_TMDB_API_KEY` in the server target.

---

## Development

```bash
cp .env.example .env
npm install
npm run db:generate && npm run db:migrate
npm run dev                       # http://localhost:5173
```

**Stack:** SvelteKit 5 + TypeScript, Drizzle ORM over SQLite (`better-sqlite3` server-side, `sql.js` + IndexedDB local-side), Zod validation, Vitest + Playwright, Capacitor 6 for the APK.

**Two targets, one codebase:** queries under `src/lib/data/` take a Drizzle handle as their first argument, so the same business logic runs against either driver. The split is only at the storage seam.

Tests: `npm run test:unit` (unit + integration, runs on both drivers), `npm run test:e2e`. The integration suite gates the build — any divergence between drivers fails CI.

## Security & trust model

Episode is a **single-user, no-auth** app by design — anyone who can reach the running instance is assumed to be you.

**Server target (Docker):**

- Do **not** expose port 3000 directly to the internet. Put it behind a reverse proxy that terminates TLS and enforces access control (basic auth, OAuth proxy, Tailscale, VPN).
- The Node process runs as non-root; SQLite lives on a named volume.
- Defence-in-depth headers on every response: CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy` disabling every browser API Episode never uses.
- Per-IP token-bucket rate limit (60 burst, 1 req/s sustained) on `/api/*`.
- All inputs validated through Zod. DB layer is Drizzle (parameterised queries everywhere).
- TMDB / OMDb keys are stored in the settings table and **never** returned in load functions (only `hasKey: boolean`).
- TV Time import capped at 10 MB; other requests capped at 512 KB by default.

**Local target (APK):**

- No server, no network listener. The only outbound traffic is to TMDB / OMDb / TVMaze / Jikan, all validated by Zod.
- IndexedDB sandboxed to the app's private storage; uninstalling wipes it.
- TMDB / OMDb keys are **not** encrypted at rest — treat them as low-sensitivity third-party credentials.
- Capacitor config: `allowMixedContent: false`, `webContentsDebuggingEnabled: false`; the WebView only loads bundled assets.

**Both targets:**

- TMDB image paths flow through a regex whitelist in `$lib/utils/images.ts` before being inlined into CSS — guards against upstream compromise injecting CSS / script.
- Avatar uploads accept only `data:image/(png|jpeg|webp);base64,…` (no SVG, no remote URL).

Security issues: open a GitHub issue, or contact directly if sensitive.

## License

MIT — see [`LICENSE`](./LICENSE).
