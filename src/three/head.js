import * as THREE from 'three';
import { Hair } from './hair.js';
import { SHAVED_GLSL } from './hairShaders.js';
import { HEAD_CAGE } from './headAsset.js';
import { ANCHORS, ANCHOR_NAMES, EYES, HEAD_BOUNDS, HEAD_POINTS, MM } from './hairField.js';
import { base64Bytes, buildHead, transferList } from './headWorker.js';
import HeadWorker from './headWorker.js?worker&inline';

// The practice head: a sculpted plaster bust of a neutral adult man, built from the MakeHuman
// CC0 base mesh (scripts/head/). The asset is a quad cage; the worker subdivides it
// (Catmull-Clark, 2 levels on the high tier, 1 on low) while the pole is already on screen.
// The worker is inlined so a single-file build still works.

let cageBytes = null;
const cage = () => (cageBytes ||= base64Bytes(HEAD_CAGE));

function levelsFor(opts) {
  if (typeof opts === 'number') return opts >= 0.025 ? 1 : 2; // legacy: SDF step
  if (opts && opts.levels) return opts.levels;
  if (opts && opts.tier) return opts.tier === 'high' ? 2 : 1;
  if (opts && opts.skinStep) return opts.skinStep >= 0.024 ? 1 : 2;
  return 2;
}

/**
 * meshHead({tier|skinStep|levels}, onProgress?) → Promise<HeadData>
 * HeadData: positions, normals, indices, bake [ao, cavity, thickness], edge [hair, beard]
 * (signed, head units), mask [hair, beard], eye, hair (shell subset), levels, stats.
 */
export function meshHead(opts = {}, onProgress) {
  const levels = levelsFor(opts);
  return new Promise((resolve) => {
    let done = false;
    let worker = null;
    let timer = 0;
    const finish = (data) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (worker) worker.terminate();
      resolve(data);
    };
    const fallback = () => {
      if (worker) worker.terminate();
      worker = null;
      clearTimeout(timer);
      setTimeout(() => {
        if (!done) finish(buildHead(cage(), { levels, onProgress }));
      }, 0);
    };
    try {
      worker = new HeadWorker();
    } catch {
      fallback();
      return;
    }
    timer = setTimeout(fallback, 6000);
    worker.onmessage = (e) => {
      const msg = e.data || {};
      if (msg.type === 'progress') onProgress?.(msg.p);
      else if (msg.type === 'mesh') finish(msg.data);
      else fallback();
    };
    worker.onerror = fallback;
    const bytes = cage().slice();
    worker.postMessage({ type: 'mesh', levels, cage: bytes.buffer }, [bytes.buffer]);
  });
}

export { transferList };

// ------------------------------------------------------------------ plaster

// Plaster tone: neutral warm grey, no skin tone. Head-owned env intensity.
export const PLASTER = { color: '#A99D8E', roughness: 0.87, envMapIntensity: 0.35 };

const PLASTER_GLSL = /* glsl */ `
  vec3 hash33p(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
  // value noise with its analytic gradient (xyz) in .yzw
  vec4 vnoiseD(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    vec3 u = f * f * (3.0 - 2.0 * f);
    vec3 du = 6.0 * f * (1.0 - f);
    float a = hash33p(i).x, b = hash33p(i + vec3(1, 0, 0)).x;
    float c = hash33p(i + vec3(0, 1, 0)).x, d = hash33p(i + vec3(1, 1, 0)).x;
    float e = hash33p(i + vec3(0, 0, 1)).x, f1 = hash33p(i + vec3(1, 0, 1)).x;
    float g = hash33p(i + vec3(0, 1, 1)).x, h = hash33p(i + vec3(1, 1, 1)).x;
    float k0 = a, k1 = b - a, k2 = c - a, k3 = e - a, k4 = a - b - c + d;
    float k5 = a - c - e + g, k6 = a - b - e + f1, k7 = -a + b + c - d + e - f1 - g + h;
    float v = k0 + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z;
    vec3 dv = du * vec3(k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z,
                        k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x,
                        k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y);
    return vec4(v, dv);
  }
`;

function plasterMaterial(hair, { tier }) {
  const material = new THREE.MeshStandardMaterial({
    color: PLASTER.color,
    roughness: PLASTER.roughness,
    metalness: 0,
    envMapIntensity: PLASTER.envMapIntensity,
  });
  const uniforms = {
    uProg: hair.uniforms.uProg,
    uWidth: hair.uniforms.uWidth,
    uGrow: hair.uniforms.uGrow,
    uMM: { value: MM }, // head units per millimetre (shaved tint ramps)
    uHairRoot: hair.uniforms.uRoot,
    uAO: { value: 1 },
    uCavity: { value: 0.55 },
    uMicro: { value: 0.02 },
    uPlate: { value: 0 },
    uIris: { value: new THREE.Vector3(0.0, 0.26, 0.34) }, // incised ring, drilled pupil, iris radius (rad)
    uEyeL: { value: new THREE.Vector3().fromArray(EYES.l) },
    uEyeR: { value: new THREE.Vector3().fromArray(EYES.r) },
    // lip slit: stomion y, drop of the slit at the corners, mouth-corner |x|, stomion z
    uLip: { value: new THREE.Vector4(HEAD_POINTS.stomion[1], -0.012, HEAD_POINTS.mouth_corner[0], HEAD_POINTS.stomion[2]) },
  };
  material.userData.uniforms = uniforms;
  material.defines = { PLASTER_HQ: tier === 'low' ? 0 : 1 };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aBake;
        attribute vec2 aMask;
        attribute float aEye;
        attribute float aFrom;
        attribute float aTo;
        attribute vec2 aCut;
        attribute vec3 aZone;
        attribute vec3 aSweep;
        uniform vec3 uProg;
        uniform float uWidth;
        uniform float uGrow;
        varying vec3 vBake;
        varying vec2 vMaskP;
        varying float vEye;
        varying float vHairLen;
        varying vec2 vCut;
        varying vec3 vRestPos;
        varying vec3 vRestN;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 tzH = clamp((uProg * (1.0 + uWidth) - aSweep) / uWidth, 0.0, 1.0);
        vHairLen = mix(aFrom, aTo, dot(aZone, tzH)) * uGrow;
        vRestPos = position;
        vRestN = normal;
        vCut = aCut;
        vBake = aBake;
        vMaskP = aMask;
        vEye = aEye;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform mat3 normalMatrix;
        uniform float uMM;
        uniform vec3 uHairRoot;
        uniform float uAO;
        uniform float uCavity;
        uniform float uMicro;
        uniform float uPlate;
        uniform vec3 uIris;
        uniform vec3 uEyeL;
        uniform vec3 uEyeR;
        uniform vec4 uLip;
        varying vec3 vBake;
        varying vec2 vMaskP;
        varying float vEye;
        varying float vHairLen;
        varying vec2 vCut;
        varying vec3 vRestPos;
        varying vec3 vRestN;
        ${PLASTER_GLSL}
        ${SHAVED_GLSL}`,
      )
      .replace(
        '#include <lights_physical_pars_fragment>',
        // wrap terminator on the diffuse term only: the plaster's soft roll-off into shadow
        // (specular keeps the true N.L, or GGX blows up at the terminator)
        THREE.ShaderChunk.lights_physical_pars_fragment.replace(
          'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
          'reflectedLight.directDiffuse += saturate( ( dot( geometryNormal, directLight.direction ) + 0.25 ) / 1.25 ) * directLight.color * BRDF_Lambert( material.diffuseColor );',
        ),
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // cavity: sockets, nostrils, lip line, concha read darker in the plaster
        diffuseColor.rgb *= 1.0 - uCavity * (1.0 - uPlate) * vBake.y;
        // lip slit: the upper lip shades the top of the lower lip (no shadow maps on the bust),
        // so the closed mouth reads as one carved line instead of a lit sliver; lipOcc also
        // damps the grazing env reflection there (see the AO step below)
        float lipOcc;
        {
          float u = abs(vRestPos.x) / uLip.z;
          float dy = vRestPos.y - (uLip.x + uLip.y * u * u);
          lipOcc = 1.0 - smoothstep(0.003, 0.012, abs(dy));
          lipOcc *= 1.0 - smoothstep(0.95, 1.12, u);
          lipOcc *= smoothstep(uLip.w - 0.3, uLip.w - 0.2, vRestPos.z);
          // the inside of the mouth, seen through the 1 mm slit: dark
          // (surfaces behind the lips that face back into the head)
          float inner = smoothstep(uLip.w - 0.04, uLip.w - 0.08, vRestPos.z) * (1.0 - smoothstep(0.12, 0.18, abs(dy)));
          inner *= smoothstep(0.05, -0.15, dot(normalize(vRestN), normalize(vec3(vRestPos.x, 0.0, vRestPos.z + 0.07))));
          lipOcc = max(lipOcc, inner) * (1.0 - uPlate);
          diffuseColor.rgb *= 1.0 - 0.6 * lipOcc;
        }
        // sculpted eyes: incised iris line and a shallow drilled pupil
        if (vEye > 0.5) {
          vec3 ec = vRestPos.x > 0.0 ? uEyeL : uEyeR;
          float ca = dot(normalize(vRestPos - ec), vec3(0.0, -0.06, 0.998));
          float a = acos(clamp(ca, -1.0, 1.0));
          float aw = fwidth(a) + 0.004;
          float ring = 1.0 - smoothstep(0.0, 0.022 + aw, abs(a - uIris.z));
          float pupil = 1.0 - smoothstep(0.10 - aw, 0.14 + aw, a);
          diffuseColor.rgb *= 1.0 - uIris.x * ring - uIris.y * pupil;
        }
        // hair shorter than the shells: shaved shadow, follicles, root colour under dense hair
        float zoneM = max(vMaskP.x, vMaskP.y);
        diffuseColor.rgb = shavedSkin(diffuseColor.rgb, vRestPos, normalize(vRestN), vHairLen, vMaskP, vCut, uHairRoot, uMM);
        diffuseColor.rgb *= 1.0 - 0.35 * smoothstep(0.02, 0.08, vHairLen) * zoneM;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        // plaster micro-surface: value-noise gradient, one octave (two on the high tier)
        {
          vec4 nz = vnoiseD(vRestPos * 60.0);
          vec3 g = nz.yzw;
          #if PLASTER_HQ == 1
            g += vnoiseD(vRestPos * 150.0 + 7.1).yzw * 0.45;
          #endif
          vec3 gv = normalize(normalMatrix * g + 1e-6);
          gv -= normal * dot(gv, normal);
          normal = normalize(normal - gv * uMicro * (1.0 - uPlate));
        }`,
      )
      .replace(
        '#include <aomap_fragment>',
        `// baked AO: full on indirect light, half on direct
        float aoP = mix(1.0, vBake.x, uAO) * (1.0 - 0.85 * lipOcc);
        reflectedLight.indirectDiffuse *= aoP;
        reflectedLight.indirectSpecular *= aoP;
        reflectedLight.directDiffuse *= mix(1.0, aoP, 0.5);
        reflectedLight.directSpecular *= mix(1.0, aoP, 0.5);`,
      );
  };
  material.customProgramCacheKey = () => `plaster-${tier === 'low' ? 0 : 1}`;
  return material;
}

// ------------------------------------------------------------------ head

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/**
 * createHead(data, {layers, tier}) → Head{group, skin, hair, bounds, anchors, setLighting,
 * setLayers, setPlate, dispose} (+ legacy mesh, geometry, uReveal for the old stage).
 */
export function createHead(data, { layers = 26, tier = 'high' } = {}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute('aBake', new THREE.BufferAttribute(data.bake, 3));
  geometry.setAttribute('aMask', new THREE.BufferAttribute(data.mask, 2));
  geometry.setAttribute('aEdge', new THREE.BufferAttribute(data.edge, 2));
  geometry.setAttribute('aEye', new THREE.BufferAttribute(data.eye, 1));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();

  const hair = new Hair(geometry, { layers, data, tier });
  const material = plasterMaterial(hair, { tier });
  const skin = new THREE.Mesh(geometry, material);
  // three applies scene.environmentIntensity to materials without their own envMap; binding the
  // scene environment here keeps the head's own envMapIntensity (0.35) in charge.
  skin.onBeforeRender = (renderer, scene) => {
    const env = scene.environment || null;
    if (material.envMap !== env) material.envMap = env;
  };
  const group = new THREE.Group();
  group.add(skin, hair.mesh);

  const b = HEAD_BOUNDS;
  const bounds = {
    center: v3(b.center),
    radius: b.radius,
    top: b.top,
    chin: b.chin,
    neck: { ...b.neck },
  };
  const anchors = Object.fromEntries(ANCHOR_NAMES.map((k) => [k, v3(ANCHORS[k])]));

  return {
    group,
    skin,
    hair,
    bounds,
    anchors,
    // world directions, linear colour x intensity (the hair shades itself; the skin uses scene lights)
    setLighting({ keyDir, keyColor, fillDir, fillColor, ambient } = {}) {
      const u = hair.uniforms;
      if (keyDir) u.uKeyDir.value.copy(keyDir).normalize();
      if (keyColor) u.uKeyCol.value.copy(keyColor);
      if (fillDir) u.uFillDir.value.copy(fillDir).normalize();
      if (fillColor) u.uFillCol.value.copy(fillColor);
      if (ambient) u.uAmb.value.copy(ambient);
    },
    setLayers(n) {
      hair.setLayers(n);
    },
    // plate (engraving) renders: plain plaster without micro-surface or cavity tint
    setPlate(on) {
      material.userData.uniforms.uPlate.value = on ? 1 : 0;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      hair.dispose();
    },
    // legacy (base stage): the reveal is gone; uReveal is kept as an inert handle
    mesh: skin,
    geometry,
    uReveal: { value: 1 },
    stats: data.stats,
  };
}
