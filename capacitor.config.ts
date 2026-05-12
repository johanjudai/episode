import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor wraps the static SPA produced by `EPISODE_TARGET=local vite build`
 * into a native Android app. The build directory is `build/` (set by
 * adapter-static).
 *
 * To produce an APK:
 *   1. EPISODE_TARGET=local npm run build:local
 *   2. npx cap sync   (copies build/ into android/app/src/main/assets/public)
 *   3. npx cap open android  (opens Android Studio)
 *   4. Build → Generate Signed Bundle / APK
 *
 * The Android project is created on first `npx cap add android`. It lives
 * under `android/` and is committed to source control along with this file.
 */
const config: CapacitorConfig = {
  appId: 'fr.iagona.episode',
  appName: 'Episode',
  webDir: 'build',
  android: {
    /* Allow http during dev for local network testing; the production APK
     * only loads its own bundled assets via `capacitor://localhost`. */
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false
  }
};

export default config;
