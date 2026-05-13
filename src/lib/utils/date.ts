/**
 * Date helpers — all assume ISO YYYY-MM-DD strings for "dates without time".
 *
 * `formatDayShortFr` / `formatDateShortFr` are kept under those names for
 * backwards compat, but they now delegate to `Intl.DateTimeFormat` with a
 * BCP-47 tag so weekday + month abbreviations follow the active locale.
 * Callers pass the locale code explicitly; components read it via the
 * i18n store and feed it in here.
 */
import { get } from 'svelte/store';
import { locale, localeCode, translate } from '$lib/i18n';

function activeLocaleCode(): string {
  return localeCode(get(locale));
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Is the airDate (ISO YYYY-MM-DD) on or before the reference day? */
export function isReleased(airDate: string | null | undefined, now: Date = new Date()): boolean {
  if (!airDate) return false;
  return airDate <= todayIso(now);
}

/** Difference in whole days between airDate and reference (positive = future). */
export function daysFromNow(airDate: string, now: Date = new Date()): number {
  const a = new Date(`${airDate}T00:00:00Z`);
  const b = new Date(`${todayIso(now)}T00:00:00Z`);
  const ms = a.getTime() - b.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function formatDayShortFr(
  date: string | Date,
  loc: string = activeLocaleCode()
): { weekday: string; day: number } {
  const d = typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : date;
  const weekday = new Intl.DateTimeFormat(loc, { weekday: 'short', timeZone: 'UTC' }).format(d);
  return {
    weekday: capitalize(weekday.replace('.', '')),
    day: d.getUTCDate()
  };
}

export function formatDateShortFr(date: string | Date, loc: string = activeLocaleCode()): string {
  const d = typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : date;
  const month = new Intl.DateTimeFormat(loc, { month: 'short', timeZone: 'UTC' }).format(d);
  return `${d.getUTCDate()} ${capitalize(month.replace('.', ''))}`;
}

export function relativeFr(airDate: string, now: Date = new Date()): string {
  const d = daysFromNow(airDate, now);
  if (d === 0) return translate('date.relativeToday');
  if (d === 1) return translate('date.relativeTomorrow');
  if (d === -1) return translate('date.relativeYesterday');
  if (d > 0) return translate('date.inDays', { n: d });
  return translate('date.daysAgo', { n: Math.abs(d) });
}
