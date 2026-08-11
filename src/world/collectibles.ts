import * as THREE from 'three';
import { activeCollectible } from '../config/content';
import { laneX } from '../config/content';
import type { ActiveToken } from './spawner';

const CAPACITY = 96;

/**
 * Token renderer: two InstancedMeshes (disc + rim) shared by every active
 * token. Spin, bob and the pickup pop are driven by per-slot state.
 */
export class TokenManager {
  private disc: THREE.InstancedMesh;
  private rim: THREE.InstancedMesh;
  private slots: Array<{ token: ActiveToken | null; collectT: number }> = [];
  private byUid = new Map<number, number>();
  private dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene) {
    const def = activeCollectible();
    const discGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.07, 18);
    discGeo.rotateX(Math.PI / 2); // face the player
    const rimGeo = new THREE.TorusGeometry(0.31, 0.05, 8, 18);
    this.disc = new THREE.InstancedMesh(
      discGeo,
      new THREE.MeshLambertMaterial({ color: def.color, emissive: 0x4a3200 }),
      CAPACITY
    );
    this.rim = new THREE.InstancedMesh(
      rimGeo,
      new THREE.MeshLambertMaterial({ color: def.rim, emissive: 0x3a2600 }),
      CAPACITY
    );
    this.disc.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rim.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.disc.frustumCulled = false;
    this.rim.frustumCulled = false;
    for (let i = 0; i < CAPACITY; i++) this.slots.push({ token: null, collectT: 0 });
    this.hideAll();
    scene.add(this.disc, this.rim);
  }

  private hideAll(): void {
    this.dummy.position.set(0, -100, 0);
    this.dummy.scale.setScalar(0.0001);
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.updateMatrix();
    for (let i = 0; i < CAPACITY; i++) {
      this.disc.setMatrixAt(i, this.dummy.matrix);
      this.rim.setMatrixAt(i, this.dummy.matrix);
    }
    this.disc.instanceMatrix.needsUpdate = true;
    this.rim.instanceMatrix.needsUpdate = true;
  }

  spawn(token: ActiveToken): void {
    for (let i = 0; i < CAPACITY; i++) {
      if (!this.slots[i].token) {
        this.slots[i].token = token;
        this.slots[i].collectT = 0;
        this.byUid.set(token.uid, i);
        return;
      }
    }
    // Out of slots: token simply isn't rendered (never happens in practice).
  }

  /** Trigger the pickup pop animation. */
  collect(uid: number): void {
    const i = this.byUid.get(uid);
    if (i === undefined) return;
    this.slots[i].collectT = 0.0001;
  }

  despawn(uid: number): void {
    const i = this.byUid.get(uid);
    if (i === undefined) return;
    // Let a running pickup animation finish; otherwise free instantly.
    if (this.slots[i].collectT <= 0) this.free(i);
  }

  private free(i: number): void {
    const t = this.slots[i].token;
    if (t) this.byUid.delete(t.uid);
    this.slots[i].token = null;
    this.slots[i].collectT = 0;
    this.dummy.position.set(0, -100, 0);
    this.dummy.scale.setScalar(0.0001);
    this.dummy.updateMatrix();
    this.disc.setMatrixAt(i, this.dummy.matrix);
    this.rim.setMatrixAt(i, this.dummy.matrix);
  }

  update(traveled: number, elapsed: number, dt: number): void {
    for (let i = 0; i < CAPACITY; i++) {
      const slot = this.slots[i];
      const t = slot.token;
      if (!t) continue;
      const z = traveled - t.d;
      if (z > 25) {
        this.free(i);
        continue;
      }
      let scale = 1;
      let yLift = 0;
      if (slot.collectT > 0) {
        slot.collectT += dt;
        const p = slot.collectT / 0.22;
        if (p >= 1) {
          this.free(i);
          continue;
        }
        scale = 1 + p * 1.4;
        yLift = p * 0.7;
      }
      this.dummy.position.set(laneX(t.lane), t.y + 0.08 * Math.sin(elapsed * 3 + i), z);
      this.dummy.position.y += yLift;
      this.dummy.rotation.set(0, elapsed * 2.4 + i * 0.7, 0);
      this.dummy.scale.setScalar(scale * (slot.collectT > 0 ? 1 - slot.collectT / 0.24 : 1));
      this.dummy.updateMatrix();
      this.disc.setMatrixAt(i, this.dummy.matrix);
      this.rim.setMatrixAt(i, this.dummy.matrix);
    }
    this.disc.instanceMatrix.needsUpdate = true;
    this.rim.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    for (let i = 0; i < CAPACITY; i++) this.free(i);
    this.byUid.clear();
  }

  dispose(): void {
    this.clear();
    for (const mesh of [this.disc, this.rim]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }
}
