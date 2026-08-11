/**
 * requestAnimationFrame loop with delta clamping. Long gaps (tab hidden,
 * debugger, GC hiccup) never produce giant physics steps.
 */
export class Loop {
  private rafId = 0;
  private last = 0;
  private running = false;
  private onFrame: (dt: number, now: number) => void;

  constructor(onFrame: (dt: number, now: number) => void) {
    this.onFrame = onFrame;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number): void => {
      if (!this.running) return;
      const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      this.onFrame(dt, now);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** After a pause, avoid a huge first delta. */
  resetClock(): void {
    this.last = performance.now();
  }
}
