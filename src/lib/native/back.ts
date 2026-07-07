/**
 * Android hardware back button / edge-swipe → in-app navigation.
 *
 * Capacitor doesn't do anything sensible with the Android back gesture by
 * default (it tends to drop straight out of the app). This wires the
 * `backButton` event from `@capacitor/app` to:
 *   1. the topmost registered interceptor (an open modal/overlay), else
 *   2. `history.back()` when there's SvelteKit history to unwind, else
 *   3. leaving the app.
 *
 * Entirely no-op on the web/Docker build and in a plain browser — only the
 * native local (APK) target ever installs the listener.
 */
import { IS_LOCAL } from '$lib/config';

/**
 * A back interceptor. Return `true` if it consumed the back action (e.g.
 * closed a modal), `false` to let the default navigation proceed.
 */
export type BackInterceptor = () => boolean;

/* LIFO stack — the most recently opened overlay gets first crack. */
const interceptors: BackInterceptor[] = [];

/**
 * Register a back interceptor. Returns an unregister function; call it on
 * teardown (an overlay component's onMount return handles this cleanly).
 */
export function pushBackInterceptor(fn: BackInterceptor): () => void {
  interceptors.push(fn);
  return () => {
    const i = interceptors.lastIndexOf(fn);
    if (i !== -1) interceptors.splice(i, 1);
  };
}

let started = false;

/**
 * Wire the native back button once. Resolves to a cleanup function that
 * removes the listener (no-op off-native). Safe to call more than once.
 */
export async function initBackButton(): Promise<() => void> {
  if (started || !IS_LOCAL) return () => {};
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) return () => {};
  started = true;

  const { App } = await import('@capacitor/app');
  const handle = await App.addListener('backButton', ({ canGoBack }) => {
    /* Topmost overlay wins — let it swallow the back press. */
    for (let i = interceptors.length - 1; i >= 0; i--) {
      if (interceptors[i]()) return;
    }
    /* Otherwise unwind the in-app history, or exit at the entry page.
     * `canGoBack` reflects the WebView history, which SvelteKit's
     * client-side router keeps in sync via the History API. */
    if (canGoBack) {
      history.back();
    } else {
      void App.exitApp();
    }
  });

  return () => {
    void handle.remove();
    started = false;
  };
}
