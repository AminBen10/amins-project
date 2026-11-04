import * as THREE from 'three';
import { toolMaterials } from './env.js';
import { MM, surfaceAt, LANDMARKS } from './hairField.js';

// The barber's tools as real objects, modelled in millimetres and scaled by hairField.MM
// (head units per mm), so they sit at true size against the head.
//
// Tool frames (all tools): the origin is the working point.
// - clipper, trimmer: origin = centre of the stationary blade's teeth tips on the contact face.
//   +Y runs from the handle to the blade, +Z points away from the scalp (the body's back, where
//   the switch, LED and guard number are), the guard combs hang on the −Z side.
//   Pose for a pass: origin = surface + normal·(guardMM·MM + 0.004), +Z = normal, +Y = stroke.
// - scissors: origin = pivot screw, blades along +X, they open in the XY plane (setScissors).
// - comb: origin = middle of the spine's lower edge, teeth towards −Y, length along X.
// - razor: origin = middle of the cutting edge, edge facing −Y, blade along +X, scales behind.
// - brush, neckBrush: origin = bristle tips, handle along −Y.

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- geometry helpers

function shape(pts) {
  return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
}

/** Extrude an XY outline along +Z from z0 to z0 + depth. */
function slab(pts, depth, { z0 = 0, bevel = 0, segs = 2, curve = 12 } = {}) {
  const geo = new THREE.ExtrudeGeometry(shape(pts), {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: segs,
    curveSegments: curve,
  });
  geo.translate(0, 0, z0);
  return geo;
}

// (s, t, e) → (x = e, y = s, z = t): an outline drawn in the YZ plane, extruded along X.
const YZ = new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);

/** Rounded rectangle outline (x0,y0)-(x1,y1) with corner radius r. */
function rrect(x0, y0, x1, y1, r, n = 4) {
  const pts = [];
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  corner(x1 - r, y0 + r, -Math.PI / 2);
  corner(x1 - r, y1 - r, 0);
  corner(x0 + r, y1 - r, Math.PI / 2);
  corner(x0 + r, y0 + r, Math.PI);
  return pts;
}

/**
 * Loft of superellipse sections along Y: stations [{y, w, d, cz?, n?}] (half width in X,
 * half depth in Z, centre z, squareness n: 2 = ellipse, 3–4 = rounded box). Capped.
 */
function loft(st, seg = 48, n0 = 2.8) {
  const pos = [];
  const idx = [];
  for (const s of st) {
    const e = 2 / (s.n || n0);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TAU;
      const c = Math.cos(a), sn = Math.sin(a);
      pos.push(s.w * Math.sign(c) * Math.abs(c) ** e, s.y, (s.cz || 0) + s.d * Math.sign(sn) * Math.abs(sn) ** e);
    }
  }
  for (let j = 0; j < st.length - 1; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * seg + i, b = j * seg + ((i + 1) % seg), c = a + seg, d = b + seg;
      idx.push(a, c, b, b, c, d);
    }
  }
  // caps on their own vertices so the rim stays crisp
  const cap = (j, top) => {
    const base = pos.length / 3;
    const s = st[j];
    for (let i = 0; i < seg; i++) pos.push(pos[(j * seg + i) * 3], pos[(j * seg + i) * 3 + 1], pos[(j * seg + i) * 3 + 2]);
    pos.push(0, s.y, s.cz || 0);
    const c = base + seg;
    for (let i = 0; i < seg; i++) {
      const a = base + i, b = base + ((i + 1) % seg);
      if (top) idx.push(c, b, a);
      else idx.push(c, a, b);
    }
  };
  cap(0, false);
  cap(st.length - 1, true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Lathe around Y from [r, y] points, with optional per-vertex colour by y. */
function lathe(points, segs = 64, colorAt = null, flute = 0) {
  const geo = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segs);
  const p = geo.attributes.position;
  if (flute) {
    // bristle bundles: a fine fluting of the radius, stronger towards the tips
    const ys = points.map((q) => q[1]);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), y = p.getY(i);
      const a = Math.atan2(z, x);
      const k = (y - y0) / (y1 - y0);
      const f = 1 + flute * k * (0.6 * Math.sin(a * 61) + 0.4 * Math.sin(a * 23 + y * 0.7));
      p.setXYZ(i, x * f, y, z * f);
    }
  }
  geo.computeVertexNormals();
  if (colorAt) {
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      colorAt(p.getY(i), c);
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  return geo;
}

/** Comb-edge outline: a plate x0..x1, y from yb up to the tooth tips at 0, n teeth of depth h. */
function toothedPlate(x0, x1, yb, n, h, wBase, wTip) {
  const p = (x1 - x0) / n;
  const pts = [[x0, yb], [x1, yb], [x1, -h]];
  for (let i = 0; i < n; i++) {
    const cx = x1 - p / 2 - i * p;
    pts.push([cx + wBase / 2, -h], [cx + wTip / 2, -0.35], [cx + wTip * 0.2, 0], [cx - wTip * 0.2, 0], [cx - wTip / 2, -0.35], [cx - wBase / 2, -h]);
  }
  pts.push([x0, -h]);
  return pts;
}

function mesh(geo, mat, setup) {
  const m = new THREE.Mesh(geo, mat);
  setup?.(m);
  return m;
}

// ---------------------------------------------------------------- guard number decal

// The guard's number, printed on the back of the guard. One canvas, redrawn on every swap,
// in Barlow Condensed 600 once the font has loaded.
function guardDecal() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  let label = '';
  let fontReady = false;
  const draw = () => {
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, 128, 128);
    if (!label) return;
    const size = label.length > 2 ? 84 : 118;
    g.font = `600 ${size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#ECE6D8';
    // optical centre: cap height ≈ 0.7 em
    g.fillText(label, 64, 64 + size * 0.35);
    tex.needsUpdate = true;
  };
  try {
    document.fonts?.load('600 100px "Barlow Condensed"').then(() => {
      fontReady = true;
      draw();
    }, () => {});
  } catch {
    /* no font loading API: canvas fallback face */
  }
  return {
    texture: tex,
    set(text) {
      if (text === label && fontReady) return;
      label = text;
      draw();
    },
  };
}

// ---------------------------------------------------------------- clipper

const CLIPPER_BODY = [
  { y: -166, w: 13, d: 10, cz: 19.5 },
  { y: -165, w: 17.6, d: 15.2, cz: 19.5 },
  { y: -162, w: 19.6, d: 17.6, cz: 19.6 },
  { y: -150, w: 20.6, d: 18.4, cz: 19.8 },
  { y: -115, w: 21.6, d: 19.0, cz: 20 },
  { y: -80, w: 22.6, d: 19.5, cz: 20.2 },
  { y: -50, w: 23.8, d: 20, cz: 20.5 },
  { y: -30, w: 24.4, d: 19.6, cz: 20.7 },
  { y: -20, w: 24, d: 17, cz: 21.6 },
  { y: -14, w: 22.5, d: 13, cz: 23 },
  { y: -11, w: 19, d: 9.5, cz: 24.4 },
  { y: -10, w: 14, d: 6, cz: 25 },
];

function clipper(m, decal, guardsMM) {
  const g = new THREE.Group();
  g.name = 'clipper';
  g.add(mesh(loft(CLIPPER_BODY, 64, 3.2), m.abs));
  // brass band at the waist of the body
  g.add(mesh(loft([
    { y: -43, w: 24.0, d: 20.0, cz: 20.55 },
    { y: -42.4, w: 24.45, d: 20.45, cz: 20.55 },
    { y: -31.6, w: 24.85, d: 20.25, cz: 20.65 },
    { y: -31, w: 24.4, d: 19.8, cz: 20.65 },
  ], 64, 3.2), m.brassBand));
  // chrome tail ring and the charging socket
  g.add(mesh(loft([
    { y: -160.5, w: 20.1, d: 18.0, cz: 19.7 },
    { y: -160, w: 20.5, d: 18.4, cz: 19.7 },
    { y: -156.5, w: 20.7, d: 18.55, cz: 19.75 },
    { y: -156, w: 20.3, d: 18.2, cz: 19.75 },
  ], 64, 3.2), m.chrome));
  g.add(mesh(new THREE.CylinderGeometry(4.2, 4.2, 1, 24), m.grip, (o) => o.position.set(0, -166.2, 19.5)));
  // blade carrier between body and blades
  g.add(mesh(slab(rrect(-22.5, -27, 22.5, -6, 3), 8.5, { z0: 1.6, bevel: 0.8 }), m.grip));
  // stationary blade (fine teeth) and the moving cutter on top of it
  g.add(mesh(slab(toothedPlate(-23, 23, -22, 24, 4.6, 1.05, 0.72), 2.0, { z0: 0.2, bevel: 0.2, segs: 1 }), m.steel));
  g.add(mesh(slab(toothedPlate(-21, 21, -19, 22, 3.6, 1.15, 0.8), 1.2, { z0: 2.4, bevel: 0.15, segs: 1 }), m.chrome, (o) => (o.position.y = -1.3)));
  // two blade screws
  for (const x of [-12, 12]) {
    g.add(mesh(new THREE.CylinderGeometry(2.3, 2.3, 1.2, 20), m.satin, (o) => {
      o.rotation.x = Math.PI / 2;
      o.position.set(x, -15.5, 4.2);
    }));
  }
  // taper lever on the +X flank: boss and arm, pivoting about X
  const lever = new THREE.Group();
  lever.position.set(24.2, -22, 13);
  lever.add(mesh(new THREE.CylinderGeometry(4.2, 4.6, 3, 28), m.brass, (o) => (o.rotation.z = Math.PI / 2)));
  const arm = new THREE.CapsuleGeometry(2.1, 20, 6, 16);
  lever.add(mesh(arm, m.brass, (o) => {
    o.position.set(1.6, -11, 2.5);
    o.rotation.x = 0.22;
  }));
  g.add(lever);
  // power slider on the back, in a dark recess, and the ready LED below it
  g.add(mesh(slab(rrect(-5.5, -86, 5.5, -64, 2.5), 0.6, { z0: 39.2 }), m.grip));
  g.add(mesh(slab(rrect(-3.6, -79, 3.6, -69, 1.8), 2.0, { z0: 39.4, bevel: 0.5 }), m.brass));
  const led = mesh(new THREE.SphereGeometry(1.5, 16, 10), m.led, (o) => o.position.set(0, -100, 38.9));
  g.add(led);

  // Guard combs, built on first use per number. Teeth: an InstancedMesh of 18 fins.
  const guards = {};
  const STRAP = { y0: -66, y1: -47 };
  const strapTop = 20.5 + 21.7;
  const decalMesh = mesh(new THREE.PlaneGeometry(17, 17), new THREE.MeshStandardMaterial({
    map: decal.texture,
    transparent: true,
    roughness: 0.5,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  }), (o) => o.position.set(0, (STRAP.y0 + STRAP.y1) / 2, strapTop + 0.25));
  const strapGeo = loft([
    { y: STRAP.y0, w: 25.0, d: 21.0, cz: 20.5 },
    { y: STRAP.y0 + 0.6, w: 25.7, d: 21.7, cz: 20.5 },
    { y: STRAP.y1 - 0.6, w: 25.7, d: 21.7, cz: 20.5 },
    { y: STRAP.y1, w: 25.0, d: 21.0, cz: 20.5 },
  ], 64, 3.2);
  const baseGeo = slab(rrect(-23.8, -64, 23.8, 3.5, 2.5), 1.4, { z0: -1.6, bevel: 0.3 });
  const lipGeo = new THREE.CapsuleGeometry(1.1, 45, 4, 12);
  function buildGuard(h) {
    const grp = new THREE.Group();
    const H = h + 1.4;
    const fin = shape([
      [3.4, -0.2], [4.2 + 0.18 * H, -0.45 * H], [3.0 + 0.2 * H, -H + 0.6], [1.4 + 0.18 * H, -H],
      [-10, -H], [-34, -0.7 * H - 0.6], [-62, -1.6], [-62, 0], [3.4, 0],
    ]);
    const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 1, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.2, bevelSegments: 1, curveSegments: 8 });
    finGeo.translate(0, 0, -0.5);
    finGeo.applyMatrix4(YZ);
    const fins = new THREE.InstancedMesh(finGeo, m.guard, 18);
    const mtx = new THREE.Matrix4();
    for (let i = 0; i < 18; i++) {
      const outer = i === 0 || i === 17;
      mtx.makeScale(outer ? 2.2 : 1, 1, 1).setPosition(-22.6 + (i * 45.2) / 17, 0, 0);
      fins.setMatrixAt(i, mtx);
    }
    grp.add(fins);
    grp.add(mesh(baseGeo, m.guard));
    grp.add(mesh(lipGeo, m.guard, (o) => {
      o.rotation.z = Math.PI / 2;
      o.position.set(0, 3.8, 1.0);
    }));
    grp.add(mesh(strapGeo, m.guard));
    grp.userData.dispose = () => finGeo.dispose();
    return grp;
  }
  let current = null;
  function setGuard(id) {
    const mm = id == null ? null : guardsMM[id];
    const show = id != null && id !== 'piel' && id !== '0' && mm > 0;
    if (current) current.visible = false;
    current = null;
    if (show) {
      current = guards[id] ||= buildGuard(mm);
      if (!current.parent) g.add(current);
      current.visible = true;
      current.add(decalMesh);
      decal.set(String(id));
    } else if (decalMesh.parent) {
      decalMesh.parent.remove(decalMesh);
    }
    return show ? mm : 0;
  }

  g.userData = {
    lever,
    led,
    setGuard,
    // lever: 0 closed (blade fully out), 1 open (blade backed off: longer cut, used to blend)
    setLever(v) {
      lever.rotation.x = -0.55 * v;
    },
    dispose() {
      for (const k in guards) guards[k].userData.dispose();
      strapGeo.dispose();
      baseGeo.dispose();
      lipGeo.dispose();
      arm.dispose();
      decalMesh.geometry.dispose();
      decalMesh.material.dispose();
    },
  };
  return g;
}

// ---------------------------------------------------------------- trimmer (T-blade)

function trimmer(m) {
  const g = new THREE.Group();
  g.name = 'trimmer';
  g.add(mesh(loft([
    { y: -158, w: 10, d: 10, cz: 17 },
    { y: -157, w: 14.5, d: 14.5, cz: 17 },
    { y: -150, w: 16, d: 16, cz: 17 },
    { y: -100, w: 17, d: 16.6, cz: 17 },
    { y: -55, w: 16.4, d: 15.8, cz: 17 },
    { y: -32, w: 15.6, d: 15, cz: 17 },
    { y: -30, w: 15.2, d: 14.6, cz: 17 },
  ], 56, 2.3), m.abs));
  // knurled-look grip band in a darker rubber
  g.add(mesh(loft([
    { y: -128, w: 16.6, d: 16.6, cz: 17 },
    { y: -127, w: 17.4, d: 17.2, cz: 17 },
    { y: -84, w: 17.6, d: 17.2, cz: 17 },
    { y: -83, w: 16.9, d: 16.5, cz: 17 },
  ], 56, 2.3), m.grip));
  // chrome nose that flares into the T
  g.add(mesh(loft([
    { y: -31, w: 15.4, d: 14.8, cz: 17 },
    { y: -24, w: 15.6, d: 14, cz: 16 },
    { y: -14, w: 18.5, d: 8.5, cz: 10.5 },
    { y: -8.5, w: 20, d: 5.2, cz: 7 },
    { y: -7.5, w: 19.5, d: 4.4, cz: 6.8 },
  ], 56, 3.4), m.satin));
  g.add(mesh(loft([
    { y: -159, w: 14.2, d: 14.2, cz: 17 },
    { y: -158.5, w: 15.2, d: 15.2, cz: 17 },
    { y: -152, w: 16.4, d: 16.4, cz: 17 },
    { y: -151.5, w: 15.8, d: 15.8, cz: 17 },
  ], 56, 2.3), m.chrome));
  g.add(mesh(slab(toothedPlate(-20, 20, -9, 40, 2.4, 0.62, 0.42), 1.4, { z0: 0.2, bevel: 0.15, segs: 1 }), m.steel));
  g.add(mesh(slab(toothedPlate(-18.6, 18.6, -8, 36, 1.8, 0.7, 0.5), 0.9, { z0: 1.6, bevel: 0.1, segs: 1 }), m.chrome, (o) => (o.position.y = -0.9)));
  g.add(mesh(slab(rrect(-3.2, -70, 3.2, -56, 1.6), 1.6, { z0: 33.4, bevel: 0.4 }), m.brass));
  return g;
}

// ---------------------------------------------------------------- scissors

// Offset-handle cutting scissors, 6.5": convex blades, a finger rest on the ring blade.
function scissorBlade(m, sign) {
  const s = sign;
  const g = new THREE.Group();
  // blade: edge along y≈0, convex spine on the +s side, tip at x = 76
  const blade = [
    [-9, -1.1], [12, -0.55], [44, -0.2], [76, 0], [70, 1.9], [56, 4.6], [36, 7.4], [16, 9.2], [2, 9.6], [-9, 8.6],
  ].map(([x, y]) => [x, y * s]);
  const z0 = s > 0 ? 0.05 : -2.05;
  g.add(mesh(slab(blade, 2.0, { z0, bevel: 0.25, segs: 1, curve: 6 }), m.blade));
  // shank from the pivot to the ring on the other side
  const ring = s > 0 ? new THREE.Vector2(-52, -15) : new THREE.Vector2(-62, 15.5);
  const a = new THREE.Vector2(-4, 4 * s);
  const dir = ring.clone().sub(a).normalize();
  const nrm = new THREE.Vector2(-dir.y, dir.x);
  const end = ring.clone().sub(dir.clone().multiplyScalar(10));
  const shank = [
    a.clone().addScaledVector(nrm, 4.6), end.clone().addScaledVector(nrm, 3.0), end.clone().addScaledVector(nrm, -3.0), a.clone().addScaledVector(nrm, -4.6),
  ].map((v) => [v.x, v.y]);
  g.add(mesh(slab(shank, 3.4, { z0: z0 - 0.7, bevel: 0.8, segs: 2 }), m.steel));
  const tor = new THREE.TorusGeometry(10.5, 2.5, 14, 48);
  g.add(mesh(tor, m.steel, (o) => {
    o.position.set(ring.x, ring.y, z0 + 1);
    o.scale.set(1.18, 1, 1.2);
  }));
  if (s < 0) {
    // finger rest (tang) curling off the finger ring
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-70, 23, z0 + 1), new THREE.Vector3(-78, 30, z0 + 1), new THREE.Vector3(-88, 31, z0 + 1), new THREE.Vector3(-93, 26, z0 + 1),
    ]);
    g.add(mesh(new THREE.TubeGeometry(curve, 24, 2.1, 10), m.steel));
    g.add(mesh(new THREE.SphereGeometry(2.8, 16, 10), m.steel, (o) => o.position.set(-93.5, 25.3, z0 + 1)));
  }
  return g;
}

function scissors(m) {
  const g = new THREE.Group();
  g.name = 'scissors';
  const a = scissorBlade(m, 1);
  const b = scissorBlade(m, -1);
  g.add(a, b);
  g.add(mesh(new THREE.CylinderGeometry(3.6, 3.6, 6.4, 28), m.brass, (o) => (o.rotation.x = Math.PI / 2)));
  g.add(mesh(new THREE.CylinderGeometry(1.6, 1.6, 6.8, 16), m.chrome, (o) => (o.rotation.x = Math.PI / 2)));
  g.userData = {
    tip: new THREE.Vector3(76, 0, 0),
    // opening angle in radians (0 closed, ~0.45 wide open)
    setOpen(rad) {
      a.rotation.z = rad / 2;
      b.rotation.z = -rad / 2;
    },
  };
  return g;
}

// ---------------------------------------------------------------- cutting comb

function comb(m) {
  const g = new THREE.Group();
  g.name = 'comb';
  const L = 89;
  const teeth = (x0, x1, pitch, w) => {
    const n = Math.round((x1 - x0) / pitch);
    const p = (x1 - x0) / n;
    const out = [];
    for (let i = 0; i < n; i++) {
      const cx = x0 + p / 2 + i * p;
      out.push([cx - w / 2, 0], [cx - w * 0.35, -18.4], [cx, -19], [cx + w * 0.35, -18.4], [cx + w / 2, 0]);
    }
    return out;
  };
  // outline: spine on top, then right to left along the teeth (fine half, coarse half)
  const bottom = teeth(-L + 3, 0, 2.5, 1.35).concat(teeth(0, L - 3, 1.25, 0.66)).reverse();
  const outline = [[-L, 6.5], [-L + 2, 7.5], [L - 2, 7.5], [L, 6.5], [L, -19], [L - 3, -19]].concat(bottom, [[-L + 3, -19], [-L, -19]]);
  g.add(mesh(slab(outline, 2.2, { z0: -1.1, bevel: 0.2, segs: 1, curve: 2 }), m.carbon));
  return g;
}

// ---------------------------------------------------------------- straight razor

function razor(m) {
  const g = new THREE.Group();
  g.name = 'razor';
  const inner = new THREE.Group();
  // blade: spine at y = 0, edge at y = −22, round point at +X, heel and shoulder at x = 0
  inner.add(mesh(slab([[0, -1], [73, -1], [76, -3.5], [77, -11], [76, -19], [72.5, -22], [7, -22], [2, -19.5], [0, -15]], 1.0, { z0: -0.5, bevel: 0.15, segs: 1, curve: 4 }), m.blade));
  // thick spine along the top
  inner.add(mesh(loft([
    { y: 0, w: 0.6, d: 1.2 }, { y: 0.2, w: 2.6, d: 1.9 }, { y: 75, w: 2.6, d: 1.9 }, { y: 76, w: 1.4, d: 1.2 },
  ], 20, 2.6), m.satin, (o) => {
    o.rotation.z = -Math.PI / 2;
    o.position.set(0, -1.2, 0);
  }));
  // shoulder and tang, thicker steel
  inner.add(mesh(slab([[2, -0.2], [2, -16], [-6, -14.5], [-26, -9.6], [-33, -7.5], [-35, -4], [-33, -0.6]], 3.2, { z0: -1.6, bevel: 0.3, segs: 1, curve: 4 }), m.satin));
  // jimps: file marks across the tang's top edge
  const jimpGeo = new THREE.BoxGeometry(0.5, 0.9, 3.9);
  for (let i = 0; i < 9; i++) inner.add(mesh(jimpGeo, m.grip, (o) => o.position.set(-6 - i * 1.7, -0.6 - i * 0.04, 0)));
  // scales: two walnut slabs either side, pinned in brass at the pivot and tail, wedge between
  const scales = new THREE.Group();
  scales.position.set(-27, -4.5, 0);
  const so = [[6, 7], [-20, 8.6], [-80, 9.2], [-140, 8], [-152, 4.6], [-154, 0], [-152, -4.4], [-140, -7.6], [-80, -8.8], [-20, -8.2], [6, -6.8], [9, 0]];
  for (const zs of [1, -1]) {
    scales.add(mesh(slab(so, 2.2, { z0: zs > 0 ? 1.8 : -4.0, bevel: 0.6, segs: 2, curve: 6 }), m.walnut));
  }
  scales.add(mesh(slab([[-128, 7], [-150, 4.2], [-150, -4.2], [-128, -7]], 3.6, { z0: -1.8 }), m.walnut));
  for (const x of [0, -144]) {
    scales.add(mesh(new THREE.CylinderGeometry(1.4, 1.4, 10.4, 14), m.brass, (o) => {
      o.rotation.x = Math.PI / 2;
      o.position.x = x;
    }));
    for (const zs of [1, -1]) {
      scales.add(mesh(new THREE.CylinderGeometry(3, 3, 0.5, 20), m.brass, (o) => {
        o.rotation.x = Math.PI / 2;
        o.position.set(x, 0, zs * 4.75);
      }));
    }
  }
  scales.rotation.z = -0.18;
  inner.add(scales);
  inner.position.set(-40, 22, 0);
  g.add(inner);
  g.userData = {
    scales,
    // angle between blade and scales (0 = straight out)
    setScales(rad) {
      scales.rotation.z = rad;
    },
  };
  return g;
}

// ---------------------------------------------------------------- brushes

const badger = (y, c) => {
  // knot from y 52 (set in the handle) to the tips at 107.5: dark root, cream, dark band, silver tips
  const k = (y - 52) / 55.5;
  if (k < 0.12) c.set('#2c2520');
  else if (k < 0.55) c.set('#cfc3ad').lerp(new THREE.Color('#e0d6c4'), (k - 0.12) / 0.43);
  else if (k < 0.8) c.set('#4a3d32').lerp(new THREE.Color('#2f2721'), (k - 0.55) / 0.25);
  else c.set('#d9d3c8').lerp(new THREE.Color('#f0ece4'), (k - 0.8) / 0.2);
  c.convertSRGBToLinear();
};

function brush(m) {
  const g = new THREE.Group();
  g.name = 'brush';
  const inner = new THREE.Group();
  inner.add(mesh(lathe([[0, 0], [16.5, 0], [17.6, 1.2], [17.8, 5], [15.2, 11], [13.4, 20], [13.8, 30], [15.6, 38], [17.2, 44], [17.4, 49.5], [16.2, 50.5], [0, 50.5]], 72), m.ivory));
  inner.add(mesh(lathe([[16.4, 49.6], [17.6, 50.2], [17.6, 52.4], [13, 52.6], [0, 52.6]], 72), m.chrome));
  inner.add(mesh(lathe([[0, 51], [12, 51.5], [14, 60], [18, 72], [22, 84], [23.6, 92], [22.6, 98], [18.4, 103], [10.5, 106.6], [0, 107.5]], 96, badger, 0.025), m.knot));
  const lather = mesh(lathe([[0, 90], [20, 90.5], [24.4, 94], [23.4, 100], [18.8, 105.4], [10.6, 108.8], [0, 109.8]], 72, null, 0.02), m.lather);
  lather.visible = false;
  inner.add(lather);
  inner.position.y = -107.5;
  g.add(inner);
  g.userData = {
    setLather(on) {
      lather.visible = !!on;
    },
  };
  return g;
}

function neckBrush(m) {
  const g = new THREE.Group();
  g.name = 'neckBrush';
  const inner = new THREE.Group();
  inner.add(mesh(lathe([[0, 0], [7, 0], [8.4, 2], [8.6, 6], [7.2, 20], [6.6, 50], [7.8, 80], [9.6, 104], [10.4, 112], [0, 112]], 48), m.walnut));
  inner.add(mesh(lathe([[10.2, 110], [11, 111], [11.4, 122], [10.8, 123.5], [0, 123.5]], 48), m.chrome));
  const soft = (y, c) => {
    const k = (y - 120) / 78;
    c.set('#b9ab95').lerp(new THREE.Color('#ebe4d6'), Math.min(1, Math.max(0, k)));
    c.convertSRGBToLinear();
  };
  inner.add(mesh(lathe([[0, 121], [10.4, 121], [14, 130], [21, 148], [25.5, 166], [25, 180], [20, 191], [11, 197], [0, 198.5]], 96, soft, 0.035), m.soft));
  inner.position.y = -198.5;
  g.add(inner);
  return g;
}

// ---------------------------------------------------------------- pose helpers

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();

/** Orient obj: +Z along normal, +Y along `up` made tangent; position at pos. */
export function poseTool(obj, pos, normal, up) {
  _z.copy(normal).normalize();
  _y.copy(up).addScaledVector(_z, -up.dot(_z)).normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  obj.quaternion.setFromRotationMatrix(_m);
  obj.position.copy(pos);
}

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/**
 * createTools({ tier, reducedMotion, guards }) → Tools
 * Tools{ group, tools:{clipper,trimmer,scissors,comb,razor,brush,neckBrush} (Groups, head-local
 *   true scale), setGuard(id|null) → mm (number decal redrawn), setLED(on), setLever(0..1),
 *   setScissors(rad), setLather(on), hideAll(), showAll() (warm-up), update(dt, time, activity)
 *   (interim choreography for the legacy hair activity), dispose() }
 * guards: GUARDS mm table (id → mm).
 */
export function createTools({ tier = 'high', reducedMotion = false, guards = {} } = {}) {
  const m = toolMaterials({ tier });
  const decal = guardDecal();
  const group = new THREE.Group();
  group.name = 'tools';
  const tools = {
    clipper: clipper(m, decal, guards),
    trimmer: trimmer(m),
    scissors: scissors(m),
    comb: comb(m),
    razor: razor(m),
    brush: brush(m),
    neckBrush: neckBrush(m),
  };
  for (const k in tools) {
    const t = tools[k];
    t.scale.setScalar(MM);
    t.visible = false;
    t.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    group.add(t);
  }
  let guardMM = 0;
  let guardId = null;
  const setGuard = (id) => {
    if (id === guardId) return guardMM;
    guardId = id;
    guardMM = tools.clipper.userData.setGuard(id);
    return guardMM;
  };

  // interim choreography state
  const vis = { clipper: 0, scissors: 0, comb: 0, razor: 0 };
  const P = new THREE.Vector3(), N = new THREE.Vector3(), U = new THREE.Vector3(), Q = new THREE.Vector3();
  const surf = (phi, y, outP, outN) => {
    const s = surfaceAt(phi, y);
    outP.set(s.pos[0], s.pos[1], s.pos[2]);
    outN.set(s.normal[0], s.normal[1], s.normal[2]);
  };

  return {
    group,
    tools,
    setGuard,
    get guardMM() {
      return guardMM;
    },
    setLED(on) {
      m.led.emissiveIntensity = on ? 1 : 0;
    },
    setLever(v) {
      tools.clipper.userData.setLever(v);
    },
    setScissors(rad) {
      tools.scissors.userData.setOpen(rad);
    },
    setLather(on) {
      tools.brush.userData.setLather(on);
    },
    hideAll() {
      for (const k in tools) tools[k].visible = false;
    },
    // every tool (and a guard) visible at once, for the shader warm-up before ready
    showAll() {
      for (const k in tools) tools[k].visible = true;
      setGuard('3');
    },
    setPixelRatio() {},
    // Interim: the legacy hair activity {sides, top, beard, zones}. The toolPath-driven
    // choreography (C8) replaces this.
    update(dt, time, activity) {
      const buzz = reducedMotion ? 0 : 1;
      const [zs, zt, zb] = activity.zones;
      const run = {
        clipper: zs && activity.sides > 0.001 && activity.sides < 0.999,
        scissors: zt && activity.top > 0.001 && activity.top < 0.999,
        razor: zb && activity.beard > 0.001 && activity.beard < 0.999,
      };
      run.comb = run.scissors;
      for (const k in vis) {
        vis[k] = reducedMotion ? (run[k] ? 1 : 0) : THREE.MathUtils.damp(vis[k], run[k] ? 1 : 0, 10, dt);
        tools[k].visible = vis[k] > 0.01;
      }
      // clipper: upward strokes on the +X side, sideburn to nape, flicking out at the corner
      if (tools.clipper.visible) {
        const p = activity.sides;
        const ids = ['3', '2', '1', '0,5'];
        const mm = setGuard(ids[Math.min(3, Math.floor(p * 4))]);
        const k = p * 7;
        const col = Math.min(6, Math.floor(k));
        const u = reducedMotion ? 0.5 : k - col;
        const phi = THREE.MathUtils.lerp(1.15, 2.45, col / 6);
        const y = THREE.MathUtils.lerp(LANDMARKS.NUCA + 0.1, LANDMARKS.ESQUINA - 0.05, u);
        surf(phi, y, P, N);
        surf(phi, y + 0.03, Q, U);
        U.copy(Q).sub(P);
        const flick = THREE.MathUtils.smoothstep(u, 0.8, 1) * 0.12;
        P.addScaledVector(N, mm * MM + 0.004 + flick + (1 - vis.clipper) * 0.6);
        P.x += Math.sin(time * 95) * 0.0012 * buzz;
        U.addScaledVector(N, flick * 0.8);
        poseTool(tools.clipper, P, N, U);
        this.setLever(0);
      }
      // scissor over comb across the top: the comb lifts, the scissors cut above it
      if (tools.scissors.visible) {
        const p = activity.top;
        const phi = THREE.MathUtils.lerp(0.35, 2.5, p);
        surf(phi, LANDMARKS.ESQUINA + 0.22, P, N);
        U.set(Math.cos(phi), 0, -Math.sin(phi)); // across the stroke
        const lift = (1 - vis.scissors) * 0.6;
        Q.copy(P).addScaledVector(N, 0.09 + lift);
        poseTool(tools.comb, Q, U.clone().cross(N).negate(), N);
        tools.comb.rotateX(-Math.PI / 2);
        Q.copy(P).addScaledVector(N, 0.24 + lift);
        poseTool(tools.scissors, Q, N, U);
        tools.scissors.rotateZ(-Math.PI / 2);
        tools.scissors.translateX(-0.4);
        this.setScissors(reducedMotion ? 0.2 : 0.06 + 0.26 * (0.5 + 0.5 * Math.sin(time * 18.8)));
      }
      // razor along the beard line, edge on the skin at a shallow angle
      if (tools.razor.visible) {
        const p = activity.beard;
        const phi = THREE.MathUtils.lerp(1.25, 0.25, p);
        const y = THREE.MathUtils.lerp(LANDMARKS.PATILLA, -0.8, p);
        surf(phi, y, P, N);
        P.addScaledVector(N, 0.004 + (1 - vis.razor) * 0.6);
        // blade nearly flat on the skin, spine lifted ~30°, edge leading the downward stroke
        poseTool(tools.razor, P, N, v3([0, 1, 0]));
        tools.razor.rotateX(0.5);
      }
    },
    dispose() {
      tools.clipper.userData.dispose();
      decal.texture.dispose();
      group.traverse((o) => {
        if (o.isMesh) o.geometry.dispose();
      });
      for (const k in m) m[k].dispose();
    },
  };
}
