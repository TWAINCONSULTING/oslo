import { DIFFICULTY, OBSTACLES, type Keyframe, type ObstacleDef } from '../config/content';

/** Piecewise-linear interpolation over keyframes. Clamped at both ends. */
export function lerpKeys(keys: readonly Keyframe[], t: number): number {
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const a = keys[i - 1];
      const b = keys[i];
      const f = (t - a.t) / (b.t - a.t);
      return a.v + (b.v - a.v) * f;
    }
  }
  return keys[keys.length - 1].v;
}

/** Forward speed (m/s) at run time t. */
export function speedAt(t: number): number {
  return lerpKeys(DIFFICULTY.speedKeys, t);
}

/** Breathing room between spawned patterns, in seconds, at run time t. */
export function gapSecondsAt(t: number): number {
  return lerpKeys(DIFFICULTY.gapKeys, t);
}

/** Obstacle types unlocked at run time t. */
export function unlockedObstacles(t: number): ObstacleDef[] {
  return Object.values(OBSTACLES).filter((o) => t >= o.minTime);
}

/** Weighted entries for procedural obstacle picking at run time t. */
export function obstacleWeightsAt(t: number): Array<readonly [ObstacleDef, number]> {
  return unlockedObstacles(t).map((o) => [o, o.weight] as const);
}

/** Whether moving trams are allowed at run time t. */
export function movingTramsAllowed(t: number): boolean {
  return t >= DIFFICULTY.movingTramMinTime;
}
