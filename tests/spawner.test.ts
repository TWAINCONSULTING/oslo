import { describe, expect, it } from 'vitest';
import { DIFFICULTY } from '../src/config/content';
import { speedAt } from '../src/world/difficulty';
import { groundedState, solve, type SolverState } from '../src/world/solver';
import { Spawner, type ActiveObstacle } from '../src/world/spawner';

/**
 * The heavyweight fairness test: a solver-driven bot plays the generated
 * route across many seeds. Every rolling window must be survivable from the
 * bot's actual chained state.
 */
function playThrough(seed: number, targetDistance: number, skipIntro: boolean): void {
  const spawner = new Spawner(seed, skipIntro);
  let traveled = 0;
  let time = 0;
  let state: SolverState = groundedState(1);

  while (traveled < targetDistance) {
    const speed = speedAt(time);
    const batch = spawner.update(traveled, time, speed, state);

    // Everything new must respect the minimum spawn lead.
    for (const o of batch.obstacles) {
      expect(o.dCur).toBeGreaterThanOrEqual(traveled + DIFFICULTY.minLead - 0.01);
    }

    // Validate far (past everything currently spawned), commit near — and only
    // commit states that stay survivable at slightly higher speed, because the
    // game accelerates continuously between the bot's discrete windows.
    const obstacles = spawner.solverObstacles().map((o) => ({
      ...o,
      d0: o.d0 - traveled,
      d1: o.d1 - traveled,
    }));
    let lookahead = 160;
    for (const o of obstacles) lookahead = Math.max(lookahead, o.d1 + 12);
    const windowOpts = { obstacles, startD: 0, endD: lookahead, commitD: 70 };

    let committed: { state: SolverState; d: number } | null = null;
    for (const simSpeed of [speed, speed * 1.06]) {
      const res = solve({ ...windowOpts, speed: simSpeed, start: state });
      if (!res.ok) {
        if (simSpeed === speed) {
          throw new Error(
            `seed ${seed}: unsolvable window at ${traveled.toFixed(0)}m (t=${time.toFixed(1)}s, lane ${state.lane})`
          );
        }
        continue; // path found at base speed was not speed-robust; try next candidate below
      }
      // Verify the committed state at the bumped speed.
      const verify = solve({
        obstacles,
        startD: res.endStateD!,
        endD: lookahead,
        speed: simSpeed === speed ? speed * 1.06 : speed,
        start: res.endState!,
      });
      if (verify.ok) {
        committed = { state: res.endState!, d: res.endStateD! };
        break;
      }
    }
    if (!committed) {
      throw new Error(
        `seed ${seed}: no speed-robust commit state at ${traveled.toFixed(0)}m (t=${time.toFixed(1)}s)`
      );
    }

    state = committed.state;
    const advance = committed.d;
    if (advance < 15) {
      throw new Error(`seed ${seed}: bot made no progress at ${traveled.toFixed(0)}m`);
    }
    const dtWindow = advance / speed;
    spawner.advanceMovers(dtWindow);
    traveled += advance;
    time += dtWindow;
    spawner.prune(traveled);
  }
}

describe('spawner fairness', () => {
  it('generates fully survivable routes across many seeds (with intro)', { timeout: 120_000 }, async () => {
    for (let seed = 1; seed <= 10; seed++) {
      playThrough(seed * 7919, 1500, false);
      await new Promise((r) => setTimeout(r, 0)); // let the worker heartbeat
    }
  });

  it('generates fully survivable routes across many seeds (veteran, deep run)', { timeout: 180_000 }, async () => {
    for (let seed = 1; seed <= 10; seed++) {
      playThrough(seed * 104729 + 17, 3000, true);
      await new Promise((r) => setTimeout(r, 0));
    }
  });

  it('is deterministic for a given seed', () => {
    const snap = (s: Spawner): string =>
      s.obstacles.map((o) => `${o.defId}:${o.lanes.join('')}@${o.dCur.toFixed(1)}v${o.vRel}`).join('|');
    const a = new Spawner(12345, true);
    const b = new Spawner(12345, true);
    a.update(0, 0, speedAt(0));
    b.update(0, 0, speedAt(0));
    a.update(120, 12, speedAt(12));
    b.update(120, 12, speedAt(12));
    expect(snap(a)).toBe(snap(b));
    expect(a.obstacles.length).toBeGreaterThan(0);

    const c = new Spawner(54321, true);
    c.update(0, 0, speedAt(0));
    c.update(120, 12, speedAt(12));
    expect(snap(c)).not.toBe(snap(a));
  });

  it('the scripted intro teaches jump, then slide, with huge gaps', () => {
    const spawner = new Spawner(42, false);
    const ids = spawner.obstacles.map((o) => o.defId);
    expect(ids).toContain('scooter');
    expect(ids).toContain('barrier');
    expect(ids).toContain('overhead');
    // First obstacle far enough out to read the controls first.
    const first = Math.min(...spawner.obstacles.map((o) => o.dCur));
    expect(first).toBeGreaterThanOrEqual(40);
    // Tokens exist and mark safe space.
    expect(spawner.tokens.length).toBeGreaterThan(8);
  });

  it('prune removes entities behind the player and collected tokens', () => {
    const spawner = new Spawner(7, true);
    spawner.update(0, 0, speedAt(0));
    const before = spawner.obstacles.length;
    expect(before).toBeGreaterThan(0);
    spawner.tokens[0].collected = true;
    const removed = spawner.prune(400);
    expect(spawner.obstacles.length).toBe(0);
    expect(removed.obstacles.length).toBe(before);
    expect(spawner.tokens.length).toBe(0);
  });

  it('revalidate repairs an artificially impossible wall', () => {
    const spawner = new Spawner(99, true);
    spawner.update(0, 0, speedAt(0));
    // Inject a solid wall of trams 60m ahead (far outside reaction range).
    const wall: ActiveObstacle[] = [0, 1, 2].map((lane, i) => ({
      uid: 90000 + i,
      defId: 'tram',
      lanes: [lane],
      dCur: 60,
      len: 13,
      y0: 0,
      y1: 3.2,
      cx: (lane - 1) * 2.3,
      hx: 1.05,
      vRel: 0,
      variant: 0,
    }));
    spawner.obstacles.push(...wall);
    const removed = spawner.revalidate(0, 0, speedAt(0), groundedState(1));
    expect(removed.length).toBeGreaterThan(0);
    // Window must be survivable again.
    const res = solve({
      obstacles: spawner.solverObstacles(),
      startD: 0,
      endD: 120,
      speed: speedAt(0),
      start: groundedState(1),
    });
    expect(res.ok).toBe(true);
  });

  it('tokens are never placed inside solid obstacles', { timeout: 60_000 }, () => {
    for (const seed of [3, 33, 333]) {
      const spawner = new Spawner(seed, false);
      let traveled = 0;
      let time = 0;
      for (let i = 0; i < 12; i++) {
        spawner.update(traveled, time, speedAt(time));
        traveled += 60;
        time += 60 / speedAt(time);
        spawner.prune(traveled);
      }
      for (const t of spawner.tokens) {
        for (const o of spawner.obstacles) {
          const inside =
            o.lanes.includes(t.lane) &&
            t.d > o.dCur &&
            t.d < o.dCur + o.len &&
            t.y > o.y0 &&
            t.y < o.y1;
          expect(inside).toBe(false);
        }
      }
    }
  });
});
