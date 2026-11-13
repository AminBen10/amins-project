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

// =====================================================================================
// Cut-step engine (pure: runs in the head worker and, as a fallback, on the main thread).
//
// A Program (src/cuts/catalog.js) is a list of steps. computeProgram() turns it into the
// hair state before and after every step: per shell vertex the hair length and the beard
// length in real mm, lift, foam and line-up (crisp edge), plus the comb direction. Each step
// also gets a sweep: where along the tool's travel every vertex is reached, s in 0..1. The
// shells cut vertex v when the tool front passes s(v); toolPath(step, s) is where the tool is
// at that moment, so the hair always changes right under the tool.
// =====================================================================================

const PI = Math.PI;
const DEDO = DEDO_MM * MM;
const FLICK = 0.5 * DEDO; // the clipper rides out of the hair over half a finger
const cl = (v, a, b) => (v < a ? a : v > b ? b : v);
const sm = (a, b, x) => {
  const t = cl((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

/** Tool front for step progress t (0..1): s = t*(1+0.06)-0.03, so t=0 cuts nothing and t=1 all. */
export const FRONT_PAD = 0.03;
export const front = (t) => t * (1 + 2 * FRONT_PAD) - FRONT_PAD;

// Visual length. Shells draw combed hair as a coat over the scalp; a 7 cm top drawn at 7 cm
// stands off the head like a helmet and its strands fan out. Up to 8 mm (guards up to the 2,
// stubble) the drawn length is the real one; beyond it the drawn length grows at 0.75 of the
// real one, and at 0.55 past 4 cm, so a long top still reads long (and a crop short) while
// the order of every length is kept: 10 mm draws 9.5, 25 mm 20.8, 40 mm 32, 75 mm 51.3.
export const VIS_KNEE = 8;
export const visMM = (mm) => (mm <= VIS_KNEE ? mm : mm <= 40 ? VIS_KNEE + 0.75 * (mm - VIS_KNEE) : 32 + 0.55 * (mm - 40));

/** Real lengths (mm) of the overgrown head the films start from. */
export const OVERGROWN = Object.freeze({ sides: 32, top: 60, front: 75, beard: 14, chin: 19 });

const CUT_OPS = new Set(['clipper', 'blend', 'scissorOverComb', 'clipperOverComb', 'pointCut', 'thinning', 'scissor', 'part', 'trimmer', 'razor']);
const HAIR_ZONES = ['sides', 'nape', 'sidesNape', 'top', 'fringe', 'crown', 'contour'];
const BEARD_ZONES = ['neck', 'cheeks', 'chin', 'moustache', 'beard'];
export const isCutOp = (op) => CUT_OPS.has(op);

const isBeardStep = (step) => step.part === 'barba' || BEARD_ZONES.includes(step.zone) && step.part !== 'acabado';
const phiOf = (x, z) => Math.atan2(x, z - AXIS_Z);
// meridian frame for the top: alpha 0 at the forehead, pi/2 on top, pi at the back; beta across.
// Unwrapped to (-pi/2, 3pi/2] so the back of the head below the meridian continues past pi
// instead of jumping to -pi (row extents measured from it would otherwise start under the chin).
const MERID_Y = 0.25;
const alphaOf = (y, z) => {
  const a = Math.atan2(y - MERID_Y, z - AXIS_Z);
  return a <= -0.5 * PI ? a + 2 * PI : a;
};
const betaOf = (x, y, z) => Math.asin(cl(x / (Math.hypot(x, y - MERID_Y, z - AXIS_Z) || 1), -1, 1));

// ------------------------------------------------------------------ surface helpers

/** Surface point (outermost) along the meridian direction (alpha, beta) from the head centre. */
export function surfaceDir(alpha, beta) {
  const d = [Math.sin(beta), Math.cos(beta) * Math.sin(alpha), Math.cos(beta) * Math.cos(alpha)];
  const at = (r) => [d[0] * r, MERID_Y + d[1] * r, AXIS_Z + d[2] * r];
  const inside = (p) => p[1] < HEAD_BOUNDS.top && Math.hypot(p[0], p[2] - AXIS_Z) < radiusAt(phiOf(p[0], p[2]), p[1]);
  let a = 0.15, b = 1.6;
  for (let i = 0; i < 22; i++) {
    const m = (a + b) / 2;
    if (inside(at(m))) a = m;
    else b = m;
  }
  const r = (a + b) / 2;
  const p = at(r);
  const s = surfaceAt(phiOf(p[0], p[2]), p[1]);
  return { pos: p, normal: s.normal };
}

// ------------------------------------------------------------------ paths
// A path says how the tool travels during a step. kinds:
//  strokes  passes side by side across phi, each one rising (up) or falling in y
//           (clipper, blend, beard trimming); sides 1 = the +x side only, -1 = the -x side,
//           2 = +x then -x, 0 = one pass across the signed phi range (chin, moustache)
//  rows     rows from front to back over the top, each across from +x to -x and back
//           (scissor over comb, point cut, dryer)
//  contour  along an outline: the hairline or the beard line (trimmer, razor line-up)
//  none     nothing moves on the head (hold, towel, mirror)

const DEFAULT_HAIR_CONTOUR = [
  [0.22, 0.6], [0.3, 0.48], [0.36, 0.3], [0.385, -0.16], [0.43, -0.05], [0.47, 0.17], [0.53, 0.24],
  [0.6, 0.1], [0.66, -0.2], [0.74, -0.48], [0.86, -0.64], [1, -0.68],
].map(([p, y]) => [p * PI, y]);
const DEFAULT_CHEEK = [[0.46, -0.12], [0.36, -0.3], [0.26, -0.4], [0.16, -0.5], [0.1, -0.56]].map(([p, y]) => [p * PI, y]);

const NOOP_OPS = new Set(['hold', 'towel', 'mirror', 'talc', 'neckBrush']);

/**
 * Path of a step. ctx (optional, from the engine) gives oneSided (the program has an
 * otherSide step after this laterales step), the measured contours and zone extents.
 */
export function stepPath(step, ctx = {}) {
  const op = step.op;
  const dur = step.dur || 3;
  if (NOOP_OPS.has(op) || !step.zone) return { kind: 'none', w: 0.06 };
  const beard = isBeardStep(step);
  const zone = step.zone;
  if (op === 'otherSide') {
    return { kind: 'strokes', sides: -1, pa: 0.25 * PI, pb: PI, y0: LANDMARKS.NUCA - 0.1, y1: ctx.otherTop ?? LANDMARKS.ESQUINA + DEDO, up: true, K: 3, w: 0.06 };
  }
  if (zone === 'contour' || (op === 'trimmer' && !beard) || (op === 'razor' && (step.upTo || zone === 'contour') && beard)) {
    if (beard) {
      const neckY = step.upTo ? heightY(step.upTo) : LANDMARKS.NUEZ + 2 * DEDO;
      const cheek = ctx.cheek || DEFAULT_CHEEK;
      const pts = cheek.map((p) => [p[0], p[1], 0]);
      for (let i = 0; i <= 8; i++) pts.push([lerp(0.46 * PI, 0, i / 8), neckY, 1]);
      return contourPath(pts, 2, dur);
    }
    if (zone === 'contour' || zone === 'top' || zone === 'nape' || zone === 'sidesNape' || zone === 'sides') {
      const pts = (ctx.hairline || DEFAULT_HAIR_CONTOUR).map((p) => [p[0], p[1], 0]);
      return contourPath(pts, ctx.oneSided ? 1 : 2, dur);
    }
  }
  if (beard) {
    const P = HEAD_POINTS;
    const K = cl(Math.round(dur * 0.9), 2, 5);
    if (zone === 'moustache') return { kind: 'strokes', sides: 0, pa: 0.11 * PI, pb: -0.11 * PI, y0: P.lip_upper[1], y1: P.subnasale[1], up: false, K: 4, w: 0.04 };
    if (zone === 'chin') return { kind: 'strokes', sides: 0, pa: 0.17 * PI, pb: -0.17 * PI, y0: -1.08, y1: P.lip_lower[1], up: false, K: cl(Math.round(dur * 1.2), 3, 6), w: 0.04 };
    if (zone === 'neck') return { kind: 'strokes', sides: 2, pa: 0.46 * PI, pb: 0, y0: LANDMARKS.NUEZ - 0.08, y1: -0.9, up: true, K, w: 0.04 };
    if (zone === 'cheeks') return { kind: 'strokes', sides: 2, pa: 0.47 * PI, pb: 0.09 * PI, y0: -1.05, y1: -0.02, up: false, K, w: 0.04 };
    return { kind: 'strokes', sides: 2, pa: 0.47 * PI, pb: 0, y0: LANDMARKS.NUEZ - 0.08, y1: -0.02, up: false, K, w: 0.04 };
  }
  if (zone === 'top' || zone === 'fringe' || zone === 'crown') {
    const ext = (ctx.rows && ctx.rows[zone]) || { top: [0.17 * PI, 0.85 * PI, 0.62], fringe: [0.12 * PI, 0.3 * PI, 0.45], crown: [0.55 * PI, 0.9 * PI, 0.5] }[zone];
    const K = cl(Math.round(dur * (zone === 'top' ? 1.2 : 0.8)), 2, 6);
    return { kind: 'rows', aA: ext[0], aB: ext[1], bMax: ext[2], K, w: Math.min(0.06, 0.3 / K) };
  }
  // sides, nape, sidesNape: upward clipper passes from the sideburn round to the nape
  const sides = ctx.oneSided ? 1 : 2;
  // (the first pass starts at the sideburn, just in front of the ear, not on the cheek)
  const pa = zone === 'nape' ? 0.6 * PI : 0.35 * PI;
  const pb = zone === 'sides' ? 0.85 * PI : PI;
  const y0 = step.from ? heightY(step.from) - 0.02 : LANDMARKS.NUCA - 0.1;
  const y1 = (step.upTo ? heightY(step.upTo) : LANDMARKS.ESQUINA + DEDO) + FLICK;
  const K = cl(Math.round(dur * (sides === 2 ? 1.6 : 1.2)), 3, 7);
  // each pass starts at the hairline; round the ear the barber works above it (ear folded)
  const line = ctx.hairline || DEFAULT_HAIR_CONTOUR;
  const P = HEAD_POINTS;
  const earA = phiOf(P.ear_front[0], P.ear_front[2]) + 0.02, earB = phiOf(P.ear_back[0], P.ear_back[2]) - 0.02;
  const floor = [];
  for (let k = 0; k < K; k++) {
    // the lowest hairline across the pass (the ear's span does not count)
    const mid = lerp(pa, pb, (k + 0.5) / K);
    let f = Infinity;
    if (mid > earA && mid < earB) f = P.ear_top[1] + 0.03;
    else if (mid <= earA) f = LANDMARKS.PATILLA; // in front of the ear: from the sideburn's foot, never down the beard
    else {
      for (let j = 0; j <= 4; j++) {
        const ph = lerp(pa, pb, (k + j / 4) / K);
        if (!(ph > earA && ph < earB)) f = Math.min(f, lineY(line, ph) - 0.02);
      }
    }
    floor.push(Math.min(Math.max(y0, f), y1 - 0.1));
  }
  return { kind: 'strokes', sides, pa, pb, y0, y1, floor, up: true, K, w: Math.min(0.06, (0.35 / K) * (sides === 2 ? 0.5 : 1)) };
}

// y of a (phi, y) polyline at |phi| (clamped to its ends)
function lineY(pts, ph) {
  const a = Math.abs(ph);
  if (a <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (a <= pts[i][0]) return lerp(pts[i - 1][1], pts[i][1], (a - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0] || 1));
  }
  return pts[pts.length - 1][1];
}

function contourPath(pts, sides, dur) {
  // cumulative length in (phi*0.75, y); a pen-up (stroke change) costs nothing
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const jump = pts[i][2] !== pts[i - 1][2];
    cum.push(cum[i - 1] + (jump ? 0 : Math.hypot((pts[i][0] - pts[i - 1][0]) * 0.75, pts[i][1] - pts[i - 1][1])));
  }
  const L = cum[cum.length - 1] || 1;
  return { kind: 'contour', sides, pts, cum: cum.map((c) => c / L), K: 1, w: 0.05, dur };
}

function sidesSplit(path, s) {
  if (path.sides === 2) return s < 0.5 ? [1, s * 2] : [-1, (s - 0.5) * 2];
  if (path.sides === -1) return [-1, s];
  return [1, s];
}

const stepCache = new WeakMap();

/**
 * Tool position at s (= front(t)) along a step's path: {pos, normal, tangent, stroke,
 * strokeT, side} in head-local units. step is a Handle step (its .path, measured on this
 * head, is used) or any catalog Step (default path). pos is on the skin: tools add their
 * own offset (guard, comb teeth) along normal.
 */
export function toolPath(step, s) {
  let path = step.path;
  if (!path) {
    path = stepCache.get(step);
    if (!path) stepCache.set(step, (path = stepPath(step)));
  }
  const at = (u) => pathPoint(path, cl(u, 0, 1));
  const p = at(s);
  if (!p) return null;
  const e = 0.004;
  const a = at(s - e), b = at(s + e);
  let tg = [b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]];
  if (a.stroke !== b.stroke || Math.hypot(...tg) < 1e-6) tg = p.dir;
  const n = p.normal;
  const dn = tg[0] * n[0] + tg[1] * n[1] + tg[2] * n[2];
  tg = [tg[0] - n[0] * dn, tg[1] - n[1] * dn, tg[2] - n[2] * dn];
  const l = Math.hypot(...tg) || 1;
  return { pos: p.pos, normal: n, tangent: [tg[0] / l, tg[1] / l, tg[2] / l], stroke: p.stroke, strokeT: p.strokeT, side: p.side };
}

function pathPoint(path, s) {
  if (path.kind === 'none') {
    const a = ANCHORS.sien;
    return { pos: a.slice(), normal: [1, 0, 0], dir: [0, 1, 0], stroke: 0, strokeT: s, side: 1 };
  }
  if (path.kind === 'strokes') {
    let side, u;
    if (path.sides === 0) [side, u] = [1, s];
    else [side, u] = sidesSplit(path, s);
    const K = path.K;
    const k = Math.min(K - 1, Math.floor(u * K));
    const f = cl(u * K - k, 0, 1);
    let phi = lerp(path.pa, path.pb, (k + 0.5) / K);
    if (path.sides === 0) side = phi >= 0 ? 1 : -1;
    else phi *= side;
    const y0 = path.floor ? path.floor[k] : path.y0;
    const y = path.up ? lerp(y0, path.y1, f) : lerp(path.y1, y0, f);
    const sf = surfaceAt(phi, y);
    const stroke = path.sides === 2 && side < 0 ? K + k : k;
    return { pos: sf.pos, normal: sf.normal, dir: [0, path.up ? 1 : -1, 0], stroke, strokeT: f, side };
  }
  if (path.kind === 'rows') {
    const K = path.K;
    const k = Math.min(K - 1, Math.floor(s * K));
    let f = cl(s * K - k, 0, 1);
    if (k & 1) f = 1 - f;
    const alpha = lerp(path.aA, path.aB, (k + 0.5) / K);
    const beta = path.bMax * (1 - 2 * f);
    const sf = surfaceDir(alpha, beta);
    return { pos: sf.pos, normal: sf.normal, dir: [k & 1 ? 1 : -1, 0, 0], stroke: k, strokeT: k & 1 ? 1 - f : f, side: beta >= 0 ? 1 : -1 };
  }
  // contour
  const [side, u] = path.sides === 0 ? [1, s] : sidesSplit(path, s);
  const { pts, cum } = path;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < u) i++;
  // skip zero-length pen-up segments
  const a = pts[i - 1], b = pts[i];
  const span = cum[i] - cum[i - 1];
  const f = span > 1e-9 ? cl((u - cum[i - 1]) / span, 0, 1) : 1;
  const phi = lerp(a[0], b[0], f) * side;
  const y = lerp(a[1], b[1], f);
  const sf = surfaceAt(phi, y);
  const stroke = b[2] + (side < 0 && path.sides === 2 ? 10 : 0);
  // strokeT: progress inside the current stroke
  let s0 = 0, s1 = 1;
  for (let j = 1; j < pts.length; j++) {
    if (pts[j][2] !== pts[j - 1][2]) {
      if (cum[j] <= u) s0 = cum[j];
      else { s1 = cum[j]; break; }
    }
  }
  return { pos: sf.pos, normal: sf.normal, dir: [0, -1, 0], stroke, strokeT: cl((u - s0) / Math.max(s1 - s0, 1e-6), 0, 1), side };
}

// Sweep coordinate of a vertex for a path (the inverse of pathPoint).
function sweepOf(path, G, k) {
  const x = G.pos[k * 3], y = G.pos[k * 3 + 1];
  if (path.kind === 'none') return 0;
  if (path.kind === 'strokes') {
    const side = x >= 0 ? 1 : -1;
    const ph = path.sides === 0 ? G.phi[k] : Math.abs(G.phi[k]);
    const K = path.K;
    const k0 = cl(Math.floor(((ph - path.pa) / (path.pb - path.pa)) * K), 0, K - 1);
    const y0 = path.floor ? path.floor[k0] : path.y0;
    const f = cl((path.up ? y - y0 : path.y1 - y) / (path.y1 - y0), 0, 1);
    const u = (k0 + f) / K;
    if (path.sides === 2) return side > 0 ? u * 0.5 : 0.5 + u * 0.5;
    return u;
  }
  if (path.kind === 'rows') {
    const K = path.K;
    const k0 = cl(Math.floor(((G.alpha[k] - path.aA) / (path.aB - path.aA)) * K), 0, K - 1);
    let f = cl((path.bMax - G.beta[k]) / (2 * path.bMax), 0, 1);
    if (k0 & 1) f = 1 - f;
    return (k0 + f) / K;
  }
  // contour: nearest point on the polyline in (phi*0.75, y)
  const side = x >= 0 ? 1 : -1;
  const ph = Math.abs(G.phi[k]);
  const { pts, cum } = path;
  let best = 1e9, bu = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][2] !== pts[i - 1][2]) continue;
    const ax = pts[i - 1][0] * 0.75, ay = pts[i - 1][1];
    const bx = pts[i][0] * 0.75 - ax, by = pts[i][1] - ay;
    const px = ph * 0.75 - ax, py = y - ay;
    const L2 = bx * bx + by * by || 1e-9;
    const f = cl((px * bx + py * by) / L2, 0, 1);
    const d = (px - bx * f) ** 2 + (py - by * f) ** 2;
    if (d < best) {
      best = d;
      bu = lerp(cum[i - 1], cum[i], f);
    }
  }
  if (path.sides === 2) return side > 0 ? bu * 0.5 : 0.5 + bu * 0.5;
  return bu;
}

// ------------------------------------------------------------------ engine geometry

function hash1(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * Engine inputs for the shell vertices: {pos, nrm (n*3), hm, bm (n), edge (n*2, signed,
 * + inside: hair, beard), top, front, noise (n), flows (n*9: crown, back, down)}.
 * Adds the derived per-vertex data (angles, zone weights, mirror map, contours) once.
 */
export function engineGeometry(input) {
  if (input.ready) return input;
  const G = { ...input };
  const n = (G.n = G.pos.length / 3);
  G.phi = new Float32Array(n);
  G.alpha = new Float32Array(n);
  G.beta = new Float32Array(n);
  G.rnd = new Float32Array(n);
  const Z = {};
  for (const z of [...HAIR_ZONES, ...BEARD_ZONES]) Z[z] = new Float32Array(n);
  const P = HEAD_POINTS;
  const st = P.stomion[1], mc = P.mouth_corner[0];
  for (let k = 0; k < n; k++) {
    const x = G.pos[k * 3], y = G.pos[k * 3 + 1], z = G.pos[k * 3 + 2];
    const ny = G.nrm[k * 3 + 1];
    const phi = phiOf(x, z), ap = Math.abs(phi);
    G.phi[k] = phi;
    G.alpha[k] = alphaOf(y, z);
    G.beta[k] = betaOf(x, y, z);
    G.rnd[k] = hash1(x * 91.7, y * 91.7, z * 91.7);
    // the masks fade over the zone edge for shading; a tool takes every strand there is
    const hm = sm(0.0, 0.03, G.hm[k]), bm = sm(0.0, 0.03, G.bm[k]), top = G.top[k];
    const keepTop = 1 - sm(0.8, 0.97, top);
    const notFront = sm(0.2 * PI, 0.3 * PI, ap);
    Z.sidesNape[k] = hm * keepTop * notFront;
    Z.sides[k] = Z.sidesNape[k] * (1 - sm(0.8 * PI, 0.92 * PI, ap));
    Z.nape[k] = hm * keepTop * sm(0.6 * PI, 0.72 * PI, ap);
    Z.top[k] = hm * top;
    Z.fringe[k] = hm * sm(0.55, 0.85, G.front[k]) * (1 - sm(0.2 * PI, 0.3 * PI, ap));
    Z.crown[k] = hm * top * (1 - sm(0.2, 0.5, G.front[k]));
    Z.contour[k] = hm * (1 - sm(0.02, 0.12, G.edge[k * 2]));
    const stache = sm(st + 0.02, st + 0.07, y) * sm(0.6, 0.7, z) * (1 - sm(mc - 0.03, mc + 0.05, Math.abs(x)));
    const neck = Math.max(sm(-0.3, -0.65, ny), sm(-0.98, -1.1, y));
    const chin = (1 - neck) * (1 - stache) * (1 - sm(0.12 * PI, 0.22 * PI, ap)) * sm(-0.62, -0.74, y);
    Z.moustache[k] = bm * stache;
    Z.neck[k] = bm * neck * (1 - stache);
    Z.chin[k] = bm * chin;
    Z.cheeks[k] = bm * (1 - neck) * (1 - stache) * (1 - chin);
    Z.beard[k] = bm;
  }
  G.zone = Z;
  // mirror vertex (x -> -x) for "Igual en el otro lado"
  G.mirror = mirrorMap(G.pos, n);
  // measured outlines (+x side, |phi|): the lower hairline and the beard's cheek line
  G.hairline = measureLine(G, (k) => G.hm[k] > 0.3 && G.edge[k * 2] > -0.006 && G.edge[k * 2] < 0.03, 0.22 * PI, PI, 30, Math.min) || DEFAULT_HAIR_CONTOUR;
  G.cheek = measureLine(G, (k) => G.bm[k] > 0.3 && G.edge[k * 2 + 1] > -0.006 && G.edge[k * 2 + 1] < 0.03 && G.pos[k * 3 + 1] > -0.72, 0.1 * PI, 0.46 * PI, 10, Math.max, true) || DEFAULT_CHEEK;
  // zone extents for the rows (alpha range and half width, 5-95 %)
  G.rows = {};
  for (const zn of ['top', 'fringe', 'crown']) {
    const al = [], be = [];
    for (let k = 0; k < n; k++) if (Z[zn][k] > 0.5) { al.push(G.alpha[k]); be.push(Math.abs(G.beta[k])); }
    if (al.length < 20) continue;
    al.sort((a, b) => a - b);
    be.sort((a, b) => a - b);
    G.rows[zn] = [al[Math.floor(al.length * 0.03)], al[Math.floor(al.length * 0.97)], be[Math.floor(be.length * 0.95)]];
  }
  G.ready = true;
  return G;
}

function mirrorMap(pos, n) {
  const cell = 0.03;
  const grid = new Map();
  const key = (i, j, k) => `${i},${j},${k}`;
  for (let v = 0; v < n; v++) {
    const kk = key(Math.floor(pos[v * 3] / cell), Math.floor(pos[v * 3 + 1] / cell), Math.floor(pos[v * 3 + 2] / cell));
    let b = grid.get(kk);
    if (!b) grid.set(kk, (b = []));
    b.push(v);
  }
  const out = new Int32Array(n);
  for (let v = 0; v < n; v++) {
    const x = -pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell), ck = Math.floor(z / cell);
    let best = 1e9, bi = v;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
      const b = grid.get(key(ci + di, cj + dj, ck + dk));
      if (!b) continue;
      for (const u of b) {
        const d = (pos[u * 3] - x) ** 2 + (pos[u * 3 + 1] - y) ** 2 + (pos[u * 3 + 2] - z) ** 2;
        if (d < best) { best = d; bi = u; }
      }
    }
    out[v] = bi;
  }
  return out;
}

// One y per |phi| bin (lowest or highest of the selected vertices), gaps filled, smoothed.
function measureLine(G, pick, p0, p1, bins, fn, reverse) {
  const ys = new Array(bins).fill(null);
  for (let k = 0; k < G.n; k++) {
    if (!pick(k)) continue;
    const ap = Math.abs(G.phi[k]);
    if (ap < p0 || ap > p1) continue;
    // surfaces facing out from the axis only (no radius-grid lookup here: the worker
    // build stays free of the head asset)
    const y = G.pos[k * 3 + 1];
    const x = G.pos[k * 3], dz = G.pos[k * 3 + 2] - AXIS_Z;
    if ((G.nrm[k * 3] * x + G.nrm[k * 3 + 2] * dz) / (Math.hypot(x, dz) || 1) < 0.35) continue;
    const b = Math.min(bins - 1, Math.floor(((ap - p0) / (p1 - p0)) * bins));
    ys[b] = ys[b] === null ? y : fn(ys[b], y);
  }
  const got = ys.filter((v) => v !== null).length;
  if (got < bins * 0.5) return null;
  for (let i = 0; i < bins; i++) {
    if (ys[i] !== null) continue;
    let a = i - 1, b = i + 1;
    while (a >= 0 && ys[a] === null) a--;
    while (b < bins && ys[b] === null) b++;
    ys[i] = a < 0 ? ys[b] : b >= bins ? ys[a] : lerp(ys[a], ys[b], (i - a) / (b - a));
  }
  let sy = ys;
  for (let pass = 0; pass < 2; pass++) sy = sy.map((v, i) => (sy[Math.max(0, i - 1)] + 2 * v + sy[Math.min(bins - 1, i + 1)]) / 4);
  const pts = sy.map((y, i) => [p0 + ((i + 0.5) / bins) * (p1 - p0), y]);
  return reverse ? pts.reverse() : pts;
}

// ------------------------------------------------------------------ state

// state: {a: Float32Array(n*5) [hair mm, beard mm, lift, foam, line], c: comb (n*3), shine, bshine}
const CH = 5;

function tangentDir(G, k, v, out, o) {
  const nx = G.nrm[k * 3], ny = G.nrm[k * 3 + 1], nz = G.nrm[k * 3 + 2];
  let cx = v[0], cy = v[1], cz = v[2];
  const dn = cx * nx + cy * ny + cz * nz;
  cx -= nx * dn; cy -= ny * dn; cz -= nz * dn;
  let l = Math.hypot(cx, cy, cz);
  if (l < 1e-4) {
    cx = nx * ny; cy = ny * ny - 1; cz = nz * ny;
    l = Math.hypot(cx, cy, cz) || 1;
  }
  out[o] = cx / l;
  out[o + 1] = cy / l;
  out[o + 2] = cz / l;
}

// comb flows: blend of the down flow (sides) and a top flow, with a sideways sweep
function combFor(G, k, style, out, o) {
  const f = G.flows, t = G.top[k];
  const sideSign = cl(G.pos[k * 3] * 4, -1, 1);
  let src = 0, sx = 0; // 0 crown flow, 3 swept back
  if (style === 'overgrown') sx = 0.6 * (G.noise[k] - 0.5);
  else if (style === 'natural') sx = 0.3 * (G.noise[k] - 0.5);
  else if (style === 'forward') sx = 0;
  else if (style === 'up' || style === 'back') src = 3;
  else sx = 0.25 * sideSign * t; // side
  const v = [
    lerp(f[k * 9 + 6], f[k * 9 + src], t) + sx,
    lerp(f[k * 9 + 7], f[k * 9 + src + 1], t),
    lerp(f[k * 9 + 8], f[k * 9 + src + 2], t),
  ];
  tangentDir(G, k, v, out, o);
}

/** The overgrown head: long, uncombed hair and an untidy beard. */
export function overgrownState(Gin) {
  const G = engineGeometry(Gin);
  const n = G.n;
  const a = new Float32Array(n * CH);
  const c = new Float32Array(n * 3);
  const P = HEAD_POINTS;
  const O = OVERGROWN;
  for (let k = 0; k < n; k++) {
    const y = G.pos[k * 3 + 1], z = G.pos[k * 3 + 2];
    const top = G.top[k], fr = G.front[k], nz = G.noise[k];
    const chin = sm(P.lip_lower[1], P.pogonion[1], y) * sm(0.15, 0.5, z);
    a[k * CH] = G.hm[k] > 0.02 ? lerp(O.sides, lerp(O.top, O.front, fr), top) + 8 * (nz - 0.5) : 0;
    // the lower hairline (sideburns, round the ear, nape) grows finer and shorter
    a[k * CH] *= lerp(lerp(0.35, 1, sm(0, 0.12, G.edge[k * 2])), 1, sm(LANDMARKS.OREJA - 0.1, LANDMARKS.OREJA + 0.1, y));
    a[k * CH + 1] = G.bm[k] > 0.02 ? O.beard + (O.chin - O.beard) * chin + 2 * nz : 0;
    // grown out: the top puffs up and goes its own way, the sides stand off a little
    a[k * CH + 2] = G.hm[k] > 0.02 ? lerp(0.12, 0.22 + 0.18 * nz, top) : 0;
    combFor(G, k, 'overgrown', c, k * 3);
  }
  return { a, c, shine: 0, bshine: 0 };
}

const cloneState = (s, comb = false) => ({ a: s.a.slice(), c: comb ? s.c.slice() : s.c, shine: s.shine, bshine: s.bshine });

function slerpInto(a, ao, b, bo, nrm, no, t, out, o) {
  const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], bx = b[bo], by = b[bo + 1], bz = b[bo + 2];
  const nx = nrm[no], ny = nrm[no + 1], nz = nrm[no + 2];
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  const ang = Math.atan2(cx * nx + cy * ny + cz * nz, ax * bx + ay * by + az * bz) * t;
  const c = Math.cos(ang), s = Math.sin(ang);
  out[o] = ax * c + (ny * az - nz * ay) * s;
  out[o + 1] = ay * c + (nz * ax - nx * az) * s;
  out[o + 2] = az * c + (nx * ay - ny * ax) * s;
}

// ------------------------------------------------------------------ ops

function stepHeight(G, k, step, spec) {
  const y = G.pos[k * 3 + 1];
  const shape = spec && spec.sides && spec.sides.shape;
  if (shape === 'burst' && !isBeardStep(step)) {
    // heights are radii round the ear: OREJA is the arc just round it
    const P = HEAD_POINTS;
    const x = Math.abs(G.pos[k * 3]), z = G.pos[k * 3 + 2];
    const cx = (P.ear_top[0] + P.ear_bottom[0]) / 2, cy = (P.ear_top[1] + P.ear_bottom[1]) / 2, cz = (P.ear_front[2] + P.ear_back[2]) / 2;
    const r = Math.hypot(x - cx, (y - cy) * 0.8, z - cz);
    return LANDMARKS.OREJA + Math.max(0, r - 0.3);
  }
  const lm = step.upTo && step.upTo.lm;
  if (shape === 'taper' && lm === 'NUCA') return LANDMARKS.NUCA + Math.max(0, G.edge[k * 2]);
  return y;
}

function lengthTarget(lengthMM, G, k) {
  if (Array.isArray(lengthMM)) return lerp(lengthMM[1], lengthMM[0], sm(-0.5, 0.6, G.pos[k * 3 + 2]));
  return lengthMM;
}

/**
 * Computes the states of a program. opts: {guards, start (state), resetParts}.
 * Returns {states, info[]} where info[i] = {path, sweep: Float32Array(n), changed, cdf,
 * foamIn, pend (pending foam mask or null)} for step i (states[i] -> states[i+1]).
 */
export function computeProgram(Gin, program, { guards = {}, start = null, resetParts = null } = {}) {
  const G = engineGeometry(Gin);
  const n = G.n;
  const Z = G.zone;
  const spec = program.spec || {};
  const top = spec.top || {};
  const og = overgrownState(G);
  let cur = start ? cloneState(start, true) : cloneState(og, true);
  if (start && resetParts && resetParts.length) cur = resetState(G, cur, og, resetParts);
  const states = [cur];
  const info = [];
  const steps = program.steps || [];
  const otherAt = steps.findIndex((s) => s.op === 'otherSide');
  const touched = new Uint8Array(n);
  let touchedTop = LANDMARKS.ESQUINA;
  const gmm = (id) => (id == null ? null : guards[id] ?? null);
  const styleName = top.fringe || 'side';
  const styleComb = new Float32Array(3);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const beard = isBeardStep(step);
    const oneSided = step.part === 'laterales' && otherAt > i && step.op !== 'otherSide' && !beard;
    const path = stepPath(step, { oneSided, hairline: G.hairline, cheek: G.cheek, rows: G.rows, otherTop: touchedTop + FLICK });
    const combOps = ['scissorOverComb', 'clipperOverComb', 'scissor', 'dryer', 'product', 'part', 'comb'];
    const next = cloneState(cur, combOps.includes(step.op));
    const A = next.a, C = next.c, A0 = cur.a;
    const zw = Z[step.zone] || null;
    const ch = beard ? 1 : 0; // length channel
    // one side first: the +x side and the midline (otherSide copies onto the -x side)
    const side = (k) => (oneSided ? sm(-0.008, -0.002, G.pos[k * 3]) : 1);
    const yUp = step.upTo ? heightY(step.upTo) : Infinity;
    const yFrom = step.from ? heightY(step.from) : -Infinity;
    const win = (k) => {
      const Y = stepHeight(G, k, step, spec);
      let w = Y <= yUp ? 1 : 1 - sm(yUp, yUp + FLICK, Y);
      if (yFrom > -Infinity) w *= sm(yFrom - 0.012, yFrom + 0.012, Y);
      return w;
    };
    let foamIn = false, pend = null;
    const liftStyle = (k) => (top.lift || 0) * G.top[k] * (styleName === 'up' ? lerp(0.35, 1, G.front[k]) : 1);
    const groom = (k, w, liftK) => {
      if (w <= 0) return;
      combFor(G, k, styleName, styleComb, 0);
      slerpInto(C, k * 3, styleComb, 0, G.nrm, k * 3, w, C, k * 3);
      A[k * CH + 2] = lerp(A[k * CH + 2], liftStyle(k) * liftK, w);
    };

    switch (step.op) {
      case 'clipper': {
        const g = gmm(step.guard) ?? 3;
        for (let k = 0; k < n; k++) {
          const w = (zw ? zw[k] : 0) * side(k) * win(k);
          if (w <= 1e-3) continue;
          const L = A0[k * CH + ch];
          A[k * CH + ch] = lerp(L, Math.min(L, g), w);
          if (!beard) A[k * CH + 2] *= 1 - w;
          // where the sideburn overlaps the beard zone the same pass takes both
          else if (A0[k * CH] > 0) A[k * CH] = lerp(A0[k * CH], Math.min(A0[k * CH], g), w * sm(0.3, 0.8, G.bm[k]));
        }
        break;
      }
      case 'blend':
        blendOp(G, A0, A, ch, zw, side, win, yUp, gmm(step.guard));
        break;
      case 'otherSide':
        for (let k = 0; k < n; k++) {
          if (G.pos[k * 3] >= -0.002) continue;
          const m = G.mirror[k];
          if (!touched[m]) continue;
          const w = sm(-0.002, -0.008, G.pos[k * 3]);
          A[k * CH] = lerp(A0[k * CH], Math.min(A0[k * CH], A0[m * CH]), w);
          for (const c of [2, 4]) A[k * CH + c] = lerp(A0[k * CH + c], A0[m * CH + c], w);
        }
        break;
      case 'scissorOverComb':
      case 'clipperOverComb':
      case 'scissor': {
        const g = step.op === 'clipperOverComb' && step.lengthMM == null ? gmm(step.guard) : null;
        const topZone = step.zone === 'top' || step.zone === 'crown' || step.zone === 'fringe';
        for (let k = 0; k < n; k++) {
          const w = (zw ? zw[k] : 0) * side(k) * (step.upTo || step.from ? win(k) : 1);
          if (w <= 1e-3) continue;
          const T = g ?? (step.lengthMM != null ? lengthTarget(step.lengthMM, G, k) : A0[k * CH + ch]);
          const L = A0[k * CH + ch];
          A[k * CH + ch] = lerp(L, Math.min(L, T), w);
          if (topZone && !beard) groom(k, w * 0.85, 0.6);
        }
        break;
      }
      case 'pointCut':
      case 'thinning': {
        const point = step.op === 'pointCut';
        for (let k = 0; k < n; k++) {
          const w = zw ? zw[k] : 0;
          if (w <= 1e-3) continue;
          const r = G.rnd[k];
          A[k * CH + ch] = A0[k * CH + ch] * (1 - w * (point ? 0.06 + 0.16 * r : 0.04 + 0.08 * r));
          A[k * CH + 2] = point ? A0[k * CH + 2] + w * 0.12 * (top.texture ?? 0.5) : A0[k * CH + 2] * (1 - 0.35 * w);
        }
        break;
      }
      case 'part': {
        const ps = (top.part && top.part.side === 'right') ? -1 : 1;
        const xp = ps * 0.24;
        for (let k = 0; k < n; k++) {
          const w = Z.top[k];
          if (w <= 1e-3 || G.pos[k * 3 + 2] < -0.5) continue;
          const dx = G.pos[k * 3] - xp;
          const cut = 1 - sm(0.006, 0.012, Math.abs(dx));
          A[k * CH] = A0[k * CH] * (1 - cut * w);
          A[k * CH + 4] = Math.max(A0[k * CH + 4], cut * w);
          // comb away from the part on each side
          const away = [Math.sign(dx) || 1, -0.2, 0.15];
          tangentDir(G, k, away, styleComb, 0);
          slerpInto(C, k * 3, styleComb, 0, G.nrm, k * 3, w * sm(0.0, 0.25, Math.abs(dx)) * 0.8, C, k * 3);
        }
        break;
      }
      case 'trimmer':
      case 'razor': {
        const razor = step.op === 'razor';
        if (beard) {
          const all = !step.upTo && step.zone !== 'contour' && step.op === 'razor';
          if (all) {
            // shave: everything in the zone goes
            for (let k = 0; k < n; k++) {
              const w = zw ? zw[k] : 0;
              if (w <= 1e-3) continue;
              A[k * CH + 1] = A0[k * CH + 1] * (1 - w);
              // the sideburn stops where the shader starts to treat the strip as beard (crisp
              // beard line): left there it would print as thin dashes under the sideburn
              A[k * CH] = A0[k * CH] * (1 - w * Math.max(sm(0.3, 0.8, G.bm[k]), sm(0.25, 0.4, G.bm[k] / (G.bm[k] + G.hm[k] + 1e-3))));
              A[k * CH + 3] = A0[k * CH + 3] * (1 - w);
              A[k * CH + 4] = lerp(A0[k * CH + 4], 1, w);
            }
          } else {
            // line-up: neckline at upTo, cheek line cleaned (perfilada), edges crisp
            const neckY = step.upTo ? heightY(step.upTo) : LANDMARKS.NUEZ + 2 * DEDO;
            const cheekClean = spec.beard ? spec.beard.cheek === 'perfilada' : true;
            for (let k = 0; k < n; k++) {
              if (G.bm[k] <= 0.02) continue;
              const y = G.pos[k * 3 + 1];
              // the neckline runs from above the Adam's apple back up to behind the jaw angle,
              // under the earlobe (a level line would leave a block of beard down the neck)
              const lim = neckY + Math.min(0.5, Math.max(0, 1.4 * (0.24 - G.pos[k * 3 + 2])));
              let cut = 1 - sm(lim - 0.008, lim + 0.008, y);
              // the cheek line only, not where the beard meets the sideburn
              if (cheekClean && y > -0.72 && y < LANDMARKS.PATILLA - 0.5 * DEDO && G.hm[k] < 0.01) {
                cut = Math.max(cut, (1 - sm(0.024, 0.034, G.edge[k * 2 + 1])) * (1 - Z.moustache[k] / Math.max(Z.beard[k], 1e-3)));
              }
              if (step.op === 'trimmer') cut = 0;
              A[k * CH + 1] = A0[k * CH + 1] * (1 - cut);
              A[k * CH + 4] = lerp(A0[k * CH + 4], 1, G.bm[k]);
              if (razor) A[k * CH + 3] = 0;
            }
          }
        } else {
          // hair line-up: crisp edge, the fuzz just outside the line removed, nape shape
          const nape = spec.nape && spec.nape.shape;
          const yN = LANDMARKS.NUCA + 0.35 * DEDO;
          for (let k = 0; k < n; k++) {
            const w = (G.hm[k] > 0.0 ? sm(0.0, 0.03, G.hm[k]) : 0) * side(k);
            if (w <= 1e-3) continue;
            const e = G.edge[k * 2];
            let cut = 1 - sm(0.003, 0.009, e);
            if ((nape === 'square' || nape === 'round') && Z.nape[k] > 0.05) {
              const x = Math.abs(G.pos[k * 3]);
              const lim = nape === 'square' ? yN : yN + 0.12 * (x / 0.35) ** 2;
              cut = Math.max(cut, Z.nape[k] * (1 - sm(lim - 0.006, lim + 0.006, G.pos[k * 3 + 1])));
            }
            A[k * CH] = A0[k * CH] * (1 - cut * w);
            A[k * CH + 4] = lerp(A0[k * CH + 4], 1, w);
            if (razor) A[k * CH + 3] = 0;
          }
        }
        if (razor) {
          // foam goes on just before the blade when no lather step put it there: over the
          // whole zone for a shave, along the line for a line-up
          const shave = beard && !step.upTo && step.zone !== 'contour';
          let had = 0, need = 0;
          pend = new Float32Array(n);
          const band = new Float32Array(n);
          for (let k = 0; k < n; k++) {
            const d = Math.abs(A[k * CH + ch] - A0[k * CH + ch]);
            band[k] = shave ? (zw ? zw[k] : 0) : d > 0.05 ? 1 : 0;
          }
          // widen the line a little (lather is brushed on wider than the blade cuts)
          for (let pass = 0; pass < (shave ? 0 : 2); pass++) {
            for (let k = 0; k < n; k++) {
              if (band[k] > 0.5) continue;
              const r = G.rnd[k];
              const y = G.pos[k * 3 + 1];
              if (beard && G.bm[k] > 0.02 && (G.edge[k * 2 + 1] < 0.045 + 0.01 * r || y < (step.upTo ? heightY(step.upTo) : -1.15) + 0.04)) band[k] = 0.6;
              if (!beard && Z.contour[k] > 0.5 + 0.2 * r) band[k] = 0.6;
            }
          }
          for (let k = 0; k < n; k++) {
            const w = band[k] > 0.5 ? 1 : 0;
            if (w > 0) need++;
            if (A0[k * CH + 3] > 0.5) had++;
            pend[k] = w;
            A[k * CH + 3] *= 1 - w;
          }
          if (had > need * 0.5 || !need) pend = null;
          else foamIn = true;
        }
        break;
      }
      case 'lather': {
        const contour = step.zone === 'contour';
        const neckY = LANDMARKS.NUEZ + 2 * DEDO;
        for (let k = 0; k < n; k++) {
          let w = contour ? G.bm[k] * Math.max(1 - sm(0.03, 0.06, G.edge[k * 2 + 1]), 1 - sm(neckY + 0.03, neckY + 0.1, G.pos[k * 3 + 1])) : zw ? zw[k] : 0;
          if (contour) w *= 1 - Z.moustache[k] / Math.max(G.bm[k], 1e-3);
          if (w <= 1e-3) continue;
          A[k * CH + 3] = lerp(A0[k * CH + 3], 1, w);
        }
        break;
      }
      case 'dryer':
      case 'product':
      case 'comb': {
        if (beard) {
          if (step.op === 'product') next.bshine = 0.5;
          break;
        }
        const liftK = step.op === 'comb' ? 0.3 : step.op === 'dryer' ? 1 : 0.9;
        for (let k = 0; k < n; k++) {
          const w = zw ? zw[k] : 0;
          if (w <= 1e-3) continue;
          if (step.op === 'comb') {
            combFor(G, k, 'natural', styleComb, 0);
            slerpInto(C, k * 3, styleComb, 0, G.nrm, k * 3, w * 0.6, C, k * 3);
            A[k * CH + 2] = A0[k * CH + 2] * (1 - 0.5 * w);
          } else groom(k, w, liftK);
        }
        if (step.op === 'product') next.shine = Math.max(cur.shine, top.shine ?? 0.2);
        break;
      }
      default:
        break;
    }

    // what changed, and where along the sweep
    const sweep = new Float32Array(n);
    const hist = new Float32Array(32);
    let changed = 0;
    for (let k = 0; k < n; k++) {
      let d = 0;
      for (let c = 0; c < CH; c++) d += Math.abs(A[k * CH + c] - A0[k * CH + c]);
      if (next.c !== cur.c) d += Math.abs(next.c[k * 3] - cur.c[k * 3]) + Math.abs(next.c[k * 3 + 1] - cur.c[k * 3 + 1]) + Math.abs(next.c[k * 3 + 2] - cur.c[k * 3 + 2]);
      const s = sweepOf(path, G, k);
      sweep[k] = s;
      if (d > 0.02 || (pend && pend[k] > 0)) {
        changed++;
        hist[Math.min(31, Math.floor(cl(s, 0, 0.9999) * 32))]++;
        if (oneSided) {
          touched[k] = 1;
          if (G.pos[k * 3 + 1] > touchedTop) touchedTop = G.pos[k * 3 + 1];
        }
      }
    }
    const cdf = new Float32Array(33);
    for (let b = 0; b < 32; b++) cdf[b + 1] = cdf[b] + hist[b] / Math.max(changed, 1);
    info.push({ path, sweep, changed, cdf, foamIn, pend, shine: [cur.shine, next.shine], bshine: [cur.bshine, next.bshine] });
    states.push(next);
    cur = next;
  }
  return { states, info };
}

function blendOp(G, A0, A, ch, zw, side, win, yUp, guard) {
  const n = G.n;
  // (signed phi, y) grid: average length, blurred along y, never longer than what is there
  const NP = 48, Y0 = -1.6, DY = 0.02, NY = 145;
  const sum = new Float32Array(NP * NY), wt = new Float32Array(NP * NY);
  const yTop = yUp === Infinity ? 1.2 : yUp + 3 * FLICK;
  const cell = (k) => {
    const pf = ((G.phi[k] + PI) / (2 * PI)) * NP - 0.5;
    const yf = (G.pos[k * 3 + 1] - Y0) / DY;
    return [pf, yf];
  };
  for (let k = 0; k < n; k++) {
    const w = zw ? zw[k] : 0;
    if (w < 0.3 || G.pos[k * 3 + 1] > yTop) continue;
    const [pf, yf] = cell(k);
    const i = ((Math.round(pf) % NP) + NP) % NP, j = cl(Math.round(yf), 0, NY - 1);
    sum[j * NP + i] += w * A0[k * CH + ch];
    wt[j * NP + i] += w;
  }
  // blur: y gaussian (sigma ~ 0.07), phi 1-2-1
  const R = 8, sig = 3.5;
  const ker = Array.from({ length: 2 * R + 1 }, (_, i) => Math.exp(-((i - R) ** 2) / (2 * sig * sig)));
  const bs = new Float32Array(NP * NY), bw = new Float32Array(NP * NY);
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NP; i++) {
      let s = 0, w = 0;
      for (let d = -R; d <= R; d++) {
        const jj = j + d;
        if (jj < 0 || jj >= NY) continue;
        for (let e = -1; e <= 1; e++) {
          const ii = (i + e + NP) % NP;
          const kw = ker[d + R] * (e === 0 ? 2 : 1);
          s += sum[jj * NP + ii] * kw;
          w += wt[jj * NP + ii] * kw;
        }
      }
      bs[j * NP + i] = s;
      bw[j * NP + i] = w;
    }
  }
  const sample = (pf, yf) => {
    const i0 = Math.floor(pf), j0 = cl(Math.floor(yf), 0, NY - 2);
    const u = pf - i0, v = cl(yf - j0, 0, 1);
    let s = 0, w = 0;
    for (const [di, dj, kw] of [[0, 0, (1 - u) * (1 - v)], [1, 0, u * (1 - v)], [0, 1, (1 - u) * v], [1, 1, u * v]]) {
      const ii = (((i0 + di) % NP) + NP) % NP;
      s += bs[(j0 + dj) * NP + ii] * kw;
      w += bw[(j0 + dj) * NP + ii] * kw;
    }
    return w > 1e-4 ? s / w : null;
  };
  for (let k = 0; k < n; k++) {
    const w = (zw ? zw[k] : 0) * side(k) * win(k);
    if (w <= 1e-3) continue;
    const [pf, yf] = cell(k);
    const b = sample(pf, yf);
    if (b === null) continue;
    const L = A0[k * CH + ch];
    const t = guard != null ? Math.max(b, Math.min(L, guard)) : b;
    A[k * CH + ch] = lerp(L, Math.min(L, t), w);
  }
}

// Parts back to the overgrown state (Compón: a changed ingredient is cut again from long hair).
function resetState(G, s, og, parts) {
  const A = s.a, O = og.a;
  const has = (p) => parts.includes(p);
  for (let k = 0; k < G.n; k++) {
    const t = G.top[k];
    const wh = (has('laterales') ? 1 - t : 0) + (has('arriba') ? t : 0);
    if (wh > 0) {
      A[k * CH] = lerp(A[k * CH], O[k * CH], wh);
      A[k * CH + 4] = lerp(A[k * CH + 4], 0, wh);
      if (has('arriba')) A[k * CH + 2] = lerp(A[k * CH + 2], 0, t);
    }
    if (has('barba')) {
      A[k * CH + 1] = O[k * CH + 1];
      A[k * CH + 3] = 0;
      if (G.bm[k] > G.hm[k]) A[k * CH + 4] = 0;
    }
    if (has('arriba') || has('acabado')) {
      const w = has('arriba') ? t : t * 0.8;
      slerpInto(s.c, k * 3, og.c, k * 3, G.nrm, k * 3, w, s.c, k * 3);
      if (has('acabado')) A[k * CH + 2] *= 1 - t;
    }
  }
  if (has('acabado') || has('arriba')) s.shine = 0;
  if (has('barba')) s.bshine = 0;
  return s;
}

/** State shown at sweep front f of step info (per-vertex interpolation, comb slerped). */
export function stateAt(G, s0, s1, inf, f) {
  const n = G.pos.length / 3;
  const out = cloneState(s0, true);
  const w = inf.path.w || 0.06;
  for (let k = 0; k < n; k++) {
    const t = cl((f - inf.sweep[k]) / w + 0.5, 0, 1);
    if (t <= 0) continue;
    for (let c = 0; c < CH; c++) out.a[k * CH + c] = lerp(s0.a[k * CH + c], s1.a[k * CH + c], t);
    if (s0.c !== s1.c) slerpInto(s0.c, k * 3, s1.c, k * 3, G.nrm, k * 3, t, out.c, k * 3);
  }
  const tt = cl(f, 0, 1);
  out.shine = lerp(s0.shine, s1.shine, tt);
  out.bshine = lerp(s0.bshine, s1.bshine, tt);
  return out;
}

/**
 * GPU arrays of a state: vec4 per vertex [drawn length (head units), lift, foam, line-up]
 * plus the comb. The hairline thins and shortens the outermost strands; beard lines are
 * kept to the measured edge.
 */
export function gpuOf(G, s, pend = null) {
  const n = G.pos.length / 3;
  const out = new Float32Array(n * 4);
  for (let k = 0; k < n; k++) {
    const H = s.a[k * CH], B = s.a[k * CH + 1];
    const eH = G.edge[k * 2], eB = G.edge[k * 2 + 1];
    // hair blown up and set (tupé, pompadour) keeps more of its real length: it stands, it does not lie
    const lift = s.a[k * CH + 2];
    // a fringe combed forward over the front hairline keeps its length to the edge
    const fwd = s.c[k * 3 + 1] * -0.45 + s.c[k * 3 + 2] * 0.89;
    const fringe = sm(0.45, 0.8, fwd) * sm(0.25, 0.45, G.pos[k * 3 + 2]) * sm(0.45, 0.6, G.pos[k * 3 + 1]);
    const lh = G.hm[k] > 0.02 && H > 0 ? lerp(visMM(H), Math.max(visMM(H), 0.36 * H), sm(0.3, 0.9, lift)) * MM * lerp(lerp(0.45, 1, sm(0, 0.09, eH)), 1, fringe) * sm(-0.03, -0.005, eH) : 0;
    // beard edges (cheek line, neckline) carry shorter, finer hair: no block of full-length
    // strands hanging over the line; a lined-up beard keeps a little more length at its edge
    const eTaper = lerp(lerp(0.3, 0.5, s.a[k * CH + 4]), 1, sm(0, 0.07, eB));
    const lb = G.bm[k] > 0.02 && B > 0 ? visMM(B) * MM * sm(-0.004, 0.004, eB) * (B > 4 ? eTaper : 1) : 0;
    out[k * 4] = Math.max(lh, lb);
    out[k * 4 + 1] = lh >= lb ? s.a[k * CH + 2] : 0;
    out[k * 4 + 2] = pend ? Math.max(s.a[k * CH + 3], pend[k]) : s.a[k * CH + 3];
    out[k * 4 + 3] = s.a[k * CH + 4];
  }
  return out;
}
