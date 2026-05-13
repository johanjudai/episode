/**
 * Tiny i18n: a writable `locale` store + a derived `t` function that
 * resolves dot-separated keys against the matching dictionary. Strings
 * can contain `{name}` placeholders that `t(key, { name: 'X' })` fills.
 *
 * Use `$t('home.toWatchTitle')` inside Svelte components (the leading $
 * auto-subscribes); use `get(t)('key')` from .ts files when needed.
 * Dates: prefer `localeCode(getLocale())` with `Intl.DateTimeFormat`
 * over keys, so we get correctly-localized weekdays / months for free.
 */
import { derived, get, writable } from 'svelte/store';
import { fr, type Dict } from './fr';
import { en } from './en';

export type Locale = 'fr' | 'en';

export const SUPPORTED_LOCALES: readonly Locale[] = ['fr', 'en'];

const dicts: Record<Locale, Dict> = { fr, en };

function isLocale(value: string | null | undefined): value is Locale {
  return value === 'fr' || value === 'en';
}

/** Initial locale resolution — only used on the very first mount.
 *  After that the value flows from layout data → setLocale. */
function detectInitial(): Locale {
  if (typeof navigator === 'undefined') return 'fr';
  const tag = navigator.language?.slice(0, 2).toLowerCase();
  return isLocale(tag) ? tag : 'fr';
}

export const locale = writable<Locale>('fr');

if (typeof window !== 'undefined') {
  /* Pre-populate from the browser before layout data arrives — limits the
   * SSR/CSR flash if the user has nothing stored yet. */
  locale.set(detectInitial());
}

export function getLocale(): Locale {
  return get(locale);
}

export function setLocale(value: string | null | undefined): void {
  if (isLocale(value)) locale.set(value);
}

/** Map our short locale code to a BCP-47 / TMDB-style tag. */
export function localeCode(l: Locale): string {
  return l === 'en' ? 'en-US' : 'fr-FR';
}

/** Reactive translator. `$t('key.path')` or `$t('greet', { name: 'X' })`. */
export const t = derived(locale, ($l) => {
  const dict = dicts[$l];
  return function translate(key: string, vars?: Record<string, string | number>): string {
    const parts = key.split('.');
    let value: unknown = dict;
    for (const p of parts) {
      if (typeof value !== 'object' || value === null) {
        value = undefined;
        break;
      }
      value = (value as Record<string, unknown>)[p];
    }
    if (typeof value !== 'string') return key;
    if (!vars) return value;
    return value.replace(/\{(\w+)\}/g, (_, name: string) => {
      const v = vars[name];
      return v === undefined || v === null ? '' : String(v);
    });
  };
});

/** Used in .ts modules where the rune/store can't be subscribed directly. */
export function translate(key: string, vars?: Record<string, string | number>): string {
  return get(t)(key, vars);
}
