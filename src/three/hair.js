import * as THREE from 'three';
import { HEAD_POINTS, LANDMARKS, MM, DEDO_MM, computeProgram, engineGeometry, front, gpuOf, isCutOp, stateAt } from './hairField.js';
import { HAIR_VERT, HAIR_FRAG } from './hairShaders.js';

// Hair and beard are drawn as "fur shells": the scalp and jaw of the head mesh
// are copied N times, each copy pushed a little further out along the normal
// and slid along the comb, and a fragment shader carves strands out of every
// layer (hairShaders.js). The length, lift and comb of each strand come from
// per-vertex attributes, so switching haircut is just interpolating between two
// fields, which is what the clipper, scissors and razor animations ride on.
// Hair shorter than ~2 mm is painted on the plaster by head.js (shaved tint).
//
// Two drivers share the shells:
//  - the cut-step engine (prepare/show): a Program from src/cuts/catalog.js is computed
//    step by step (hairField.computeProgram, in the head worker); show(handle, step, t)
//    uploads the state before and after that step and the shader moves the tool front;
//  - the legacy looks (ritual/change/settle), kept for the old stage until it moves over.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

function hash3(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  let out = 0;
  for (let c = 0; c < 8; c++) {
    const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
    const w = (dx ? ux : 1 - ux) * (dy ? uy : 1 - uy) * (dz ? uz : 1 - uz);
    out += w * hash3(ix + dx, iy + dy, iz + dz);
  }
  return out;
}

// ---------------------------------------------------------------- regions
// Hair and beard zones come with the head asset as signed edge distances measured on the
// MakeHuman head (scripts/head/); hairField.js holds the anatomy used below.

const P_ = HEAD_POINTS;
const L_ = LANDMARKS;
// The shells reach down the neck to where an untrimmed beard stops (half a finger above the
// Adam's apple); the legacy looks keep it tidy a finger and a half above it.
const NECKLINE = L_.NUEZ + 0.5 * DEDO_MM * MM;
const NECKLINE_TIDY = L_.NUEZ + 1.5 * DEDO_MM * MM;
const mm = (v) => v * MM;

// The measured beard zone stops just under the nose; the moustache (from under the nose wings
// down to the line of the upper lip, out to the mouth corners) joins it here. Signed, + inside.
const SN = P_.subnasale[1], LU = P_.lip_upper[1], MC = P_.mouth_corner;
function moustacheEdge(x, y, z) {
  const u = Math.min(Math.abs(x) / MC[0], 1.3);
  const lipTop = LU + (MC[1] - LU) * u * u + 0.012;
  // the top follows the nose wings and falls towards the nasolabial fold
  // the top is never a ruled line: it wanders a millimetre or two along the lip
  const wob = 0.008 * (noise3(x * 38, y * 38, z * 38) - 0.5) + 0.006 * (noise3(x * 90 + 3.1, y * 90, z * 90) - 0.5);
  return Math.min(SN - 0.016 - 0.06 * u * u - 0.03 * u * u * u * u + wob - y, y - lipTop, MC[0] + 0.05 - Math.abs(x), z - (MC[2] - 0.12));
}
function beardEdge(eb, x, y, z) {
  return Math.min(Math.max(eb, moustacheEdge(x, y, z)), y - NECKLINE);
}

// ------------------------------------------------------------------ looks
// A look returns [length (head units), comb x, y, z (head frame, projected onto the scalp
// afterwards), lift 0..1]. c: { top 0 sides..1 top, front 0..1 towards the fringe, n noise,
// side: sign of x, y }.

// Comb fields are built from flows without opposed neighbours (a crack in the shells):
// c.crown: away from the crown whorl (forward on top, down at the back);
// c.back: swept back from the forehead, turning down over the occiput;
// c.down: down the slope, slightly back (sides, nape, beard).
const HAIR = {
  before(x, y, z, c) {
    const len = mm(mix(15, 21, c.top) + 4 * c.n);
    return [len, ...blend(c.down, c.crown, c.top, 0.3 * (c.n - 0.5)), 0];
  },
  fade(x, y, z, c) {
    // skin at the nape and above the ear, blended up to the weight line under the parietal ridge
    const sides = mm(6) * smooth(L_.NUCA + 0.08, L_.SIEN + 0.2, y);
    const top = mm(mix(10, 13, c.front));
    return [mix(sides, top, c.top), ...blend(c.down, c.crown, c.top, 0.25 * c.side * c.top), 0];
  },
  quiff(x, y, z, c) {
    const sides = mm(mix(1.5, 5.5, smooth(L_.NUCA, L_.SIEN + 0.2, y)));
    const top = mm(mix(17, 34, c.front));
    // the front is blow-dried up, then everything is swept back
    return [mix(sides, top, c.top), ...blend(c.down, c.back, c.top, 0), 0.85 * c.top * c.front];
  },
  crew(x, y, z, c) {
    const sides = mm(mix(3.5, 6, smooth(L_.NUCA, L_.SIEN + 0.2, y)));
    const top = mm(mix(9.5, 13, c.front));
    return [mix(sides, top, c.top), ...blend(c.down, c.crown, c.top, 0.15 * c.side * c.top), 0];
  },
  buzz(x, y, z, c) {
    return [mm(3), ...blend(c.down, c.crown, c.top, 0), 0];
  },
};

// mix two unit flows, plus a sideways sweep (x)
function blend(a, b, t, sx) {
  return [mix(a[0], b[0], t) + sx, mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

const BEARD = {
  before(x, y, z, c) {
    return [mm(7 + 3.5 * c.chin + 1.5 * c.n), 0.2 * (c.n - 0.5), -1, 0.25, 0];
  },
  none() {
    return [0, 0, -1, 0.25, 0];
  },
  stubble() {
    return [mm(1.2), 0, -1, 0.25, 0];
  },
  short(x, y, z, c) {
    return [mm(3 + 1.6 * c.chin), 0, -1, 0.25, 0];
  },
  full(x, y, z, c) {
    const len = mix(mm(9 + 9 * c.chin), mm(6), c.stache);
    return [len, c.side * 0.6 * c.stache, -1, 0.25, 0];
  },
};

// --------------------------------------------------------------- material

export function hairUniforms({ tier = 'high' } = {}) {
  const fill = { value: new THREE.Vector3(-0.8, 0.25, 0.55).normalize() };
  const fillCol = { value: new THREE.Color('#F0E6D6').multiplyScalar(0.6) };
  return {
    // legacy looks: three zone progresses (sides, top, beard) and their soft front
    uProg: { value: new THREE.Vector3(1, 1, 1) },
    uWidth: { value: 0.18 },
    uLegacy: { value: 1 },
    // cut-step engine: the tool front along the step's sweep, its width, pending foam
    uFront: { value: 1.03 },
    uStepW: { value: 0.06 },
    uFoamIn: { value: 1 },
    uShine: { value: 0 },
    uBShine: { value: 0 },
    // comb lifting a section (scissor over comb) and a tool pressing the hair (guard, comb)
    uLift: { value: new THREE.Vector4(0, 0, 0, 0) },
    uLiftDir: { value: new THREE.Vector3(0, 1, 0) },
    uLiftAmt: { value: 0 },
    uContact: { value: new THREE.Vector4(0, 0, 0, 0) },
    uGrow: { value: 1 },
    uBend: { value: 0.9 },
    uCurv: { value: 0.9 },
    uLayers: { value: 26 },
    uDensity: { value: tier === 'low' ? 55 : 70 },
    uClump: { value: tier === 'low' ? 0 : 1 },
    uRagged: { value: 0.15 },
    uGrey: { value: 0 },
    // dark brown, tips a little warmer and lighter
    uRoot: { value: new THREE.Color('#2a1b12') },
    uTip: { value: new THREE.Color('#3b2d24') },
    uBeard: { value: new THREE.Color('#463427') },
    // brief rig: cool overhead key, warm window fill, dim warm ambient (world dirs, linear colour)
    uKeyDir: { value: new THREE.Vector3(0.1, 0.9, 0.45).normalize() },
    uKeyCol: { value: new THREE.Color('#EEF2F5').multiplyScalar(1.4) },
    uFillDir: fill,
    uFillCol: fillCol,
    // legacy names (the old stage writes its rim light here): the same objects as the fill
    uRimDir: fill,
    uRimCol: fillCol,
    uAmb: { value: new THREE.Color('#262422').multiplyScalar(0.9) },
  };
}

// Lock centres for clumping: Worley points 7 strand cells apart, nearest one per vertex
// (exact 3x3x3 search on the CPU, so the GPU only reads an attribute).
function clumpField(pos, nrm, n, cell) {
  const out = new Float32Array(n * 4);
  for (let k = 0; k < n; k++) {
    const x = pos[k * 3] / cell, y = pos[k * 3 + 1] / cell, z = pos[k * 3 + 2] / cell;
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let best = 1e9, bx = 0, by = 0, bz = 0, bid = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cx = ix + dx, cy = iy + dy, cz = iz + dz;
          const px = cx + hash3(cx, cy, cz), py = cy + hash3(cy + 17.1, cz, cx), pz = cz + hash3(cz - 9.3, cx, cy);
          const d = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
          if (d < best) {
            best = d;
            bx = px; by = py; bz = pz;
            bid = hash3(cx + 3.7, cy - 1.3, cz + 5.1);
          }
        }
      }
    }
    let ox = (bx - x) * cell, oy = (by - y) * cell, oz = (bz - z) * cell;
    const nx = nrm[k * 3], ny = nrm[k * 3 + 1], nz = nrm[k * 3 + 2];
    const dn = ox * nx + oy * ny + oz * nz;
    ox -= nx * dn; oy -= ny * dn; oz -= nz * dn;
    out[k * 4] = ox;
    out[k * 4 + 1] = oy;
    out[k * 4 + 2] = oz;
    out[k * 4 + 3] = bid;
  }
  return out;
}

function flow(out, x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  out[0] = x / l;
  out[1] = y / l;
  out[2] = z / l;
}

// The shell subset: skin vertices inside the hair zone or the (moustache-completed) beard zone.
// Edges are signed (+ inside): the hairline as measured, the beard edge with the moustache and
// closed by the legacy neckline. Falls back to the worker's subset on old data.
function shellSubset(data) {
  const old = data.hair;
  if (!data.edge || !data.indices) {
    const m = old.keep.length;
    const edge = new Float32Array(m * 2);
    for (let k = 0; k < m; k++) {
      edge[k * 2] = old.edge ? old.edge[k * 2] : old.mask[k * 2] * 0.1 - 0.02;
      edge[k * 2 + 1] = old.edge ? old.edge[k * 2 + 1] : old.mask[k * 2 + 1] * 0.06 - 0.015;
    }
    return { ...old, edge };
  }
  const P = data.positions, N = data.normals, E = data.edge, M = data.mask;
  const nv = P.length / 3;
  const map = new Int32Array(nv).fill(-1);
  const keep = [];
  const eb = new Float32Array(nv);
  for (let i = 0; i < nv; i++) {
    eb[i] = beardEdge(E[i * 2 + 1], P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    if (data.eye && data.eye[i] > 0.5) continue;
    if (M[i * 2] > 0.02 || smooth(-0.015, 0.03, eb[i]) > 0.02) {
      map[i] = keep.length;
      keep.push(i);
    }
  }
  const m = keep.length;
  const positions = new Float32Array(m * 3), normals = new Float32Array(m * 3);
  const mask = new Float32Array(m * 2), edge = new Float32Array(m * 2);
  for (let k = 0; k < m; k++) {
    const i = keep[k];
    for (let c = 0; c < 3; c++) {
      positions[k * 3 + c] = P[i * 3 + c];
      normals[k * 3 + c] = N[i * 3 + c];
    }
    edge[k * 2] = E[i * 2];
    edge[k * 2 + 1] = eb[i];
    mask[k * 2] = M[i * 2];
    mask[k * 2 + 1] = Math.max(M[i * 2 + 1], smooth(-0.015, 0.03, eb[i]));
  }
  const I = data.indices, tris = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = map[I[t]], b = map[I[t + 1]], c = map[I[t + 2]];
    if (a >= 0 && b >= 0 && c >= 0) tris.push(a, b, c);
  }
  const indices = m > 65535 ? Uint32Array.from(tris) : Uint16Array.from(tris);
  return { positions, normals, indices, mask, edge, keep: Uint32Array.from(keep) };
}

// rotate tangent a towards b around normal n by fraction t (shortest arc), into out[o..o+2]
function slerpTangent(a, b, n, t, out, o) {
  const cx = a[1] * b[2] - a[2] * b[1], cy = a[2] * b[0] - a[0] * b[2], cz = a[0] * b[1] - a[1] * b[0];
  const ang = Math.atan2(cx * n[0] + cy * n[1] + cz * n[2], a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) * t;
  const c = Math.cos(ang), s = Math.sin(ang);
  out[o] = a[0] * c + (n[1] * a[2] - n[2] * a[1]) * s;
  out[o + 1] = a[1] * c + (n[2] * a[0] - n[0] * a[2]) * s;
  out[o + 2] = a[2] * c + (n[0] * a[1] - n[1] * a[0]) * s;
}

// ------------------------------------------------------------- the system

// comb flows used by the looks and the engine: crown whorl, swept back, down the slope
function flowsAt(x, y, z, nx, ny, nz, out, o) {
  const C = L_.CORONILLA;
  const t = [0, 0, 0];
  flow(t, x - C[0], y - C[1] + 0.06, z - C[2] - 0.14);
  out[o] = t[0]; out[o + 1] = t[1]; out[o + 2] = t[2];
  // swept back: away from a point above the forehead, turning down where it faces back
  flow(t, x, y - 0.3, z - 3.0);
  const dw = smooth(0.2, 0.75, -nz) * (1 - smooth(0.55, 0.85, ny));
  out[o + 3] = t[0] * (1 - dw); out[o + 4] = mix(t[1], -1, dw); out[o + 5] = t[2] * (1 - dw);
  flow(t, 0, -1, -0.35);
  out[o + 6] = t[0]; out[o + 7] = t[1]; out[o + 8] = t[2];
}

// Shell LOD: bucket sizes (shell counts) and the target spacing between shells (head units).
const LOD_NEED = [4, 7, 11, 16, 22, 32];
const LOD_SPACING = 0.0035;
const MAX_LAYERS = 32;

const PARTS = ['consulta', 'laterales', 'arriba', 'barba', 'acabado'];
const SIDE_ZONES = new Set(['sides', 'nape', 'sidesNape', 'contour']);
const TOP_ZONES = new Set(['top', 'fringe', 'crown']);
const BEARD_ZONES = new Set(['neck', 'cheeks', 'chin', 'moustache', 'beard']);

// Plain, cloneable copy of a program for the worker.
const plainProgram = (p) => ({ id: p.id, kind: p.kind, spec: p.spec ? JSON.parse(JSON.stringify(p.spec)) : null, steps: p.steps.map((s) => JSON.parse(JSON.stringify(s))) });

export class Hair {
  // data: HeadData from meshHead(); data.hair is the subset of skin vertices inside the hair
  // or beard zone (positions, normals, indices, mask [hair, beard], edge [hair, beard],
  // keep = skin vertex index). service: the head worker (head.js) for computeProgram.
  constructor(headGeometry, { layers = 28, data, tier = 'high', service = null } = {}) {
    const total = headGeometry.attributes.position.count;
    const src = shellSubset(data);
    const n = src.keep.length;
    this.count = n;
    this.keepIdx = src.keep;
    this.pos = src.positions;
    this.nrm = src.normals;
    this.hm = new Float32Array(n);
    this.bm = new Float32Array(n);
    this.edge = src.edge;
    for (let k = 0; k < n; k++) {
      this.hm[k] = src.mask[k * 2];
      this.bm[k] = src.mask[k * 2 + 1];
    }
    this.service = service;
    this.tier = tier;

    // anatomy per vertex: top of the head vs sides (from the surface normal, so the weight
    // line follows the skull, not a fixed height), fringe, noise, comb flows
    this.top = new Float32Array(n);
    this.fwd = new Float32Array(n); // 0..1 towards the fringe (hair.front is the tool-front function)
    this.noise = new Float32Array(n);
    this.flows = new Float32Array(n * 9);
    // legacy looks: which tool owns each vertex, and where along that tool's pass it sits
    this.zone = new Float32Array(n * 3);
    this.sweepL = new Float32Array(n * 3);
    this.lineL = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const x = this.pos[k * 3], y = this.pos[k * 3 + 1], z = this.pos[k * 3 + 2];
      const nx = this.nrm[k * 3], ny = this.nrm[k * 3 + 1], nz = this.nrm[k * 3 + 2];
      const top = smooth(0.3, 0.72, ny + 0.25 * smooth(L_.SIEN, L_.FLEQUILLO, y) * smooth(0.1, 0.6, z));
      this.top[k] = top;
      this.fwd[k] = smooth(-0.2, 0.75, z);
      this.noise[k] = noise3(x * 7, y * 7, z * 7);
      flowsAt(x, y, z, nx, ny, nz, this.flows, k * 9);
      const wb = smooth(-0.15, 0.15, this.bm[k] - this.hm[k]);
      const wt = (1 - wb) * top;
      this.zone[k * 3] = 1 - wb - wt;
      this.zone[k * 3 + 1] = wt;
      this.zone[k * 3 + 2] = wb;
      this.sweepL[k * 3] = smooth(-0.7, 0.75, y);
      this.sweepL[k * 3 + 1] = 1 - smooth(-0.85, 0.75, z);
      this.sweepL[k * 3 + 2] = clamp((Math.atan2(x, z) + 1.55) / 3.1, 0, 1);
      this.lineL[k] = wb > 0.5 ? 1 : 0;
    }
    // engine inputs (hairField.computeProgram): sent to the worker once
    this.engineInput = {
      pos: this.pos, nrm: this.nrm, hm: this.hm, bm: this.bm, edge: this.edge,
      top: this.top, front: this.fwd, noise: this.noise, flows: this.flows,
    };
    this.G = null; // engineGeometry on the main thread (fallback only)

    // The head mesh gets the same state so very short hair (fades, stubble) is painted
    // straight onto the plaster with the head's own lighting, and lather sits on the skin.
    this.headFrom = new THREE.BufferAttribute(new Float32Array(total * 4), 4);
    this.headTo = new THREE.BufferAttribute(new Float32Array(total * 4), 4);
    this.headSweep = new THREE.BufferAttribute(new Float32Array(total), 1);
    const headZone = new Float32Array(total * 3);
    const headSweepL = new Float32Array(total * 3);
    for (let k = 0; k < n; k++) {
      const i = this.keepIdx[k];
      for (let c = 0; c < 3; c++) {
        headZone[i * 3 + c] = this.zone[k * 3 + c];
        headSweepL[i * 3 + c] = this.sweepL[k * 3 + c];
      }
    }
    headGeometry.setAttribute('aFrom', this.headFrom);
    headGeometry.setAttribute('aTo', this.headTo);
    headGeometry.setAttribute('aSweep', this.headSweep);
    headGeometry.setAttribute('aZoneL', new THREE.BufferAttribute(headZone, 3));
    headGeometry.setAttribute('aSweepL', new THREE.BufferAttribute(headSweepL, 3));
    // the same edges on the skin (beard edge closed by the neckline)
    const cut = new Float32Array(total * 2).fill(-0.5);
    const hp = headGeometry.attributes.position.array;
    if (data.edge) {
      for (let i = 0; i < total; i++) {
        cut[i * 2] = data.edge[i * 2];
        cut[i * 2 + 1] = beardEdge(data.edge[i * 2 + 1], hp[i * 3], hp[i * 3 + 1], hp[i * 3 + 2]);
      }
    }
    headGeometry.setAttribute('aCut', new THREE.BufferAttribute(cut, 2));
    const skinMask = headGeometry.getAttribute('aMask');
    if (skinMask) {
      for (let i = 0; i < total; i++) skinMask.array[i * 2 + 1] = Math.max(skinMask.array[i * 2 + 1], smooth(-0.015, 0.03, cut[i * 2 + 1]));
      skinMask.needsUpdate = true;
    }

    this.uniforms = hairUniforms({ tier });
    const cell = 7 / this.uniforms.uDensity.value;

    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(new THREE.BufferAttribute(src.indices, 1));
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3));
    geo.setAttribute('aMask', new THREE.BufferAttribute(src.mask, 2));
    geo.setAttribute('aEdge', new THREE.BufferAttribute(this.edge, 2));
    geo.setAttribute('aTop', new THREE.BufferAttribute(this.top, 1));
    geo.setAttribute('aClump', new THREE.BufferAttribute(clumpField(this.pos, this.nrm, n, cell), 4));
    geo.setAttribute('aZoneL', new THREE.BufferAttribute(this.zone, 3));
    geo.setAttribute('aSweepL', new THREE.BufferAttribute(this.sweepL, 3));
    this.from = new THREE.BufferAttribute(new Float32Array(n * 4), 4);
    this.to = new THREE.BufferAttribute(new Float32Array(n * 4), 4);
    this.sweep = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.combFrom = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.combTo = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    geo.setAttribute('aFrom', this.from);
    geo.setAttribute('aTo', this.to);
    geo.setAttribute('aSweep', this.sweep);
    geo.setAttribute('aCombFrom', this.combFrom);
    geo.setAttribute('aCombTo', this.combTo);
    this.geometry = geo;

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: HAIR_VERT,
      fragmentShader: HAIR_FRAG,
      defines: tier === 'low' ? { HAIR_LOW: 1 } : {},
      alphaToCoverage: true,
      // the first shell sits 1 mm off the plaster: keep it from fighting the skin
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });

    // Shell LOD: triangles are sorted by how many shells their hair needs (thickness / 0.35 mm),
    // into one shared index buffer; each bucket is its own draw over a range of it, with its own
    // instance count and per-instance layer heights. Triangles with only sub-shell hair (fades,
    // shaved skin, the head shader paints them) are not drawn at all. All buckets share the
    // vertex attributes and the material: no extra uploads, no extra programs.
    this.tris = src.indices;
    this.triCount = src.indices.length / 3;
    this.lodIndex = new THREE.BufferAttribute(src.indices.slice(), 1);
    this.lodIndex.setUsage(THREE.DynamicDrawUsage);
    this.triNeed = new Uint8Array(this.triCount);
    this.vNeed = new Float32Array(n);
    this.mesh = new THREE.Group();
    this.mesh.name = 'hair';
    this.buckets = LOD_NEED.map((need) => {
      const g = new THREE.InstancedBufferGeometry();
      g.setIndex(this.lodIndex);
      for (const [name, attr] of Object.entries(geo.attributes)) g.setAttribute(name, attr);
      const aLayer = new THREE.InstancedBufferAttribute(new Float32Array(64), 2);
      g.setAttribute('aLayer', aLayer);
      g.setDrawRange(0, 0);
      g.instanceCount = 0;
      const m = new THREE.Mesh(g, this.material);
      m.frustumCulled = false;
      m.renderOrder = 1;
      m.visible = false;
      this.mesh.add(m);
      return { need, geometry: g, aLayer, mesh: m, layers: 0 };
    });
    this.liftBoost = false;
    this.layers = 0;
    this.setLayers(layers);

    this.cache = new Map();
    this.pairKey = '';
    this.mode = 'ritual';
    this.look = null;
    this.anim = null;
    // engine: handles by key (LRU of 3 for the overgrown base), what is on the GPU
    this.handles = new Map();
    this.seq = 0;
    this.shown = null; // {handle, i, step, t}
    this.setupSent = null;
    // activity: the contract fields, plus the legacy ones the old tools read
    this.activity = {
      handle: null, step: -1, t: 0, op: null, zone: null, cutting: false, cutFraction: 0,
      sides: 0, top: 0, beard: 0, zones: [false, false, false],
    };
  }

  /** Hair colours (linear THREE.Color, live uniforms). */
  get colors() {
    const u = this.uniforms;
    return { root: u.uRoot.value, tip: u.uTip.value, beard: u.uBeard.value };
  }

  // Shell count at runtime (governor / mirror pass): only instance counts and the per-instance
  // layer heights change (no new program, no new geometry). Shell i of a bucket with k shells
  // sits at (i+1)/k of the strand: the scalp under the hair is painted by the head shader.
  setLayers(layers) {
    const n = Math.max(2, Math.min(MAX_LAYERS, Math.round(layers)));
    if (this.layers === n) return;
    this.layers = n;
    this.uniforms.uLayers.value = n;
    this.applyLayers();
  }

  applyLayers() {
    const L = this.layers;
    for (const b of this.buckets) {
      const k = Math.max(2, Math.min(L, b.need));
      b.geometry.instanceCount = k;
      if (b.layers === k) continue;
      b.layers = k;
      const a = b.aLayer.array;
      for (let i = 0; i < k; i++) {
        a[i * 2] = (i + 1) / k;
        a[i * 2 + 1] = 1 / k;
      }
      b.aLayer.needsUpdate = true;
    }
  }

  // Re-sorts the shell triangles into the LOD buckets for the pair of states on the GPU
  // (A, B: vec4 per vertex, length and lift first). Called when the step or look changes.
  rebucket(A, B) {
    const n = this.count, vn = this.vNeed, boost = this.liftBoost;
    for (let k = 0; k < n; k++) {
      const len = Math.max(A[k * 4], B[k * 4]);
      if (len < 0.016) {
        vn[k] = -1;
        continue;
      }
      const lift = boost && len > 0.03 && this.hm[k] > 0.3 ? 1 : Math.max(A[k * 4 + 1], B[k * 4 + 1]);
      vn[k] = mix(Math.min(len, 0.016 + 0.24 * len), 0.5 * len, lift) / LOD_SPACING;
    }
    const T = this.tris, tn = this.triNeed, nb = this.buckets.length;
    const counts = new Uint32Array(nb + 1);
    for (let t = 0; t < this.triCount; t++) {
      const v = Math.max(vn[T[t * 3]], vn[T[t * 3 + 1]], vn[T[t * 3 + 2]]);
      let bi = nb; // skipped
      if (v >= 0) {
        // one layer of hysteresis: a triangle gets the bucket above its exact need
        const need = v + 1;
        bi = 0;
        while (bi < nb - 1 && this.buckets[bi].need < need) bi++;
      }
      tn[t] = bi;
      counts[bi]++;
    }
    const start = new Uint32Array(nb + 1);
    for (let i = 1; i <= nb; i++) start[i] = start[i - 1] + counts[i - 1];
    const out = this.lodIndex.array, fill = start.slice();
    for (let t = 0; t < this.triCount; t++) {
      const bi = tn[t];
      if (bi === nb) continue;
      const o = fill[bi]++ * 3;
      out[o] = T[t * 3];
      out[o + 1] = T[t * 3 + 1];
      out[o + 2] = T[t * 3 + 2];
    }
    this.lodIndex.needsUpdate = true;
    this.buckets.forEach((b, i) => {
      b.geometry.setDrawRange(start[i] * 3, counts[i] * 3);
      b.mesh.visible = counts[i] > 0;
    });
    this.lodStats = Array.from(counts);
  }

  dispose() {
    for (const b of this.buckets) b.geometry.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.handles.clear();
  }

  // ================================================================ cut-step engine

  /** Tool front for step progress t: t*(1+0.06)-0.03 (hairField.front). */
  front(t) {
    return front(t);
  }

  /**
   * Computes a program (in the head worker; on the main thread if it is unavailable).
   * base 'overgrown' starts from long hair; 'current' from what is on screen now, with
   * resetParts (Part[]) grown back first. → Handle {id, steps, parts: {part: [first, end)}}
   * steps[i] is the program step plus .path (pass it to hairField.toolPath) and .changes.
   */
  async prepare(program, { guards = {}, base = 'overgrown', resetParts = null } = {}) {
    const start = base === 'current' ? this.currentState() : null;
    const key = start ? null : `${program.id}|${JSON.stringify(guards)}|${JSON.stringify(program.steps.map((s) => [s.op, s.zone, s.guard, s.upTo, s.from, s.lengthMM]))}`;
    if (key && this.handles.has(key)) {
      const h = this.handles.get(key);
      this.handles.delete(key);
      this.handles.set(key, h);
      return h;
    }
    const opts = { guards: { ...guards }, start, resetParts: start ? resetParts : null };
    const res = await this.compute(plainProgram(program), opts);
    const parts = {};
    program.steps.forEach((s, i) => {
      if (!PARTS.includes(s.part)) return;
      if (!parts[s.part]) parts[s.part] = [i, i + 1];
      else parts[s.part][1] = i + 1;
    });
    const handle = {
      id: ++this.seq,
      program,
      steps: program.steps.map((s, i) => ({ ...s, index: i, path: res.info[i].path, changes: res.info[i].changed > 0 })),
      parts,
      _res: res,
      _gpu: new Map(),
    };
    if (key) {
      this.handles.set(key, handle);
      while (this.handles.size > 3) this.handles.delete(this.handles.keys().next().value);
    }
    return handle;
  }

  async compute(program, opts) {
    const svc = this.service;
    if (svc && svc.alive) {
      try {
        if (this.setupSent !== svc.generation) {
          await svc.run('hairSetup', { input: this.engineInput });
          this.setupSent = svc.generation;
        }
        const transfer = opts.start ? [opts.start.a.buffer, opts.start.c.buffer] : [];
        return await svc.run('program', { program, opts }, transfer, { timeout: 15000 });
      } catch {
        // fall through to the main thread (the start state was transferred: rebuild it)
        if (opts.start) opts.start = this.currentState();
      }
    }
    if (!this.G) this.G = engineGeometry(this.engineInput);
    return computeProgram(this.G, program, opts);
  }

  // Internal state on screen now (null when the legacy looks or nothing is showing).
  currentState() {
    const sh = this.shown;
    if (!sh || this.uniforms.uLegacy.value > 0.5) return null;
    const { states, info } = sh.handle._res;
    const n = info.length;
    if (sh.i < 0) return copyState(states[0]);
    if (sh.i >= n) return copyState(states[n]);
    return stateAt(this.engineInput, states[sh.i], states[sh.i + 1], info[sh.i], front(sh.t));
  }

  gpuState(handle, j, pend) {
    const key = pend ? `p${j}` : j;
    let g = handle._gpu.get(key);
    if (!g) {
      g = gpuOf(this.engineInput, handle._res.states[j], pend);
      handle._gpu.set(key, g);
    }
    return g;
  }

  upload(handle, i) {
    const { states, info } = handle._res;
    const n = info.length;
    let from, to, combA, combB, sweep = null;
    if (i < 0 || i >= n) {
      const j = i < 0 ? 0 : n;
      from = to = this.gpuState(handle, j);
      combA = combB = states[j].c;
    } else {
      from = this.gpuState(handle, i, info[i].pend);
      to = this.gpuState(handle, i + 1);
      combA = states[i].c;
      combB = states[i + 1].c;
      sweep = info[i].sweep;
    }
    this.from.array.set(from);
    this.to.array.set(to);
    if (sweep) this.sweep.array.set(sweep);
    else this.sweep.array.fill(0);
    this.combFrom.array.set(combA);
    this.combTo.array.set(combB);
    for (const a of [this.from, this.to, this.sweep, this.combFrom, this.combTo]) a.needsUpdate = true;
    const hf = this.headFrom.array, ht = this.headTo.array, hs = this.headSweep.array;
    const keep = this.keepIdx;
    for (let k = 0; k < this.count; k++) {
      const v = keep[k];
      for (let c = 0; c < 4; c++) {
        hf[v * 4 + c] = from[k * 4 + c];
        ht[v * 4 + c] = to[k * 4 + c];
      }
      hs[v] = sweep ? sweep[k] : 0;
    }
    this.headFrom.needsUpdate = this.headTo.needsUpdate = this.headSweep.needsUpdate = true;
    this.pairKey = `h${handle.id}:${i}`;
    this.rebucket(this.from.array, this.to.array);
  }

  /**
   * Shows step `step` of a prepared handle at progress t (0..1): −1 is the start state,
   * ≥ steps.length the finished cut. Cheap to call every frame: buffers are uploaded only
   * when the handle or the step changes.
   */
  show(handle, step, t = 0) {
    const n = handle.steps.length;
    const i = step < 0 ? -1 : step >= n ? n : Math.floor(step);
    const tt = clamp(t, 0, 1);
    const u = this.uniforms;
    if (!this.shown || this.shown.handle !== handle || this.shown.i !== i || u.uLegacy.value > 0.5) this.upload(handle, i);
    this.mode = 'engine';
    this.anim = null;
    this.shown = { handle, i, t: tt };
    u.uLegacy.value = 0;
    const inf = i >= 0 && i < n ? handle._res.info[i] : null;
    const f = inf ? front(tt) : 1.03;
    u.uFront.value = f;
    u.uStepW.value = inf ? inf.path.w || 0.06 : 0.06;
    u.uFoamIn.value = inf && inf.foamIn ? smooth(0, 0.12, tt) : 1;
    const st = handle._res.states;
    const s0 = st[Math.max(0, Math.min(i, n))];
    const s1 = st[Math.max(0, Math.min(i + 1, n))];
    const k = inf ? smooth(0, 1, tt) : 0;
    u.uShine.value = mix(s0.shine, s1.shine, k);
    u.uBShine.value = mix(s0.bshine, s1.bshine, k);

    // activity
    const a = this.activity;
    const s = inf ? handle.steps[i] : null;
    a.handle = handle;
    a.step = step;
    a.t = tt;
    a.op = s ? s.op : null;
    a.zone = s ? s.zone : null;
    let cf = i >= n ? 1 : 0;
    if (inf) {
      const x = clamp(f, 0, 1) * 32;
      const b = Math.min(31, Math.floor(x));
      cf = inf.changed ? mix(inf.cdf[b], inf.cdf[b + 1], x - b) : tt;
    }
    a.cutFraction = clamp(cf, 0, 1);
    a.cutting = !!s && isCutOp(s.op) && inf.changed > 0 && tt > 0 && tt < 1;
    // legacy view for the old tools: one zone at a time
    const active = !!s && inf.changed > 0 && tt > 0 && tt < 1;
    const zs = s && (SIDE_ZONES.has(s.zone) && s.part !== 'barba');
    const zt = s && TOP_ZONES.has(s.zone) && s.part !== 'barba';
    const zb = s && (BEARD_ZONES.has(s.zone) || s.part === 'barba');
    a.zones = [active && !!zs, active && !!zt, active && !!zb];
    a.sides = a.zones[0] ? tt : 1;
    a.top = a.zones[1] ? tt : 1;
    a.beard = a.zones[2] ? tt : 1;
  }

  /**
   * The comb lifting a section while the scissors cut over it: hair within `radius` of
   * centre (head-local Vector3 or [x,y,z]) stands up towards dir by `amount` (0..1).
   * centre null turns it off.
   */
  setLift(centre, radius = 0.25, amount = 1, dir = null) {
    const u = this.uniforms;
    if (!centre) {
      u.uLiftAmt.value = 0;
      this.setBoost(false);
      return;
    }
    this.setBoost(amount > 0);
    const c = Array.isArray(centre) ? centre : [centre.x, centre.y, centre.z];
    u.uLift.value.set(c[0], c[1], c[2], radius);
    u.uLiftAmt.value = clamp(amount, 0, 1);
    if (dir) {
      const d = Array.isArray(dir) ? dir : [dir.x, dir.y, dir.z];
      u.uLiftDir.value.set(d[0], d[1], d[2]).normalize();
    }
  }

  // lifted hair stands up to 2.4x thicker: give the long hair its full shells while a lift is on
  setBoost(on) {
    if (this.liftBoost === on) return;
    this.liftBoost = on;
    this.rebucket(this.from.array, this.to.array);
  }

  /** A tool resting on the hair (guard, comb): hair within radius of centre is pressed flat. */
  setContact(centre, radius = 0.12) {
    const u = this.uniforms;
    if (!centre) {
      u.uContact.value.w = 0;
      return;
    }
    const c = Array.isArray(centre) ? centre : [centre.x, centre.y, centre.z];
    u.uContact.value.set(c[0], c[1], c[2], radius);
  }

  // ================================================================ legacy looks

  // Length, lift and comb fields for one hair + beard combination, cached.
  field(hair, beard) {
    const key = `${hair}|${beard}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const n = this.count;
    const len = new Float32Array(n * 2);
    const comb = new Float32Array(n * 3);
    const hairFn = HAIR[hair] || HAIR.before, beardFn = BEARD[beard] || BEARD.none;
    const ctx = { top: 0, front: 0, n: 0, side: 1, chin: 0, stache: 0, crown: [0, 0, 0], back: [0, 0, 0], down: [0, 0, 0] };
    for (let k = 0; k < n; k++) {
      const x = this.pos[k * 3], y = this.pos[k * 3 + 1], z = this.pos[k * 3 + 2];
      ctx.top = this.top[k];
      ctx.front = this.fwd[k];
      ctx.n = this.noise[k];
      ctx.side = clamp(x * 4, -1, 1);
      ctx.chin = smooth(P_.lip_lower[1], P_.pogonion[1], y) * smooth(0.15, 0.5, z);
      ctx.stache = smooth(P_.stomion[1] + 0.02, P_.stomion[1] + 0.07, y) * smooth(0.6, 0.7, z) *
        (1 - smooth(P_.mouth_corner[0] - 0.03, P_.mouth_corner[0] + 0.05, Math.abs(x)));
      const F = this.flows;
      for (let c = 0; c < 3; c++) {
        ctx.crown[c] = F[k * 9 + c];
        ctx.back[c] = F[k * 9 + 3 + c];
        ctx.down[c] = F[k * 9 + 6 + c];
      }
      const h = hairFn(x, y, z, ctx);
      const b = beardFn(x, y, z, ctx);
      // natural hairline: hair keeps its length up to ~1 cm inside the edge, then the
      // edge strands are finer and shorter (the shader thins them out one by one)
      const eH = this.edge[k * 2], eB = this.edge[k * 2 + 1];
      const lh = this.hm[k] > 0.02 ? h[0] * mix(0.45, 1, smooth(0, 0.09, eH)) * smooth(-0.03, -0.005, eH) : 0;
      // beard lines are razor lines: full length right up to the edge (tidy neckline)
      const lb = b[0] * smooth(-0.004, 0.004, Math.min(eB, y - NECKLINE_TIDY)) * (this.bm[k] > 0.02 ? 1 : 0);
      const src = lh >= lb ? h : b;
      len[k * 2] = Math.max(lh, lb);
      len[k * 2 + 1] = src[4] || 0;
      // project the comb direction onto the surface
      const nx = this.nrm[k * 3], ny = this.nrm[k * 3 + 1], nzz = this.nrm[k * 3 + 2];
      let cx = src[1], cy = src[2], cz = src[3];
      const dn = cx * nx + cy * ny + cz * nzz;
      cx -= nx * dn; cy -= ny * dn; cz -= nzz * dn;
      let cl = Math.hypot(cx, cy, cz);
      if (cl < 1e-4) {
        // comb along the normal: fall back to "down the slope"
        cx = nx * ny; cy = ny * ny - 1; cz = nzz * ny;
        cl = Math.hypot(cx, cy, cz) || 1;
      }
      comb[k * 3] = cx / cl;
      comb[k * 3 + 1] = cy / cl;
      comb[k * 3 + 2] = cz / cl;
    }
    const out = { len, comb };
    this.cache.set(key, out);
    return out;
  }

  setPair(from, to, key) {
    const A = this.from.array, B = this.to.array, L = this.lineL;
    for (let k = 0; k < this.count; k++) {
      A[k * 4] = from.len[k * 2];
      A[k * 4 + 1] = from.len[k * 2 + 1];
      B[k * 4] = to.len[k * 2];
      B[k * 4 + 1] = to.len[k * 2 + 1];
      A[k * 4 + 2] = B[k * 4 + 2] = 0;
      A[k * 4 + 3] = B[k * 4 + 3] = L[k];
    }
    this.combFrom.array.set(from.comb);
    this.combTo.array.set(to.comb);
    this.from.needsUpdate = this.to.needsUpdate = true;
    this.combFrom.needsUpdate = this.combTo.needsUpdate = true;
    const hf = this.headFrom.array, ht = this.headTo.array;
    for (let k = 0; k < this.count; k++) {
      const v = this.keepIdx[k];
      hf[v * 4] = from.len[k * 2];
      ht[v * 4] = to.len[k * 2];
      hf[v * 4 + 1] = from.len[k * 2 + 1];
      ht[v * 4 + 1] = to.len[k * 2 + 1];
      hf[v * 4 + 2] = ht[v * 4 + 2] = 0;
      hf[v * 4 + 3] = ht[v * 4 + 3] = L[k];
    }
    this.headFrom.needsUpdate = this.headTo.needsUpdate = true;
    this.pairKey = key;
    this.rebucket(A, B);
    this.uniforms.uLegacy.value = 1;
    this.shown = null;
  }

  // What is on screen right now, so a new look can start from it.
  snapshot() {
    const n = this.count;
    const prog = this.uniforms.uProg.value;
    const w = this.uniforms.uWidth.value;
    const p = [prog.x, prog.y, prog.z];
    const len = new Float32Array(n * 2);
    const comb = new Float32Array(n * 3);
    const A = this.from.array, B = this.to.array, CA = this.combFrom.array, CB = this.combTo.array;
    const a = [0, 0, 0], b = [0, 0, 0], nn = [0, 0, 0];
    const legacy = this.uniforms.uLegacy.value > 0.5;
    const f = this.uniforms.uFront.value, sw = this.uniforms.uStepW.value, S = this.sweep.array;
    for (let k = 0; k < n; k++) {
      let t = 0;
      if (legacy) for (let z = 0; z < 3; z++) t += this.zone[k * 3 + z] * clamp((p[z] * (1 + w) - this.sweepL[k * 3 + z]) / w, 0, 1);
      else t = clamp((f - S[k]) / sw + 0.5, 0, 1);
      len[k * 2] = mix(A[k * 4], B[k * 4], t);
      len[k * 2 + 1] = mix(A[k * 4 + 1], B[k * 4 + 1], t);
      for (let c = 0; c < 3; c++) {
        a[c] = CA[k * 3 + c];
        b[c] = CB[k * 3 + c];
        nn[c] = this.nrm[k * 3 + c];
      }
      slerpTangent(a, b, nn, t, comb, k * 3);
    }
    return { len, comb };
  }

  // Scroll-driven: overgrown hair turns into the chosen look, one tool at a time.
  ritual(look, sides, top, beard) {
    const key = `before>${look.hair}|${look.beard}`;
    if (this.mode !== 'ritual' || this.pairKey !== key) {
      this.anim = null;
      this.mode = 'ritual';
      this.setPair(this.field('before', 'before'), this.field(look.hair, look.beard), key);
    }
    this.look = { ...look };
    this.uniforms.uProg.value.set(sides, top, beard);
    this.activity.sides = sides;
    this.activity.top = top;
    this.activity.beard = beard;
    this.activity.zones = [true, true, true];
  }

  // Studio: animate from whatever is showing to a new look.
  change(look, { duration = 2.4 } = {}) {
    const target = this.field(look.hair, look.beard);
    const from = this.mode === 'studio' && !this.anim && this.look ? this.field(this.look.hair, this.look.beard) : this.snapshot();
    const zones = [false, false, false];
    for (let k = 0; k < this.count; k++) {
      if (Math.abs(from.len[k * 2] - target.len[k * 2]) < 0.004) continue;
      for (let z = 0; z < 3; z++) if (this.zone[k * 3 + z] > 0.5) zones[z] = true;
    }
    this.mode = 'studio';
    this.setPair(from, target, `studio>${look.hair}|${look.beard}`);
    this.look = { ...look };
    this.uniforms.uProg.value.set(0, 0, 0);
    const active = zones.filter(Boolean).length || 1;
    this.anim = { t: 0, duration: Math.max(0.6, (duration * active) / 3), zones };
  }

  // Studio entered by scrolling: keep the current look without a transition.
  settle(look) {
    if (this.mode === 'studio') return;
    const field = this.field(look.hair, look.beard);
    this.mode = 'studio';
    this.anim = null;
    this.look = { ...look };
    this.setPair(field, field, `studio>${look.hair}|${look.beard}`);
    this.uniforms.uProg.value.set(1, 1, 1);
    this.activity.zones = [false, false, false];
  }

  update(dt) {
    if (this.mode !== 'studio' || !this.anim) {
      if (this.mode === 'studio') this.activity.zones = [false, false, false];
      return;
    }
    const a = this.anim;
    a.t = Math.min(1, a.t + dt / a.duration);
    // run the active zones one after another, overlapping a little
    const order = [0, 1, 2].filter((z) => a.zones[z]);
    const slots = order.length || 1;
    const prog = [1, 1, 1];
    order.forEach((z, i) => {
      const start = (i / slots) * 0.85;
      const end = start + 0.15 + 0.85 / slots;
      prog[z] = smooth(start, end, a.t);
    });
    for (let z = 0; z < 3; z++) if (!a.zones[z]) prog[z] = 1;
    this.uniforms.uProg.value.set(prog[0], prog[1], prog[2]);
    this.activity.sides = prog[0];
    this.activity.top = prog[1];
    this.activity.beard = prog[2];
    this.activity.zones = a.zones.slice();
    if (a.t >= 1) {
      const field = this.field(this.look.hair, this.look.beard);
      this.setPair(field, field, `studio>${this.look.hair}|${this.look.beard}`);
      this.anim = null;
      this.activity.zones = [false, false, false];
    }
  }
}

function copyState(s) {
  return { a: s.a.slice(), c: s.c.slice(), shine: s.shine, bshine: s.bshine };
}
