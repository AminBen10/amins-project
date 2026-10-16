// Sculpted mannequin head described as a signed distance field, then meshed
// with surface nets. Units: 1 ≈ 11 cm. The face looks down +Z, Y is up.
// Everything here is plain JS so it can run on the main thread or in a worker.

const { sqrt, abs, max, min, cos, sin } = Math;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function ell(x, y, z, rx, ry, rz) {
  const ix = 1 / rx, iy = 1 / ry, iz = 1 / rz;
  const px = x * ix, py = y * iy, pz = z * iz;
  const k0 = sqrt(px * px + py * py + pz * pz);
  const qx = px * ix, qy = py * iy, qz = pz * iz;
  const k1 = sqrt(qx * qx + qy * qy + qz * qz);
  return k1 === 0 ? -min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

function smin(a, b, k) {
  const h = max(k - abs(a - b), 0) / k;
  return min(a, b) - h * h * k * 0.25;
}

function smax(a, b, k) {
  const h = max(k - abs(a - b), 0) / k;
  return max(a, b) + h * h * k * 0.25;
}

// Capsule whose radius goes from ra (at a) to rb (at b).
function cone(x, y, z, ax, ay, az, bx, by, bz, ra, rb) {
  const pax = x - ax, pay = y - ay, paz = z - az;
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const t = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  const dx = pax - bax * t, dy = pay - bay * t, dz = paz - baz * t;
  return sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * t);
}

const EAR_TILT = 0.28;
const ET_C = cos(EAR_TILT), ET_S = sin(EAR_TILT);

function ear(ax, y, z) {
  // ear-local frame: tilt the ear back around X
  const lx = ax - 0.69;
  const ly0 = y + 0.05, lz0 = z + 0.12;
  const ly = ly0 * ET_C - lz0 * ET_S;
  const lz = ly0 * ET_S + lz0 * ET_C;
  let d = ell(lx, ly, lz, 0.08, 0.25, 0.155);
  d = smax(d, -ell(lx - 0.075, ly - 0.015, lz - 0.015, 0.06, 0.17, 0.095), 0.035);
  return d;
}

export function headSDF(x, y, z) {
  const ax = abs(x);

  // cranium, forehead and face masses
  let d = ell(x, y - 0.3, z + 0.1, 0.71, 0.8, 0.85);
  d = smin(d, ell(x, y - 0.36, z - 0.3, 0.56, 0.44, 0.44), 0.2);
  d = smin(d, ell(x, y + 0.2, z - 0.16, 0.58, 0.72, 0.62), 0.28);

  // Far from the surface only the sign matters, so skip the detail work.
  if (d > 0.45 && y > -0.1) return d;

  // jawline from the angle to the chin, then the chin itself
  if (y < 0.0) {
    d = smin(d, cone(ax, y, z, 0.4, -0.5, -0.12, 0.07, -0.86, 0.47, 0.1, 0.11), 0.22);
    d = smin(d, ell(x, y + 0.84, z - 0.5, 0.17, 0.13, 0.14), 0.2);
  }

  if (z > -0.05 && y > -1.05 && y < 0.62) {
    // cheekbones and brow
    d = smin(d, ell(ax - 0.4, y - 0.0, z - 0.36, 0.18, 0.12, 0.18), 0.16);
    d = smin(d, ell(x, y - 0.21, z - 0.57, 0.46, 0.1, 0.15), 0.14);

    // soft eye sockets with closed lids
    d = smax(d, -ell(ax - 0.26, y - 0.035, z - 0.76, 0.15, 0.085, 0.11), 0.1);
    d = smin(d, ell(ax - 0.258, y - 0.02, z - 0.61, 0.13, 0.08, 0.11), 0.08);

    // nose: bridge to tip, then the wings
    d = smin(d, cone(x, y, z, 0, 0.13, 0.68, 0, -0.27, 0.93, 0.05, 0.088), 0.09);
    d = smin(d, ell(ax - 0.085, y + 0.3, z - 0.81, 0.075, 0.055, 0.075), 0.06);

    // muzzle and lips
    d = smin(d, ell(x, y + 0.5, z - 0.6, 0.27, 0.2, 0.2), 0.14);
    d = smin(d, ell(x, y + 0.455, z - 0.76, 0.16, 0.05, 0.07), 0.08);
    d = smin(d, ell(x, y + 0.55, z - 0.745, 0.14, 0.055, 0.07), 0.08);
  }

  // ears
  if (ax > 0.45 && y > -0.45 && y < 0.35) d = smin(d, ear(ax, y, z), 0.07);

  // neck, cut flat like a sculptor's bust
  if (y < -0.1) d = smin(d, cone(x, y, z, 0, -0.5, -0.22, 0, -1.7, -0.14, 0.41, 0.46), 0.3);
  d = smax(d, -(y + 1.42), 0.04);
  return d;
}

export const HEAD_BOUNDS = { min: [-0.92, -1.48, -1.0], max: [0.92, 1.16, 1.02] };

// Surface nets polygonizer. Returns indexed triangles with SDF-gradient normals.
export function polygonize(sdf, bounds = HEAD_BOUNDS, step = 0.02) {
  const [x0, y0, z0] = bounds.min;
  const nx = Math.ceil((bounds.max[0] - x0) / step) + 1;
  const ny = Math.ceil((bounds.max[1] - y0) / step) + 1;
  const nz = Math.ceil((bounds.max[2] - z0) / step) + 1;
  const field = new Float32Array(nx * ny * nz);
  const idx = (i, j, k) => i + nx * (j + ny * k);

  // Coarse pass first, then only refine the blocks that can hold surface.
  const F = 4;
  const C = F * step;
  const cx = Math.ceil((nx - 1) / F) + 1, cy = Math.ceil((ny - 1) / F) + 1, cz = Math.ceil((nz - 1) / F) + 1;
  const coarse = new Float32Array(cx * cy * cz);
  const cidx = (i, j, k) => i + cx * (j + cy * k);
  for (let k = 0; k < cz; k++)
    for (let j = 0; j < cy; j++)
      for (let i = 0; i < cx; i++) coarse[cidx(i, j, k)] = sdf(x0 + i * C, y0 + j * C, z0 + k * C);

  const done = new Uint8Array(nx * ny * nz);
  const band = C * 1.25;
  for (let bk = 0; bk < cz - 1; bk++) {
    for (let bj = 0; bj < cy - 1; bj++) {
      for (let bi = 0; bi < cx - 1; bi++) {
        let near = false;
        let sign = 0;
        for (let c = 0; c < 8 && !near; c++) {
          const val = coarse[cidx(bi + (c & 1), bj + ((c >> 1) & 1), bk + ((c >> 2) & 1))];
          if (Math.abs(val) < band) near = true;
          sign += val < 0 ? -1 : 1;
        }
        if (Math.abs(sign) !== 8) near = true;
        const i1 = Math.min(bi * F + F, nx - 1), j1 = Math.min(bj * F + F, ny - 1), k1 = Math.min(bk * F + F, nz - 1);
        for (let k = bk * F; k <= k1; k++) {
          for (let j = bj * F; j <= j1; j++) {
            for (let i = bi * F; i <= i1; i++) {
              const id = idx(i, j, k);
              if (done[id] === 2) continue;
              if (near) {
                field[id] = sdf(x0 + i * step, y0 + j * step, z0 + k * step);
                done[id] = 2;
              } else if (done[id] === 0) {
                field[id] = sign > 0 ? band : -band;
                done[id] = 1;
              }
            }
          }
        }
      }
    }
  }

  const cellVert = new Int32Array(nx * ny * nz).fill(-1);
  let pos = new Float32Array(1 << 16);
  let count = 0;
  const sy = nx, sz = nx * ny;
  // corner c sits at (c & 1, c >> 1 & 1, c >> 2 & 1)
  const cOff = [0, 1, sy, 1 + sy, sz, 1 + sz, sy + sz, 1 + sy + sz];
  const eA = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3];
  const eB = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];
  const v = new Float32Array(8);

  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      let base = sy * j + sz * k;
      for (let i = 0; i < nx - 1; i++, base++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const val = field[base + cOff[c]];
          v[c] = val;
          if (val < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let ax = 0, ay = 0, az = 0, n = 0;
        for (let e = 0; e < 12; e++) {
          const a = eA[e], b = eB[e];
          const va = v[a], vb = v[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          ax += (a & 1) + ((b & 1) - (a & 1)) * t;
          ay += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          az += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          n++;
        }
        if (count * 3 + 3 > pos.length) {
          const grown = new Float32Array(pos.length * 2);
          grown.set(pos);
          pos = grown;
        }
        cellVert[base] = count;
        pos[count * 3] = x0 + (i + ax / n) * step;
        pos[count * 3 + 1] = y0 + (j + ay / n) * step;
        pos[count * 3 + 2] = z0 + (k + az / n) * step;
        count++;
      }
    }
  }

  let index = new Uint32Array(count * 6 + 6);
  let ic = 0;
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (ic + 6 > index.length) {
      const grown = new Uint32Array(index.length * 2);
      grown.set(index);
      index = grown;
    }
    if (flip) { index[ic++] = a; index[ic++] = c; index[ic++] = b; index[ic++] = a; index[ic++] = d; index[ic++] = c; }
    else { index[ic++] = a; index[ic++] = b; index[ic++] = c; index[ic++] = a; index[ic++] = c; index[ic++] = d; }
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      let id = 1 + sy * j + sz * k;
      for (let i = 1; i < nx - 1; i++, id++) {
        if (cellVert[id] < 0 && cellVert[id - 1] < 0 && cellVert[id - sy] < 0 && cellVert[id - sz] < 0) continue;
        const inside = field[id] < 0;
        if (inside !== field[id + 1] < 0) quad(cellVert[id - sy - sz], cellVert[id - sz], cellVert[id], cellVert[id - sy], !inside);
        if (inside !== field[id + sy] < 0) quad(cellVert[id - 1 - sz], cellVert[id - 1], cellVert[id], cellVert[id - sz], !inside);
        if (inside !== field[id + sz] < 0) quad(cellVert[id - 1 - sy], cellVert[id - sy], cellVert[id], cellVert[id - 1], !inside);
      }
    }
  }

  // Pull vertices onto the true surface and take normals from the gradient.
  const positions = pos.slice(0, count * 3);
  const normals = new Float32Array(count * 3);
  const e = step * 0.25;
  for (let p = 0; p < count; p++) {
    let x = positions[p * 3], y = positions[p * 3 + 1], z = positions[p * 3 + 2];
    const d = sdf(x, y, z);
    let gx = sdf(x + e, y, z) - d;
    let gy = sdf(x, y + e, z) - d;
    let gz = sdf(x, y, z + e) - d;
    const gl = sqrt(gx * gx + gy * gy + gz * gz) || 1;
    gx /= gl; gy /= gl; gz /= gl;
    const s = clamp(d, -step, step);
    x -= gx * s; y -= gy * s; z -= gz * s;
    positions[p * 3] = x; positions[p * 3 + 1] = y; positions[p * 3 + 2] = z;
    normals[p * 3] = gx; normals[p * 3 + 1] = gy; normals[p * 3 + 2] = gz;
  }

  const indices = count > 65535 ? index.slice(0, ic) : Uint16Array.from(index.subarray(0, ic));
  return { positions, normals, indices };
}
