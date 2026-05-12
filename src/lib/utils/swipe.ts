/** Pure helpers for swipe gesture math. Kept separate from the DOM action
 *  so they can be unit-tested without a browser. */

export function normalizedProgress(deltaX: number, width: number): number {
  if (width <= 0) return 0;
  return Math.max(-1, Math.min(1, deltaX / width));
}

/** Returns the swipe direction past the threshold, or null if not exceeded.
 *  Strict comparison: deltaX must be strictly greater than threshold. */
export function exceedsThreshold(deltaX: number, threshold: number): 'left' | 'right' | null {
  if (deltaX > threshold) return 'right';
  if (deltaX < -threshold) return 'left';
  return null;
}

/** Returns 'h' or 'v' once the user has moved past `lockDistance` along
 *  the dominant axis. Returns null while still ambiguous. */
export function resolveAxis(deltaX: number, deltaY: number, lockDistance = 8): 'h' | 'v' | null {
  const ax = Math.abs(deltaX);
  const ay = Math.abs(deltaY);
  if (ax < lockDistance && ay < lockDistance) return null;
  return ax > ay ? 'h' : 'v';
}
