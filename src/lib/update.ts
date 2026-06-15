/**
 * In-app update check for the Android APK build.
 *
 * The APK is distributed via GitHub Releases (see .github/workflows/
 * release-apk.yml): a `vX.Y.Z` tag publishes a release-signed
 * `episode-vX.Y.Z.apk` asset. This module asks the GitHub API for the
 * latest release, compares its version to the running app, and — when
 * newer — hands back the APK download URL so the home banner can offer a
 * one-tap update via the native installer.
 *
 * Everything here is plain fetch + pure parsing so it runs unchanged in
 * the WebView (GitHub's API sends `Access-Control-Allow-Origin: *`, and
 * there is no app-side CSP on the local build). The native install step
 * lives in `$lib/native/apkInstaller`.
 */

/** owner/repo the releases are published under. */
export const GITHUB_REPO = 'johanjudai/episode';
const LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

/** How often to hit the API at most (throttled by the caller via settings). */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateInfo {
  /** Release tag, e.g. `v0.2.0`. */
  tag: string;
  /** Normalised numeric version, e.g. `0.2.0`. */
  version: string;
  /** Direct download URL of the `.apk` asset. */
  apkUrl: string;
  /** APK size in bytes, when the API reports it (for the progress UI). */
  sizeBytes: number | null;
  /** Human release page, used as a fallback link. */
  releaseUrl: string;
  /** Release notes (markdown), may be empty. */
  notes: string;
}

/** Strip a leading `v` and any pre-release/build suffix → `x.y.z` core. */
export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, '').split(/[-+]/)[0];
}

/**
 * Compare two semver-ish strings by their numeric `major.minor.patch`
 * core. Returns 1 if a > b, -1 if a < b, 0 if equal. Missing segments
 * count as 0, so `1.2` === `1.2.0`. Pre-release suffixes are ignored
 * (treated as their core), which is fine for our simple tag scheme.
 */
export function compareSemver(a: string, b: string): number {
  const pa = normalizeVersion(a)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const pb = normalizeVersion(b)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db ? 1 : -1;
  }
  return 0;
}

/** True when `latest` is strictly newer than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
  return compareSemver(latest, current) > 0;
}

/** Whether a fresh check is due, given the last check time (ms epoch). */
export function dueForCheck(
  lastCheckedMs: number | null,
  now: number,
  intervalMs: number = UPDATE_CHECK_INTERVAL_MS
): boolean {
  if (!lastCheckedMs || !Number.isFinite(lastCheckedMs)) return true;
  return now - lastCheckedMs >= intervalMs;
}

/* Minimal shape of the bits of the GitHub release payload we read. */
interface GithubAsset {
  name?: string;
  browser_download_url?: string;
  content_type?: string;
  size?: number;
}
interface GithubRelease {
  tag_name?: string;
  html_url?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GithubAsset[];
}

/** Pick the APK asset from a release: prefer the package-archive content
 *  type, else the first `.apk` by name. Returns null when there's none. */
function pickApkAsset(assets: GithubAsset[]): GithubAsset | null {
  const byType = assets.find((a) => a.content_type === 'application/vnd.android.package-archive');
  if (byType?.browser_download_url) return byType;
  const byName = assets.find((a) => (a.name ?? '').toLowerCase().endsWith('.apk'));
  return byName?.browser_download_url ? byName : null;
}

/**
 * Turn a GitHub `releases/latest` payload into an `UpdateInfo`, or null
 * when the release is unusable (draft/prerelease, missing tag, or no APK
 * asset attached). Pure — unit-tested without the network.
 */
export function parseLatestRelease(release: unknown): UpdateInfo | null {
  const r = release as GithubRelease | null;
  if (!r || typeof r !== 'object') return null;
  if (r.draft || r.prerelease) return null;
  if (!r.tag_name) return null;
  const asset = pickApkAsset(r.assets ?? []);
  if (!asset?.browser_download_url) return null;
  return {
    tag: r.tag_name,
    version: normalizeVersion(r.tag_name),
    apkUrl: asset.browser_download_url,
    sizeBytes: typeof asset.size === 'number' ? asset.size : null,
    releaseUrl: r.html_url ?? `https://github.com/${GITHUB_REPO}/releases/latest`,
    notes: r.body ?? ''
  };
}

/**
 * Fetch the latest release and return it only if it is newer than
 * `currentVersion`. Returns null on any failure (offline, rate-limited,
 * no APK asset, already up to date) — the caller treats null as
 * "nothing to show".
 */
export async function checkForUpdate(
  currentVersion: string,
  fetchImpl: typeof fetch = fetch
): Promise<UpdateInfo | null> {
  let release: unknown;
  try {
    const res = await fetchImpl(LATEST_RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json' }
    });
    if (!res.ok) return null;
    release = await res.json();
  } catch {
    return null;
  }
  const info = parseLatestRelease(release);
  if (!info) return null;
  return isNewerVersion(info.version, currentVersion) ? info : null;
}
