import * as THREE from 'three';
import type { ThemeDef } from '../config/content';
import type { RNG } from '../core/rng';
import { ATLAS_STREETS, GeoBuilder, atlasPlane } from './materials';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Environment chunk factory. Each chunk is 36 m of street baked into ONE
 * vertex-colored geometry (single draw call) plus an optional textured sign
 * quad set. Local z runs from 0 (near edge) to -CHUNK_LEN (far edge).
 */
export const CHUNK_LEN = 36;

export const CHUNK_VARIANTS = ['brick', 'colorful', 'waterfront', 'park', 'roadworks'] as const;
export type ChunkVariant = (typeof CHUNK_VARIANTS)[number];

export interface ChunkGeometry {
  base: THREE.BufferGeometry;
  signs: THREE.BufferGeometry | null;
  variant: ChunkVariant;
}

const ROAD_HALF = 4.25;
const SIDEWALK_OUT = 8.9;

export function createEnvironmentChunk(theme: ThemeDef, variant: ChunkVariant, rng: RNG): ChunkGeometry {
  const b = new GeoBuilder();
  const signs: THREE.BufferGeometry[] = [];
  const L = CHUNK_LEN;
  const zc = -L / 2;

  // ---- street base (all variants) ----------------------------------------
  b.box(theme.asphalt, ROAD_HALF * 2, 0.04, L, 0, -0.02, zc);

  // Cobblestone strip in the middle lane (tram street feel).
  for (let z = 0.4; z < L; z += 0.85) {
    const c = rng.chance(0.5) ? theme.cobble : theme.cobbleAlt;
    b.box(c, 2.05, 0.016, 0.78, rng.range(-0.06, 0.06), 0.002, -z);
  }

  // Tram rails: a pair per lane, continuous across chunk seams.
  for (const laneCx of [-2.3, 0, 2.3]) {
    for (const off of [-0.72, 0.72]) {
      b.box(theme.rail, 0.09, 0.024, L, laneCx + off, 0.008, zc);
    }
  }

  // Dashed lane dividers.
  for (const x of [-1.15, 1.15]) {
    for (let z = 1; z < L; z += 3) {
      b.box(theme.laneLine, 0.09, 0.012, 1.3, x, 0.012, -z);
    }
  }

  // Bike lane (right edge, Oslo red-brown) with edge line.
  b.box(theme.bikeLane, 1.0, 0.05, L, 4.8, -0.005, zc);
  b.box(theme.laneLine, 0.07, 0.012, L, 4.32, 0.022, zc);

  // Curbs + sidewalks.
  const water = variant === 'waterfront';
  b.box(theme.curb, 0.18, 0.16, L, -4.36, 0.08, zc);
  b.box(theme.sidewalk, SIDEWALK_OUT - 4.45, 0.12, L, -(4.45 + SIDEWALK_OUT) / 2, 0.06, zc);
  b.box(theme.curb, 0.18, 0.16, L, 5.36, 0.08, zc);
  if (water) {
    // Harbor promenade: lighter granite, then the fjord.
    b.box(0xa8a49c, 9.6 - 5.45, 0.12, L, (5.45 + 9.6) / 2, 0.06, zc);
    b.box(0x8e8a82, 0.5, 0.55, L, 9.55, 0.27, zc); // low granite wall
    for (let z = 3; z < L; z += 7) {
      b.cyl(0x3c4046, 0.14, 0.55, 9.2, 0.55, -z); // bollards
    }
  } else {
    b.box(theme.sidewalk, SIDEWALK_OUT - 5.45, 0.12, L, (5.45 + SIDEWALK_OUT) / 2, 0.06, zc);
  }

  // Ground fill beyond sidewalks so nothing shows through under buildings.
  b.box(0x565a60, 14, 0.1, L, -(SIDEWALK_OUT + 7), -0.02, zc);
  if (!water) b.box(0x565a60, 14, 0.1, L, SIDEWALK_OUT + 7, -0.02, zc);

  // Tram catenary wires overhead.
  for (const x of [-1.6, 1.6]) {
    b.box(0x2c2e30, 0.025, 0.025, L, x, 5.6, zc);
  }

  // Occasional crosswalk at the chunk start.
  if ((variant === 'brick' || variant === 'colorful') && rng.chance(0.4)) {
    for (let i = 0; i < 6; i++) {
      b.box(0xdfe3e6, 0.75, 0.014, 2.2, -3.2 + i * 1.3, 0.012, -2.2);
    }
  }

  // ---- buildings ----------------------------------------------------------
  const leftStyle = variant === 'park' ? 'none' : variant === 'colorful' ? 'colorful' : 'brick';
  const rightStyle = water ? 'none' : variant === 'colorful' ? 'colorful' : 'brick';
  if (leftStyle !== 'none') buildFacades(b, signs, theme, rng, -1, leftStyle === 'colorful');
  if (rightStyle !== 'none') buildFacades(b, signs, theme, rng, 1, rightStyle === 'colorful');

  // ---- street furniture ---------------------------------------------------
  for (let z = 5; z < L; z += 12) {
    const side = Math.floor(z / 12) % 2 === 0 ? 1 : -1;
    streetlight(b, side * 5.9, -z, side);
  }
  const furnitureSide = water ? -1 : rng.chance(0.5) ? 1 : -1;
  if (rng.chance(0.8)) bench(b, furnitureSide * 6.9, -rng.range(6, 14), furnitureSide);
  if (rng.chance(0.6)) planter(b, theme, -6.6, -rng.range(18, 28));
  if (rng.chance(0.5)) bikeRackDecor(b, 6.8, -rng.range(20, 32));

  // Birch trees on the sidewalks.
  const treeCount = variant === 'park' ? 0 : rng.int(2, 4);
  for (let i = 0; i < treeCount; i++) {
    const side = rng.chance(0.5) ? 1 : -1;
    if (water && side === 1) continue;
    birch(b, theme, rng, side * rng.range(6.3, 7.8), -rng.range(3, L - 3));
  }

  // ---- variant extras -----------------------------------------------------
  if (variant === 'park') buildPark(b, theme, rng);
  if (water) buildWaterfront(b, rng);
  if (variant === 'roadworks') buildRoadworksDecor(b, rng);

  const signGeo =
    signs.length > 0 ? (mergeGeometries(signs, false) ?? null) : null;
  if (signGeo) for (const s of signs) s.dispose();

  return { base: b.merge(), signs: signGeo, variant };
}

// ---------------------------------------------------------------------------

function buildFacades(
  b: GeoBuilder,
  signs: THREE.BufferGeometry[],
  theme: ThemeDef,
  rng: RNG,
  side: 1 | -1,
  colorful: boolean
): void {
  const front = SIDEWALK_OUT + 0.1;
  let z = -1;
  let signPlaced = false;
  while (z > -CHUNK_LEN + 4) {
    const w = rng.range(8, 13);
    const floors = colorful ? rng.int(2, 3) : rng.int(3, 5);
    const h = floors * 3 + 1.2;
    const color = rng.pick(theme.buildingPalette);
    const cx = side * (front + 3.5);
    const cz = z - w / 2;
    b.box(color, 7, h, w, cx, h / 2, cz);

    // Windows: small planes just in front of the facade.
    const faceX = side * (front + 0.02);
    const ry = side === 1 ? -Math.PI / 2 : Math.PI / 2;
    for (let f = 0; f < floors; f++) {
      const wy = 2.2 + f * 3;
      for (let wz = z - 1.4; wz > z - w + 1.2; wz -= 2.2) {
        const lit = rng.chance(0.12);
        b.plane(lit ? theme.windowLit : theme.window, 1.05, 1.5, faceX, wy, wz - 0.5, { ry });
        // Window trim.
        b.box(theme.trim, 0.04, 0.08, 1.25, faceX, wy - 0.83, wz - 0.5);
      }
    }

    // Ground floor: shop band + door.
    b.plane(0x2e3d4d, 1.7, 2.0, faceX, 1.3, z - w / 2, { ry });
    b.plane(0x4c3a2c, 1.0, 2.1, faceX, 1.16, z - w + 1.6, { ry });

    // Roof: gable or flat with trim.
    if (rng.chance(0.55)) {
      b.prism(theme.roof, 7.2, 2.2, w, cx, h + 1.05, cz);
    } else {
      b.box(theme.trim, 7.3, 0.35, w + 0.2, cx, h + 0.14, cz);
    }

    // Occasional Norwegian flag on a pole angled from the facade.
    if (rng.chance(0.3)) {
      const fy = h - 1.4;
      const fx = side * (front - 0.3);
      b.cyl(0xd8d2c4, 0.03, 1.6, fx, fy, cz, { rz: side * 0.6 }, 5);
      const flagX = side * (front - 1.0);
      flag(b, flagX, fy + 0.62, cz);
    }

    // One street-name plate per chunk side, on the first facade.
    if (!signPlaced) {
      signPlaced = true;
      const name = ATLAS_STREETS[rng.int(0, ATLAS_STREETS.length - 1)];
      const plate = atlasPlane(name, 0.42);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(side * (front + 0.01), 3.4, z - 2),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
        new THREE.Vector3(1, 1, 1)
      );
      plate.applyMatrix4(m);
      signs.push(plate);
    }

    z -= w + rng.range(0.2, 1.6);
  }
}

function flag(b: GeoBuilder, x: number, y: number, z: number): void {
  // Norwegian flag: red field, white cross, blue inner cross.
  b.box(0xba0c2f, 0.02, 0.4, 0.55, x, y, z);
  b.box(0xffffff, 0.024, 0.4, 0.11, x, y, z - 0.06);
  b.box(0xffffff, 0.024, 0.1, 0.55, x, y + 0.02, z);
  b.box(0x00205b, 0.028, 0.4, 0.055, x, y, z - 0.06);
  b.box(0x00205b, 0.028, 0.05, 0.55, x, y + 0.02, z);
}

function streetlight(b: GeoBuilder, x: number, z: number, side: number): void {
  const green = 0x2f4f43;
  b.cyl(green, 0.07, 5.2, x, 2.6, z);
  b.box(green, 1.6, 0.09, 0.09, x - side * 0.75, 5.2, z);
  b.box(0xffe9b8, 0.34, 0.14, 0.22, x - side * 1.45, 5.12, z);
}

function bench(b: GeoBuilder, x: number, z: number, side: number): void {
  const wood = 0x8a6b4a;
  const iron = 0x33363b;
  b.box(iron, 0.06, 0.42, 0.5, x, 0.33, z - 0.7);
  b.box(iron, 0.06, 0.42, 0.5, x, 0.33, z + 0.7);
  b.box(wood, 0.55, 0.07, 1.8, x, 0.56, z);
  b.box(wood, 0.08, 0.5, 1.8, x + side * 0.28, 0.85, z, { rx: 0 });
}

function planter(b: GeoBuilder, theme: ThemeDef, x: number, z: number): void {
  b.box(0x9aa0a6, 0.9, 0.5, 0.9, x, 0.37, z);
  b.ico(theme.leafAlt, 0.42, x, 0.85, z, 0.8);
}

function bikeRackDecor(b: GeoBuilder, x: number, z: number): void {
  const steel = 0x9aa2ab;
  for (let i = 0; i < 3; i++) {
    const zz = z - i * 0.7;
    b.cyl(steel, 0.035, 0.75, x - 0.35, 0.49, zz, {}, 5);
    b.cyl(steel, 0.035, 0.75, x + 0.35, 0.49, zz, {}, 5);
    b.box(steel, 0.76, 0.07, 0.07, x, 0.86, zz);
  }
}

function birch(b: GeoBuilder, theme: ThemeDef, rng: RNG, x: number, z: number): void {
  const h = rng.range(2.4, 3.2);
  b.cyl(theme.birchTrunk, 0.09, h, x, h / 2 + 0.1, z, {}, 5);
  for (let i = 0; i < 3; i++) {
    b.cyl(theme.birchDark, 0.095, 0.08, x, 0.5 + i * (h / 3.4) + rng.range(-0.1, 0.1), z, {}, 5);
  }
  const leaf = rng.chance(0.5) ? theme.leaf : theme.leafAlt;
  b.ico(leaf, rng.range(0.75, 1.0), x, h + 0.55, z, 1.15, { ry: rng.range(0, 3) });
  b.ico(theme.leafAlt, 0.5, x + rng.range(-0.4, 0.4), h + 0.1, z + rng.range(-0.3, 0.3), 1);
}

function buildPark(b: GeoBuilder, theme: ThemeDef, rng: RNG): void {
  // Left side becomes a small park strip: grass, trees, benches.
  b.box(theme.grass, 3.4, 0.1, CHUNK_LEN, -7.1, 0.1, -CHUNK_LEN / 2);
  for (let i = 0; i < 7; i++) {
    birch(b, theme, rng, -rng.range(5.9, 8.2), -rng.range(2, CHUNK_LEN - 2));
  }
  bench(b, -6.6, -rng.range(8, 14), -1);
  bench(b, -6.6, -rng.range(20, 30), -1);
  // Low hedge along the back.
  for (let z = 2; z < CHUNK_LEN; z += 1.6) {
    b.ico(theme.leafAlt, 0.55, -8.6, 0.5, -z, 0.75);
  }
}

function buildWaterfront(b: GeoBuilder, rng: RNG): void {
  // A moored sailboat and a distant harbor crane.
  const bz = -rng.range(10, 24);
  b.box(0xf2f0ea, 1.1, 0.55, 3.4, 13, -0.15, bz);
  b.box(0x7c5b40, 0.9, 0.18, 2.6, 13, 0.14, bz);
  b.cyl(0xd8d2c4, 0.05, 4.4, 13, 2.2, bz - 0.3, {}, 5);
  b.shape(
    [
      [0, 0],
      [0, 3.4],
      [1.5, 0.4],
    ],
    0xe8e4dc,
    13.06,
    0.9,
    bz - 0.34,
    { ry: -Math.PI / 2 }
  );
  // Harbor crane far to the right.
  const cz = -rng.range(6, 28);
  b.box(0x9a6a3f, 1.1, 9, 1.1, 26, 4.5, cz);
  b.box(0x9a6a3f, 0.8, 0.8, 9, 26, 9.2, cz - 3.5);
  b.box(0x6b4a2c, 0.5, 2.2, 0.5, 26, 8, cz - 7.4);
}

function buildRoadworksDecor(b: GeoBuilder, rng: RNG): void {
  // Fencing along the right sidewalk + a parked mini-excavator. Decorative
  // only — clearly on the sidewalk, never in a lane.
  for (let z = 4; z < CHUNK_LEN - 6; z += 2.4) {
    b.cyl(0xb9bec4, 0.05, 1.1, 6.2, 0.67, -z, {}, 5);
    b.box(z % 4.8 < 2.4 ? 0xe86a10 : 0xf4f4f2, 0.06, 0.75, 2.3, 6.2, 0.85, -z - 1.15);
  }
  const mz = -rng.range(10, 24);
  b.box(0x2e3134, 1.5, 0.5, 2.3, 7.4, 0.3, mz);
  b.box(0xe86a10, 1.3, 1.1, 1.5, 7.4, 1.1, mz + 0.2);
  b.box(0x1d1f21, 0.9, 0.8, 0.9, 7.4, 1.2, mz - 0.6);
  b.box(0xe86a10, 0.25, 0.25, 1.8, 7.0, 1.7, mz + 1.4, { rx: -0.5 });
  b.box(0x6f6f6f, 0.5, 0.4, 0.5, 7.0, 1.05, mz + 2.3);
  // Gravel patch.
  for (let i = 0; i < 8; i++) {
    b.ico(0x8f8a82, rng.range(0.12, 0.22), rng.range(6.2, 8.2), 0.12, mz - rng.range(1, 3));
  }
}
