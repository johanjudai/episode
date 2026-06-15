/**
 * Release-instant helpers.
 *
 * TMDB only gives us a bare `air_date` (`YYYY-MM-DD`, no time, no zone), and
 * that date is the broadcaster's *local* calendar day in the show's country
 * of origin. Treating it as a universal calendar day is what made episodes
 * surface a day early in France: a US show airing in the evening (US time)
 * carries an `air_date` that is already "tomorrow" once converted to Europe,
 * so the strict `air_date <= todayUTC` gate lit it up a day before it was
 * actually reachable here.
 *
 * The fix is to turn `air_date` into an absolute instant — a default
 * broadcast time interpreted in the origin timezone — and compare instants.
 * Instant comparison is timezone-independent at the point of computation, so
 * the gate is correct whether it runs server-side (Docker) or in the
 * Capacitor WebView (Android APK). The viewer's own timezone only matters for
 * *display* (which weekday/day to show), and there we lean on `Intl`, which
 * resolves to the device timezone in both targets.
 *
 * This is deliberately an approximation (we guess the broadcast hour and pick
 * one representative zone per country) — TMDB simply doesn't carry the
 * granularity for an exact answer. Erring a few hours late is far less
 * annoying than a full day early.
 */

/**
 * Assumed broadcast hour (24h) in the origin timezone when TMDB gives us only
 * a date. 20:00 is the linear-TV prime-time convention; it also conveniently
 * pushes evening US releases past European midnight, which is the case the
 * "appears the day before" bug was about.
 */
export const DEFAULT_BROADCAST_HOUR = 20;

/**
 * ISO 3166-1 alpha-2 country → representative IANA timezone.
 *
 * A handful of countries span several zones (US, notably); we pick the
 * primary broadcast zone rather than try to be exhaustive. Anything not in
 * the map resolves to `null`, and the caller leaves `release_at` unset so the
 * row falls back to the legacy date-string comparison.
 */
const COUNTRY_TZ: Record<string, string> = {
  US: 'America/New_York',
  CA: 'America/Toronto',
  MX: 'America/Mexico_City',
  BR: 'America/Sao_Paulo',
  AR: 'America/Argentina/Buenos_Aires',
  GB: 'Europe/London',
  IE: 'Europe/Dublin',
  FR: 'Europe/Paris',
  BE: 'Europe/Brussels',
  NL: 'Europe/Amsterdam',
  DE: 'Europe/Berlin',
  AT: 'Europe/Vienna',
  CH: 'Europe/Zurich',
  ES: 'Europe/Madrid',
  PT: 'Europe/Lisbon',
  IT: 'Europe/Rome',
  SE: 'Europe/Stockholm',
  NO: 'Europe/Oslo',
  DK: 'Europe/Copenhagen',
  FI: 'Europe/Helsinki',
  PL: 'Europe/Warsaw',
  CZ: 'Europe/Prague',
  RU: 'Europe/Moscow',
  TR: 'Europe/Istanbul',
  IL: 'Asia/Jerusalem',
  IN: 'Asia/Kolkata',
  CN: 'Asia/Shanghai',
  HK: 'Asia/Hong_Kong',
  TW: 'Asia/Taipei',
  JP: 'Asia/Tokyo',
  KR: 'Asia/Seoul',
  TH: 'Asia/Bangkok',
  ID: 'Asia/Jakarta',
  PH: 'Asia/Manila',
  AU: 'Australia/Sydney',
  NZ: 'Pacific/Auckland',
  ZA: 'Africa/Johannesburg'
};

/**
 * Resolve a TMDB `origin_country` value to a representative IANA zone.
 * Accepts the raw array (we read the first entry), a single code, or null.
 * Returns null when the country is unknown/unset.
 */
export function originTimeZone(
  origin: string | readonly string[] | null | undefined
): string | null {
  if (!origin) return null;
  const code = Array.isArray(origin) ? origin[0] : (origin as string);
  if (!code) return null;
  return COUNTRY_TZ[code.toUpperCase()] ?? null;
}

/**
 * The UTC offset (in minutes) that the given IANA zone has at a given instant.
 * Positive = east of UTC. Computed via `Intl` so DST is handled for free.
 */
function zoneOffsetMinutes(timeZone: string, atUtcMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts = dtf.formatToParts(new Date(atUtcMs));
  const f: Record<string, number> = {};
  for (const p of parts) if (p.type !== 'literal') f[p.type] = Number(p.value);
  /* Some engines format midnight as hour "24"; normalize to 0. */
  const hour = f.hour % 24;
  const asUtc = Date.UTC(f.year, f.month - 1, f.day, hour, f.minute, f.second);
  return Math.round((asUtc - atUtcMs) / 60000);
}

/**
 * Convert a wall-clock time *in a named zone* to an absolute UTC instant (ms).
 *
 * `Intl` only goes instant → zoned, so we invert it: guess the instant as if
 * the wall time were UTC, read the zone's offset there, subtract it, then
 * refine once more in case the first guess landed on the wrong side of a DST
 * transition. Two passes is exact except for the ~1h/year fold ambiguity,
 * which is irrelevant at our granularity.
 */
function zonedWallTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): number {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let offset = zoneOffsetMinutes(timeZone, wallAsUtc);
  let utc = wallAsUtc - offset * 60000;
  const offset2 = zoneOffsetMinutes(timeZone, utc);
  if (offset2 !== offset) {
    offset = offset2;
    utc = wallAsUtc - offset * 60000;
  }
  return utc;
}

/**
 * Turn an `air_date` (`YYYY-MM-DD`) into the absolute instant (epoch ms) the
 * episode is assumed to become available, given the origin timezone and an
 * assumed broadcast hour. Returns null when either input is unusable so the
 * caller can leave `release_at` NULL and keep the legacy behaviour.
 */
export function computeReleaseAtMs(
  airDate: string | null | undefined,
  timeZone: string | null | undefined,
  hour: number = DEFAULT_BROADCAST_HOUR
): number | null {
  if (!airDate || !timeZone) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(airDate);
  if (!m) return null;
  const [, y, mo, d] = m;
  return zonedWallTimeToUtcMs(Number(y), Number(mo), Number(d), hour, 0, timeZone);
}

/**
 * Format an instant (epoch ms) as a `YYYY-MM-DD` calendar date in a given
 * timezone (defaults to the device timezone via `Intl`). Used so the home
 * "upcoming" list buckets an episode under the day it actually unlocks for the
 * viewer, consistent with the instant-based release gate.
 */
export function localIsoDate(ms: number, timeZone?: string): string {
  /* en-CA renders as YYYY-MM-DD. */
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(ms));
}
