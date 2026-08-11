import * as THREE from 'three';
import { activeTheme } from '../config/content';
import type { ActiveObstacle } from './spawner';
import { GeoBuilder, atlasPlane, blobShadowTexture, signAtlasMaterial, vertexColorMaterial, ATLAS_DESTS } from './materials';

/**
 * Obstacle factory + pool. createObstacle(id) builds a fully procedural,
 * merged low-poly prop (1–2 draw calls). The manager pools instances and
 * positions them from the spawner's logical entities every frame.
 */

let shadowMat: THREE.MeshBasicMaterial | null = null;
function shadowMaterial(): THREE.MeshBasicMaterial {
  if (!shadowMat) {
    shadowMat = new THREE.MeshBasicMaterial({
      map: blobShadowTexture(),
      transparent: true,
      depthWrite: false,
    });
  }
  return shadowMat;
}

function addShadow(group: THREE.Group, w: number, len: number): void {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), shadowMaterial());
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.045;
  m.renderOrder = 1;
  group.add(m);
}

/** Build one obstacle prop. `span` = number of lanes the visual covers. */
export function createObstacle(id: string, span = 1, variant = 0): THREE.Group {
  const group = new THREE.Group();
  const theme = activeTheme();
  const b = new GeoBuilder();
  const v = variant;

  switch (id) {
    case 'tram': {
      const blue = theme.tramBlue;
      const trim = theme.tramTrim;
      const L = 12.4;
      // Body with tapered noses.
      b.box(0x2a3138, 1.7, 0.32, L - 0.6, 0, 0.36, 0); // undercarriage
      b.box(blue, 2.0, 1.5, L - 1.6, 0, 1.27, 0);
      b.box(blue, 1.9, 1.4, 1.1, 0, 1.22, (L - 1.6) / 2 + 0.4, { ry: 0 });
      b.box(blue, 1.9, 1.4, 1.1, 0, 1.22, -((L - 1.6) / 2 + 0.4));
      // Window band.
      b.box(0x1b2733, 2.04, 0.62, L - 2.2, 0, 2.28, 0);
      b.box(blue, 2.0, 0.5, L - 1.6, 0, 2.3, 0);
      for (let i = 0; i < 5; i++) {
        const z = -L / 2 + 1.8 + i * 2.2;
        b.box(0x18242f, 2.06, 0.75, 1.5, 0, 2.25, z);
      }
      // Doors.
      b.box(trim, 2.02, 1.35, 0.9, 0, 1.3, -1.8);
      b.box(trim, 2.02, 1.35, 0.9, 0, 1.3, 2.6);
      // Roof.
      b.box(trim, 1.85, 0.22, L - 1.8, 0, 2.95, 0);
      b.box(0x9aa2ab, 1.2, 0.18, 2.2, 0, 3.12, -1);
      // Pantograph.
      b.box(0x33363b, 0.06, 1.3, 0.06, -0.4, 3.7, 0.6, { rx: 0.5 });
      b.box(0x33363b, 0.06, 1.3, 0.06, 0.4, 3.7, 0.6, { rx: 0.5 });
      b.box(0x33363b, 1.3, 0.05, 0.3, 0, 4.28, 0.95);
      // Front (toward player, +z): windshield, lights, bumper.
      b.box(0x18242f, 1.6, 0.8, 0.08, 0, 2.2, L / 2 - 0.02, { rx: -0.12 });
      b.box(0xfff1c4, 0.3, 0.18, 0.08, -0.6, 1.0, L / 2 + 0.13);
      b.box(0xfff1c4, 0.3, 0.18, 0.08, 0.6, 1.0, L / 2 + 0.13);
      b.box(0xc8372d, 0.24, 0.12, 0.06, -0.6, 0.78, L / 2 + 0.13);
      b.box(0xc8372d, 0.24, 0.12, 0.06, 0.6, 0.78, L / 2 + 0.13);
      group.add(new THREE.Mesh(b.merge(), vertexColorMaterial));
      // Destination board.
      const dest = new THREE.Mesh(
        atlasPlane(ATLAS_DESTS[v % ATLAS_DESTS.length], 0.3),
        signAtlasMaterial()
      );
      dest.position.set(0, 2.85, L / 2 + 0.16);
      group.add(dest);
      addShadow(group, 3.0, L + 1.5);
      break;
    }

    case 'scooter': {
      // A fallen e-scooter across the lane.
      const mint = 0x63c7ae;
      const dark = 0x2a2d33;
      const yaw = ((v % 5) - 2) * 0.22;
      const g2 = new THREE.Group();
      const bb = new GeoBuilder();
      bb.box(dark, 1.05, 0.06, 0.17, 0, 0.14, 0); // deck lying flat-ish
      bb.box(mint, 0.95, 0.03, 0.15, 0, 0.18, 0);
      bb.cyl(dark, 0.12, 0.07, -0.55, 0.12, 0, { rx: Math.PI / 2 }); // wheel
      bb.cyl(dark, 0.12, 0.07, 0.55, 0.12, 0, { rx: Math.PI / 2 });
      // Stem lying on the ground, pointing sideways.
      bb.cyl(mint, 0.045, 1.0, 0.55, 0.1, -0.5, { rx: Math.PI / 2 }, 5);
      bb.box(dark, 0.5, 0.05, 0.07, 0.55, 0.12, -1.0);
      bb.box(dark, 0.08, 0.07, 0.12, 0.35, 0.14, -1.0);
      const mesh = new THREE.Mesh(bb.merge(), vertexColorMaterial);
      g2.add(mesh);
      g2.rotation.y = yaw + (v % 2 === 0 ? 0 : Math.PI);
      group.add(g2);
      addShadow(group, 1.9, 1.6);
      break;
    }

    case 'barrier': {
      // Roadwork barrier: A-frame legs + chevron plank + warning lamp.
      const orange = 0xe86a10;
      for (const zoff of [-0.14, 0.14]) {
        b.box(0x9aa2ab, 0.08, 0.95, 0.06, -0.8, 0.47, zoff, { rz: zoff * 1.4 });
        b.box(0x9aa2ab, 0.08, 0.95, 0.06, 0.8, 0.47, zoff, { rz: zoff * 1.4 });
      }
      b.box(orange, 1.9, 0.16, 0.1, 0, 0.32, 0);
      group.add(new THREE.Mesh(b.merge(), vertexColorMaterial));
      const plank = new THREE.Mesh(atlasPlane('chevron', 0.34), signAtlasMaterial());
      plank.position.set(0, 0.68, 0.07);
      plank.scale.x = 1.34; // widen chevron plank toward ~1.9 m
      group.add(plank);
      const back = plank.clone();
      back.rotation.y = Math.PI;
      back.position.z = -0.07;
      group.add(back);
      const lampGeo = new THREE.BoxGeometry(0.16, 0.16, 0.1);
      const lamp = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xff9c2e }));
      lamp.position.set(v % 2 === 0 ? -0.7 : 0.7, 0.92, 0);
      lamp.name = 'lamp';
      group.add(lamp);
      addShadow(group, 2.1, 1.1);
      break;
    }

    case 'overhead': {
      // Scaffold gantry with a low-clearance sign. Slide under it!
      const width = span * 2.3 + 0.7;
      const steel = 0x9aa2ab;
      for (const sx of [-1, 1]) {
        const x = sx * (width / 2);
        b.cyl(steel, 0.06, 3.3, x - 0.15, 1.65, 0.2, {}, 5);
        b.cyl(steel, 0.06, 3.3, x + 0.15, 1.65, -0.2, {}, 5);
        b.box(steel, 0.08, 0.08, 0.7, x, 1.1, 0);
        b.box(steel, 0.08, 0.08, 0.7, x, 2.6, 0);
        b.box(0xe86a10, 0.5, 0.16, 0.5, x, 0.08, 0);
      }
      b.box(steel, width, 0.14, 0.4, 0, 3.15, 0);
      b.box(0xf4b400, width, 0.5, 0.14, 0, 1.5, 0); // the low beam (hit zone)
      b.box(0x17181a, width, 0.08, 0.16, 0, 1.21, 0);
      group.add(new THREE.Mesh(b.merge(), vertexColorMaterial));
      const sign = new THREE.Mesh(atlasPlane('lavhoyde', 0.55), signAtlasMaterial());
      sign.position.set(0, 2.35, 0.1);
      group.add(sign);
      addShadow(group, width, 1.4);
      break;
    }

    case 'cones': {
      const arrangement = [
        [-0.5, 0.15],
        [0.1, -0.25],
        [0.55, 0.2],
      ];
      for (let i = 0; i < 3; i++) {
        const [cx, cz] = arrangement[(i + v) % 3];
        const x = cx + ((v >> i) % 2 === 0 ? 0.08 : -0.08);
        b.cyl(0xe86a10, 0.16, 0.06, x, 0.03, cz);
        b.cone(0xe86a10, 0.15, 0.5, x, 0.28, cz);
        b.cyl(0xf4f4f2, 0.1, 0.09, x, 0.27, cz);
      }
      group.add(new THREE.Mesh(b.merge(), vertexColorMaterial));
      addShadow(group, 1.7, 1.3);
      break;
    }

    case 'boxes': {
      // A courier's nightmare: someone else's delivery stack.
      const card = 0xb78a5a;
      const cardDark = 0xa07648;
      b.box(card, 0.62, 0.45, 0.62, -0.32, 0.225, 0, { ry: 0.1 * (v % 3) });
      b.box(cardDark, 0.55, 0.4, 0.55, 0.35, 0.2, 0.05, { ry: -0.2 });
      b.box(card, 0.5, 0.35, 0.5, 0, 0.62, 0, { ry: 0.35 + 0.1 * (v % 4) });
      b.box(0xd9c9a8, 0.52, 0.045, 0.12, 0, 0.8, 0, { ry: 0.35 });
      group.add(new THREE.Mesh(b.merge(), vertexColorMaterial));
      addShadow(group, 1.6, 1.3);
      break;
    }

    case 'bikerack': {
      const steel = 0x8b939c;
      for (let i = -1; i <= 1; i++) {
        const x = i * 0.6;
        b.cyl(steel, 0.04, 0.8, x - 0.22, 0.4, 0, {}, 5);
        b.cyl(steel, 0.04, 0.8, x + 0.22, 0.4, 0, {}, 5);
        b.box(steel, 0.5, 0.08, 0.08, x, 0.82, 0);
      }
      group.add(new THREE.Mesh(b.merge(), vertexColorMaterial));
      addShadow(group, 2.0, 1.0);
      break;
    }

    default: {
      // Unknown id — visible magenta box so content errors are obvious.
      b.box(0xff00ff, 1, 1, 1, 0, 0.5, 0);
      group.add(new THREE.Mesh(b.merge(), vertexColorMaterial));
    }
  }
  return group;
}

// ---------------------------------------------------------------------------

export class ObstacleManager {
  private pools = new Map<string, THREE.Group[]>();
  private live = new Map<number, { group: THREE.Group; obs: ActiveObstacle }>();
  private builtVariant = new Map<string, number>();

  constructor(private scene: THREE.Scene) {}

  private poolKey(obs: ActiveObstacle): string {
    return obs.defId === 'overhead' ? `overhead:${obs.lanes.length}` : obs.defId;
  }

  spawn(obs: ActiveObstacle): void {
    const key = this.poolKey(obs);
    let pool = this.pools.get(key);
    if (!pool) {
      pool = [];
      this.pools.set(key, pool);
    }
    let group = pool.pop();
    if (!group) {
      const variantCounter = (this.builtVariant.get(key) ?? 0) + 1;
      this.builtVariant.set(key, variantCounter);
      group = createObstacle(obs.defId, obs.lanes.length, obs.variant + variantCounter);
      group.userData.poolKey = key;
    }
    group.visible = true;
    this.scene.add(group);
    this.live.set(obs.uid, { group, obs });
  }

  despawn(uid: number): void {
    const entry = this.live.get(uid);
    if (!entry) return;
    this.live.delete(uid);
    entry.group.visible = false;
    this.scene.remove(entry.group);
    const key = entry.group.userData.poolKey as string;
    this.pools.get(key)?.push(entry.group);
  }

  update(traveled: number, elapsed: number): void {
    for (const { group, obs } of this.live.values()) {
      const centerD = obs.dCur + obs.len / 2;
      group.position.z = traveled - centerD;
      group.position.x = obs.cx;
      // Warning lamps blink in sync.
      const lamp = group.getObjectByName('lamp');
      if (lamp) {
        (lamp as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.color.setHex(
          Math.sin(elapsed * 6) > 0 ? 0xffb648 : 0xb35510
        );
      }
    }
  }

  clear(): void {
    for (const uid of [...this.live.keys()]) this.despawn(uid);
  }
}
