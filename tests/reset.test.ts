import { describe, expect, it } from 'vitest';
import { PHYSICS } from '../src/config/content';
import { PlayerController } from '../src/player/controller';
import { speedAt } from '../src/world/difficulty';
import { Spawner } from '../src/world/spawner';

describe('state reset', () => {
  it('controller reset restores a clean grounded center-lane state', () => {
    const c = new PlayerController();
    c.enqueue('jump');
    c.update(0.016, 10);
    c.enqueue('right');
    c.update(0.016, 10);
    expect(c.airT).toBeGreaterThan(0);
    expect(c.targetLane).toBe(2);

    c.reset();
    expect(c.targetLane).toBe(1);
    expect(c.airT).toBe(0);
    expect(c.slideT).toBe(0);
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
    expect(c.grounded).toBe(true);
    const hb = c.hitbox();
    expect(hb.y0).toBe(0);
    expect(hb.y1).toBeCloseTo(PHYSICS.runHeight, 5);
  });

  it('a fresh spawner with the same seed reproduces the same route (restart-with-seed)', () => {
    const runA = new Spawner(2026, false);
    runA.update(0, 0, speedAt(0));
    runA.update(200, 20, speedAt(20));
    const snapshotA = runA.obstacles.map((o) => `${o.defId}@${o.dCur.toFixed(2)}:${o.lanes.join('')}`);

    // "Restart": brand-new spawner, same seed — identical plan.
    const runB = new Spawner(2026, false);
    runB.update(0, 0, speedAt(0));
    runB.update(200, 20, speedAt(20));
    const snapshotB = runB.obstacles.map((o) => `${o.defId}@${o.dCur.toFixed(2)}:${o.lanes.join('')}`);

    expect(snapshotB).toEqual(snapshotA);
  });

  it('buffered inputs expire instead of leaking into later states', () => {
    const c = new PlayerController();
    // Jump, then buffer another jump mid-air; let the buffer go stale.
    c.enqueue('jump');
    c.update(0.016, 10);
    c.enqueue('jump');
    // Advance past the buffer window while still airborne.
    for (let i = 0; i < 20; i++) c.update(0.016, 10);
    // Land fully.
    for (let i = 0; i < 30; i++) c.update(0.016, 10);
    expect(c.grounded).toBe(true);
    // The stale jump must NOT have re-triggered on landing.
    expect(c.airT).toBe(0);
  });

  it('a buffered jump just before landing does trigger on landing', () => {
    const c = new PlayerController();
    c.enqueue('jump');
    c.update(0.016, 10);
    // Ride the jump until just before touchdown.
    while (c.airT > 0.08) c.update(0.016, 10);
    c.enqueue('jump'); // buffered slightly early
    let jumpedAgain = false;
    for (let i = 0; i < 12; i++) {
      const ev = c.update(0.016, 10);
      if (ev.jumped) jumpedAgain = true;
    }
    expect(jumpedAgain).toBe(true);
  });

  it('slide input while airborne fast-falls and slides on landing', () => {
    const c = new PlayerController();
    c.enqueue('jump');
    c.update(0.016, 10);
    expect(c.airT).toBeGreaterThan(0.4);
    c.enqueue('slide');
    let slid = false;
    for (let i = 0; i < 20; i++) {
      const ev = c.update(0.016, 10);
      if (ev.startedSlide) slid = true;
    }
    expect(slid).toBe(true);
    expect(c.sliding).toBe(true);
  });
});
