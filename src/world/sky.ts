import * as THREE from 'three';
import type { ThemeDef } from '../config/content';
import { GeoBuilder, canvasTexture, glowTexture, silhouetteMaterial } from './materials';

/**
 * Static backdrop: gradient sky, warm sun, fog, distant hills with
 * Oslo-inspired silhouettes (Barcode row, City Hall towers, the Opera wedge,
 * the ski-jump curve) and the fjord water plane. The camera barely moves in
 * world space (the world scrolls instead), so the backdrop can be static.
 */
export class Backdrop {
  readonly hemi: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
  private sprite: THREE.Sprite;
  private group: THREE.Group;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene, theme: ThemeDef) {
    this.scene = scene;
    // Sky gradient.
    const skyTop = new THREE.Color(theme.skyTop);
    const skyHor = new THREE.Color(theme.skyHorizon);
    scene.background = canvasTexture(4, 256, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, `#${skyTop.getHexString()}`);
      g.addColorStop(0.62, `#${new THREE.Color(theme.skyTop).lerp(skyHor, 0.55).getHexString()}`);
      g.addColorStop(1, `#${skyHor.getHexString()}`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
    scene.fog = new THREE.Fog(theme.fog, theme.fogNear, theme.fogFar);

    // Lights: soft sky bounce + warm, low late-summer sun from the west.
    this.hemi = new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemiIntensity);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(theme.sun, theme.sunIntensity);
    this.sun.position.set(-38, 30, -55);
    scene.add(this.sun);

    // Sun glow sprite near the horizon.
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      })
    );
    this.sprite.position.set(-95, 34, -240);
    this.sprite.scale.setScalar(150);

    this.group = new THREE.Group();
    this.group.add(this.sprite);

    // Distant hills: two fogged ridges.
    const far = new GeoBuilder();
    far.shape(ridge(520, 26, 5, 0.55), theme.hillFar, -30, 0, -330);
    const farGeo = far.merge();
    this.group.add(new THREE.Mesh(farGeo, silhouetteMaterial));

    const near = new GeoBuilder();
    near.shape(ridge(480, 34, 6, 0.8), theme.hillNear, 20, 0, -290);
    // Holmenkollen-inspired ski jump silhouette on the left ridge.
    near.shape(
      [
        [0, 0],
        [3, 26],
        [6, 26],
        [6, 23],
        [10, 8],
        [22, 0.5],
        [22, 0],
      ],
      theme.silhouette,
      -150,
      16,
      -288
    );
    this.group.add(new THREE.Mesh(near.merge(), silhouetteMaterial));

    // City silhouettes closer in: Barcode row (right), City Hall + Opera (left).
    const city = new GeoBuilder();
    const s = theme.silhouette;
    // Barcode: a row of slim, varied towers with slots between them.
    const widths = [9, 6, 11, 5, 8, 10, 6];
    let bx = 55;
    for (let i = 0; i < widths.length; i++) {
      const w = widths[i];
      const h = 26 + ((i * 37) % 21);
      city.box(s, w, h, 10, bx + w / 2, h / 2, -250);
      bx += w + 4;
    }
    // City Hall: two brick towers and a broad base.
    city.box(s, 26, 16, 12, -70, 8, -252);
    city.box(s, 8, 30, 8, -80, 15, -250);
    city.box(s, 8, 27, 8, -58, 13.5, -250);
    // Opera: a low white wedge sliding into the fjord.
    city.shape(
      [
        [0, 0],
        [34, 0],
        [22, 9],
        [14, 9],
      ],
      0xd8dde2,
      -36,
      0,
      -238
    );
    this.group.add(new THREE.Mesh(city.merge(), silhouetteMaterial));

    // The fjord: one large water plane, visible through waterfront gaps.
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900),
      new THREE.MeshLambertMaterial({ color: theme.water })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.55;
    this.group.add(water);

    scene.add(this.group);
  }

  dispose(): void {
    this.scene.remove(this.group, this.hemi, this.sun);
    (this.scene.background as THREE.Texture | null)?.dispose?.();
    this.scene.background = null;
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
      if (o instanceof THREE.Sprite) o.material.dispose();
    });
  }
}

/** Points for a jagged ridge silhouette, centered on x. */
function ridge(width: number, height: number, peaks: number, jag: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [[-width / 2, 0]];
  for (let i = 0; i <= peaks * 2; i++) {
    const x = -width / 2 + (width * i) / (peaks * 2);
    const t = i / (peaks * 2);
    const env = Math.sin(t * Math.PI);
    const h = i % 2 === 1 ? height * (0.55 + jag * 0.45 * pseudo(i)) * env : height * 0.35 * env;
    pts.push([x, Math.max(0.5, h)]);
  }
  pts.push([width / 2, 0]);
  return pts;
}

function pseudo(i: number): number {
  return ((Math.sin(i * 127.1) * 43758.5453) % 1 + 1) % 1;
}
