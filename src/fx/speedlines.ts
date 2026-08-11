import * as THREE from 'three';

const COUNT = 14;

/**
 * Subtle anime-style speed streaks around the camera at high speed.
 * Attached to the camera; shared material opacity keyed to speed.
 */
export class SpeedLines {
  group = new THREE.Group();
  private mat: THREE.MeshBasicMaterial;
  private lines: THREE.Mesh[] = [];

  constructor(camera: THREE.Camera) {
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xf5f9ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const geo = new THREE.BoxGeometry(0.02, 0.02, 1);
    for (let i = 0; i < COUNT; i++) {
      const m = new THREE.Mesh(geo, this.mat);
      this.place(m, true);
      this.lines.push(m);
      this.group.add(m);
    }
    this.group.visible = false;
    camera.add(this.group);
  }

  private place(m: THREE.Mesh, randomZ: boolean): void {
    const a = Math.random() * Math.PI * 2;
    const r = 1.6 + Math.random() * 2.2;
    m.position.set(Math.cos(a) * r * 1.25, Math.sin(a) * r * 0.85, randomZ ? -3 - Math.random() * 12 : -15);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.lines[0]?.geometry.dispose();
    this.mat.dispose();
  }

  update(dt: number, speed: number, speedNorm: number): void {
    const target = Math.max(0, (speedNorm - 0.45) / 0.55) * 0.4;
    this.mat.opacity += (target - this.mat.opacity) * (1 - Math.exp(-4 * dt));
    this.group.visible = this.mat.opacity > 0.01;
    if (!this.group.visible) return;
    const stretch = 1.5 + speedNorm * 4.5;
    for (const m of this.lines) {
      m.scale.z = stretch;
      m.position.z += speed * 1.6 * dt;
      if (m.position.z > -1) this.place(m, false);
    }
  }
}
