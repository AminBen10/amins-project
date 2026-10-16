import * as THREE from 'three';
import { headSDF, polygonize } from './headSdf.js';
import { Hair } from './hair.js';
import HeadWorker from './headWorker.js?worker&inline';

// Polygonizing the head takes a few hundred milliseconds, so it runs in a
// worker while the barber pole is already on screen. The worker is inlined
// so a single-file build still works.
export function meshHead(step) {
  return new Promise((resolve) => {
    const fallback = () => resolve(polygonize(headSDF, undefined, step));
    let worker;
    try {
      worker = new HeadWorker();
    } catch {
      setTimeout(fallback, 0);
      return;
    }
    worker.onmessage = (e) => {
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = () => {
      worker.terminate();
      fallback();
    };
    worker.postMessage({ step });
  });
}

const HEAD_GLSL = /* glsl */ `
  vec3 hash33h(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
  float vnoiseh(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash33h(i).x, n100 = hash33h(i + vec3(1, 0, 0)).x;
    float n010 = hash33h(i + vec3(0, 1, 0)).x, n110 = hash33h(i + vec3(1, 1, 0)).x;
    float n001 = hash33h(i + vec3(0, 0, 1)).x, n101 = hash33h(i + vec3(1, 0, 1)).x;
    float n011 = hash33h(i + vec3(0, 1, 1)).x, n111 = hash33h(i + vec3(1, 1, 1)).x;
    return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
               mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
  }
`;

// Height of a head point mapped to 0 (neck cut) … 1 (crown); the reveal and
// the particle morph both use it so the head fills in where particles land.
export const HEAD_Y0 = -1.45;
export const HEAD_H = 2.6;

export function createHead(data, { layers = 28, skin = '#b8a48c' } = {}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();

  const hair = new Hair(geometry, { layers });
  hair.uniforms.uSkin.value.set(skin);

  const uReveal = { value: 1 };
  const uEdge = { value: new THREE.Color('#ffc770') };
  const material = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.62, metalness: 0, envMapIntensity: 0.55 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uProg: hair.uniforms.uProg,
      uWidth: hair.uniforms.uWidth,
      uGrow: hair.uniforms.uGrow,
      uDensity: hair.uniforms.uDensity,
      uRoot: hair.uniforms.uRoot,
      uReveal,
      uEdge,
    });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aFrom;
        attribute float aTo;
        attribute vec3 aZone;
        attribute vec3 aSweep;
        uniform vec3 uProg;
        uniform float uWidth;
        uniform float uGrow;
        varying float vHairLen;
        varying vec3 vRestPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 tzH = clamp((uProg * (1.0 + uWidth) - aSweep) / uWidth, 0.0, 1.0);
        vHairLen = mix(aFrom, aTo, dot(aZone, tzH)) * uGrow;
        vRestPos = position;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uDensity;
        uniform vec3 uRoot;
        uniform float uReveal;
        uniform vec3 uEdge;
        varying float vHairLen;
        varying vec3 vRestPos;
        ${HEAD_GLSL}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        float yn = (vRestPos.y - (${HEAD_Y0.toFixed(3)})) / ${HEAD_H.toFixed(3)};
        float rv = (1.0 - yn) * 0.4 + 0.52 + vnoiseh(vRestPos * 5.0) * 0.06;
        if (uReveal < rv) discard;
        float revealEdge = (1.0 - smoothstep(0.0, 0.035, uReveal - rv)) * (1.0 - step(0.999, uReveal));`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float shade = smoothstep(0.0, 0.03, vHairLen);
        vec3 hc = vRestPos * uDensity;
        vec3 hr = hash33h(floor(hc));
        float hd = length(fract(hc) - (0.25 + 0.5 * hr));
        float dots = (1.0 - smoothstep(0.26, 0.4, hd)) * step(0.0015, vHairLen);
        float cover = clamp(shade * 0.85 + dots * 0.55 * (1.0 - shade), 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, uRoot * 1.5, cover);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += uEdge * revealEdge * 4.0;`,
      );
  };

  const mesh = new THREE.Mesh(geometry, material);
  const group = new THREE.Group();
  group.add(mesh, hair.mesh);
  return { group, mesh, hair, uReveal, geometry };
}
