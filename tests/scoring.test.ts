import { describe, expect, it } from 'vitest';
import { activeCollectible } from '../src/config/content';
import { scoreFor } from '../src/core/scoring';
import { loadData, resetHighScore, saveData } from '../src/core/storage';

describe('scoring', () => {
  it('score is distance plus token bonus from the active collectible', () => {
    const bonus = activeCollectible().value;
    expect(bonus).toBeGreaterThan(0);
    expect(scoreFor(0, 0)).toBe(0);
    expect(scoreFor(123.9, 0)).toBe(123);
    expect(scoreFor(100, 4)).toBe(100 + 4 * bonus);
    expect(scoreFor(0.5, 1)).toBe(bonus);
  });

  it('score grows with distance and tokens', () => {
    expect(scoreFor(500, 10)).toBeGreaterThan(scoreFor(500, 9));
    expect(scoreFor(501, 10)).toBeGreaterThan(scoreFor(500, 10));
  });
});

describe('storage (in-memory fallback in tests)', () => {
  it('persists a high score patch and merges defaults', () => {
    const before = loadData();
    expect(before.sound).toBe(true);
    saveData({ high: 777 });
    expect(loadData().high).toBe(777);
    expect(loadData().sound).toBe(true); // untouched fields survive
  });

  it('resetHighScore zeroes only score fields', () => {
    saveData({ high: 500, bestDistance: 400, vibration: false });
    resetHighScore();
    const d = loadData();
    expect(d.high).toBe(0);
    expect(d.bestDistance).toBe(0);
    expect(d.vibration).toBe(false);
  });
});
