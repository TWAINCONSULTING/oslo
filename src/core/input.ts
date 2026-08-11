/**
 * Unified pointer (touch + mouse) and keyboard input.
 *
 * Swipes fire once past a small threshold and then re-arm from the current
 * point, so chained swipes in a single drag work (e.g. two quick lane changes).
 * Desktop: arrow keys / WASD, Space to jump.
 */
export type GameAction = 'left' | 'right' | 'jump' | 'slide';

const SWIPE_THRESHOLD = 26; // px
/** Repeating the SAME direction within one drag needs a deliberately long pull. */
const SWIPE_REPEAT_FACTOR = 2.6;
const TAP_MAX_DIST = 16; // px — forgiving: thumbs drift on a moving tram
const TAP_MAX_MS = 450;

export class Input {
  private el: HTMLElement;
  private onAction: (a: GameAction) => void;
  private onTap: () => void;

  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private armX = 0;
  private armY = 0;
  private startT = 0;
  private moved = false;
  private lastDir: GameAction | null = null;

  constructor(el: HTMLElement, onAction: (a: GameAction) => void, onTap: () => void) {
    this.el = el;
    this.onAction = onAction;
    this.onTap = onTap;

    el.addEventListener('pointerdown', this.handleDown);
    el.addEventListener('pointermove', this.handleMove);
    // Up/cancel are tracked on window in the CAPTURE phase: overlay widgets
    // stopPropagation() their pointerup, which must never leave the swipe
    // tracker holding a stale pointerId.
    window.addEventListener('pointerup', this.handleUp, true);
    window.addEventListener('pointercancel', this.handleCancel, true);
    window.addEventListener('keydown', this.handleKey);
    // Belt & braces against browser gestures during play.
    el.addEventListener('touchmove', this.preventDefault, { passive: false });
    el.addEventListener('gesturestart' as keyof HTMLElementEventMap, this.preventDefault as EventListener);
    el.addEventListener('dblclick', this.preventDefault);
  }

  dispose(): void {
    const el = this.el;
    el.removeEventListener('pointerdown', this.handleDown);
    el.removeEventListener('pointermove', this.handleMove);
    window.removeEventListener('pointerup', this.handleUp, true);
    window.removeEventListener('pointercancel', this.handleCancel, true);
    window.removeEventListener('keydown', this.handleKey);
    el.removeEventListener('touchmove', this.preventDefault);
    el.removeEventListener('gesturestart' as keyof HTMLElementEventMap, this.preventDefault as EventListener);
    el.removeEventListener('dblclick', this.preventDefault);
  }

  private preventDefault = (e: Event): void => {
    e.preventDefault();
  };

  private handleDown = (e: PointerEvent): void => {
    // Ignore additional fingers, but a re-down of the tracked id (stale after
    // a swallowed pointerup) restarts the gesture cleanly.
    if (this.pointerId !== null && this.pointerId !== e.pointerId) return;
    this.pointerId = e.pointerId;
    this.startX = this.armX = e.clientX;
    this.startY = this.armY = e.clientY;
    this.startT = performance.now();
    this.moved = false;
    this.lastDir = null;
    // No setPointerCapture here: capturing would retarget pointerup away from
    // overlay buttons (retry, toggles) and silently break them. The element is
    // full-screen, so moves bubble to it anyway.
  };

  private handleMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.armX;
    const dy = e.clientY - this.armY;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const dist = Math.max(adx, ady);
    if (dist < SWIPE_THRESHOLD) return;
    const dir: GameAction = adx > ady ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'slide' : 'jump';
    // One swipe = one action. A continued drag only fires again on a direction
    // change, or on a much longer pull in the same direction (deliberate
    // double-move) — never from ordinary swipe momentum.
    if (dir === this.lastDir && dist < SWIPE_THRESHOLD * SWIPE_REPEAT_FACTOR) return;
    this.moved = true;
    this.lastDir = dir;
    this.onAction(dir);
    // Re-arm from the current position so chained swipes work.
    this.armX = e.clientX;
    this.armY = e.clientY;
  };

  private handleUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    // A release over the debug panel only clears tracking — no game tap.
    if ((e.target as Element | null)?.closest?.('#debug')) return;
    const dist = Math.hypot(e.clientX - this.startX, e.clientY - this.startY);
    const dt = performance.now() - this.startT;
    if (!this.moved && dist < TAP_MAX_DIST && dt < TAP_MAX_MS) {
      this.onTap();
    }
  };

  private handleCancel = (e: PointerEvent): void => {
    if (e.pointerId === this.pointerId) this.pointerId = null;
  };

  private handleKey = (e: KeyboardEvent): void => {
    let action: GameAction | null = null;
    switch (e.code) {
      case 'ArrowLeft':
      case 'KeyA':
        action = 'left';
        break;
      case 'ArrowRight':
      case 'KeyD':
        action = 'right';
        break;
      case 'ArrowUp':
      case 'KeyW':
      case 'Space':
        action = 'jump';
        break;
      case 'ArrowDown':
      case 'KeyS':
        action = 'slide';
        break;
      case 'Enter':
        this.onTap();
        return;
      default:
        return;
    }
    e.preventDefault();
    if (action) this.onAction(action);
  };
}
