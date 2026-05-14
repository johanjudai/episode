import type { Handle } from '@sveltejs/kit';
import { IS_LOCAL } from '$lib/config';
import { getSetting } from '$lib/data/queries';

/**
 * In-memory token-bucket per client IP for /api/* endpoints.
 *
 * Episode is single-user by design, but the server is reachable to
 * anyone who can connect to the port (or hop through the reverse
 * proxy). A burst limit + sustained rate stops trivial DoS via repeat
 * POSTs and protects the TMDB/OMDb validation endpoints from
 * upstream-quota abuse.
 *
 *   capacity = 60 burst
 *   refill   = 1 token / second  (≈ 1 req/s sustained)
 *
 * The map is intentionally tiny (cleared lazily). For a homelab
 * single-user app, this is enough; no need for redis or per-route
 * isolation. */
interface Bucket {
  tokens: number;
  lastRefill: number;
}
const BUCKET_CAPACITY = 60;
const BUCKET_REFILL_PER_SEC = 1;
const buckets = new Map<string, Bucket>();

function consumeToken(ip: string): boolean {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b) {
    b = { tokens: BUCKET_CAPACITY, lastRefill: now };
    buckets.set(ip, b);
  }
  const elapsedSec = (now - b.lastRefill) / 1000;
  b.tokens = Math.min(BUCKET_CAPACITY, b.tokens + elapsedSec * BUCKET_REFILL_PER_SEC);
  b.lastRefill = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

/* Periodic compaction so the map doesn't grow unbounded across IPs. */
let lastCompact = Date.now();
function maybeCompact() {
  const now = Date.now();
  if (now - lastCompact < 60_000) return;
  lastCompact = now;
  for (const [ip, b] of buckets) {
    if (now - b.lastRefill > 5 * 60_000) buckets.delete(ip);
  }
}

/**
 * Security response headers — applied to every response in server mode.
 * Conservative defaults that match the app's actual needs:
 *
 *   - X-Frame-Options DENY    — no clickjacking
 *   - X-Content-Type-Options  — no MIME sniffing
 *   - Referrer-Policy         — leak as little as possible to externals
 *   - Permissions-Policy      — disable APIs Episode never uses
 *   - Strict-Transport-Security: only set when the reverse proxy is
 *     already terminating HTTPS (HTTPS-aware origin) — we leave HSTS
 *     to the proxy itself since some homelabs use mkcert/.lan and
 *     don't want the long pin.
 *   - Content-Security-Policy — defense-in-depth XSS mitigation.
 *     `unsafe-inline` on scripts is required by the tiny theme
 *     bootstrap in +layout.svelte (reads localStorage before
 *     hydration); the rest of the policy is tight.
 */
function setSecurityHeaders(headers: Headers) {
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), accelerometer=(), gyroscope=()'
  );
  headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https://image.tmdb.org https://static.tvmaze.com https://cdn.myanimelist.net https://i.ytimg.com",
      "connect-src 'self' https://api.themoviedb.org https://www.omdbapi.com https://api.tvmaze.com https://api.jikan.moe",
      /* The trailer modal embeds YouTube via the privacy-enhanced
       * youtube-nocookie.com domain — the `default-src 'self'`
       * fallback would block it otherwise. */
      'frame-src https://www.youtube-nocookie.com',
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; ')
  );
}

export const handle: Handle = async ({ event, resolve }) => {
  /* In local-target builds there is no server-side DB and the route guard
   * runs in the browser via +layout.ts. The Vite plugin replaces this file
   * with a no-op for local builds anyway, but the early return is a belt-
   * and-braces fallback for prerender / SSR-disabled paths. */
  if (IS_LOCAL) return resolve(event);

  const url = event.url.pathname;
  const isApi = url.startsWith('/api/');

  /* Rate-limit the API surface. The home page, assets and prerendered
   * pages aren't worth limiting (they're cheap), but every /api/* call
   * either writes to the DB or hits a third-party (TMDB/OMDb). */
  if (isApi) {
    maybeCompact();
    const ip =
      event.getClientAddress?.() ??
      event.request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
      'unknown';
    if (!consumeToken(ip)) {
      return new Response('Too many requests', {
        status: 429,
        headers: { 'retry-after': '5', 'content-type': 'text/plain' }
      });
    }
  }

  const { serverDb } = await import('$lib/server/db');
  const completed = (await getSetting(serverDb, 'onboarding.completed_at')) !== null;
  event.locals.onboardingCompleted = completed;

  const isOnboarding = url.startsWith('/onboarding');
  const isAsset = url.startsWith('/_app') || url === '/favicon.ico';

  if (!completed && !isOnboarding && !isAsset && !isApi) {
    return new Response(null, { status: 302, headers: { location: '/onboarding' } });
  }

  const response = await resolve(event);
  setSecurityHeaders(response.headers);
  return response;
};
