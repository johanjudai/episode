import type { Action } from 'svelte/action';
import { exceedsThreshold, resolveAxis } from '$lib/utils/swipe';

export interface SwipeParams {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** Called with the current horizontal delta in px (positive = right). */
  onProgress?: (deltaX: number) => void;
  /** Minimum horizontal delta in px to commit a swipe. Default 80. */
  threshold?: number;
  /** If true, animates the node off-screen after a successful right swipe.
   *  Use this when the row will disappear from the data set anyway. */
  flyOutOnRight?: boolean;
}

/**
 * Touch + mouse swipe gesture on a horizontal row. Vertical scroll is
 * preserved (the gesture is dropped once vertical motion dominates).
 *
 * The node is moved with `transform: translateX(...)` while dragging,
 * springs back on release if the threshold isn't reached, and calls
 * the appropriate callback when it is.
 */
export const swipeable: Action<HTMLElement, SwipeParams> = (node, initial) => {
  let params = initial;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let active = false;
  let axis: 'h' | 'v' | null = null;

  const SPRING = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
  const QUICK = 'transform 0.25s ease-out';

  function reset(animate: boolean) {
    node.style.transition = animate ? SPRING : 'none';
    node.style.transform = '';
    params.onProgress?.(0);
  }

  function onStart(x: number, y: number) {
    startX = x;
    startY = y;
    currentX = 0;
    active = true;
    axis = null;
    node.style.transition = 'none';
  }

  function onMove(x: number, y: number, e: Event) {
    if (!active) return;
    const dx = x - startX;
    const dy = y - startY;

    if (axis === null) {
      axis = resolveAxis(dx, dy);
      if (axis === null) return;
      if (axis === 'v') {
        active = false;
        return;
      }
    }

    if (cancellable(e)) e.preventDefault();
    currentX = dx;
    node.style.transform = `translateX(${dx}px)`;
    params.onProgress?.(dx);
  }

  function onEnd() {
    if (!active) return;
    active = false;
    const t = params.threshold ?? 80;
    const which = exceedsThreshold(currentX, t);

    /* Suppress the synthesized click that browsers fire after a
     * mouse-drag. Without this, dragging across a clickable child
     * (e.g. the episode title button in EpisodeRow) opens the modal as
     * soon as the user finishes a swipe. Touch doesn't trigger the
     * synthesized click in the same way, but the guard is harmless
     * there. 6px is below the swipe-axis threshold so an outright tap
     * still goes through. */
    if (Math.abs(currentX) > 6) suppressNextClick();

    if (which === 'right') {
      params.onSwipeRight?.();
      if (params.flyOutOnRight) {
        node.style.transition = QUICK;
        node.style.transform = `translateX(${node.offsetWidth + 40}px)`;
      } else {
        reset(true);
      }
    } else if (which === 'left') {
      params.onSwipeLeft?.();
      reset(true);
    } else {
      reset(true);
    }
    params.onProgress?.(0);
  }

  function suppressNextClick() {
    /* Document-level capture so we catch the synthesized click whatever
     * element the cursor is over at mouseup time. The browser computes
     * the click target from the *visual* mouseup position; the row's
     * transform during the drag can move the cursor over a sibling
     * (e.g. the now-visible swipe reveal) instead of the swiped child,
     * which would dodge a node-scoped listener. */
    const swallow = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      document.removeEventListener('click', swallow, true);
    };
    document.addEventListener('click', swallow, true);
    /* Safety net — if no click event ever arrives (touch path, or the
     * browser already deduped the click) drop the listener after a
     * frame so it doesn't intercept a later, legitimate tap. */
    setTimeout(() => document.removeEventListener('click', swallow, true), 350);
  }

  function cancellable(e: Event): boolean {
    return e.cancelable && typeof (e as TouchEvent).preventDefault === 'function';
  }

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    onStart(t.clientX, t.clientY);
  };
  const onTouchMove = (e: TouchEvent) => {
    const t = e.touches[0];
    onMove(t.clientX, t.clientY, e);
  };
  const onTouchEnd = () => onEnd();

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    onStart(e.clientX, e.clientY);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };
  const onMouseMove = (e: MouseEvent) => onMove(e.clientX, e.clientY, e);
  const onMouseUp = () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    onEnd();
  };

  node.addEventListener('touchstart', onTouchStart, { passive: true });
  node.addEventListener('touchmove', onTouchMove, { passive: false });
  node.addEventListener('touchend', onTouchEnd);
  node.addEventListener('touchcancel', onTouchEnd);
  node.addEventListener('mousedown', onMouseDown);

  return {
    update(next: SwipeParams) {
      params = next;
    },
    destroy() {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchEnd);
      node.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }
  };
};
