import { PHYSICS, laneX } from '../config/content';
import type { GameAction } from '../core/input';
import { jumpY, type SolverState } from '../world/solver';

export interface ControllerEvents {
  jumped: boolean;
  landed: boolean;
  startedSlide: boolean;
  laneChanged: boolean;
}

/**
 * Player movement state machine: lane easing, jump parabola, slide timer and
 * a short input buffer so slightly-early swipes still count.
 */
export class PlayerController {
  targetLane = 1;
  fromLane = 1;
  private fromX = 0;
  private changeT = 0;

  airT = 0;
  slideT = 0;

  x = 0;
  y = 0;
  /** Lane-change lean, -1..1. */
  lean = 0;
  /** Landing squash envelope, 1 → 0. */
  squash = 0;
  /** Distance-driven run cycle phase (radians). */
  runPhase = 0;

  private buffer: Array<{ action: GameAction; at: number }> = [];
  private now = 0;

  reset(): void {
    this.targetLane = 1;
    this.fromLane = 1;
    this.fromX = 0;
    this.changeT = 0;
    this.airT = 0;
    this.slideT = 0;
    this.x = 0;
    this.y = 0;
    this.lean = 0;
    this.squash = 0;
    this.runPhase = 0;
    this.buffer = [];
    this.now = 0;
  }

  enqueue(action: GameAction): void {
    this.buffer.push({ action, at: this.now });
  }

  get grounded(): boolean {
    return this.airT <= 0;
  }
  get sliding(): boolean {
    return this.slideT > 0 && this.grounded;
  }
  get airProgress(): number {
    return this.airT > 0 ? 1 - this.airT / PHYSICS.jumpDuration : 0;
  }
  get slideProgress(): number {
    return this.sliding ? 1 - this.slideT / PHYSICS.slideDuration : 0;
  }

  update(dt: number, speed: number): ControllerEvents {
    this.now += dt;
    const ev: ControllerEvents = { jumped: false, landed: false, startedSlide: false, laneChanged: false };

    // Consume buffered inputs that are currently executable.
    const keep: Array<{ action: GameAction; at: number }> = [];
    let laneExecuted: GameAction | null = null;
    for (const item of this.buffer) {
      if (this.now - item.at > PHYSICS.inputBufferTime) continue; // stale
      let executed = false;
      switch (item.action) {
        case 'left':
        case 'right': {
          const dir = item.action === 'left' ? -1 : 1;
          const next = this.targetLane + dir;
          if (next < 0 || next > 2) {
            // Swiping into a wall: discard immediately. Keeping it buffered
            // would let it fire later and reverse a subsequent dodge.
            executed = true;
            break;
          }
          // A just-executed lane change purges buffered opposite swipes
          // (almost always jitter); same-direction stays queued (double-move).
          if (laneExecuted && laneExecuted !== item.action) {
            executed = true;
            break;
          }
          if (this.changeT <= 0.05) {
            this.fromLane = this.targetLane;
            this.fromX = this.x;
            this.targetLane = next;
            this.changeT = PHYSICS.laneChangeTime;
            ev.laneChanged = true;
            laneExecuted = item.action;
            executed = true;
          }
          break;
        }
        case 'jump': {
          if (this.grounded) {
            this.airT = PHYSICS.jumpDuration;
            this.slideT = 0;
            ev.jumped = true;
            executed = true;
          }
          break;
        }
        case 'slide': {
          if (this.grounded) {
            this.slideT = PHYSICS.slideDuration;
            ev.startedSlide = true;
            executed = true;
          } else {
            // Fast-fall: cut the jump short; the buffered slide then triggers
            // on landing (it stays in the buffer until executed or stale).
            this.airT = Math.min(this.airT, 0.1);
          }
          break;
        }
      }
      if (!executed) keep.push(item);
    }
    this.buffer = keep;

    // Vertical.
    if (this.airT > 0) {
      this.airT -= dt;
      if (this.airT <= 0) {
        this.airT = 0;
        this.y = 0;
        this.squash = 1;
        ev.landed = true;
      } else {
        this.y = jumpY(PHYSICS.jumpDuration - this.airT);
      }
    } else {
      this.y = 0;
    }

    // Slide timer.
    if (this.slideT > 0) this.slideT = Math.max(0, this.slideT - dt);

    // Lane easing + lean.
    const targetX = laneX(this.targetLane);
    if (this.changeT > 0) {
      this.changeT = Math.max(0, this.changeT - dt);
      const f = 1 - this.changeT / PHYSICS.laneChangeTime;
      const ease = f * f * (3 - 2 * f);
      this.x = this.fromX + (targetX - this.fromX) * ease;
      const dir = Math.sign(targetX - this.fromX);
      this.lean = dir * 4 * f * (1 - f);
    } else {
      this.x = targetX;
      this.lean *= Math.exp(-10 * dt);
    }

    // Squash decay.
    this.squash = Math.max(0, this.squash - dt * 4);

    // Run cycle.
    this.runPhase += speed * dt * 0.9;

    return ev;
  }

  /** Snapshot for the fairness solver. */
  get solverState(): SolverState {
    return {
      lane: this.targetLane,
      airTime: Math.max(0, this.airT),
      slideTime: this.grounded ? this.slideT : 0,
      changeTime: this.changeT,
      fromLane: this.fromLane,
      coolTime: 0,
    };
  }

  /** Current collision box (generous to the player). */
  hitbox(): { x: number; halfW: number; halfD: number; y0: number; y1: number } {
    const h = this.airT > 0 ? PHYSICS.airHeight : this.sliding ? PHYSICS.slideHeight : PHYSICS.runHeight;
    return {
      x: this.x,
      halfW: PHYSICS.playerHalfW,
      halfD: PHYSICS.playerHalfD,
      y0: this.y,
      y1: this.y + h,
    };
  }
}
