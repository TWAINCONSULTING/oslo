import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Geometry & texture helpers. Everything visual is procedural: merged
 * vertex-colored geometry (one draw call per chunk/obstacle) plus a handful of
 * small generated canvas textures.
 */

// Shared unit primitives (cloned + transformed at build time).
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_CYL8 = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
const UNIT_CYL5 = new THREE.CylinderGeometry(0.5, 0.5, 1, 5);
// thetaStart π so the triangular cross-section has its apex pointing up after rx=90°.
const UNIT_PRISM = new THREE.CylinderGeometry(0.5, 0.5, 1, 3, 1, false, Math.PI);
const UNIT_ICO = new THREE.IcosahedronGeometry(0.5, 0);
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);
const UNIT_CONE = new THREE.CylinderGeometry(0.06, 0.5, 1, 7);

const tmpColor = new THREE.Color();

export function paintGeometry(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  tmpColor.set(color);
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = tmpColor.r;
    arr[i * 3 + 1] = tmpColor.g;
    arr[i * 3 + 2] = tmpColor.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

export interface XformOpts {
  rx?: number;
  ry?: number;
  rz?: number;
}

/** Accumulates transformed, vertex-colored parts and merges them into one geometry. */
export class GeoBuilder {
  private parts: THREE.BufferGeometry[] = [];

  push(
    src: THREE.BufferGeometry,
    color: number,
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = 1,
    sz = 1,
    opts: XformOpts = {}
  ): void {
    const g = src.index ? src.toNonIndexed() : src.clone();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0)),
      new THREE.Vector3(sx, sy, sz)
    );
    g.applyMatrix4(m);
    paintGeometry(g, color);
    this.parts.push(g);
  }

  box(color: number, w: number, h: number, d: number, x: number, y: number, z: number, opts: XformOpts = {}): void {
    this.push(UNIT_BOX, color, x, y, z, w, h, d, opts);
  }

  cyl(color: number, r: number, h: number, x: number, y: number, z: number, opts: XformOpts = {}, seg: 5 | 8 = 8): void {
    this.push(seg === 8 ? UNIT_CYL8 : UNIT_CYL5, color, x, y, z, r * 2, h, r * 2, opts);
  }

  cone(color: number, r: number, h: number, x: number, y: number, z: number): void {
    this.push(UNIT_CONE, color, x, y, z, r * 2, h, r * 2);
  }

  prism(color: number, w: number, h: number, len: number, x: number, y: number, z: number, opts: XformOpts = {}): void {
    // Triangular prism (gabled roof): 3-sided cylinder on its side.
    this.push(UNIT_PRISM, color, x, y, z, w, len, h, { rx: Math.PI / 2, ...opts });
  }

  ico(color: number, r: number, x: number, y: number, z: number, sy = 1, opts: XformOpts = {}): void {
    this.push(UNIT_ICO, color, x, y, z, r * 2, r * 2 * sy, r * 2, opts);
  }

  plane(color: number, w: number, h: number, x: number, y: number, z: number, opts: XformOpts = {}): void {
    this.push(UNIT_PLANE, color, x, y, z, w, h, 1, opts);
  }

  shape(points: Array<[number, number]>, color: number, x: number, y: number, z: number, opts: XformOpts = {}): void {
    const s = new THREE.Shape();
    s.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
    const geo = new THREE.ShapeGeometry(s);
    this.push(geo, color, x, y, z, 1, 1, 1, opts);
    geo.dispose();
  }

  merge(): THREE.BufferGeometry {
    if (this.parts.length === 0) return new THREE.BufferGeometry();
    // Merged parts only need position/normal/color — drop uv to keep merge compatible.
    for (const p of this.parts) p.deleteAttribute('uv');
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    return merged ?? new THREE.BufferGeometry();
  }
}

/** Single shared lit material for all merged vertex-colored geometry. */
export const vertexColorMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

/** Unlit variant for distant silhouettes (still fogged). */
export const silhouetteMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });

// ---------------------------------------------------------------------------
// Canvas textures.
// ---------------------------------------------------------------------------

export function canvasTexture(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  return tex;
}

let _blobTex: THREE.CanvasTexture | null = null;
export function blobShadowTexture(): THREE.CanvasTexture {
  if (!_blobTex) {
    _blobTex = canvasTexture(128, 128, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(10,14,20,0.55)');
      g.addColorStop(0.7, 'rgba(10,14,20,0.28)');
      g.addColorStop(1, 'rgba(10,14,20,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
  }
  return _blobTex;
}

let _glowTex: THREE.CanvasTexture | null = null;
export function glowTexture(): THREE.CanvasTexture {
  if (!_glowTex) {
    _glowTex = canvasTexture(128, 128, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,236,190,1)');
      g.addColorStop(0.35, 'rgba(255,214,140,0.55)');
      g.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
  }
  return _glowTex;
}

/**
 * Sign atlas: Oslo-style street name plates and tram destination boards,
 * drawn once and shared by every chunk / tram.
 */
export interface AtlasRegion {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Aspect ratio w/h for sizing quads. */
  aspect: number;
}

const ATLAS_W = 512;
const ATLAS_H = 256;
const atlasRegions: Record<string, AtlasRegion> = {};
let _atlasTex: THREE.CanvasTexture | null = null;

function defineRegion(key: string, x: number, y: number, w: number, h: number): void {
  atlasRegions[key] = {
    u0: x / ATLAS_W,
    v0: 1 - (y + h) / ATLAS_H,
    u1: (x + w) / ATLAS_W,
    v1: 1 - y / ATLAS_H,
    aspect: w / h,
  };
}

export function signAtlasTexture(): THREE.CanvasTexture {
  if (_atlasTex) return _atlasTex;
  _atlasTex = canvasTexture(ATLAS_W, ATLAS_H, (ctx) => {
    ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);

    const plate = (x: number, y: number, w: number, h: number, text: string): void => {
      ctx.fillStyle = '#1c3f6e';
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 6);
      ctx.fill();
      ctx.strokeStyle = '#f2f4f6';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(x + 3, y + 3, w - 6, h - 6, 4);
      ctx.stroke();
      ctx.fillStyle = '#f2f4f6';
      ctx.font = `700 ${Math.floor(h * 0.48)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text.toUpperCase(), x + w / 2, y + h / 2 + 1);
    };

    plate(0, 0, 250, 46, 'Storgata');
    defineRegion('storgata', 0, 0, 250, 46);
    plate(256, 0, 250, 46, 'Torggata');
    defineRegion('torggata', 256, 0, 250, 46);
    plate(0, 52, 250, 46, 'Kirkegata');
    defineRegion('kirkegata', 0, 52, 250, 46);
    plate(256, 52, 250, 46, 'Grønland');
    defineRegion('gronland', 256, 52, 250, 46);

    const dest = (x: number, y: number, w: number, h: number, text: string): void => {
      ctx.fillStyle = '#101418';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#ffb23e';
      ctx.font = `700 ${Math.floor(h * 0.55)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + w / 2, y + h / 2 + 1);
    };

    dest(0, 108, 250, 40, '11 Majorstuen');
    defineRegion('dest-majorstuen', 0, 108, 250, 40);
    dest(256, 108, 250, 40, '13 Grünerløkka');
    defineRegion('dest-lokka', 256, 108, 250, 40);

    // Roadwork chevron block (red/white diagonals).
    const cx0 = 0;
    const cy0 = 158;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx0, cy0, 250, 60);
    ctx.clip();
    ctx.fillStyle = '#f4f4f2';
    ctx.fillRect(cx0, cy0, 250, 60);
    ctx.fillStyle = '#c8372d';
    for (let i = -2; i < 10; i++) {
      ctx.beginPath();
      ctx.moveTo(cx0 + i * 34, cy0 + 60);
      ctx.lineTo(cx0 + i * 34 + 34, cy0);
      ctx.lineTo(cx0 + i * 34 + 51, cy0);
      ctx.lineTo(cx0 + i * 34 + 17, cy0 + 60);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    defineRegion('chevron', 0, 158, 250, 60);

    // Overhead warning board (yellow/black).
    const ox0 = 256;
    const oy0 = 158;
    ctx.fillStyle = '#f4b400';
    ctx.fillRect(ox0, oy0, 250, 60);
    ctx.fillStyle = '#17181a';
    ctx.font = '800 34px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('OBS! LAV HØYDE', ox0 + 125, oy0 + 31);
    defineRegion('lavhoyde', 256, 158, 250, 60);
  });
  _atlasTex.needsUpdate = true;
  return _atlasTex;
}

let _atlasMat: THREE.MeshBasicMaterial | null = null;
export function signAtlasMaterial(): THREE.MeshBasicMaterial {
  if (!_atlasMat) {
    _atlasMat = new THREE.MeshBasicMaterial({ map: signAtlasTexture(), transparent: true });
  }
  return _atlasMat;
}

/** A plane whose UVs point at a named atlas region. Height 1, width = aspect. */
export function atlasPlane(key: string, height: number): THREE.PlaneGeometry {
  signAtlasTexture();
  const r = atlasRegions[key];
  const geo = new THREE.PlaneGeometry(r.aspect * height, height);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // PlaneGeometry uv order: (0,1) (1,1) (0,0) (1,0)
  uv.setXY(0, r.u0, r.v1);
  uv.setXY(1, r.u1, r.v1);
  uv.setXY(2, r.u0, r.v0);
  uv.setXY(3, r.u1, r.v0);
  uv.needsUpdate = true;
  return geo;
}

export const ATLAS_STREETS = ['storgata', 'torggata', 'kirkegata', 'gronland'];
export const ATLAS_DESTS = ['dest-majorstuen', 'dest-lokka'];
