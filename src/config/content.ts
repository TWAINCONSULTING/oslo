/**
 * Central content & configuration layer.
 *
 * Game logic references content by ID (character IDs, obstacle IDs, theme IDs,
 * collectible IDs) and reads all tuning values from here. To reskin or rebalance
 * the game, edit this file — not the game loop.
 */

// ---------------------------------------------------------------------------
// Physics & feel (shared by gameplay AND the fairness solver — keep in sync).
// ---------------------------------------------------------------------------
export const PHYSICS = {
  laneWidth: 2.3,
  laneCount: 3,
  laneChangeTime: 0.17, // seconds for a full lane change
  jumpDuration: 0.62, // total airtime in seconds
  jumpHeight: 1.45, // apex height in meters
  slideDuration: 0.7,
  runHeight: 1.62, // standing hitbox height
  slideHeight: 0.82, // hitbox height while sliding
  airHeight: 1.1, // hitbox height while airborne (tucked legs)
  playerHalfW: 0.3, // generous: the player's box is narrow
  playerHalfD: 0.42,
  inputBufferTime: 0.18, // seconds an input stays buffered
  actionCooldown: 0.1, // min seconds between accepted actions in-game
} as const;

/** X position of a lane center. Lane indices are 0 (left), 1 (center), 2 (right). */
export function laneX(lane: number): number {
  return (lane - 1) * PHYSICS.laneWidth;
}

// ---------------------------------------------------------------------------
// Difficulty curve.
// ---------------------------------------------------------------------------
export interface Keyframe {
  t: number; // seconds since run start
  v: number;
}

export const DIFFICULTY = {
  /** Forward speed in m/s over run time. */
  speedKeys: [
    { t: 0, v: 7.5 },
    { t: 15, v: 10.5 },
    { t: 45, v: 14 },
    { t: 90, v: 17.5 },
    { t: 150, v: 20.5 },
    { t: 240, v: 23 },
    { t: 420, v: 25 },
  ] as Keyframe[],
  /** Seconds of breathing room between spawned patterns. */
  gapKeys: [
    { t: 0, v: 1.8 },
    { t: 15, v: 1.3 },
    { t: 45, v: 1.0 },
    { t: 90, v: 0.82 },
    { t: 180, v: 0.72 },
  ] as Keyframe[],
  /** Extra gap multiplier the first time an obstacle type appears in a run. */
  firstSeenGapMultiplier: 1.6,
  /** Seconds before trams may drive toward the player. */
  movingTramMinTime: 50,
  /** Relative approach speed of a moving tram, m/s. */
  movingTramRelSpeed: 4,
  /** How far ahead (m) the spawner plans. */
  horizon: 150,
  /** Minimum distance ahead of the player that anything may spawn. */
  minLead: 55,
  /** Distance behind the player at which entities are recycled. */
  despawnBehind: 20,
} as const;

// ---------------------------------------------------------------------------
// Obstacles.
// ---------------------------------------------------------------------------
export type ObstacleKind = 'block' | 'jump' | 'slide';

export interface ObstacleDef {
  id: string;
  /** Intended dodge action (lane change always also works unless all lanes are used). */
  kind: ObstacleKind;
  /** Hitbox length along the track, meters. */
  len: number;
  /** Vertical hitbox range, meters. */
  y0: number;
  y1: number;
  /** Hitbox half width, meters. */
  halfW: number;
  /** Seconds into a run before this type may appear. */
  minTime: number;
  /** Relative spawn weight once unlocked. */
  weight: number;
  /** Whether this obstacle may move toward the player. */
  canMove?: boolean;
}

export const OBSTACLES: Record<string, ObstacleDef> = {
  tram: {
    id: 'tram',
    kind: 'block',
    len: 13,
    y0: 0,
    y1: 3.2,
    halfW: 1.05,
    minTime: 25,
    weight: 3,
    canMove: true,
  },
  scooter: {
    id: 'scooter',
    kind: 'jump',
    len: 0.8,
    y0: 0,
    y1: 0.42,
    halfW: 0.85,
    minTime: 4,
    weight: 5,
  },
  barrier: {
    id: 'barrier',
    kind: 'jump',
    len: 0.5,
    y0: 0,
    y1: 0.86,
    halfW: 1.0,
    minTime: 10,
    weight: 4,
  },
  overhead: {
    id: 'overhead',
    kind: 'slide',
    len: 0.6,
    y0: 1.15,
    y1: 2.6,
    halfW: 1.05,
    minTime: 20,
    weight: 3,
  },
  cones: {
    id: 'cones',
    kind: 'jump',
    len: 0.9,
    y0: 0,
    y1: 0.55,
    halfW: 0.8,
    minTime: 6,
    weight: 3,
  },
  boxes: {
    id: 'boxes',
    kind: 'jump',
    len: 0.9,
    y0: 0,
    y1: 0.72,
    halfW: 0.8,
    minTime: 14,
    weight: 2,
  },
  bikerack: {
    id: 'bikerack',
    kind: 'jump',
    len: 0.6,
    y0: 0,
    y1: 0.85,
    halfW: 0.95,
    minTime: 35,
    weight: 2,
  },
};

// ---------------------------------------------------------------------------
// Collectibles.
// ---------------------------------------------------------------------------
export interface CollectibleDef {
  id: string;
  /** Pickup radius, generous. */
  radius: number;
  /** Default hover height. */
  y: number;
  /** Score bonus per token. */
  value: number;
  color: number;
  rim: number;
}

export const COLLECTIBLES: Record<string, CollectibleDef> = {
  'oslo-coin': {
    id: 'oslo-coin',
    radius: 0.9,
    y: 1.05,
    value: 25,
    color: 0xffc233,
    rim: 0xe08e00,
  },
};

// ---------------------------------------------------------------------------
// Characters.
// ---------------------------------------------------------------------------
export interface CharacterDef {
  id: string;
  name: string;
  colors: {
    jacket: number;
    jacketZip: number;
    beanie: number;
    beanieBand: number;
    skin: number;
    trousers: number;
    boots: number;
    backpack: number;
    strap: number;
    mitt: number;
  };
  /** Future hook: path to a .glb under /assets/characters. Procedural rig is the fallback. */
  glbPath: string | null;
}

export const CHARACTERS: Record<string, CharacterDef> = {
  courier: {
    id: 'courier',
    name: 'Budet',
    colors: {
      jacket: 0x1f7a6d, // teal
      jacketZip: 0x155a50,
      beanie: 0xf4802e, // orange
      beanieBand: 0xd96a1e,
      skin: 0xe8b48f,
      trousers: 0x35383f,
      boots: 0x23252b,
      backpack: 0xe76f51,
      strap: 0x2c2f36,
      mitt: 0x2c2f36,
    },
    glbPath: null,
  },
};

// ---------------------------------------------------------------------------
// Environment themes.
// ---------------------------------------------------------------------------
export interface ThemeDef {
  id: string;
  skyTop: number;
  skyHorizon: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  sun: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  asphalt: number;
  laneLine: number;
  cobble: number;
  cobbleAlt: number;
  sidewalk: number;
  curb: number;
  bikeLane: number;
  rail: number;
  buildingPalette: number[];
  window: number;
  windowLit: number;
  roof: number;
  trim: number;
  grass: number;
  birchTrunk: number;
  birchDark: number;
  leaf: number;
  leafAlt: number;
  water: number;
  hillNear: number;
  hillFar: number;
  silhouette: number;
  tramBlue: number;
  tramTrim: number;
}

export const THEMES: Record<string, ThemeDef> = {
  'oslo-summer': {
    id: 'oslo-summer',
    skyTop: 0x6ea7dd,
    skyHorizon: 0xf2e2c4,
    fog: 0xdde6ee,
    fogNear: 42,
    fogFar: 150,
    sun: 0xffdca8,
    sunIntensity: 1.35,
    hemiSky: 0xbdd7f5,
    hemiGround: 0x8a7f6d,
    hemiIntensity: 0.75,
    asphalt: 0x4b5058,
    laneLine: 0xcfd4d8,
    cobble: 0x7d7469,
    cobbleAlt: 0x6e665c,
    sidewalk: 0x9b9ba1,
    curb: 0x7e7e84,
    bikeLane: 0x9a5a48,
    rail: 0x88929c,
    buildingPalette: [0xa34a3c, 0xc9803f, 0x7e9b7a, 0x5b7ea3, 0xd9c9a8, 0xb45a4b, 0x8f6a4f],
    window: 0x223247,
    windowLit: 0xffd98c,
    roof: 0x5d4a44,
    trim: 0xe8e2d6,
    grass: 0x7fae62,
    birchTrunk: 0xe8e4da,
    birchDark: 0x3a3a38,
    leaf: 0x9ec978,
    leafAlt: 0x86b563,
    water: 0x5e8fb8,
    hillNear: 0x5a7d8c,
    hillFar: 0x76919e,
    silhouette: 0x4a6474,
    tramBlue: 0x2b6fb7,
    tramTrim: 0xeef2f5,
  },
};

// ---------------------------------------------------------------------------
// Audio definitions (all synthesized at runtime — no audio files).
// ---------------------------------------------------------------------------
export const AUDIO = {
  masterVolume: 0.5,
  ambienceVolume: 0.16,
} as const;

// ---------------------------------------------------------------------------
// Scoring.
// ---------------------------------------------------------------------------
export const SCORING = {
  pointsPerMeter: 1,
  tokenBonus: 25,
} as const;

// ---------------------------------------------------------------------------
// Active content selection.
// ---------------------------------------------------------------------------
export const CONTENT = {
  activeCharacter: 'courier',
  activeTheme: 'oslo-summer',
  activeCollectible: 'oslo-coin',
} as const;

export function activeCharacter(): CharacterDef {
  return CHARACTERS[CONTENT.activeCharacter];
}
export function activeTheme(): ThemeDef {
  return THEMES[CONTENT.activeTheme];
}
export function activeCollectible(): CollectibleDef {
  return COLLECTIBLES[CONTENT.activeCollectible];
}
