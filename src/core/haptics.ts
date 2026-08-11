/**
 * Vibration feedback. Silently no-ops on unsupported devices (iOS Safari has
 * no Vibration API — that is fine, it degrades gracefully).
 */
let enabled = true;

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

export function vibrate(pattern: number | number[]): void {
  if (!enabled) return;
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    /* ignore */
  }
}

export const HAPTIC = {
  tap: 8,
  land: 8,
  crash: [60, 40, 90] as number[],
  record: [25, 40, 25] as number[],
};
