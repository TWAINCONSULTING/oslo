import * as THREE from 'three';

const CAP = 120;

interface P {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  spin: number;
  gravity: number;
}

/**
 * Tiny instanced particle pool: dust puffs, crash sparks, token pops.
 * Particles live in scene space and inherit the world scroll so they appear
 * glued to the ground.
 */
export class Particles {
  private mesh: THREE.InstancedMesh;
  private items: P[] = [];
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const geo = new THREE.TetrahedronGeometry(0.07);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < CAP; i++) {
      this.items.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 1,
        spin: 0,
        gravity: 0,
      });
      this.mesh.setColorAt(i, this.color.setHex(0xffffff));
    }
    this.hide();
    scene.add(this.mesh);
  }

  private hide(): void {
    this.dummy.position.set(0, -100, 0);
    this.dummy.scale.setScalar(0.0001);
    this.dummy.updateMatrix();
    for (let i = 0; i < CAP; i++) this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  burst(
    x: number,
    y: number,
    z: number,
    opts: {
      count: number;
      colors: number[];
      speed: number;
      up?: number;
      gravity?: number;
      life?: number;
      size?: number;
    }
  ): void {
    let spawned = 0;
    for (let i = 0; i < CAP && spawned < opts.count; i++) {
      const p = this.items[i];
      if (p.active) continue;
      p.active = true;
      p.pos.set(x, y, z);
      const a = Math.random() * Math.PI * 2;
      const r = opts.speed * (0.4 + Math.random() * 0.6);
      p.vel.set(Math.cos(a) * r, (opts.up ?? 1.4) * (0.5 + Math.random() * 0.8), Math.sin(a) * r);
      p.maxLife = p.life = (opts.life ?? 0.5) * (0.7 + Math.random() * 0.6);
      p.size = (opts.size ?? 1) * (0.7 + Math.random() * 0.7);
      p.spin = (Math.random() - 0.5) * 12;
      p.gravity = opts.gravity ?? 5;
      this.mesh.setColorAt(i, this.color.setHex(opts.colors[(Math.random() * opts.colors.length) | 0]));
      spawned++;
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dust(x: number, z: number): void {
    this.burst(x, 0.1, z, { count: 5, colors: [0xb3a58f, 0x9c9184, 0xc4b8a2], speed: 1.2, up: 1.2, life: 0.4 });
  }

  sparks(x: number, y: number, z: number): void {
    this.burst(x, y, z, {
      count: 22,
      colors: [0xffc233, 0xff8a3c, 0xf4f4f2, 0xe86a10],
      speed: 4.5,
      up: 3.2,
      gravity: 9,
      life: 0.7,
      size: 1.4,
    });
  }

  pop(x: number, y: number, z: number): void {
    this.burst(x, y, z, { count: 7, colors: [0xffc233, 0xffe28a], speed: 1.6, up: 2.2, life: 0.35 });
  }

  /** worldDeltaZ: meters the world scrolled this frame (speed * dt). */
  update(dt: number, worldDeltaZ: number): void {
    for (let i = 0; i < CAP; i++) {
      const p = this.items[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this.dummy.position.set(0, -100, 0);
        this.dummy.scale.setScalar(0.0001);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.pos.z += worldDeltaZ;
      if (p.pos.y < 0.04) {
        p.pos.y = 0.04;
        p.vel.y *= -0.3;
      }
      const f = p.life / p.maxLife;
      this.dummy.position.copy(p.pos);
      this.dummy.rotation.set(p.spin * p.life, p.spin * 0.7 * p.life, 0);
      this.dummy.scale.setScalar(p.size * (0.3 + 0.7 * f));
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    for (const p of this.items) p.active = false;
    this.hide();
  }
}
