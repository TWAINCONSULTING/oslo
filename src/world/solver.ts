import { PHYSICS } from '../config/content';

/**
 * Route-solvability checker. Pure logic — used at runtime by the spawner to
 * guarantee every generated obstacle window can be survived, and hammered by
 * the automated tests.
 *
 * The solver is deliberately STRICTER than the real game:
 *  - obstacle hitboxes are expanded by a safety margin,
 *  - actions may only start on a coarse time grid (~66 ms),
 *  - a longer action cooldown is enforced than the game requires.
 * If the strict solver finds a path, a human player has slack.
 */

export interface SolverObstacle {
  lane: number;
  /** Near/far face distance (meters from run start) at time 0 of the sim. */
  d0: number;
  d1: number;
  y0: number;
  y1: number;
  /** Approach speed toward the player (m/s). 0 = static. */
  vRel?: number;
}

export interface SolverState {
  lane: number;
  airTime: number;
  slideTime: number;
  changeTime: number;
  fromLane: number;
  coolTime: number;
}

export function groundedState(lane: number): SolverState {
  return { lane, airTime: 0, slideTime: 0, changeTime: 0, fromLane: lane, coolTime: 0 };
}

export interface SolveOptions {
  obstacles: SolverObstacle[];
  /** Player distance at sim start. */
  startD: number;
  /** Distance that must be reached alive. */
  endD: number;
  /** Constant forward speed for the sim (use a conservative value). */
  speed: number;
  start: SolverState;
  dt?: number;
  margin?: number;
  cooldown?: number;
  /** If true, the surviving action sequence is returned (for tests/bots). */
  wantPath?: boolean;
  /**
   * If set, endState is taken at this distance along the found path instead of
   * at endD — "validate far, commit near", so chained windows never inherit a
   * state that only survives to the window edge.
   */
  commitD?: number;
  maxNodes?: number;
}

/** Action encoding for returned paths. */
export const ACTION_NONE = 0;
export const ACTION_JUMP = 1;
export const ACTION_SLIDE = 2;
export const ACTION_LEFT = 3;
export const ACTION_RIGHT = 4;
export type SolverAction = 0 | 1 | 2 | 3 | 4;

export interface SolveResult {
  ok: boolean;
  /** Per-step actions when wantPath was set and ok. */
  path?: SolverAction[];
  /** Player state at the end of a successful search (for chaining windows). */
  endState?: SolverState;
  /** Absolute distance of the node endState was taken from. */
  endStateD?: number;
  /** True when the search aborted on the node budget (treated as not ok). */
  overflow?: boolean;
  /**
   * True when the START state already intersects an expanded obstacle box.
   * The strict solver cannot reason from such a state (the lenient in-game
   * hitbox may well survive it) — callers should treat this as inconclusive,
   * not as an unsolvable route.
   */
  rootBlocked?: boolean;
}

/** Vertical jump position given elapsed airtime. Shared with the gameplay code. */
export function jumpY(elapsed: number, duration = PHYSICS.jumpDuration, height = PHYSICS.jumpHeight): number {
  const f = Math.min(1, Math.max(0, elapsed / duration));
  return 4 * height * f * (1 - f);
}

interface Node {
  lane: number;
  air: number; // remaining steps
  slide: number;
  change: number;
  from: number;
  cool: number;
  parent: number; // index into nodes array, -1 for root
  action: SolverAction;
  step: number;
}

export function solve(opts: SolveOptions): SolveResult {
  const dt = opts.dt ?? 1 / 30;
  const margin = opts.margin ?? 0.15;
  const cooldown = opts.cooldown ?? 0.26;
  const maxNodes = opts.maxNodes ?? 250_000;
  const speed = Math.max(0.5, opts.speed);
  const stepDist = speed * dt;

  const totalDist = opts.endD - opts.startD;
  if (totalDist <= 0) return { ok: true, path: [] };
  const nSteps = Math.ceil(totalDist / stepDist);
  if (nSteps > 4000) {
    // Window too large to verify — treat as unsolved so callers simplify.
    return { ok: false, overflow: true };
  }

  const J = PHYSICS.jumpDuration;
  const S = PHYSICS.slideDuration;
  const L = PHYSICS.laneChangeTime;
  const airSteps = Math.max(1, Math.round(J / dt));
  const slideSteps = Math.max(1, Math.round(S / dt));
  const changeSteps = Math.max(1, Math.round(L / dt));
  const coolSteps = Math.max(1, Math.round(cooldown / dt));
  // Actions may only start every other step — coarser than the game allows.
  const actionGrid = 2;

  const obstacles = opts.obstacles;
  const expand = margin + PHYSICS.playerHalfD;

  /** Player vertical extent for a point state. */
  const bounds = (air: number, slide: number): [number, number] => {
    if (air > 0) {
      const y = jumpY(J - air * dt);
      return [y, y + PHYSICS.airHeight];
    }
    if (slide > 0) return [0, PHYSICS.slideHeight];
    return [0, PHYSICS.runHeight];
  };

  /**
   * Conservative segment collision: the motion from step-1 → step is tested as
   * an interval (both in distance and in worst-case player height at the two
   * endpoint states), so results do not depend on sampling-grid phase.
   * `air0/slide0` describe the state at the segment start (after the action
   * was applied), `air1/slide1` after the step's timer decrement.
   */
  const collides = (
    step: number,
    lane: number,
    from: number,
    changing: boolean,
    air0: number,
    slide0: number,
    air1: number,
    slide1: number
  ): boolean => {
    const t = step * dt;
    const pd1 = opts.startD + step * stepDist;
    const pd0 = pd1 - stepDist;
    const [b0, t0] = bounds(air0, slide0);
    const [b1, t1] = bounds(air1, slide1);
    const py0 = Math.min(b0, b1);
    const py1 = Math.max(t0, t1);
    for (const o of obstacles) {
      if (o.lane !== lane && !(changing && o.lane === from)) continue;
      const vRel = o.vRel ?? 0;
      const shift = vRel * t;
      const d0 = o.d0 - shift - expand - Math.abs(vRel) * dt;
      const d1 = o.d1 - shift + expand + Math.abs(vRel) * dt;
      if (pd1 < d0 || pd0 > d1) continue;
      const oy0 = o.y0 - margin;
      const oy1 = o.y1 + margin;
      if (py1 > oy0 && py0 < oy1) return true;
    }
    return false;
  };

  const startNode: Node = {
    lane: opts.start.lane,
    air: Math.min(airSteps, Math.max(0, Math.round(opts.start.airTime / dt))),
    slide: Math.min(slideSteps, Math.max(0, Math.round(opts.start.slideTime / dt))),
    change: Math.min(changeSteps, Math.max(0, Math.round(opts.start.changeTime / dt))),
    from: opts.start.fromLane,
    cool: Math.min(coolSteps, Math.max(0, Math.round(opts.start.coolTime / dt))),
    parent: -1,
    action: ACTION_NONE,
    step: 0,
  };

  // Root must not already be inside an obstacle for the search to make sense;
  // if it is, report unsolvable (the game itself decides actual collisions).
  // Point check — a segment check would falsely include ground just passed.
  {
    const [rb, rt] = bounds(startNode.air, startNode.slide);
    for (const o of obstacles) {
      if (o.lane !== startNode.lane && !(startNode.change > 0 && o.lane === startNode.from)) continue;
      if (opts.startD < o.d0 - expand || opts.startD > o.d1 + expand) continue;
      if (rt > o.y0 - margin && rb < o.y1 + margin) return { ok: false, rootBlocked: true };
    }
  }

  const nodes: Node[] = [startNode];
  // Packed numeric visited key (fits comfortably in a double's exact range).
  const kAir = airSteps + 2;
  const kSlide = slideSteps + 2;
  const kChange = changeSteps + 2;
  const kCool = coolSteps + 2;
  const key = (n: Node): number =>
    ((((n.step * 3 + n.lane) * 3 + n.from) * kAir + n.air) * kSlide + n.slide) * kChange * kCool +
    n.change * kCool +
    n.cool;
  const visited = new Set<number>();
  visited.add(key(startNode));

  let head = 0;
  while (head < nodes.length) {
    if (nodes.length > maxNodes) return { ok: false, overflow: true };
    const cur = nodes[head];
    const curIdx = head;
    head++;

    if (cur.step >= nSteps) {
      let stateNode: Node = cur;
      if (opts.commitD !== undefined) {
        const commitStep = Math.max(0, Math.min(nSteps, Math.round((opts.commitD - opts.startD) / stepDist)));
        let i = curIdx;
        while (nodes[i].step > commitStep && nodes[i].parent >= 0) i = nodes[i].parent;
        // Prefer the nearest ancestor with no active timers: such "clean"
        // states re-base onto a fresh sampling grid without rounding drift.
        let j = i;
        while (nodes[j].parent >= 0) {
          const n = nodes[j];
          if (n.air === 0 && n.slide === 0 && n.change === 0) break;
          j = n.parent;
        }
        stateNode = nodes[j].step > 0 ? nodes[j] : nodes[i];
      }
      const endState: SolverState = {
        lane: stateNode.lane,
        airTime: stateNode.air * dt,
        slideTime: stateNode.slide * dt,
        changeTime: stateNode.change * dt,
        fromLane: stateNode.from,
        coolTime: stateNode.cool * dt,
      };
      const endStateD = opts.startD + stateNode.step * stepDist;
      if (!opts.wantPath) return { ok: true, endState, endStateD };
      const path: SolverAction[] = [];
      let i = curIdx;
      while (i >= 0 && nodes[i].parent >= 0) {
        path.push(nodes[i].action);
        i = nodes[i].parent;
      }
      path.reverse();
      return { ok: true, path, endState, endStateD };
    }

    const canAct = cur.cool <= 0 && cur.step % actionGrid === 0;
    const actions: SolverAction[] = [ACTION_NONE];
    if (canAct) {
      if (cur.air <= 0) {
        actions.push(ACTION_JUMP);
        actions.push(ACTION_SLIDE);
      }
      if (cur.change <= 0) {
        if (cur.lane > 0) actions.push(ACTION_LEFT);
        if (cur.lane < 2) actions.push(ACTION_RIGHT);
      }
    }

    for (const action of actions) {
      let lane = cur.lane;
      let air = cur.air;
      let slide = cur.slide;
      let change = cur.change;
      let from = cur.from;
      let cool = cur.cool;

      switch (action) {
        case ACTION_JUMP:
          air = airSteps;
          slide = 0;
          cool = coolSteps;
          break;
        case ACTION_SLIDE:
          slide = slideSteps;
          cool = coolSteps;
          break;
        case ACTION_LEFT:
        case ACTION_RIGHT:
          from = lane;
          lane += action === ACTION_LEFT ? -1 : 1;
          change = changeSteps;
          cool = coolSteps;
          break;
        default:
          break;
      }

      // Advance one step.
      const step = cur.step + 1;
      const air0 = air;
      const slide0 = slide;
      air = Math.max(0, air - 1);
      slide = Math.max(0, slide - 1);
      change = Math.max(0, change - 1);
      cool = Math.max(0, cool - 1);

      if (collides(step, lane, from, change > 0, air0, slide0, air, slide)) continue;

      const node: Node = { lane, air, slide, change, from, cool, parent: curIdx, action, step };
      const k = key(node);
      if (visited.has(k)) continue;
      visited.add(k);
      nodes.push(node);
    }
  }

  return { ok: false };
}
