import * as THREE from 'three';
import { STRIPE_ANGLE, POLE_COLORS } from './pole.js';
import { surfaceAt, AXIS_Z } from './hairField.js';

// The cape: black nylon, snapped from a flat sheet held across the camera into an analytic
// drape over the shoulders, hung from the head's neck ring (head.bounds.neck). Pole-stripe hem.
// Everything is computed in the vertex shader from uv, so the snap is exact both ways and costs
// no CPU. Head-local units (1 ≈ 11 cm); lives in the head's rig.

const SHAPE = {
  around: 3.02, // half-angle of the wrap (rad): the cape opens at the nape
  shoulderRX: 1.95, // shoulder half breadth (≈ 225 mm with the cloth)
  shoulderRZ: 1.05,
  dropSide: 1.05, // shoulder tip below the collar
  dropFront: 0.5,
  slope: 0.22,
  shoulderV: 0.38, // share of the cape (along v) spent going over the shoulder
  hang: 2.7, // straight fall below the shoulders
  flare: 0.32,
  hem: 0.17, // hem band height (stripes)
  stripe: 0.075, // width of one coloured stripe
  sheetW: 5.6,
  sheetH: 3.2,
  sheetTop: -0.62,
  sheetZ: 2.3,
};

const DRAPE_GLSL = /* glsl */ `
  uniform float uSnap;
  uniform float uOff;
  uniform vec4 uNeck;      // y, cz, rx, rz
  uniform vec4 uShape1;    // around, shoulderRX, shoulderRZ, shoulderV
  uniform vec4 uShape2;    // dropSide, dropFront, slope, hang
  uniform vec4 uShape3;    // flare, sheetW, sheetH, sheetTop
  uniform float uSheetZ;
  varying vec3 vCape;      // arc length around, distance up from the hem, collar distance 0..1
  varying float vFront;

  float ellR(float sn, float cs, float rx, float rz) {
    return 1.0 / sqrt(sn * sn / (rx * rx) + cs * cs / (rz * rz));
  }
  // drape position for uv
  vec3 capeDrape(vec2 q) {
    float th = (q.x - 0.5) * 2.0 * uShape1.x;
    float s = q.y;
    float sn = sin(th), cs = cos(th);
    float rN = ellR(sn, cs, uNeck.z * 1.05, uNeck.w * 1.08);
    float rS = ellR(sn, cs, uShape1.y, uShape1.z);
    float a = mix(uShape2.y, uShape2.x, sn * sn);
    float top = uNeck.x + 0.07;
    float r, y;
    if (s < uShape1.w) {
      float b = s / uShape1.w * 1.5707963;
      r = rN + (rS - rN) * sin(b);
      y = top - a * (1.0 - cos(b)) - uShape2.z * sin(b);
    } else {
      float t = (s - uShape1.w) / (1.0 - uShape1.w);
      r = rS + uShape3.x * t * t;
      y = top - a - uShape2.z - t * uShape2.w;
    }
    // hanging folds: stronger towards the hem, none on the shoulders
    float f = smoothstep(uShape1.w - 0.12, 1.0, s);
    r += f * (0.055 * sin(th * 9.0 + 1.3 * sin(th * 3.0)) + 0.028 * sin(th * 17.0 + 2.0) + 0.02 * sin(th * 5.0 - 0.7));
    return vec3(sn * r, y, uNeck.y + cs * r);
  }
  vec3 capeSheet(vec2 q) {
    float x = (q.x - 0.5) * uShape3.y;
    return vec3(x, uShape3.w - q.y * uShape3.z, uSheetZ - 0.08 * x * x);
  }
  vec3 capePos(vec2 q) {
    vec3 D = capeDrape(q);
    // snap: the collar centre lands first, the edges trail round the shoulders
    float k = clamp(uSnap * 1.55 - abs(q.x - 0.5) * 0.55 - q.y * 0.18, 0.0, 1.0);
    k = k * k * (3.0 - 2.0 * k);
    vec3 P = mix(capeSheet(q), D, k);
    P.y += sin(k * 3.14159) * 0.45 * (1.0 - q.y * 0.5);
    // damped travelling wave tied to snap progress (no time): settles to zero at uSnap = 1
    float p = clamp(uSnap, 0.0, 1.0);
    P.z += sin(q.x * 11.0 + q.y * 4.0 - p * 14.0) * (1.0 - p) * (1.0 - p) * 0.22;
    // whipped off at the chair turn
    float o = uOff * uOff;
    P += vec3(P.x * 0.35 * o, o * (2.4 + q.y * 1.4), o * 2.2);
    return P;
  }
  void capeEval(vec2 q, out vec3 P, out vec3 N) {
    P = capePos(q);
    float e = 0.004;
    vec3 du = capePos(q + vec2(e, 0.0)) - capePos(q - vec2(e, 0.0));
    vec3 dv = capePos(q + vec2(0.0, e)) - capePos(q - vec2(0.0, e));
    N = normalize(cross(dv, du));
    vec3 axis = vec3(0.0, P.y, uNeck.y);
    vec3 out_ = mix(vec3(0.0, 0.0, 1.0), P - axis, uSnap);
    if (dot(N, out_) < 0.0) N = -N;
    float th = (q.x - 0.5) * 2.0 * uShape1.x;
    float rS = ellR(sin(th), cos(th), uShape1.y, uShape1.z);
    vCape = vec3(th * rS, (1.0 - q.y) * (uShape2.w + 1.4), q.y);
    vFront = cos(th);
  }
`;

const FRAG_GLSL = /* glsl */ `
  uniform float uSnap;
  uniform vec3 uRed;
  uniform vec3 uWhite;
  uniform vec3 uBlue;
  uniform vec4 uHem; // band height, stripe width, tan(stripe angle), contact shadow
  varying vec3 vCape;
  varying float vFront;
`;

/**
 * createCape(head.bounds, { tier, seg }) → Cape{ group, uniforms, setSnap(0..1), setOff(0..1),
 *   setPeel(0..1) (neck strip), capeHeight(x, z) → y|null (head-local top of the draped cape,
 *   folds ignored), dispose() }
 */
export function createCape(bounds, { tier = 'high', seg } = {}) {
  const n = seg || (tier === 'high' ? 48 : 28);
  const neck = bounds.neck;
  const S = SHAPE;
  const uniforms = {
    uSnap: { value: 1 },
    uOff: { value: 0 },
    uNeck: { value: new THREE.Vector4(neck.y, neck.cz, neck.rx, neck.rz) },
    uShape1: { value: new THREE.Vector4(S.around, S.shoulderRX, S.shoulderRZ, S.shoulderV) },
    uShape2: { value: new THREE.Vector4(S.dropSide, S.dropFront, S.slope, S.hang) },
    uShape3: { value: new THREE.Vector4(S.flare, S.sheetW, S.sheetH, S.sheetTop) },
    uSheetZ: { value: S.sheetZ },
    uRed: { value: new THREE.Color(POLE_COLORS.red) },
    uWhite: { value: new THREE.Color(POLE_COLORS.white) },
    uBlue: { value: new THREE.Color(POLE_COLORS.blue) },
    uHem: { value: new THREE.Vector4(S.hem, S.stripe, Math.tan(STRIPE_ANGLE), tier === 'high' ? 0.7 : 1) },
  };

  // more rows near the collar, where the shoulder curves
  const geo = new THREE.PlaneGeometry(1, 1, n, n);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const v = 1 - uv.getY(i);
    uv.setY(i, v * v * 0.35 + v * 0.65);
  }
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -2, 0), 6);

  const mat = new THREE.MeshPhysicalMaterial({
    color: '#111214',
    roughness: 0.5,
    metalness: 0,
    sheen: 1,
    sheenColor: new THREE.Color('#5a5e66'),
    sheenRoughness: 0.32,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${DRAPE_GLSL}`)
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 capeP, capeN;\n capeEval(uv, capeP, capeN);\n vec3 objectNormal = capeN;\n #ifdef USE_TANGENT\n vec3 objectTangent = vec3(1.0, 0.0, 0.0);\n #endif`,
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = capeP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_GLSL}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        // hem: three-colour stripes at the pole's stripe angle
        float hemD = vCape.y;
        if (hemD < uHem.x) {
          float c = (hemD - vCape.x * uHem.z) / uHem.y;
          float k = mod(floor(c), 3.0);
          vec3 sc = k < 0.5 ? uRed : (k < 1.5 ? uWhite : uBlue);
          // a hair of black piping above the band
          float pipe = smoothstep(uHem.x - 0.012, uHem.x - 0.006, hemD);
          diffuseColor.rgb = mix(sc * 0.82, diffuseColor.rgb, pipe);
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        // contact shadow: the collar and the jaw shade the cape (the shadow map adds to it on high)
        float sCol = vCape.z;
        float ao = mix(0.45, 1.0, smoothstep(0.0, 0.16, sCol));
        ao *= 1.0 - uHem.w * 0.5 * smoothstep(0.3, 0.0, sCol) * pow(max(vFront, 0.0), 3.0);
        // fake anisotropic sheen: nylon catches light in streaks along the fall
        vec3 vdir = normalize(vViewPosition);
        float an = pow(1.0 - abs(dot(normal, vdir)), 3.0) * 0.06;
        outgoingLight = outgoingLight * mix(1.0, ao, uSnap) + an * vec3(0.55, 0.57, 0.62) * ao;
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'cape1';

  const cape = new THREE.Mesh(geo, mat);
  cape.frustumCulled = false;
  cape.receiveShadow = true;
  cape.name = 'cape';

  // Paper neck strip: a band wrapped on the neck just above the collar; peels from one end.
  const strip = neckStrip(neck);
  const group = new THREE.Group();
  group.name = 'capeGroup';
  group.add(cape, strip.mesh);

  // ------- JS mirror of the drape (folds ignored), for clippings landing on the shoulders
  function capeHeight(x, z) {
    const dz = z - neck.cz;
    const th = Math.atan2(x, dz);
    if (Math.abs(th) > S.around) return null;
    const sn = Math.sin(th), cs = Math.cos(th);
    const ell = (rx, rz) => 1 / Math.sqrt((sn * sn) / (rx * rx) + (cs * cs) / (rz * rz));
    const rN = ell(neck.rx * 1.05, neck.rz * 1.08);
    const rS = ell(S.shoulderRX, S.shoulderRZ);
    const r = Math.hypot(x, dz);
    if (r < rN || r > rS) return null;
    const b = Math.asin(Math.min(1, (r - rN) / (rS - rN)));
    const a = S.dropFront + (S.dropSide - S.dropFront) * sn * sn;
    return neck.y + 0.07 - a * (1 - Math.cos(b)) - S.slope * Math.sin(b);
  }

  return {
    group,
    mesh: cape,
    uniforms,
    capeHeight,
    setSnap(v) {
      uniforms.uSnap.value = THREE.MathUtils.clamp(v, 0, 1);
      strip.mesh.visible = uniforms.uSnap.value > 0.97 && uniforms.uOff.value < 0.02 && strip.uniforms.uPeel.value < 0.999;
    },
    setOff(v) {
      uniforms.uOff.value = THREE.MathUtils.clamp(v, 0, 1);
      cape.visible = v < 0.995;
      this.setSnap(uniforms.uSnap.value);
    },
    setPeel(v) {
      strip.uniforms.uPeel.value = THREE.MathUtils.clamp(v, 0, 1);
      this.setSnap(uniforms.uSnap.value);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      strip.dispose();
    },
  };
}

function neckStrip(neck) {
  // ring hugging the neck surface from just under the collar up 25 mm; radius sampled from the head
  const segs = 72, rows = 6;
  const y0 = neck.y + 0.02, y1 = neck.y + 0.26;
  const pos = [], uvs = [], idx = [];
  for (let j = 0; j <= rows; j++) {
    const y = y0 + ((y1 - y0) * j) / rows;
    for (let i = 0; i <= segs; i++) {
      const phi = -Math.PI + (i / segs) * Math.PI * 2;
      const s = surfaceAt(phi, y);
      const dx = s.pos[0], dz = s.pos[2] - AXIS_Z;
      const r = Math.hypot(dx, dz) + 0.022;
      pos.push(Math.sin(phi) * r, y, AXIS_Z + Math.cos(phi) * r);
      uvs.push(i / segs, j / rows);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * (segs + 1) + i, b = a + 1, c = a + segs + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const uniforms = { uPeel: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({ color: '#ECE6DA', roughness: 0.92, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vStripUv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvStripUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vStripUv;\nuniform float uPeel;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vStripUv.x < uPeel) discard;');
  };
  mat.customProgramCacheKey = () => 'neckstrip1';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'neckStrip';
  return { mesh, uniforms, dispose: () => (geo.dispose(), mat.dispose()) };
}
