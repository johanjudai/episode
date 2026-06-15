/**
 * JS bridge to the native `ApkInstaller` Capacitor plugin (Android only).
 *
 * The plugin downloads a `.apk` from a URL into the app cache and launches
 * the system package installer through a FileProvider `content://` URI.
 * It is implemented in `android/app/src/main/java/fr/iagona/episode/
 * ApkInstallerPlugin.java` and registered in `MainActivity`.
 *
 * On any non-Android platform the methods reject (the proxy has no web
 * implementation) — callers must gate on `Capacitor.isNativePlatform()`
 * before using it.
 */
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface AppInfo {
  /** Android `versionName` (tracks the release tag, e.g. `0.2.0`). */
  versionName: string;
  /** Android `versionCode`. */
  versionCode: number;
}

export interface InstallApkOptions {
  /** Direct download URL of the APK (GitHub release asset). */
  url: string;
  /** Optional file name to save as; defaults to `episode-update.apk`. */
  fileName?: string;
}

export interface DownloadProgressEvent {
  /** 0..1 fraction downloaded, or -1 when the total size is unknown. */
  progress: number;
}

export interface ApkInstallerPlugin {
  /** Read the running app's version from the native PackageManager. */
  getAppInfo(): Promise<AppInfo>;
  /**
   * Download the APK and launch the installer. Resolves once the install
   * intent has been fired (the OS then shows its confirm UI). Rejects with
   * a coded error: `UNKNOWN_SOURCES` when the user hasn't allowed installs
   * from this app (we route them to the relevant settings screen),
   * `DOWNLOAD_FAILED`, or `NO_URL`.
   */
  installApk(options: InstallApkOptions): Promise<{ launched: boolean }>;
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (event: DownloadProgressEvent) => void
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

export const ApkInstaller = registerPlugin<ApkInstallerPlugin>('ApkInstaller');
