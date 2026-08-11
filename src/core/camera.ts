import * as THREE from 'three';

export interface CameraState {
  playerX: number;
  playerY: number;
  speedNorm: number;
  elapsed: number;
}

/**
 * Camera rig: chase camera with speed-based FOV, subtle bob, landing dip,
 * crash shake, and a menu orbit with a smooth transition into gameplay.
 */
export class CameraRig {
  camera: THREE.PerspectiveCamera;
  private mode: 'menu' | 'follow' = 'menu';
  private transition = 1; // 1 = fully in current mode
  private shake = 0;
  private dip = 0;
  private fov = 66;
  private smoothX = 0;
  private smoothY = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(66, aspect, 0.1, 400);
    this.snapMenu(0);
  }

  setMenu(): void {
    this.mode = 'menu';
    this.transition = 1;
  }

  startFollow(): void {
    if (this.mode === 'follow') return;
    this.mode = 'follow';
    this.transition = 0;
  }

  crashKick(): void {
    this.shake = 1;
  }

  onLand(): void {
    this.dip = Math.min(1, this.dip + 0.7);
  }

  private snapMenu(elapsed: number): void {
    const a = elapsed * 0.13;
    this.pos.set(Math.sin(a) * 2.7, 1.8, Math.cos(a) * 2.7 + 0.6);
    this.look.set(0, 1.15, 0);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  update(dt: number, s: CameraState): void {
    this.shake *= Math.exp(-4.2 * dt);
    this.dip *= Math.exp(-6 * dt);
    this.transition = Math.min(1, this.transition + dt / 0.9);
    const tt = this.transition * this.transition * (3 - 2 * this.transition);

    const k = 1 - Math.exp(-10 * dt);
    this.smoothX += (s.playerX - this.smoothX) * k;
    this.smoothY += (s.playerY - this.smoothY) * (1 - Math.exp(-8 * dt));

    const menuA = s.elapsed * 0.13;
    const menuPos = new THREE.Vector3(Math.sin(menuA) * 2.7, 1.8, Math.cos(menuA) * 2.7 + 0.6);
    const menuLook = new THREE.Vector3(0, 1.15, 0);

    const followPos = new THREE.Vector3(
      this.smoothX * 0.55,
      3.02 + this.smoothY * 0.45 - this.dip * 0.2,
      6.1
    );
    const followLook = new THREE.Vector3(this.smoothX * 0.85, 1.35 + this.smoothY * 0.3, -7);

    if (this.mode === 'follow') {
      this.pos.copy(menuPos).lerp(followPos, tt);
      this.look.copy(menuLook).lerp(followLook, tt);
    } else {
      this.pos.copy(menuPos);
      this.look.copy(menuLook);
    }

    // Crash shake.
    if (this.shake > 0.002) {
      const sh = this.shake * this.shake * 0.3;
      this.pos.x += (Math.random() - 0.5) * sh;
      this.pos.y += (Math.random() - 0.5) * sh;
    }

    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);

    const targetFov = this.mode === 'follow' ? 66 + 12 * s.speedNorm * tt : 62;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-3 * dt));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
