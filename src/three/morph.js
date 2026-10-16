import * as THREE from 'three';
import { POLE, POLE_Y0, POLE_H, STRIPES, stripeIndex } from './pole.js';

// Particles that peel off the barber pole from the top down, spiral outwards
// and land on the surface of the head. Their departure time matches the pole
// dissolve and their arrival matches the head reveal, so the three effects
// read as one motion.

export function createMorph(headGeometry, { count = 12000 } = {}) {
  const P = headGeometry.attributes.position.array;
  const I = headGeometry.index.array;

  // area-weighted samples on the head surface
  const triCount = I.length / 3;
  const cdf = new Float32Array(triCount);
  let total = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    a.fromArray(P, I[t * 3] * 3);
    b.fromArray(P, I[t * 3 + 1] * 3);
    c.fromArray(P, I[t * 3 + 2] * 3);
    total += ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() * 0.5;
    cdf[t] = total;
  }
  const targets = [];
  for (let i = 0; i < count; i++) {
    const r = Math.random() * total;
    let lo = 0, hi = triCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    a.fromArray(P, I[lo * 3] * 3);
    b.fromArray(P, I[lo * 3 + 1] * 3);
    c.fromArray(P, I[lo * 3 + 2] * 3);
    let u = Math.random(), v = Math.random();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    targets.push(new THREE.Vector3().copy(a).addScaledVector(ab.subVectors(b, a), u).addScaledVector(ac.subVectors(c, a), v));
  }
  targets.sort((p, q) => p.y - q.y);

  // pole samples, sorted the same way so the top of the pole becomes the crown
  const sources = [];
  for (let i = 0; i < count; i++) {
    sources.push({ angle: Math.random() * Math.PI * 2, y: (Math.random() - 0.5) * POLE.height });
  }
  sources.sort((p, q) => p.y - q.y);

  const aSrc = new Float32Array(count * 2);
  const aDst = new Float32Array(count * 3);
  const aColor = new Float32Array(count * 3);
  const aSeed = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const s = sources[i];
    aSrc[i * 2] = s.angle;
    aSrc[i * 2 + 1] = s.y;
    targets[i].toArray(aDst, i * 3);
    STRIPES[stripeIndex(s.angle, s.y)].toArray(aColor, i * 3);
    aSeed[i * 2] = Math.random();
    aSeed[i * 2 + 1] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSrc', new THREE.BufferAttribute(aSrc, 2));
  geo.setAttribute('aDst', new THREE.BufferAttribute(aDst, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 2));

  const uniforms = {
    uMorph: { value: 0 },
    uSpin: { value: 0 },
    uPoleMatrix: { value: new THREE.Matrix4() },
    uHeadMatrix: { value: new THREE.Matrix4() },
    uPx: { value: 1 },
    uGold: { value: new THREE.Color('#ffc770') },
    uSkin: { value: new THREE.Color('#b8a48c') },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec2 aSrc;
      attribute vec3 aDst;
      attribute vec3 aColor;
      attribute vec2 aSeed;
      uniform float uMorph;
      uniform float uSpin;
      uniform mat4 uPoleMatrix;
      uniform mat4 uHeadMatrix;
      uniform float uPx;
      uniform vec3 uGold;
      uniform vec3 uSkin;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        float pyn = (aSrc.y - (${POLE_Y0.toFixed(3)})) / ${POLE_H.toFixed(3)};
        float depart = ((1.0 - pyn) * 0.5 + 0.04) / 1.08 + aSeed.x * 0.03;
        float t = clamp((uMorph - depart) / 0.42, 0.0, 1.0);
        float e = t * t * (3.0 - 2.0 * t);

        float ang = aSrc.x - uSpin;
        vec3 S = (uPoleMatrix * vec4(sin(ang) * ${(POLE.radius + 0.01).toFixed(3)}, aSrc.y, cos(ang) * ${(POLE.radius + 0.01).toFixed(3)}, 1.0)).xyz;
        vec3 E = (uHeadMatrix * vec4(aDst, 1.0)).xyz;

        // spiral in cylindrical coordinates around the shared vertical axis
        vec3 C = vec3(uHeadMatrix[3].x, 0.0, uHeadMatrix[3].z);
        vec3 s = S - C, d = E - C;
        float as = atan(s.x, s.z), ad = atan(d.x, d.z);
        if (ad < as) ad += 6.2831853;
        ad += 6.2831853 * floor(aSeed.y * 1.5);
        float an = mix(as, ad, e);
        float rad = mix(length(s.xz), length(d.xz), e) + sin(e * 3.14159) * (0.5 + aSeed.y * 0.9);
        float y = mix(S.y, E.y, e) + sin(e * 3.14159) * (aSeed.x - 0.5) * 0.4;
        vec3 p = C + vec3(sin(an) * rad, y, cos(an) * rad);

        vColor = mix(mix(aColor, uGold * 1.6, smoothstep(0.0, 0.45, e)), uSkin * 1.2, smoothstep(0.75, 1.0, e));
        vAlpha = smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.9, 1.0, t));

        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_PointSize = (1.6 + aSeed.y * 1.8) * uPx * (8.0 / -mv.z) * step(0.001, vAlpha);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.1, d) * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor * a, a);
      }
    `,
  });

  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  return {
    points,
    uniforms,
    update(morph, spin, poleGroup, headGroup) {
      uniforms.uMorph.value = morph;
      uniforms.uSpin.value = spin;
      uniforms.uPoleMatrix.value.copy(poleGroup.matrixWorld);
      uniforms.uHeadMatrix.value.copy(headGroup.matrixWorld);
      points.visible = morph > 0.001 && morph < 0.999;
    },
  };
}

