import { describe, expect, it } from 'vitest';
import { PHYSICS } from '../src/config/content';
import { groundedState, jumpY, solve, type SolverObstacle } from '../src/world/solver';

const SPEED = 12;

function run(obstacles: SolverObstacle[], lane = 1, speed = SPEED): boolean {
  let endD = 40;
  for (const o of obstacles) endD = Math.max(endD, o.d1 + 12);
  return solve({ obstacles, startD: 0, endD, speed, start: groundedState(lane) }).ok;
}

const tram = (lane: number, d0: number, vRel = 0): SolverObstacle => ({
  lane,
  d0,
  d1: d0 + 13,
  y0: 0,
  y1: 3.2,
  vRel,
});
const low = (lane: number, d0: number, h = 0.42): SolverObstacle => ({ lane, d0, d1: d0 + 0.8, y0: 0, y1: h });
const overhead = (lane: number, d0: number): SolverObstacle => ({ lane, d0, d1: d0 + 0.6, y0: 1.15, y1: 2.6 });

describe('solver', () => {
  it('jump parabola peaks at configured height mid-flight', () => {
    expect(jumpY(PHYSICS.jumpDuration / 2)).toBeCloseTo(PHYSICS.jumpHeight, 5);
    expect(jumpY(0)).toBe(0);
    expect(jumpY(PHYSICS.jumpDuration)).toBe(0);
  });

  it('empty route is solvable', () => {
    expect(run([])).toBe(true);
  });

  it('a full wall of trams is unsolvable', () => {
    expect(run([tram(0, 30), tram(1, 30), tram(2, 30)])).toBe(false);
  });

  it('two trams with one free lane is solvable', () => {
    expect(run([tram(0, 30), tram(1, 30)])).toBe(true);
  });

  it('a single low obstacle in every lane can be jumped', () => {
    expect(run([low(0, 30), low(1, 30), low(2, 30)])).toBe(true);
  });

  it('an overhead bar across all lanes can be slid under', () => {
    expect(run([overhead(0, 30), overhead(1, 30), overhead(2, 30)])).toBe(true);
  });

  it('an overhead bar cannot be jumped', () => {
    // Only lane 1 exists as an option (trams elsewhere) and it has an overhead:
    // jumping makes it worse; sliding is required and must succeed.
    const obs = [tram(0, 28), tram(2, 28), overhead(1, 30)];
    expect(run(obs)).toBe(true);
    // Sanity: block sliding by placing a low obstacle inside the slide window
    // right under the bar — now nothing works.
    const impossible = [...obs, { lane: 1, d0: 29.7, d1: 30.9, y0: 0, y1: 1.0 }];
    expect(run(impossible)).toBe(false);
  });

  it('a moving tram with a free adjacent lane is solvable', () => {
    expect(run([tram(1, 60, 4)])).toBe(true);
  });

  it('impossible back-to-back lane traps are rejected', () => {
    // Trams everywhere with staggered tiny gaps that require teleporting.
    const obs = [tram(0, 30), tram(1, 30), tram(2, 43.5), tram(0, 43.5), tram(1, 43.6)];
    expect(run(obs, 2)).toBe(false);
  });

  it('a survivable slalom is accepted from every starting lane', () => {
    const obs = [tram(0, 30), tram(1, 50), tram(2, 70)];
    for (const lane of [0, 1, 2]) {
      expect(run(obs, lane)).toBe(true);
    }
  });

  it('returns a path and an end state when asked', () => {
    const res = solve({
      obstacles: [tram(1, 30)],
      startD: 0,
      endD: 60,
      speed: SPEED,
      start: groundedState(1),
      wantPath: true,
    });
    expect(res.ok).toBe(true);
    expect(res.path).toBeDefined();
    expect(res.path!.some((a) => a !== 0)).toBe(true); // had to act
    expect(res.endState).toBeDefined();
    expect(res.endState!.lane).not.toBe(1); // ended in another lane
  });

  it('close obstacles requiring superhuman reactions are rejected', () => {
    // Jump obstacle immediately followed by an overhead: land-and-slide within
    // ~0.1s at high speed is not humanly possible; the strict solver says no.
    const speed = 22;
    const obs: SolverObstacle[] = [
      tram(0, 28),
      tram(2, 28),
      tram(0, 44),
      tram(2, 44),
      { lane: 1, d0: 40, d1: 40.8, y0: 0, y1: 0.86 },
      overhead(1, 43.4),
    ];
    expect(run(obs, 1, speed)).toBe(false);
  });
});
