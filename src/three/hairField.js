// Head-local measurements of the practice head, for tools, camera and the cut engine.
// Pure JS (no three.js, no DOM), importable in node. All values come from the asset that
// scripts/head/build_head.py measures on the MakeHuman mesh (see scripts/head/README.md).
//
// Frame: Y up, the face looks down +Z, +X is the head's left (the side the films show).
// 1 unit is about 11 cm: crown top y 1.10, chin y -1.00. phi = atan2(x, z - AXIS_Z):
// 0 at the forehead, +pi/2 at the left ear, pi at the nape.

import { HEAD_META, HEAD_CAGE } from './headAsset.js';
import { base64Bytes, decodeCage, hairMaskOf, beardMaskOf } from './headWorker.js';

export { hairMaskOf, beardMaskOf };

/** Head units per millimetre (crown to chin = 230 mm). */
export const MM = HEAD_META.MM;
/** One finger ("dedo") of a barber's hand, in mm. */
export const DEDO_MM = HEAD_META.DEDO_MM;

const freeze = (o) => Object.freeze(o);

/** Landmark heights (y, head units); CORONILLA is a point [x, y, z]. */
export const LANDMARKS = freeze({
  ...HEAD_META.LANDMARKS,
  CORONILLA: freeze(HEAD_META.LANDMARKS.CORONILLA.slice()),
});

export const ANCHOR_NAMES = freeze(['flequillo', 'sien', 'esquina', 'coronilla', 'nuca', 'patilla', 'oreja', 'lineaBarba', 'bigote', 'barbilla', 'cuello']);

/** Head-local surface points [x, y, z]; lateral ones sit on the +x side. */
export const ANCHORS = freeze(Object.fromEntries(ANCHOR_NAMES.map((k) => [k, freeze(HEAD_META.ANCHORS[k].slice())])));

/** Head bounds (head-local): center [x,y,z], radius, top, chin, neck ring {y,cx,cz,rx,rz}. */
export const HEAD_BOUNDS = HEAD_META.bounds;
/** Measured anatomy (nose tip, lips, chin, throat, ear extremes...), head-local [x,y,z]. */
export const HEAD_POINTS = HEAD_META.points;
/** Eyeball centres and radius (the sculpted eyes). */
export const EYES = HEAD_META.eyes;
export const AXIS_Z = HEAD_META.axisZ;

/** y of a Height {lm, dedos?} (or a landmark name): the landmark plus dedos fingers. */
export function heightY(h) {
  const lm = typeof h === 'string' ? h : h && h.lm;
  const v = LANDMARKS[lm];
  if (v === undefined) throw new Error(`hairField: unknown landmark ${lm}`);
  const y = Array.isArray(v) ? v[1] : v;
  const dedos = (h && typeof h === 'object' && h.dedos) || 0;
  return y + dedos * DEDO_MM * MM;
}

let grid = null;
function radiusGrid() {
  if (!grid) grid = decodeCage(base64Bytes(HEAD_CAGE), HEAD_META.encoding).grid;
  return grid;
}

// Outermost surface radius around the head axis at (|phi|, y): bilinear in the baked grid.
function radiusAt(phi, y) {
  const g = radiusGrid();
  const fp = Math.min(Math.max((Math.abs(phi) / Math.PI) * (g.nPhi - 1), 0), g.nPhi - 1.0001);
  const fy = Math.min(Math.max((y - g.y0) / g.dy, 0), g.nY - 1.0001);
  const i = fp | 0, j = fy | 0;
  const u = fp - i, v = fy - j;
  const r = g.r, w = g.nPhi;
  const a = r[j * w + i] * (1 - u) + r[j * w + i + 1] * u;
  const b = r[(j + 1) * w + i] * (1 - u) + r[(j + 1) * w + i + 1] * u;
  return a * (1 - v) + b * v;
}

function pointAt(phi, y) {
  const p = Math.max(-Math.PI, Math.min(Math.PI, phi));
  const r = radiusAt(p, y);
  return [Math.sin(p) * r, y, AXIS_Z + Math.cos(p) * r];
}

const TOP_Y = HEAD_BOUNDS.top - 0.012;

/**
 * Surface point and outward normal at azimuth phi (radians, see header) and height y.
 * Reads the outermost surface (the ear where it overhangs). Six grid lookups, no meshing.
 */
export function surfaceAt(phi, y) {
  const yy = Math.min(y, TOP_Y);
  const e = 0.01;
  const pos = pointAt(phi, yy);
  const a = pointAt(phi + e, yy), b = pointAt(phi - e, yy);
  const c = pointAt(phi, yy + e), d = pointAt(phi, yy - e);
  const tp = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const ty = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
  let nx = tp[1] * ty[2] - tp[2] * ty[1];
  let ny = tp[2] * ty[0] - tp[0] * ty[2];
  let nz = tp[0] * ty[1] - tp[1] * ty[0];
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  // outward: away from the head axis
  if (nx * pos[0] + nz * (pos[2] - AXIS_Z) < 0) {
    nx = -nx; ny = -ny; nz = -nz;
  }
  if (y > TOP_Y) {
    pos[1] = HEAD_BOUNDS.top;
    return { pos, normal: [0, 1, 0] };
  }
  return { pos, normal: [nx, ny, nz] };
}
