import * as THREE from 'three';
import type { ThemeDef } from '../config/content';
import { RNG } from '../core/rng';
import { CHUNK_LEN, CHUNK_VARIANTS, createEnvironmentChunk, type ChunkGeometry, type ChunkVariant } from './chunks';
import { signAtlasMaterial, vertexColorMaterial } from './materials';

const AHEAD = 175;
const BEHIND = 45;

interface Slot {
  group: THREE.Group;
  baseMesh: THREE.Mesh;
  signMesh: THREE.Mesh;
  d0: number;
  geoIndex: number;
}

/**
 * Streams prebuilt environment chunks past the camera. Geometries are built
 * once (two randomized instances per variant); slots just swap geometry
 * pointers when recycled — zero allocation while playing.
 */
export class Environment {
  private geos: ChunkGeometry[] = [];
  private slots: Slot[] = [];
  private rng: RNG;
  private sinceWaterfront = 0;
  private lastGeoIndex = -1;
  private emptyGeo = new THREE.BufferGeometry();

  constructor(private scene: THREE.Scene, theme: ThemeDef, seed: number) {
    this.rng = new RNG(seed);
    for (const variant of CHUNK_VARIANTS) {
      for (let i = 0; i < 2; i++) {
        this.geos.push(createEnvironmentChunk(theme, variant, this.rng.fork()));
      }
    }
    const slotCount = Math.ceil((AHEAD + BEHIND) / CHUNK_LEN) + 1;
    for (let i = 0; i < slotCount; i++) {
      const baseMesh = new THREE.Mesh(this.emptyGeo, vertexColorMaterial);
      const signMesh = new THREE.Mesh(this.emptyGeo, signAtlasMaterial());
      const group = new THREE.Group();
      group.add(baseMesh, signMesh);
      scene.add(group);
      this.slots.push({ group, baseMesh, signMesh, d0: 0, geoIndex: -1 });
    }
    this.reset(0);
  }

  private pickGeoIndex(): number {
    // Waterfront cadence every 4–6 chunks; otherwise weighted variety.
    let variant: ChunkVariant;
    if (this.sinceWaterfront >= this.rng.int(4, 6)) {
      variant = 'waterfront';
      this.sinceWaterfront = 0;
    } else {
      variant = this.rng.weighted([
        ['brick', 3],
        ['colorful', 3],
        ['park', 1.5],
        ['roadworks', 1.5],
      ] as const);
      this.sinceWaterfront++;
    }
    const candidates = this.geos
      .map((g, i) => ({ g, i }))
      .filter(({ g, i }) => g.variant === variant && i !== this.lastGeoIndex);
    const pick = candidates[this.rng.int(0, candidates.length - 1)];
    this.lastGeoIndex = pick.i;
    return pick.i;
  }

  private assign(slot: Slot, d0: number): void {
    slot.d0 = d0;
    slot.geoIndex = this.pickGeoIndex();
    const geo = this.geos[slot.geoIndex];
    slot.baseMesh.geometry = geo.base;
    slot.signMesh.geometry = geo.signs ?? this.emptyGeo;
  }

  reset(traveled: number): void {
    const start = Math.floor((traveled - BEHIND) / CHUNK_LEN) * CHUNK_LEN;
    this.sinceWaterfront = 1; // never open on a waterfront chunk
    this.slots.forEach((slot, i) => {
      this.assign(slot, start + i * CHUNK_LEN);
    });
    this.update(traveled);
  }

  update(traveled: number): void {
    let maxD0 = -Infinity;
    for (const s of this.slots) maxD0 = Math.max(maxD0, s.d0);
    for (const s of this.slots) {
      // Recycle chunks that fell behind the camera.
      while (s.d0 + CHUNK_LEN < traveled - BEHIND) {
        const newD0 = maxD0 + CHUNK_LEN;
        this.assign(s, newD0);
        maxD0 = newD0;
      }
      s.group.position.z = traveled - s.d0;
    }
  }

  dispose(): void {
    for (const s of this.slots) this.scene.remove(s.group);
    for (const g of this.geos) {
      g.base.dispose();
      g.signs?.dispose();
    }
    this.emptyGeo.dispose();
  }
}
