import { describe, expect, it } from 'vitest';
import { DIFFICULTY, OBSTACLES } from '../src/config/content';
import {
  gapSecondsAt,
  movingTramsAllowed,
  obstacleWeightsAt,
  speedAt,
  unlockedObstacles,
} from '../src/world/difficulty';

describe('difficulty progression', () => {
  it('speed is monotonically non-decreasing and capped', () => {
    let prev = 0;
    for (let t = 0; t <= 600; t += 1) {
      const v = speedAt(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    const cap = DIFFICULTY.speedKeys[DIFFICULTY.speedKeys.length - 1].v;
    expect(speedAt(10_000)).toBe(cap);
    expect(speedAt(0)).toBe(DIFFICULTY.speedKeys[0].v);
  });

  it('pattern gaps shrink over time but never collapse', () => {
    let prev = Infinity;
    for (let t = 0; t <= 300; t += 5) {
      const g = gapSecondsAt(t);
      expect(g).toBeLessThanOrEqual(prev);
      expect(g).toBeGreaterThanOrEqual(0.7);
      prev = g;
    }
  });

  it('obstacle types unlock on schedule', () => {
    const idsAt = (t: number): string[] => unlockedObstacles(t).map((o) => o.id);
    expect(idsAt(0)).toEqual([]);
    expect(idsAt(5)).toContain('scooter');
    expect(idsAt(5)).not.toContain('tram');
    expect(idsAt(5)).not.toContain('overhead');
    expect(idsAt(21)).toContain('overhead');
    expect(idsAt(26)).toContain('tram');
    expect(idsAt(120)).toContain('bikerack');
    expect(idsAt(120).length).toBe(Object.keys(OBSTACLES).length);
  });

  it('weights only include unlocked types', () => {
    for (const t of [0, 10, 30, 100]) {
      for (const [def] of obstacleWeightsAt(t)) {
        expect(t).toBeGreaterThanOrEqual(def.minTime);
        expect(def.weight).toBeGreaterThan(0);
      }
    }
  });

  it('moving trams are gated behind their unlock time', () => {
    expect(movingTramsAllowed(DIFFICULTY.movingTramMinTime - 1)).toBe(false);
    expect(movingTramsAllowed(DIFFICULTY.movingTramMinTime)).toBe(true);
  });
});
