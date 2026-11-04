import * as THREE from 'three';
import { HEAD_POINTS, LANDMARKS, MM, DEDO_MM } from './hairField.js';
import { HAIR_VERT, HAIR_FRAG } from './hairShaders.js';

// Hair and beard are drawn as "fur shells": the scalp and jaw of the head mesh
// are copied N times, each copy pushed a little further out along the normal
// and slid along the comb, and a fragment shader carves strands out of every
// layer (hairShaders.js). The length, lift and comb of each strand come from
// per-vertex attributes, so switching haircut is just interpolating between two
// fields, which is what the clipper, scissors and razor animations ride on.
// Hair shorter than ~2 mm is painted on the plaster by head.js (shaved tint).

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
// legacy looks keep the beard tidy: a neckline a finger and a half above the Adam's apple
const NECKLINE = L_.NUEZ + 1.5 * DEDO_MM * MM;
const mm = (v) => v * MM;

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
    uProg: { value: new THREE.Vector3(1, 1, 1) },
    uWidth: { value: 0.18 },
    uGrow: { value: 1 },
    uBend: { value: 0.9 },
    uCurv: { value: 0.9 },
    uLayers: { value: 26 },
    uDensity: { value: tier === 'low' ? 55 : 70 },
    uClump: { value: tier === 'low' ? 0 : 1 },
    uRagged: { value: 0.3 },
    uGrey: { value: 0 },
    // dark brown with warmer, lighter tips: the depth between roots and tips is what lets
    // the strands read against the plaster
    uRoot: { value: new THREE.Color('#2a1b12') },
    uTip: { value: new THREE.Color('#5c3f2b') },
    uBeard: { value: new THREE.Color('#33231a') },
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

export class Hair {
  // data: HeadData from meshHead(); data.hair is the subset of skin vertices inside the hair
  // or beard zone (positions, normals, indices, mask [hair, beard], edge [hair, beard],
  // keep = skin vertex index).
  constructor(headGeometry, { layers = 28, data, tier = 'high' } = {}) {
    const total = headGeometry.attributes.position.count;
    const src = data.hair;
    const n = src.keep.length;
    this.count = n;
    this.keepIdx = src.keep;
    this.pos = src.positions;
    this.nrm = src.normals;
    this.hm = new Float32Array(n);
    this.bm = new Float32Array(n);
    // edges used by the looks: the hairline as measured, the beard edge also closed by
    // the legacy neckline (both signed, + inside)
    this.edge = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) {
      this.hm[k] = src.mask[k * 2];
      this.bm[k] = src.mask[k * 2 + 1];
      const y = this.pos[k * 3 + 1];
      this.edge[k * 2] = src.edge ? src.edge[k * 2] : this.hm[k] * 0.1 - 0.02;
      const eb = src.edge ? src.edge[k * 2 + 1] : this.bm[k] * 0.06 - 0.015;
      this.edge[k * 2 + 1] = Math.min(eb, y - NECKLINE);
    }

    // anatomy per vertex: top of the head vs sides (from the surface normal, so the weight
    // line follows the skull, not a fixed height), fringe, noise
    this.top = new Float32Array(n);
    this.front = new Float32Array(n);
    this.noise = new Float32Array(n);
    // which tool owns each vertex, and where along that tool's pass it sits
    this.zone = new Float32Array(n * 3);
    this.sweep = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const x = this.pos[k * 3], y = this.pos[k * 3 + 1], z = this.pos[k * 3 + 2];
      const ny = this.nrm[k * 3 + 1];
      const top = smooth(0.3, 0.72, ny + 0.25 * smooth(L_.SIEN, L_.FLEQUILLO, y) * smooth(0.1, 0.6, z));
      this.top[k] = top;
      this.front[k] = smooth(-0.2, 0.75, z);
      this.noise[k] = noise3(x * 7, y * 7, z * 7);
      const wb = smooth(-0.15, 0.15, this.bm[k] - this.hm[k]);
      const wt = (1 - wb) * top;
      this.zone[k * 3] = 1 - wb - wt;
      this.zone[k * 3 + 1] = wt;
      this.zone[k * 3 + 2] = wb;
      this.sweep[k * 3] = smooth(-0.7, 0.75, y);
      this.sweep[k * 3 + 1] = 1 - smooth(-0.85, 0.75, z);
      this.sweep[k * 3 + 2] = clamp((Math.atan2(x, z) + 1.55) / 3.1, 0, 1);
    }

    // The head mesh gets the length fields so very short hair (fades, stubble) is painted
    // straight onto the plaster with the head's own lighting.
    this.headFrom = new THREE.BufferAttribute(new Float32Array(total), 1);
    this.headTo = new THREE.BufferAttribute(new Float32Array(total), 1);
    const headZone = new Float32Array(total * 3);
    const headSweep = new Float32Array(total * 3);
    for (let k = 0; k < n; k++) {
      const i = this.keepIdx[k];
      for (let c = 0; c < 3; c++) {
        headZone[i * 3 + c] = this.zone[k * 3 + c];
        headSweep[i * 3 + c] = this.sweep[k * 3 + c];
      }
    }
    headGeometry.setAttribute('aFrom', this.headFrom);
    headGeometry.setAttribute('aTo', this.headTo);
    headGeometry.setAttribute('aZone', new THREE.BufferAttribute(headZone, 3));
    headGeometry.setAttribute('aSweep', new THREE.BufferAttribute(headSweep, 3));
    // the same edges on the skin (beard edge closed by the neckline)
    const cut = new Float32Array(total * 2).fill(-0.5);
    const hp = headGeometry.attributes.position.array;
    if (data.edge) {
      for (let i = 0; i < total; i++) {
        cut[i * 2] = data.edge[i * 2];
        cut[i * 2 + 1] = Math.min(data.edge[i * 2 + 1], hp[i * 3 + 1] - NECKLINE);
      }
    }
    headGeometry.setAttribute('aCut', new THREE.BufferAttribute(cut, 2));

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
    geo.setAttribute('aZone', new THREE.BufferAttribute(this.zone, 3));
    geo.setAttribute('aSweep', new THREE.BufferAttribute(this.sweep, 3));
    this.from = new THREE.BufferAttribute(new Float32Array(n * 2), 2);
    this.to = new THREE.BufferAttribute(new Float32Array(n * 2), 2);
    this.combFrom = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.combTo = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    geo.setAttribute('aFrom', this.from);
    geo.setAttribute('aTo', this.to);
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
    this.setLayers(layers);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;

    this.cache = new Map();
    this.pairKey = '';
    this.mode = 'ritual';
    this.look = null;
    this.anim = null;
    this.activity = { sides: 0, top: 0, beard: 0, zones: [false, false, false] };
  }

  /** Hair colours (linear THREE.Color, live uniforms). */
  get colors() {
    const u = this.uniforms;
    return { root: u.uRoot.value, tip: u.uTip.value, beard: u.uBeard.value };
  }

  // Shell count at runtime (governor / mirror pass): rewrites the per-instance layer values in
  // place (no new program, no new geometry) and sets instanceCount. Shell i sits at (i+1)/n of
  // the strand: the scalp under the hair is painted by the head shader.
  setLayers(layers) {
    const n = Math.max(2, Math.round(layers));
    if (this.layers === n) return;
    this.layers = n;
    let attr = this.geometry.getAttribute('aLayer');
    if (!attr || attr.count < n) {
      attr = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(n, 32)), 1);
      this.geometry.setAttribute('aLayer', attr);
    }
    for (let i = 0; i < n; i++) attr.array[i] = (i + 1) / n;
    attr.needsUpdate = true;
    this.geometry.instanceCount = n;
    this.uniforms.uLayers.value = n;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }

  // Length, lift and comb fields for one hair + beard combination, cached.
  field(hair, beard) {
    const key = `${hair}|${beard}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const n = this.count;
    const len = new Float32Array(n * 2);
    const comb = new Float32Array(n * 3);
    const hairFn = HAIR[hair] || HAIR.before, beardFn = BEARD[beard] || BEARD.none;
    const ctx = { top: 0, front: 0, n: 0, side: 1, chin: 0, stache: 0, crown: [0, 0, 0], back: [0, 0, 0], down: [0, 0, 0] };
    const C = L_.CORONILLA;
    for (let k = 0; k < n; k++) {
      const x = this.pos[k * 3], y = this.pos[k * 3 + 1], z = this.pos[k * 3 + 2];
      ctx.top = this.top[k];
      ctx.front = this.front[k];
      ctx.n = this.noise[k];
      ctx.side = clamp(x * 4, -1, 1);
      ctx.chin = smooth(P_.lip_lower[1], P_.pogonion[1], y) * smooth(0.15, 0.5, z);
      ctx.stache = smooth(P_.stomion[1] + 0.02, P_.stomion[1] + 0.07, y) * smooth(0.6, 0.7, z) *
        (1 - smooth(P_.mouth_corner[0] - 0.03, P_.mouth_corner[0] + 0.05, Math.abs(x)));
      const nx0 = this.nrm[k * 3], ny0 = this.nrm[k * 3 + 1], nz0 = this.nrm[k * 3 + 2];
      flow(ctx.crown, x - C[0], y - C[1] + 0.06, z - C[2] - 0.14);
      // swept back: away from a point above the forehead, turning down where it faces back
      flow(ctx.back, x, y - 1.6, z - 1.4);
      const dw = smooth(0.2, 0.75, -nz0) * (1 - smooth(0.55, 0.85, ny0));
      ctx.back[0] *= 1 - dw; ctx.back[1] = mix(ctx.back[1], -1, dw); ctx.back[2] *= 1 - dw;
      flow(ctx.down, 0, -1, -0.35);
      const h = hairFn(x, y, z, ctx);
      const b = beardFn(x, y, z, ctx);
      // natural hairline: hair keeps its length up to ~1 cm inside the edge, then the
      // edge strands are finer and shorter (the shader thins them out one by one)
      const eH = this.edge[k * 2], eB = this.edge[k * 2 + 1];
      const lh = this.hm[k] > 0.02 ? h[0] * mix(0.45, 1, smooth(0, 0.09, eH)) * smooth(-0.03, -0.005, eH) : 0;
      // beard lines are razor lines: full length right up to the edge
      const lb = b[0] * smooth(-0.004, 0.004, eB) * (this.bm[k] > 0.02 ? 1 : 0);
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
    this.from.array.set(from.len);
    this.to.array.set(to.len);
    this.combFrom.array.set(from.comb);
    this.combTo.array.set(to.comb);
    this.from.needsUpdate = this.to.needsUpdate = true;
    this.combFrom.needsUpdate = this.combTo.needsUpdate = true;
    const hf = this.headFrom.array, ht = this.headTo.array;
    for (let k = 0; k < this.count; k++) {
      hf[this.keepIdx[k]] = from.len[k * 2];
      ht[this.keepIdx[k]] = to.len[k * 2];
    }
    this.headFrom.needsUpdate = this.headTo.needsUpdate = true;
    this.pairKey = key;
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
    for (let k = 0; k < n; k++) {
      let t = 0;
      for (let z = 0; z < 3; z++) t += this.zone[k * 3 + z] * clamp((p[z] * (1 + w) - this.sweep[k * 3 + z]) / w, 0, 1);
      len[k * 2] = mix(A[k * 2], B[k * 2], t);
      len[k * 2 + 1] = mix(A[k * 2 + 1], B[k * 2 + 1], t);
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
