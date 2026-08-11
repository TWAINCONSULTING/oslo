import { DIFFICULTY, OBSTACLES, activeCollectible, laneX } from '../config/content';
import { RNG } from '../core/rng';
import { gapSecondsAt, movingTramsAllowed, obstacleWeightsAt, speedAt } from './difficulty';
import { groundedState, solve, type SolverObstacle, type SolverState } from './solver';

/**
 * Procedural route planner. Places obstacle patterns and token trails ahead of
 * the player and guarantees fairness two ways:
 *  1. Every appended pattern is validated with the strict BFS solver, from the
 *     player's actual current state, over the whole remaining window.
 *  2. The game re-validates periodically while running; if the player's own
 *     choices made the remaining window unsolvable, far-away obstacles (still
 *     outside reaction range) are removed until a route exists again.
 */

export interface ActiveObstacle {
  uid: number;
  defId: string;
  lanes: number[];
  /** Current near-face distance from run start; movers decrease over time. */
  dCur: number;
  len: number;
  y0: number;
  y1: number;
  /** Hitbox center x and half width (covers multi-lane obstacles). */
  cx: number;
  hx: number;
  /** Approach speed toward the player (m/s); 0 = static. */
  vRel: number;
  /** Visual variation seed. */
  variant: number;
}

export interface ActiveToken {
  uid: number;
  lane: number;
  d: number;
  y: number;
  collected: boolean;
}

interface NewObs {
  defId: string;
  lanes: number[];
  dOff: number;
  vRel?: number;
}

interface NewTok {
  lane: number;
  dOff: number;
  y?: number;
}

interface BuiltPattern {
  obstacles: NewObs[];
  tokens: NewTok[];
  length: number;
}

interface PatternCtx {
  t: number; // projected run time when the player reaches the pattern
  speed: number;
  react: number; // comfortable reaction distance in meters
  rng: RNG;
}

interface PatternDef {
  id: string;
  minT: number;
  weight: (t: number) => number;
  build: (ctx: PatternCtx) => BuiltPattern | null;
}

export interface SpawnBatch {
  obstacles: ActiveObstacle[];
  tokens: ActiveToken[];
}

const TOKEN_Y = () => activeCollectible().y;

function reactDist(speed: number): number {
  return Math.min(18, Math.max(6.5, speed * 0.75));
}

function tokenLine(lane: number, dStart: number, count: number, spacing: number, y?: number): NewTok[] {
  const out: NewTok[] = [];
  for (let i = 0; i < count; i++) out.push({ lane, dOff: dStart + i * spacing, y });
  return out;
}

/** Token arc matching the jump parabola, centered over an obstacle. */
function tokenArc(lane: number, dCenter: number): NewTok[] {
  const out: NewTok[] = [];
  const offs = [-3, -1.5, 0, 1.5, 3];
  for (const off of offs) {
    const f = 1 - (off / 3) * (off / 3);
    out.push({ lane, dOff: dCenter + off, y: 1.05 + 1.05 * f });
  }
  return out;
}

function otherLanes(lane: number): number[] {
  return [0, 1, 2].filter((l) => l !== lane);
}

// ---------------------------------------------------------------------------

export class Spawner {
  private rng: RNG;
  private uidCounter = 1;
  private cursor = 0;
  private seenTypes = new Set<string>();
  private lastLane = -1;

  obstacles: ActiveObstacle[] = [];
  tokens: ActiveToken[] = [];

  /** Set by validate(); surfaced in the debug panel. */
  lastRepairCount = 0;

  constructor(seed: number, skipIntro: boolean) {
    this.rng = new RNG(seed);
    if (skipIntro) {
      this.cursor = DIFFICULTY.minLead;
    } else {
      this.placeIntro();
    }
  }

  // -- helpers --------------------------------------------------------------

  private mkObstacle(defId: string, lanes: number[], d: number, vRel = 0): ActiveObstacle {
    const def = OBSTACLES[defId];
    const lo = Math.min(...lanes);
    const hi = Math.max(...lanes);
    const cx = (laneX(lo) + laneX(hi)) / 2;
    const hx = (laneX(hi) - laneX(lo)) / 2 + def.halfW;
    return {
      uid: this.uidCounter++,
      defId,
      lanes: [...lanes].sort((a, b) => a - b),
      dCur: d,
      len: def.len,
      y0: def.y0,
      y1: def.y1,
      cx,
      hx,
      vRel,
      variant: this.rng.int(0, 1023),
    };
  }

  private mkToken(lane: number, d: number, y?: number): ActiveToken {
    return { uid: this.uidCounter++, lane, d, y: y ?? TOKEN_Y(), collected: false };
  }

  private laneFreeInRange(lane: number, d0: number, d1: number): boolean {
    return !this.obstacles.some(
      (o) => o.lanes.includes(lane) && o.dCur < d1 && o.dCur + o.len > d0
    );
  }

  /** Expand active (+candidate) obstacles into per-lane solver entries. */
  solverObstacles(extra: ActiveObstacle[] = []): SolverObstacle[] {
    const out: SolverObstacle[] = [];
    for (const o of [...this.obstacles, ...extra]) {
      for (const lane of o.lanes) {
        out.push({ lane, d0: o.dCur, d1: o.dCur + o.len, y0: o.y0, y1: o.y1, vRel: o.vRel });
      }
    }
    return out;
  }

  /**
   * Validate that the whole remaining window is survivable from the given
   * player state. Checked at both current speed and the (higher) projected
   * speed, so time-based actions are safe across the acceleration range.
   *
   * `strict` (used when APPENDING patterns) adds extra margin — a full sim
   * step of distance plus a longer action cooldown — so accepted patterns
   * always carry real slack, never razor-thin timing.
   */
  private windowSolvable(
    traveled: number,
    time: number,
    speed: number,
    state: SolverState,
    extra: ActiveObstacle[] = [],
    strict = false
  ): boolean {
    const obstacles = this.solverObstacles(extra);
    if (obstacles.length === 0) return true;
    let endD = traveled;
    for (const o of obstacles) endD = Math.max(endD, o.d1);
    endD += 12;
    const spanSec = (endD - traveled) / Math.max(1, speed);
    const highSpeed = Math.max(speed * 1.05, speedAt(time + spanSec));
    const base = { obstacles, startD: traveled, endD, start: state };
    const opts = strict
      ? { margin: 0.15 + highSpeed / 30, cooldown: 0.3 }
      : {};
    // Always check both ends of the speed range: time-based actions cover
    // fewer meters at low speed and reaction windows shrink at high speed.
    if (!solve({ ...base, ...opts, speed }).ok) return false;
    if (highSpeed > speed * 1.01 && !solve({ ...base, ...opts, speed: highSpeed }).ok) return false;
    return true;
  }

  // -- intro ---------------------------------------------------------------

  /** Scripted opening: huge gaps, one new concept at a time. */
  private placeIntro(): void {
    const rng = this.rng;
    const laneA = rng.int(0, 2);
    const laneB = rng.pick(otherLanes(laneA));

    this.tokens.push(...tokenLine(1, 18, 5, 1.7).map((t) => this.mkToken(t.lane, t.dOff, t.y)));

    const scooter = this.mkObstacle('scooter', [laneA], 55);
    this.obstacles.push(scooter);
    this.tokens.push(...tokenArc(laneA, 55 + scooter.len / 2).map((t) => this.mkToken(t.lane, t.dOff, t.y)));

    const barrier = this.mkObstacle('barrier', [laneB], 85);
    this.obstacles.push(barrier);
    this.tokens.push(
      ...tokenLine(rng.pick(otherLanes(laneB)), 82, 5, 1.7).map((t) => this.mkToken(t.lane, t.dOff, t.y))
    );

    this.obstacles.push(this.mkObstacle('overhead', [0, 1, 2], 118));
    this.tokens.push(...tokenLine(1, 115, 5, 1.7, 0.55).map((t) => this.mkToken(t.lane, t.dOff, t.y)));

    const laneC = rng.int(0, 2);
    this.obstacles.push(this.mkObstacle('cones', [laneC], 142));
    this.tokens.push(
      ...tokenLine(rng.pick(otherLanes(laneC)), 139, 4, 1.7).map((t) => this.mkToken(t.lane, t.dOff, t.y))
    );

    this.seenTypes.add('scooter').add('barrier').add('overhead').add('cones');
    this.cursor = 168;
  }

  // -- pattern library ------------------------------------------------------

  private patterns: PatternDef[] = [
    {
      id: 'single',
      minT: 0,
      weight: (t) => (t < 40 ? 10 : 6),
      build: (ctx) => {
        const entries = obstacleWeightsAt(ctx.t).filter(([o]) => o.kind === 'jump');
        if (!entries.length) return null;
        const def = ctx.rng.weighted(entries);
        const lane = this.pickLane(ctx.rng);
        const obstacles: NewObs[] = [{ defId: def.id, lanes: [lane], dOff: 0 }];
        const tokens = ctx.rng.chance(0.5)
          ? tokenArc(lane, def.len / 2)
          : tokenLine(ctx.rng.pick(otherLanes(lane)), -2, 5, 1.7);
        return { obstacles, tokens, length: def.len + 2 };
      },
    },
    {
      id: 'double',
      minT: 30,
      weight: (t) => (t < 60 ? 3 : 6),
      build: (ctx) => {
        const entries = obstacleWeightsAt(ctx.t).filter(([o]) => o.kind === 'jump');
        if (!entries.length) return null;
        const open = ctx.rng.int(0, 2);
        const lanes = otherLanes(open);
        const a = ctx.rng.weighted(entries);
        const b = ctx.rng.weighted(entries);
        const obstacles: NewObs[] = [
          { defId: a.id, lanes: [lanes[0]], dOff: 0 },
          { defId: b.id, lanes: [lanes[1]], dOff: 0 },
        ];
        const tokens = ctx.rng.chance(0.4)
          ? tokenArc(lanes[0], a.len / 2)
          : tokenLine(open, -2, 5, 1.7);
        return { obstacles, tokens, length: Math.max(a.len, b.len) + 2 };
      },
    },
    {
      id: 'slalom',
      minT: 20,
      weight: () => 5,
      build: (ctx) => {
        const entries = obstacleWeightsAt(ctx.t).filter(([o]) => o.kind === 'jump');
        if (!entries.length) return null;
        const gap = Math.max(ctx.react, 8);
        let lane = this.pickLane(ctx.rng);
        const obstacles: NewObs[] = [];
        const tokens: NewTok[] = [];
        let d = 0;
        for (let i = 0; i < 3; i++) {
          const def = ctx.rng.weighted(entries);
          obstacles.push({ defId: def.id, lanes: [lane], dOff: d });
          const safe = ctx.rng.pick(otherLanes(lane));
          tokens.push(...tokenLine(safe, d - 1, 3, 1.7));
          lane = ctx.rng.pick(otherLanes(lane));
          d += gap;
        }
        return { obstacles, tokens, length: d + 2 };
      },
    },
    {
      id: 'tram-static',
      minT: OBSTACLES.tram.minTime,
      weight: (t) => (t < 60 ? 4 : 5),
      build: (ctx) => {
        const lane = this.pickLane(ctx.rng);
        const tram = OBSTACLES.tram;
        const safe = ctx.rng.pick(otherLanes(lane));
        return {
          obstacles: [{ defId: 'tram', lanes: [lane], dOff: 0 }],
          tokens: tokenLine(safe, -1, 7, 2.1),
          length: tram.len + 2,
        };
      },
    },
    {
      id: 'tram-double',
      minT: 70,
      weight: () => 3,
      build: (ctx) => {
        const open = ctx.rng.int(0, 2);
        const lanes = otherLanes(open);
        const off = Math.max(ctx.react * 1.4, 16);
        return {
          obstacles: [
            { defId: 'tram', lanes: [lanes[0]], dOff: 0 },
            { defId: 'tram', lanes: [lanes[1]], dOff: off },
          ],
          tokens: tokenLine(open, -1, 10, 2.4),
          length: off + OBSTACLES.tram.len + 2,
        };
      },
    },
    {
      id: 'tram-moving',
      minT: DIFFICULTY.movingTramMinTime,
      weight: () => 4,
      build: (ctx) => {
        if (!movingTramsAllowed(ctx.t)) return null;
        const lane = this.pickLane(ctx.rng);
        const safe = ctx.rng.pick(otherLanes(lane));
        return {
          obstacles: [{ defId: 'tram', lanes: [lane], dOff: 0, vRel: DIFFICULTY.movingTramRelSpeed }],
          tokens: tokenLine(safe, -4, 8, 2.2),
          length: OBSTACLES.tram.len + 2,
        };
      },
    },
    {
      id: 'overhead-all',
      minT: OBSTACLES.overhead.minTime,
      weight: () => 4,
      build: (ctx) => ({
        obstacles: [{ defId: 'overhead', lanes: [0, 1, 2], dOff: 0 }],
        tokens: tokenLine(ctx.rng.int(0, 2), -1.5, 4, 1.6, 0.55),
        length: OBSTACLES.overhead.len + 2,
      }),
    },
    {
      id: 'overhead-side',
      minT: 28,
      weight: () => 3,
      build: (ctx) => {
        const pair = ctx.rng.pick([
          [0, 1],
          [1, 2],
        ]);
        const free = pair.includes(0) && pair.includes(1) ? 2 : 0;
        return {
          obstacles: [{ defId: 'overhead', lanes: pair, dOff: 0 }],
          tokens: tokenLine(free, -1.5, 4, 1.7),
          length: OBSTACLES.overhead.len + 2,
        };
      },
    },
    {
      id: 'corridor',
      minT: 45,
      weight: () => 4,
      build: (ctx) => {
        const gap = Math.max(ctx.react, 9);
        const openFirst = ctx.rng.int(0, 2);
        const blocked = otherLanes(openFirst);
        const obstacles: NewObs[] = [
          { defId: 'barrier', lanes: [blocked[0]], dOff: 0 },
          { defId: 'barrier', lanes: [blocked[1]], dOff: gap * 0.5 },
          { defId: 'cones', lanes: [ctx.rng.pick(blocked)], dOff: gap * 1.5 },
        ];
        const tokens = [
          ...tokenLine(openFirst, -1, 4, 1.7),
          ...tokenLine(openFirst, gap, 4, 1.7),
        ];
        return { obstacles, tokens, length: gap * 1.5 + 3 };
      },
    },
    {
      id: 'jump-chain',
      minT: 35,
      weight: () => 3,
      build: (ctx) => {
        const entries = obstacleWeightsAt(ctx.t).filter(
          ([o]) => o.kind === 'jump' && o.y1 <= 0.6
        );
        if (!entries.length) return null;
        const lane = this.pickLane(ctx.rng);
        const gap = Math.max(7, ctx.speed * 0.55);
        const a = ctx.rng.weighted(entries);
        const b = ctx.rng.weighted(entries);
        return {
          obstacles: [
            { defId: a.id, lanes: [lane], dOff: 0 },
            { defId: b.id, lanes: [lane], dOff: gap },
          ],
          tokens: [...tokenArc(lane, a.len / 2), ...tokenArc(lane, gap + b.len / 2)],
          length: gap + b.len + 2,
        };
      },
    },
    {
      id: 'breather',
      minT: 0,
      weight: (t) => (t < 30 ? 3 : 2),
      build: (ctx) => {
        const lane = this.pickLane(ctx.rng);
        return { obstacles: [], tokens: tokenLine(lane, 0, 6, 1.8), length: 11 };
      },
    },
  ];

  private pickLane(rng: RNG): number {
    // Mildly avoid repeating the exact same lane over and over.
    let lane = rng.int(0, 2);
    if (lane === this.lastLane && rng.chance(0.5)) lane = rng.pick(otherLanes(lane));
    this.lastLane = lane;
    return lane;
  }

  // -- main API -------------------------------------------------------------

  /**
   * Keep the route planned ahead of the player. Returns newly spawned entities
   * so the renderer can materialize them.
   */
  update(traveled: number, time: number, speed: number, state?: SolverState): SpawnBatch {
    const out: SpawnBatch = { obstacles: [], tokens: [] };
    const playerState = state ?? groundedState(1);
    this.cursor = Math.max(this.cursor, traveled + DIFFICULTY.minLead);

    let guard = 0;
    while (this.cursor < traveled + DIFFICULTY.horizon && guard++ < 24) {
      const projT = time + Math.max(0, this.cursor - traveled) / Math.max(1, speed);
      const projSpeed = speedAt(projT);
      const ctx: PatternCtx = {
        t: projT,
        speed: projSpeed,
        react: reactDist(projSpeed),
        rng: this.rng,
      };

      const available = this.patterns.filter((p) => projT >= p.minT);
      let placed = false;

      for (let attempt = 0; attempt < 6 && !placed; attempt++) {
        const pattern = this.rng.weighted(available.map((p) => [p, p.weight(projT)] as const));
        const built = pattern.build(ctx);
        if (!built) continue;

        // Movers must have a clear approach path in their lane.
        const mover = built.obstacles.find((o) => (o.vRel ?? 0) > 0);
        if (mover && !this.laneFreeInRange(mover.lanes[0], traveled - 5, this.cursor + mover.dOff)) {
          continue;
        }

        const newObs = built.obstacles.map((o) =>
          this.mkObstacle(o.defId, o.lanes, this.cursor + o.dOff, o.vRel ?? 0)
        );

        if (!this.windowSolvable(traveled, time, speed, playerState, newObs, true)) continue;

        const unseen = built.obstacles.some((o) => !this.seenTypes.has(o.defId));
        this.obstacles.push(...newObs);
        out.obstacles.push(...newObs);
        for (const tk of built.tokens) {
          if (!this.tokenSpotFree(tk.lane, this.cursor + tk.dOff, tk.y ?? TOKEN_Y())) continue;
          const token = this.mkToken(tk.lane, this.cursor + tk.dOff, tk.y);
          this.tokens.push(token);
          out.tokens.push(token);
        }
        for (const o of built.obstacles) this.seenTypes.add(o.defId);

        const gapMult = unseen ? DIFFICULTY.firstSeenGapMultiplier : 1;
        this.cursor += built.length + gapSecondsAt(projT) * projSpeed * gapMult;
        placed = true;
      }

      if (!placed) {
        // Guaranteed progress: token-only breather.
        const lane = this.pickLane(this.rng);
        for (const tk of tokenLine(lane, 0, 5, 1.8)) {
          if (!this.tokenSpotFree(tk.lane, this.cursor + tk.dOff, tk.y ?? TOKEN_Y())) continue;
          const token = this.mkToken(tk.lane, this.cursor + tk.dOff, tk.y);
          this.tokens.push(token);
          out.tokens.push(token);
        }
        this.cursor += 12;
      }
    }
    return out;
  }

  /** A token must not sit inside a solid obstacle (unless it is a low token under an overhead). */
  private tokenSpotFree(lane: number, d: number, y: number): boolean {
    return !this.obstacles.some(
      (o) =>
        o.lanes.includes(lane) &&
        d > o.dCur - 0.5 &&
        d < o.dCur + o.len + 0.5 &&
        y > o.y0 - 0.4 &&
        y < o.y1 + 0.4
    );
  }

  /** Advance moving obstacles (trams driving toward the player). */
  advanceMovers(dt: number): void {
    for (const o of this.obstacles) {
      if (o.vRel > 0) o.dCur -= o.vRel * dt;
    }
  }

  /** Remove entities behind the player. Returns removed uids. */
  prune(traveled: number): { obstacles: number[]; tokens: number[] } {
    const limit = traveled - DIFFICULTY.despawnBehind;
    const removedO: number[] = [];
    const removedT: number[] = [];
    this.obstacles = this.obstacles.filter((o) => {
      if (o.dCur + o.len < limit) {
        removedO.push(o.uid);
        return false;
      }
      return true;
    });
    this.tokens = this.tokens.filter((t) => {
      if (t.d < limit || t.collected) {
        removedT.push(t.uid);
        return false;
      }
      return true;
    });
    return { obstacles: removedO, tokens: removedT };
  }

  /**
   * Fairness repair: if the remaining window is not survivable from the
   * player's actual state, drop far-away obstacles (outside reaction range)
   * until it is. Returns removed uids.
   */
  revalidate(traveled: number, time: number, speed: number, state: SolverState): number[] {
    const removed: number[] = [];
    let guard = 0;
    while (!this.windowSolvable(traveled, time, speed, state) && guard++ < 12) {
      const farIdx = this.farthestRemovableIndex(traveled);
      if (farIdx < 0) break;
      removed.push(this.obstacles[farIdx].uid);
      this.obstacles.splice(farIdx, 1);
    }
    this.lastRepairCount += removed.length;
    return removed;
  }

  private farthestRemovableIndex(traveled: number): number {
    let idx = -1;
    let best = -Infinity;
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      if (o.dCur > traveled + 45 && o.dCur > best) {
        best = o.dCur;
        idx = i;
      }
    }
    return idx;
  }

  /** Debug helper: drop an obstacle directly ahead, bypassing pattern logic. */
  forceSpawn(defId: string, traveled: number): ActiveObstacle | null {
    const def = OBSTACLES[defId];
    if (!def) return null;
    const lanes = defId === 'overhead' ? [0, 1, 2] : [this.rng.int(0, 2)];
    const obs = this.mkObstacle(defId, lanes, traveled + 60, 0);
    this.obstacles.push(obs);
    return obs;
  }
}
