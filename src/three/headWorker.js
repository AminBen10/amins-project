// Practice head builder. Decodes the compact cage from headAsset.js (MakeHuman CC0 mesh, see
// scripts/head/README.md), runs Catmull-Clark subdivision and interpolates the baked attributes
// (AO, cavity, thickness, hair/beard edges, eye flag) with the same rule. It runs in a worker;
// head.js imports buildHead() for the main-thread fallback. Plain JS, no three.js.
// The worker stays alive afterwards and runs the cut-step engine (hairField.computeProgram).

import { computeProgram, engineGeometry } from './hairField.js';

/** URL of the module (or of the built chunk holding it): the shared worker bootstrap imports it. */
export const MODULE_URL = import.meta.url;

// ------------------------------------------------------------------ inflate (raw deflate)

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function huffman(lengths, n) {
  const count = new Uint16Array(16);
  const symbol = new Uint16Array(n);
  const offs = new Uint16Array(16);
  for (let i = 0; i < n; i++) count[lengths[i]]++;
  count[0] = 0;
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
  for (let i = 0; i < n; i++) if (lengths[i]) symbol[offs[lengths[i]]++] = i;
  return { count, symbol };
}

// Small canonical-Huffman inflater (after zlib's puff.c); the asset is ~50 KB.
export function inflateRaw(src) {
  let out = new Uint8Array(src.length * 3);
  let len = 0;
  let pos = 0, buf = 0, cnt = 0;
  const bits = (n) => {
    while (cnt < n) {
      if (pos >= src.length) throw new Error('inflate: unexpected end');
      buf |= src[pos++] << cnt;
      cnt += 8;
    }
    const v = buf & ((1 << n) - 1);
    buf >>>= n;
    cnt -= n;
    return v;
  };
  const put = (b) => {
    if (len === out.length) {
      const grown = new Uint8Array(out.length * 2);
      grown.set(out);
      out = grown;
    }
    out[len++] = b;
  };
  const decode = (h) => {
    let code = 0, first = 0, index = 0;
    for (let l = 1; l < 16; l++) {
      code |= bits(1);
      const c = h.count[l];
      if (code - c < first) return h.symbol[index + (code - first)];
      index += c;
      first = (first + c) << 1;
      code <<= 1;
    }
    throw new Error('inflate: bad code');
  };
  const block = (lc, dc) => {
    for (;;) {
      let sym = decode(lc);
      if (sym < 256) put(sym);
      else if (sym === 256) return;
      else {
        sym -= 257;
        const n = LBASE[sym] + bits(LEXT[sym]);
        const ds = decode(dc);
        const dist = DBASE[ds] + bits(DEXT[ds]);
        for (let i = 0; i < n; i++) put(out[len - dist]);
      }
    }
  };
  let last;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      buf = 0;
      cnt = 0;
      const n = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      for (let i = 0; i < n; i++) put(src[pos++]);
    } else if (type === 1) {
      const l = new Uint8Array(288);
      l.fill(8, 0, 144);
      l.fill(9, 144, 256);
      l.fill(7, 256, 280);
      l.fill(8, 280, 288);
      block(huffman(l, 288), huffman(new Uint8Array(30).fill(5), 30));
    } else if (type === 2) {
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
      const lengths = new Uint8Array(320);
      for (let i = 0; i < ncode; i++) lengths[CLORDER[i]] = bits(3);
      const lc = huffman(lengths, 19);
      lengths.fill(0);
      let i = 0;
      while (i < nlen + ndist) {
        const sym = decode(lc);
        if (sym < 16) lengths[i++] = sym;
        else {
          let v = 0, rep;
          if (sym === 16) {
            v = lengths[i - 1];
            rep = 3 + bits(2);
          } else if (sym === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          while (rep--) lengths[i++] = v;
        }
      }
      block(huffman(lengths.subarray(0, nlen), nlen), huffman(lengths.subarray(nlen, nlen + ndist), ndist));
    } else throw new Error('inflate: bad block type');
  } while (!last);
  return out.subarray(0, len);
}

// ------------------------------------------------------------------ cage decoding

const unzig = (v) => (v >>> 1) ^ -(v & 1);
export const ATTR = { ao: 0, cavity: 1, thickness: 2, edgeH: 3, edgeB: 4, part: 5 };
export const NATTR = 6;

export function base64Bytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// Layout: see scripts/head/encode.py. Returns cage positions, quads, attributes (nv x NATTR,
// decoded to real values) and the radius grid used by hairField.surfaceAt.
export function decodeCage(deflated, { qbits = 12, edgeMax = 0.5, thickMax = 0.3 } = {}) {
  const raw = inflateRaw(deflated);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (String.fromCharCode(raw[0], raw[1], raw[2], raw[3]) !== 'HD01') throw new Error('head asset: bad magic');
  const nv = dv.getUint16(4, true), nq = dv.getUint16(6, true);
  const bmin = [dv.getFloat32(8, true), dv.getFloat32(12, true), dv.getFloat32(16, true)];
  const bmax = [dv.getFloat32(20, true), dv.getFloat32(24, true), dv.getFloat32(28, true)];
  const nPhi = dv.getUint16(32, true), nY = dv.getUint16(34, true);
  const y0 = dv.getFloat32(36, true), dy = dv.getFloat32(40, true), rScale = dv.getFloat32(44, true);
  const nAttr = dv.getUint16(48, true);
  let o = 52;
  const qmax = (1 << qbits) - 1;
  const positions = new Float32Array(nv * 3);
  for (let a = 0; a < 3; a++) {
    let acc = 0;
    const k = (bmax[a] - bmin[a]) / qmax;
    for (let i = 0; i < nv; i++) {
      acc += unzig(raw[o + i] | (raw[o + nv + i] << 8));
      positions[i * 3 + a] = bmin[a] + acc * k;
    }
    o += nv * 2;
  }
  const qlen = dv.getUint32(o, true);
  o += 4;
  const quads = new Uint32Array(nq * 4);
  {
    let acc = 0, j = 0, end = o + qlen;
    while (o < end) {
      let v = 0, shift = 0, b;
      do {
        b = raw[o++];
        v += (b & 127) * 2 ** shift;
        shift += 7;
      } while (b & 128);
      acc += unzig(v);
      quads[j++] = acc;
    }
  }
  const attrs = new Float32Array(nv * NATTR);
  for (let a = 0; a < nAttr; a++) {
    for (let i = 0; i < nv; i++) {
      const c = raw[o + i];
      let v;
      if (a === ATTR.thickness) v = (c / 255) * thickMax;
      else if (a === ATTR.edgeH || a === ATTR.edgeB) {
        const s = (c - 128) / 127;
        v = Math.sign(s) * s * s * edgeMax;
      } else if (a === ATTR.part) v = c;
      else v = c / 255;
      attrs[i * NATTR + a] = v;
    }
    o += nv;
  }
  const r = new Float32Array(nPhi * nY);
  for (let row = 0; row < nY; row++) {
    let acc = 0;
    for (let c = 0; c < nPhi; c++) {
      const i = row * nPhi + c;
      acc += unzig(raw[o + i] | (raw[o + nPhi * nY + i] << 8));
      r[i] = acc / rScale;
    }
  }
  return { nv, nq, positions, quads, attrs, grid: { nPhi, nY, y0, dy, r } };
}

// ------------------------------------------------------------------ Catmull-Clark

// One step on a quad mesh with open boundaries (boundary edges are creases). X holds `d` floats
// per vertex (position first, then attributes) and every channel follows the same rule.
// New vertex order: old vertices, face points, edge points (so vertex i keeps its index).
export function catmullClark(X, d, Q) {
  const n = X.length / d, nf = Q.length / 4;
  const fe = new Uint32Array(nf * 4);
  const ea = [], eb = [];
  const map = new Map();
  for (let f = 0; f < nf; f++) {
    for (let i = 0; i < 4; i++) {
      const a = Q[f * 4 + i], b = Q[f * 4 + ((i + 1) & 3)];
      const lo = a < b ? a : b, hi = a < b ? b : a;
      const key = lo * n + hi;
      let e = map.get(key);
      if (e === undefined) {
        e = ea.length;
        map.set(key, e);
        ea.push(lo);
        eb.push(hi);
      }
      fe[f * 4 + i] = e;
    }
  }
  const ne = ea.length;
  const N = n + nf + ne;
  const Y = new Float32Array(N * d);
  // face points
  const fo = n * d;
  for (let f = 0; f < nf; f++) {
    for (let c = 0; c < d; c++) {
      Y[fo + f * d + c] = (X[Q[f * 4] * d + c] + X[Q[f * 4 + 1] * d + c] + X[Q[f * 4 + 2] * d + c] + X[Q[f * 4 + 3] * d + c]) * 0.25;
    }
  }
  // per edge: face count and face-point sum
  const ecount = new Uint8Array(ne);
  const esum = new Float32Array(ne * d);
  for (let f = 0; f < nf; f++) {
    for (let i = 0; i < 4; i++) {
      const e = fe[f * 4 + i];
      ecount[e]++;
      for (let c = 0; c < d; c++) esum[e * d + c] += Y[fo + f * d + c];
    }
  }
  const eo = (n + nf) * d;
  const vf = new Uint16Array(n), ve = new Uint16Array(n), vb = new Uint8Array(n);
  const qsum = new Float32Array(n * d), rsum = new Float32Array(n * d), bsum = new Float32Array(n * d);
  for (let e = 0; e < ne; e++) {
    const a = ea[e], b = eb[e];
    const boundary = ecount[e] === 1;
    for (let c = 0; c < d; c++) {
      const xa = X[a * d + c], xb = X[b * d + c];
      const mid = (xa + xb) * 0.5;
      Y[eo + e * d + c] = boundary ? mid : (xa + xb + esum[e * d + c]) * 0.25;
      rsum[a * d + c] += mid;
      rsum[b * d + c] += mid;
      if (boundary) {
        bsum[a * d + c] += xb;
        bsum[b * d + c] += xa;
      }
    }
    ve[a]++;
    ve[b]++;
    if (boundary) vb[a] = vb[b] = 1;
  }
  for (let f = 0; f < nf; f++) {
    for (let i = 0; i < 4; i++) {
      const v = Q[f * 4 + i];
      vf[v]++;
      for (let c = 0; c < d; c++) qsum[v * d + c] += Y[fo + f * d + c];
    }
  }
  for (let v = 0; v < n; v++) {
    const k = vf[v];
    for (let c = 0; c < d; c++) {
      const x = X[v * d + c];
      let y;
      if (!k) y = x;
      else if (vb[v]) y = 0.75 * x + 0.125 * bsum[v * d + c];
      else y = (qsum[v * d + c] / k + (2 * rsum[v * d + c]) / ve[v] + (k - 3) * x) / k;
      Y[v * d + c] = y;
    }
  }
  const Q2 = new Uint32Array(nf * 16);
  for (let f = 0; f < nf; f++) {
    for (let i = 0; i < 4; i++) {
      const o = (f * 4 + i) * 4;
      Q2[o] = Q[f * 4 + i];
      Q2[o + 1] = n + nf + fe[f * 4 + i];
      Q2[o + 2] = n + f;
      Q2[o + 3] = n + nf + fe[f * 4 + ((i + 3) & 3)];
    }
  }
  return { X: Y, Q: Q2 };
}

function normalsOf(P, I, n) {
  const N = new Float32Array(n * 3);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    N[a] += nx; N[a + 1] += ny; N[a + 2] += nz;
    N[b] += nx; N[b + 1] += ny; N[b + 2] += nz;
    N[c] += nx; N[c + 1] += ny; N[c + 2] += nz;
  }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1;
    N[i * 3] /= l;
    N[i * 3 + 1] /= l;
    N[i * 3 + 2] /= l;
  }
  return N;
}

function triangulate(Q, n) {
  const nq = Q.length / 4;
  const I = n > 65535 ? new Uint32Array(nq * 6) : new Uint16Array(nq * 6);
  for (let f = 0; f < nq; f++) {
    const o = f * 6;
    I[o] = Q[f * 4];
    I[o + 1] = Q[f * 4 + 1];
    I[o + 2] = Q[f * 4 + 2];
    I[o + 3] = Q[f * 4];
    I[o + 4] = Q[f * 4 + 2];
    I[o + 5] = Q[f * 4 + 3];
  }
  return I;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Zone masks from the stored signed edge distances (head units, + inside). Shared with hair.js.
export const hairMaskOf = (edgeH) => smooth(-0.02, 0.05, edgeH);
export const beardMaskOf = (edgeB) => smooth(-0.015, 0.03, edgeB);

// levels: 2 on the high tier (skin ~72k vertices, hair subset ~18k), 1 on low (~18k, ~4.5k).
// The hair shells are the subset of skin vertices inside the hair or beard zone, as before.
export function buildHead(deflated, { levels = 2, onProgress } = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const cage = decodeCage(deflated);
  onProgress?.(0.15);
  const d = 3 + NATTR;
  let X = new Float32Array(cage.nv * d);
  for (let i = 0; i < cage.nv; i++) {
    X[i * d] = cage.positions[i * 3];
    X[i * d + 1] = cage.positions[i * 3 + 1];
    X[i * d + 2] = cage.positions[i * 3 + 2];
    for (let a = 0; a < NATTR; a++) X[i * d + 3 + a] = cage.attrs[i * NATTR + a];
  }
  let Q = cage.quads;
  const nLevels = levels >= 2 ? 2 : 1;
  for (let l = 0; l < nLevels; l++) {
    const r = catmullClark(X, d, Q);
    X = r.X;
    Q = r.Q;
    onProgress?.(0.15 + (0.55 * (l + 1)) / nLevels);
  }
  const n = X.length / d;
  const positions = new Float32Array(n * 3);
  const bake = new Float32Array(n * 3);
  const edge = new Float32Array(n * 2);
  const mask = new Float32Array(n * 2);
  const eye = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * d;
    positions[i * 3] = X[o];
    positions[i * 3 + 1] = X[o + 1];
    positions[i * 3 + 2] = X[o + 2];
    bake[i * 3] = X[o + 3 + ATTR.ao];
    bake[i * 3 + 1] = X[o + 3 + ATTR.cavity];
    bake[i * 3 + 2] = X[o + 3 + ATTR.thickness];
    const isEye = X[o + 3 + ATTR.part] > 0.5;
    eye[i] = isEye ? 1 : 0;
    const eh = isEye ? -0.5 : X[o + 3 + ATTR.edgeH];
    const eb = isEye ? -0.5 : X[o + 3 + ATTR.edgeB];
    edge[i * 2] = eh;
    edge[i * 2 + 1] = eb;
    mask[i * 2] = hairMaskOf(eh);
    mask[i * 2 + 1] = beardMaskOf(eb);
  }
  const indices = triangulate(Q, n);
  const normals = normalsOf(positions, indices, n);
  onProgress?.(0.85);

  // hair subset
  const keepMap = new Int32Array(n).fill(-1);
  const keep = [];
  for (let i = 0; i < n; i++) {
    if (mask[i * 2] > 0.02 || mask[i * 2 + 1] > 0.02) {
      keepMap[i] = keep.length;
      keep.push(i);
    }
  }
  const m = keep.length;
  const hp = new Float32Array(m * 3), hn = new Float32Array(m * 3), hm = new Float32Array(m * 2), he = new Float32Array(m * 2);
  for (let k = 0; k < m; k++) {
    const i = keep[k];
    for (let c = 0; c < 3; c++) {
      hp[k * 3 + c] = positions[i * 3 + c];
      hn[k * 3 + c] = normals[i * 3 + c];
    }
    hm[k * 2] = mask[i * 2];
    hm[k * 2 + 1] = mask[i * 2 + 1];
    he[k * 2] = edge[i * 2];
    he[k * 2 + 1] = edge[i * 2 + 1];
  }
  const tris = [];
  for (let f = 0; f < Q.length; f += 4) {
    const a = keepMap[Q[f]], b = keepMap[Q[f + 1]], c = keepMap[Q[f + 2]], e = keepMap[Q[f + 3]];
    if (a >= 0 && b >= 0 && c >= 0) tris.push(a, b, c);
    if (a >= 0 && c >= 0 && e >= 0) tris.push(a, c, e);
  }
  const hi = m > 65535 ? Uint32Array.from(tris) : Uint16Array.from(tris);
  const time = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  onProgress?.(1);
  return {
    positions, normals, indices, bake, edge, mask, eye,
    levels: nLevels,
    hair: { positions: hp, normals: hn, indices: hi, mask: hm, edge: he, keep: Uint32Array.from(keep) },
    stats: { cage: cage.nv, verts: n, tris: indices.length / 3, shellVerts: m, ms: Math.round(time) },
  };
}

export function transferList(data) {
  const list = [data.positions, data.normals, data.indices, data.bake, data.edge, data.mask, data.eye,
    data.hair.positions, data.hair.normals, data.hair.indices, data.hair.mask, data.hair.edge, data.hair.keep];
  return list.map((a) => a.buffer);
}

// Worker entry (inert when this module is imported on the main thread or in node). A
// persistent service: meshing first, then the cut-step engine for every program the page
// prepares. Messages {type, id, ...}; replies {id, type: 'progress' | 'done' | 'error'}.
if (typeof self !== 'undefined' && typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  let hairGeo = null;
  self.onmessage = (event) => {
    const msg = event.data || {};
    const id = msg.id;
    try {
      if (msg.type === 'mesh') {
        const data = buildHead(new Uint8Array(msg.cage), {
          levels: msg.levels,
          onProgress: (p) => self.postMessage({ id, type: 'progress', p }),
        });
        self.postMessage({ id, type: 'done', data }, transferList(data));
      } else if (msg.type === 'hairSetup') {
        hairGeo = engineGeometry(msg.input);
        self.postMessage({ id, type: 'done', data: { n: hairGeo.n } });
      } else if (msg.type === 'program') {
        if (!hairGeo) throw new Error('hair engine: no setup');
        const res = computeProgram(hairGeo, msg.program, msg.opts);
        const bufs = new Set();
        for (const s of res.states) bufs.add(s.a.buffer).add(s.c.buffer);
        for (const i of res.info) {
          bufs.add(i.sweep.buffer);
          if (i.pend) bufs.add(i.pend.buffer);
        }
        self.postMessage({ id, type: 'done', data: res }, [...bufs]);
      }
    } catch (err) {
      self.postMessage({ id, type: 'error', message: String(err && err.message ? err.message : err) });
    }
  };
}
