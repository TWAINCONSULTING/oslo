import { SCORING } from '../config/content';

/** Score is mainly distance, with a bonus per collected token. */
export function scoreFor(distanceMeters: number, tokens: number): number {
  return Math.floor(distanceMeters * SCORING.pointsPerMeter) + tokens * SCORING.tokenBonus;
}
