import * as THREE from 'three';
import { CHARACTERS, type CharacterDef } from '../config/content';
import { blobShadowTexture } from '../world/materials';

/**
 * Procedural low-poly courier with a jointed rig built from boxes.
 * All animation (run cycle, jump tuck, slide, idle, crash) is computed —
 * no keyframe data. A future .glb character can replace this by setting
 * CHARACTERS[id].glbPath and swapping the factory below.
 */

export interface CharAnimState {
  mode: 'idle' | 'run' | 'crash';
  runPhase: number;
  speedNorm: number;
  y: number;
  grounded: boolean;
  airProgress: number;
  sliding: boolean;
  slideProgress: number;
  lean: number;
  squash: number;
  elapsed: number;
}

function limb(
  parent: THREE.Object3D,
  x: number,
  y: number,
  upper: THREE.Mesh,
  jointY: number,
  lower: THREE.Mesh[]
): { top: THREE.Group; joint: THREE.Group } {
  const top = new THREE.Group();
  top.position.set(x, y, 0);
  top.add(upper);
  const joint = new THREE.Group();
  joint.position.set(0, jointY, 0);
  for (const m of lower) joint.add(m);
  top.add(joint);
  parent.add(top);
  return { top, joint };
}

function boxMesh(mat: THREE.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

export class CourierCharacter {
  root = new THREE.Group();
  private body = new THREE.Group();
  private rig = new THREE.Group();
  private hips = new THREE.Group();
  private spine = new THREE.Group();
  private neck = new THREE.Group();
  private legL: { top: THREE.Group; joint: THREE.Group };
  private legR: { top: THREE.Group; joint: THREE.Group };
  private armL: { top: THREE.Group; joint: THREE.Group };
  private armR: { top: THREE.Group; joint: THREE.Group };
  private shadow: THREE.Mesh;
  private shadowMat: THREE.MeshBasicMaterial;
  private airW = 0;
  private slideW = 0;
  private crashT = 0;
  private materials: THREE.MeshLambertMaterial[] = [];

  constructor(def: CharacterDef) {
    const c = def.colors;
    const mat = (color: number): THREE.MeshLambertMaterial => {
      const m = new THREE.MeshLambertMaterial({ color });
      this.materials.push(m);
      return m;
    };
    const jacket = mat(c.jacket);
    const zip = mat(c.jacketZip);
    const beanie = mat(c.beanie);
    const band = mat(c.beanieBand);
    const skin = mat(c.skin);
    const trousers = mat(c.trousers);
    const boots = mat(c.boots);
    const backpack = mat(c.backpack);
    const strap = mat(c.strap);
    const mitt = mat(c.mitt);

    // Legs.
    this.hips.position.y = 0.92;
    const mkLeg = (x: number): { top: THREE.Group; joint: THREE.Group } =>
      limb(this.hips, x, 0, boxMesh(trousers, 0.17, 0.44, 0.2, 0, -0.2, 0), -0.42, [
        boxMesh(trousers, 0.15, 0.4, 0.17, 0, -0.19, 0),
        boxMesh(boots, 0.17, 0.12, 0.3, 0, -0.4, -0.05),
      ]);
    this.legL = mkLeg(-0.12);
    this.legR = mkLeg(0.12);

    // Spine, torso, backpack.
    this.spine.position.y = 0.98;
    const torso = boxMesh(jacket, 0.46, 0.58, 0.27, 0, 0.28, 0);
    const zipStripe = boxMesh(zip, 0.07, 0.56, 0.02, 0, 0.28, -0.14);
    const hem = boxMesh(zip, 0.48, 0.08, 0.29, 0, 0.02, 0);
    const pack = boxMesh(backpack, 0.36, 0.42, 0.17, 0, 0.3, 0.22);
    const packLid = boxMesh(strap, 0.36, 0.1, 0.18, 0, 0.52, 0.21);
    const strapL = boxMesh(strap, 0.06, 0.5, 0.02, -0.13, 0.3, -0.145);
    const strapR = boxMesh(strap, 0.06, 0.5, 0.02, 0.13, 0.3, -0.145);
    this.spine.add(torso, zipStripe, hem, pack, packLid, strapL, strapR);

    // Head + beanie (faces -z, the running direction).
    this.neck.position.y = 0.62;
    const head = boxMesh(skin, 0.3, 0.3, 0.28, 0, 0.17, 0);
    const cap = boxMesh(beanie, 0.32, 0.16, 0.3, 0, 0.34, 0.01);
    const capTop = boxMesh(beanie, 0.24, 0.08, 0.22, 0, 0.43, 0.02);
    const capBand = boxMesh(band, 0.33, 0.07, 0.31, 0, 0.26, 0.01);
    this.neck.add(head, cap, capTop, capBand);
    this.spine.add(this.neck);

    // Arms.
    const mkArm = (x: number): { top: THREE.Group; joint: THREE.Group } =>
      limb(this.spine, x, 0.5, boxMesh(jacket, 0.13, 0.34, 0.15, 0, -0.14, 0), -0.3, [
        boxMesh(jacket, 0.11, 0.28, 0.13, 0, -0.12, 0),
        boxMesh(mitt, 0.12, 0.1, 0.14, 0, -0.29, 0),
      ]);
    this.armL = mkArm(-0.3);
    this.armR = mkArm(0.3);

    this.rig.add(this.hips, this.spine);
    this.body.add(this.rig);
    this.root.add(this.body);

    // Blob shadow (stays on the ground when jumping).
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: blobShadowTexture(),
      transparent: true,
      depthWrite: false,
    });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.4), this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.05;
    this.shadow.renderOrder = 1;
    this.root.add(this.shadow);
  }

  update(dt: number, s: CharAnimState): void {
    const k = 1 - Math.exp(-12 * dt);
    this.airW += (((!s.grounded && s.mode === 'run') ? 1 : 0) - this.airW) * k;
    this.slideW += ((s.sliding ? 1 : 0) - this.slideW) * k;
    const runW = Math.max(0, 1 - this.airW - this.slideW) * (s.mode === 'run' ? 1 : 0);
    const idleW = s.mode === 'idle' ? 1 : 0;

    if (s.mode === 'crash') {
      this.crashT = Math.min(1, this.crashT + dt * 3);
    } else {
      this.crashT = Math.max(0, this.crashT - dt * 6);
    }
    const crashW = this.crashT;

    const p = s.runPhase;
    const sw = 0.55 + 0.4 * s.speedNorm;

    // --- compose joint angles from weighted poses ---------------------------
    const legLx =
      runW * -Math.sin(p) * sw +
      this.airW * (-0.9 + 0.5 * s.airProgress) +
      this.slideW * -1.15 +
      idleW * 0 +
      crashW * -0.7;
    const legRx =
      runW * Math.sin(p) * sw +
      this.airW * (0.55 - 0.45 * s.airProgress) +
      this.slideW * -1.3 +
      idleW * 0 +
      crashW * 0.9;
    const kneeLx =
      runW * Math.max(0, Math.sin(p - 1.2)) * 1.25 +
      this.airW * 1.15 +
      this.slideW * 0.4 +
      crashW * 0.8;
    const kneeRx =
      runW * Math.max(0, Math.sin(p + Math.PI - 1.2)) * 1.25 +
      this.airW * 1.35 +
      this.slideW * 0.25 +
      crashW * 0.4;

    this.legL.top.rotation.x = legLx;
    this.legR.top.rotation.x = legRx;
    this.legL.joint.rotation.x = kneeLx;
    this.legR.joint.rotation.x = kneeRx;

    const armSw = 0.5 + 0.35 * s.speedNorm;
    const idleArm = Math.sin(s.elapsed * 1.7) * 0.06;
    this.armL.top.rotation.x =
      runW * Math.sin(p) * armSw + this.airW * -1.1 + this.slideW * 0.85 + idleW * idleArm + crashW * -1.6;
    this.armR.top.rotation.x =
      runW * -Math.sin(p) * armSw + this.airW * -1.3 + this.slideW * 0.85 + idleW * -idleArm + crashW * -1.2;
    this.armL.top.rotation.z = 0.1 + this.airW * 0.5 + crashW * 1.2;
    this.armR.top.rotation.z = -0.1 - this.airW * 0.5 - crashW * 1.2;
    this.armL.joint.rotation.x = runW * -0.9 + this.airW * -0.3 + this.slideW * -0.2 + idleW * -0.15 + crashW * -0.5;
    this.armR.joint.rotation.x = runW * -0.9 + this.airW * -0.3 + this.slideW * -0.2 + idleW * -0.15 + crashW * -0.5;

    // Torso: forward run lean, backward slide lean, subtle idle breathing.
    this.spine.rotation.x =
      runW * (-0.14 - 0.08 * s.speedNorm) + this.airW * -0.2 + this.slideW * 0.85 + crashW * -0.55;
    this.spine.rotation.y = runW * Math.sin(p) * 0.08;
    this.neck.rotation.x = runW * 0.12 + this.slideW * -0.75 + this.airW * 0.1 + crashW * 0.4;
    this.neck.rotation.y = idleW * Math.sin(s.elapsed * 0.5) * 0.35;

    // Vertical: jump height + run bob + slide crouch.
    const bob = runW * Math.abs(Math.sin(p)) * 0.06 * (0.4 + 0.6 * s.speedNorm);
    const breathe = idleW * Math.sin(s.elapsed * 1.7) * 0.012;
    this.body.position.y = s.y + bob + breathe - this.slideW * 0.46 - crashW * 0.2;

    // Lane-change lean/bank.
    this.body.rotation.z = -s.lean * 0.34;
    this.body.rotation.y = -s.lean * 0.18 + crashW * 0.6;
    this.body.rotation.x = crashW * 0.5;

    // Landing squash.
    const sq = s.squash * 0.22;
    this.rig.scale.set(1 + sq * 0.6, 1 - sq, 1 + sq * 0.6);

    // Shadow: fades and shrinks with height.
    const h = Math.min(1, s.y / 1.4);
    this.shadow.scale.setScalar(1 - h * 0.35);
    this.shadowMat.opacity = 1 - h * 0.55;
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
    this.shadowMat.dispose();
    (this.shadow.geometry as THREE.BufferGeometry).dispose();
  }
}

/** Factory: game code asks for a character by ID, never constructs rigs directly. */
export function createCharacter(characterId: string): CourierCharacter {
  const def = CHARACTERS[characterId] ?? CHARACTERS.courier;
  // Future: if (def.glbPath) load GLTF and wrap it in the same interface.
  return new CourierCharacter(def);
}
