import * as THREE from 'three';

// Hair and beard are drawn as "fur shells": the scalp and jaw of the head mesh
// are copied N times, each copy pushed a little further out along the normal,
// and a fragment shader carves strands out of every layer. The length of each
// strand comes from a per-vertex attribute, so switching haircut is just
// interpolating between two length fields — which is what the clipper,
// scissors and razor animations ride on.

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

// Hairline height (y) against azimuth around the head, 0 = forehead, π = nape.
const HAIRLINE = [
  [0, 0.6], [0.45, 0.56], [0.8, 0.42], [1.12, 0.3], [1.3, -0.08],
  [1.75, -0.12], [2.3, -0.3], [Math.PI, -0.5],
];

function hairlineAt(phi) {
  for (let i = 1; i < HAIRLINE.length; i++) {
    const [p1, y1] = HAIRLINE[i];
    if (phi <= p1) {
      const [p0, y0] = HAIRLINE[i - 1];
      return mix(y0, y1, smooth(0, 1, (phi - p0) / (p1 - p0)));
    }
  }
  return HAIRLINE[HAIRLINE.length - 1][1];
}

function earClearance(x, y, z) {
  const ex = (Math.abs(x) - 0.7) / 0.15, ey = (y + 0.05) / 0.28, ez = (z + 0.14) / 0.15;
  return smooth(1.0, 1.25, ex * ex + ey * ey + ez * ez);
}

export function hairMask(x, y, z) {
  const phi = Math.abs(Math.atan2(x, z));
  const h = hairlineAt(phi);
  return smooth(h - 0.03, h + 0.09, y) * earClearance(x, y, z);
}

// Upper edge of the beard against |x|: moustache, mouth corner, cheek line, sideburn.
const CHEEK_LINE = [[0, -0.36], [0.16, -0.37], [0.25, -0.47], [0.45, -0.34], [0.62, -0.12], [0.85, -0.1]];

function cheekLineAt(ax) {
  for (let i = 1; i < CHEEK_LINE.length; i++) {
    const [x1, y1] = CHEEK_LINE[i];
    if (ax <= x1) {
      const [x0, y0] = CHEEK_LINE[i - 1];
      return mix(y0, y1, (ax - x0) / (x1 - x0));
    }
  }
  return CHEEK_LINE[CHEEK_LINE.length - 1][1];
}

export function beardMask(x, y, z) {
  const ax = Math.abs(x);
  const phi = Math.abs(Math.atan2(x, z));
  const top = cheekLineAt(ax);
  let m = 1 - smooth(top - 0.025, top + 0.025, y);
  m *= 1 - smooth(1.42, 1.56, phi);
  // neckline: from the jaw angle down to just under the chin
  const bottom = -0.62 - 0.38 * smooth(-0.15, 0.45, z);
  m *= smooth(bottom - 0.03, bottom + 0.05, y);
  if (z > 0.5) {
    const lx = x / 0.17, ly = (y + 0.5) / 0.068;
    m *= smooth(1.0, 1.4, lx * lx + ly * ly);
  }
  return m * earClearance(x, y, z);
}

// ------------------------------------------------------------------ looks
// A look returns the strand length (head units, 1 ≈ 11 cm) and the direction
// the hair is combed, before it is projected onto the scalp.

const HAIR = {
  before(x, y, z, n) {
    const top = smooth(0.3, 0.55, y);
    return [mix(0.115, 0.17, top) + 0.04 * n, 0.15 * (n - 0.5), -1, mix(-0.2, 0.45, top)];
  },
  fade(x, y, z) {
    const sides = 0.05 * smooth(-0.32, 0.38, y);
    const top = 0.1 + 0.025 * smooth(-0.3, 0.6, z);
    const t = smooth(0.36, 0.52, y);
    return [mix(sides, top, t), 0, mix(-1, 0.55, t), mix(-0.5, 0.65, t)];
  },
  quiff(x, y, z) {
    const sides = 0.012 + 0.035 * smooth(-0.3, 0.42, y);
    const front = smooth(-0.1, 0.62, z);
    const top = 0.15 + 0.17 * front;
    const t = smooth(0.4, 0.56, y);
    return [mix(sides, top, t), 0, mix(-1, mix(0.2, 1.2, front), t), mix(-0.6, mix(-1, -0.55, front), t)];
  },
  crew(x, y, z) {
    const sides = 0.03 + 0.025 * smooth(-0.3, 0.4, y);
    const top = 0.085 + 0.035 * smooth(-0.3, 0.6, z);
    const t = smooth(0.38, 0.55, y);
    return [mix(sides, top, t), 0, mix(-1, 0.6, t), mix(-0.4, 0.7, t)];
  },
  buzz() {
    return [0.026, 0, -1, -0.3];
  },
};

const BEARD = {
  before(x, y, z, n, chin) {
    return [0.06 + 0.035 * chin + 0.015 * n, 0.2 * (n - 0.5), -1, 0.25];
  },
  none() {
    return [0, 0, -1, 0.25];
  },
  stubble() {
    return [0.011, 0, -1, 0.25];
  },
  short(x, y, z, n, chin) {
    return [0.022 + 0.016 * chin, 0, -1, 0.25];
  },
  full(x, y, z, n, chin, stache) {
    const len = mix(0.065 + 0.09 * chin, 0.05, stache);
    return [len, Math.sign(x) * 0.6 * stache, -1, 0.25];
  },
};

// --------------------------------------------------------------- material

const vertexShader = /* glsl */ `
  attribute float aLayer;
  attribute float aFrom;
  attribute float aTo;
  attribute vec3 aCombFrom;
  attribute vec3 aCombTo;
  attribute vec3 aZone;
  attribute vec3 aSweep;

  uniform vec3 uProg;
  uniform float uWidth;
  uniform float uGrow;
  uniform float uBend;

  varying vec3 vRest;
  varying vec3 vNormalW;
  varying vec3 vCombW;
  varying vec3 vPosW;
  varying float vLen;
  varying float vF;
  varying float vBase;

  void main() {
    vec3 tz = clamp((uProg * (1.0 + uWidth) - aSweep) / uWidth, 0.0, 1.0);
    float t = dot(aZone, tz);
    float len = mix(aFrom, aTo, t) * uGrow;
    vec3 comb = normalize(mix(aCombFrom, aCombTo, t) + vec3(0.0, -1e-4, 0.0));
    float base = 1.0 - step(1e-4, aLayer);
    float f = mix(0.45, 1.0, aLayer);
    vec3 p = position + normal * (0.0015 + len * f) + comb * len * f * f * uBend;

    vRest = position;
    vLen = len;
    vF = f;
    vBase = base;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vPosW = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vCombW = normalize(mat3(modelMatrix) * comb);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uRoot;
  uniform vec3 uTip;
  uniform vec3 uSkin;
  uniform vec3 uKeyDir;
  uniform vec3 uKeyCol;
  uniform vec3 uRimDir;
  uniform vec3 uRimCol;
  uniform vec3 uAmb;
  uniform float uDensity;

  varying vec3 vRest;
  varying vec3 vNormalW;
  varying vec3 vCombW;
  varying vec3 vPosW;
  varying float vLen;
  varying float vF;
  varying float vBase;

  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }

  void main() {
    if (vLen < 0.0018) discard;
    float hf = (vF - 0.45) / 0.55;

    vec3 c = vRest * uDensity;
    vec3 rnd = hash33(floor(c));
    float d = length(fract(c) - (0.25 + 0.5 * rnd));
    float strandLen = mix(0.55, 1.0, rnd.y);

    float alpha;
    if (vBase > 0.5) {
      alpha = smoothstep(0.015, 0.022, vLen);
    } else {
      if (hf > strandLen) discard;
      float r = 0.52 * (1.0 - hf / strandLen) + 0.04;
      float aa = fwidth(d) * 1.2 + 1e-4;
      alpha = 1.0 - smoothstep(r - aa, r + aa, d);
    }
    if (alpha < 0.02) discard;

    float shortMix = smoothstep(0.004, 0.05, vLen);
    vec3 hairCol = mix(uRoot, uTip, hf * (0.55 + 0.45 * rnd.z));
    vec3 albedo = mix(uRoot * 1.3, hairCol, shortMix);

    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    vec3 T = normalize(mix(N, vCombW, 0.7));
    float wrap = clamp((dot(N, uKeyDir) + 0.45) / 1.45, 0.0, 1.0);
    vec3 H = normalize(uKeyDir + V);
    float th = dot(T, H);
    float spec = pow(sqrt(max(0.0, 1.0 - th * th)), 80.0) * (0.2 + 0.8 * hf);
    float ao = mix(0.3, 1.0, hf);
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5) * (0.5 + 0.5 * dot(N, uRimDir));

    vec3 col = albedo * (uAmb + uKeyCol * wrap) * ao;
    col += uKeyCol * spec * 0.3 * shortMix;
    col += uRimCol * max(rim, 0.0) * (0.15 + 0.85 * hf) * 0.35;
    gl_FragColor = vec4(col, alpha);
  }
`;

export function hairUniforms() {
  return {
    uProg: { value: new THREE.Vector3(1, 1, 1) },
    uWidth: { value: 0.18 },
    uGrow: { value: 1 },
    uBend: { value: 0.75 },
    uDensity: { value: 62 },
    uRoot: { value: new THREE.Color('#1c130e') },
    uTip: { value: new THREE.Color('#6b4a33') },
    uSkin: { value: new THREE.Color('#d8ccb9') },
    uKeyDir: { value: new THREE.Vector3(0.45, 0.55, 0.7).normalize() },
    uKeyCol: { value: new THREE.Color('#ffd9a8').multiplyScalar(1.6) },
    uRimDir: { value: new THREE.Vector3(-0.6, 0.3, -0.7).normalize() },
    uRimCol: { value: new THREE.Color('#6f8dff').multiplyScalar(1.4) },
    uAmb: { value: new THREE.Color('#2b3550').multiplyScalar(0.9) },
  };
}

// ------------------------------------------------------------- the system

export class Hair {
  constructor(headGeometry, { layers = 28 } = {}) {
    const P = headGeometry.attributes.position.array;
    const N = headGeometry.attributes.normal.array;
    const I = headGeometry.index.array;
    const total = P.length / 3;

    const remap = new Int32Array(total).fill(-1);
    const keepHair = [], keepBeard = [], keepIdx = [];
    for (let i = 0; i < total; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const hm = hairMask(x, y, z), bm = beardMask(x, y, z);
      if (hm > 0.002 || bm > 0.002) {
        remap[i] = keepIdx.length;
        keepIdx.push(i);
        keepHair.push(hm);
        keepBeard.push(bm);
      }
    }
    const n = keepIdx.length;
    this.count = n;
    this.keepIdx = Int32Array.from(keepIdx);
    this.pos = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const i = keepIdx[k];
      for (let c = 0; c < 3; c++) {
        this.pos[k * 3 + c] = P[i * 3 + c];
        this.nrm[k * 3 + c] = N[i * 3 + c];
      }
    }
    const tris = [];
    for (let t = 0; t < I.length; t += 3) {
      const a = remap[I[t]], b = remap[I[t + 1]], c = remap[I[t + 2]];
      if (a >= 0 && b >= 0 && c >= 0) tris.push(a, b, c);
    }
    this.hm = Float32Array.from(keepHair);
    this.bm = Float32Array.from(keepBeard);

    // which tool owns each vertex, and where along that tool's pass it sits
    this.zone = new Float32Array(n * 3);
    this.sweep = new Float32Array(n * 3);
    this.noise = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const x = this.pos[k * 3], y = this.pos[k * 3 + 1], z = this.pos[k * 3 + 2];
      const wb = smooth(-0.15, 0.15, this.bm[k] - this.hm[k]);
      const wt = (1 - wb) * smooth(0.34, 0.5, y);
      this.zone[k * 3] = 1 - wb - wt;
      this.zone[k * 3 + 1] = wt;
      this.zone[k * 3 + 2] = wb;
      this.sweep[k * 3] = smooth(-0.5, 0.55, y);
      this.sweep[k * 3 + 1] = 1 - smooth(-0.75, 0.75, z);
      this.sweep[k * 3 + 2] = clamp((Math.atan2(x, z) + 1.55) / 3.1, 0, 1);
      this.noise[k] = noise3(x * 7, y * 7, z * 7);
    }

    // The head mesh gets the same fields so very short hair (fades, stubble)
    // can be painted straight onto the skin with the head's own lighting.
    this.headFrom = new THREE.BufferAttribute(new Float32Array(total), 1);
    this.headTo = new THREE.BufferAttribute(new Float32Array(total), 1);
    const headZone = new Float32Array(total * 3);
    const headSweep = new Float32Array(total * 3);
    for (let k = 0; k < n; k++) {
      const i = keepIdx[k];
      for (let c = 0; c < 3; c++) {
        headZone[i * 3 + c] = this.zone[k * 3 + c];
        headSweep[i * 3 + c] = this.sweep[k * 3 + c];
      }
    }
    headGeometry.setAttribute('aFrom', this.headFrom);
    headGeometry.setAttribute('aTo', this.headTo);
    headGeometry.setAttribute('aZone', new THREE.BufferAttribute(headZone, 3));
    headGeometry.setAttribute('aSweep', new THREE.BufferAttribute(headSweep, 3));

    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(tris, 1) : new THREE.Uint16BufferAttribute(tris, 1));
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3));
    geo.setAttribute('aZone', new THREE.BufferAttribute(this.zone, 3));
    geo.setAttribute('aSweep', new THREE.BufferAttribute(this.sweep, 3));
    this.from = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.to = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.combFrom = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.combTo = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    geo.setAttribute('aFrom', this.from);
    geo.setAttribute('aTo', this.to);
    geo.setAttribute('aCombFrom', this.combFrom);
    geo.setAttribute('aCombTo', this.combTo);
    const layerValues = new Float32Array(layers);
    for (let i = 0; i < layers; i++) layerValues[i] = i / (layers - 1);
    geo.setAttribute('aLayer', new THREE.InstancedBufferAttribute(layerValues, 1));
    geo.instanceCount = layers;

    this.uniforms = hairUniforms();
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      alphaToCoverage: true,
    });
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

  // Length and comb fields for one hair + beard combination, cached.
  field(hair, beard) {
    const key = `${hair}|${beard}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const n = this.count;
    const len = new Float32Array(n);
    const comb = new Float32Array(n * 3);
    const hairFn = HAIR[hair], beardFn = BEARD[beard];
    for (let k = 0; k < n; k++) {
      const x = this.pos[k * 3], y = this.pos[k * 3 + 1], z = this.pos[k * 3 + 2];
      const nz = this.noise[k];
      const chin = smooth(-0.55, -0.85, y) * smooth(0.15, 0.5, z);
      const stache = smooth(-0.47, -0.42, y) * smooth(0.6, 0.7, z) * (1 - smooth(0.2, 0.28, Math.abs(x)));
      const h = hairFn(x, y, z, nz);
      const b = beardFn(x, y, z, nz, chin, stache);
      const lh = this.hm[k] ** 1.6 * h[0], lb = this.bm[k] ** 1.3 * b[0];
      const src = lh >= lb ? h : b;
      len[k] = Math.max(lh, lb);
      // project the comb direction onto the surface
      const nx = this.nrm[k * 3], ny = this.nrm[k * 3 + 1], nzz = this.nrm[k * 3 + 2];
      let cx = src[1], cy = src[2], cz = src[3];
      const dn = cx * nx + cy * ny + cz * nzz;
      cx -= nx * dn; cy -= ny * dn; cz -= nzz * dn;
      const cl = Math.hypot(cx, cy, cz) || 1;
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
      hf[this.keepIdx[k]] = from.len[k];
      ht[this.keepIdx[k]] = to.len[k];
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
    const len = new Float32Array(n);
    const comb = new Float32Array(n * 3);
    const A = this.from.array, B = this.to.array, CA = this.combFrom.array, CB = this.combTo.array;
    for (let k = 0; k < n; k++) {
      let t = 0;
      for (let z = 0; z < 3; z++) t += this.zone[k * 3 + z] * clamp((p[z] * (1 + w) - this.sweep[k * 3 + z]) / w, 0, 1);
      len[k] = mix(A[k], B[k], t);
      for (let c = 0; c < 3; c++) comb[k * 3 + c] = mix(CA[k * 3 + c], CB[k * 3 + c], t);
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
      if (Math.abs(from.len[k] - target.len[k]) < 0.004) continue;
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

