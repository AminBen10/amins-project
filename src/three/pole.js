import * as THREE from 'three';

// A classic barber pole: striped core turning inside a glass sleeve, chrome
// caps, a glowing globe on top and two gold light trails orbiting it.
// Every part can dissolve from the top down (uDissolve) for the morph into
// the head.

export const POLE = {
  radius: 0.3,
  height: 2.1,
  // red, white, blue, white: two full sets around the pole, 1.6 turns per unit
  bands: 2,
  twist: 0.75,
};

export const STRIPES = [new THREE.Color('#c1272d'), new THREE.Color('#f4efe4'), new THREE.Color('#1d4fb0'), new THREE.Color('#f4efe4')];

// Stripe colour at angle a (radians) and height y; shared with the particles.
export function stripeIndex(a, y) {
  const u = a / (Math.PI * 2);
  const v = (y + POLE.height / 2) / POLE.height;
  const s = (((u * POLE.bands + v * POLE.height * POLE.twist) % 1) + 1) % 1;
  return Math.floor(s * 4) % 4;
}

function stripeTexture() {
  const W = 512, H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const rgb = STRIPES.map((c) => c.clone().convertLinearToSRGB());
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < 2; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          const u = (px + 0.25 + sx * 0.5) / W;
          const v = 1 - (py + 0.25 + sy * 0.5) / H;
          const s = (((u * POLE.bands + v * POLE.height * POLE.twist) % 1) + 1) % 1;
          const c = rgb[Math.floor(s * 4) % 4];
          r += c.r; g += c.g; b += c.b;
        }
      }
      const o = (py * W + px) * 4;
      img.data[o] = (r / 4) * 255;
      img.data[o + 1] = (g / 4) * 255;
      img.data[o + 2] = (b / 4) * 255;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const DISSOLVE_GLSL = /* glsl */ `
  float hashP(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noiseP(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hashP(i), hashP(i + vec3(1, 0, 0)), f.x), mix(hashP(i + vec3(0, 1, 0)), hashP(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hashP(i + vec3(0, 0, 1)), hashP(i + vec3(1, 0, 1)), f.x), mix(hashP(i + vec3(0, 1, 1)), hashP(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
`;

// Height inside the pole group mapped 0 (bottom finial) … 1 (top of globe).
export const POLE_Y0 = -1.55;
export const POLE_H = 3.35;

function dissolvable(material, uDissolve, uEdge) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDissolve = uDissolve;
    shader.uniforms.uEdge = uEdge;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPoleLocal;\nuniform mat4 uPoleInv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPoleLocal = (uPoleInv * modelMatrix * vec4(position, 1.0)).xyz;');
    shader.uniforms.uPoleInv = material.userData.poleInv;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPoleLocal;\nuniform float uDissolve;\nuniform vec3 uEdge;\n${DISSOLVE_GLSL}`)
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        float pyn = (vPoleLocal.y - (${POLE_Y0.toFixed(3)})) / ${POLE_H.toFixed(3)};
        float th = (1.0 - pyn) * 0.5 + noiseP(vPoleLocal * 9.0) * 0.08;
        if (uDissolve > th) discard;
        float poleEdge = (1.0 - smoothstep(0.0, 0.04, th - uDissolve)) * step(0.001, uDissolve);`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uEdge * poleEdge * 4.0;');
  };
  return material;
}

export function createPole({ reducedMotion = false } = {}) {
  const group = new THREE.Group();
  const uDissolve = { value: 0 };
  const uEdge = { value: new THREE.Color('#ffc770') };
  const poleInv = { value: new THREE.Matrix4() };
  const mk = (m) => {
    m.userData.poleInv = poleInv;
    return dissolvable(m, uDissolve, uEdge);
  };

  const chrome = mk(new THREE.MeshStandardMaterial({ color: '#dfe3ea', metalness: 1, roughness: 0.14 }));
  const brass = mk(new THREE.MeshStandardMaterial({ color: '#c9a35b', metalness: 1, roughness: 0.26 }));

  const tex = stripeTexture();
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(POLE.radius, POLE.radius, POLE.height, 96, 1, true),
    mk(new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.12, roughness: 0.3 })),
  );
  group.add(core);

  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(POLE.radius + 0.04, POLE.radius + 0.04, POLE.height + 0.02, 96, 1, true),
    mk(new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0, clearcoat: 1, envMapIntensity: 1.6, depthWrite: false })),
  );
  glass.renderOrder = 2;
  group.add(glass);

  const r = POLE.radius;
  const capProfile = [
    [r + 0.045, -0.02], [r + 0.09, 0.0], [r + 0.1, 0.05], [r + 0.08, 0.1], [r + 0.1, 0.13],
    [r + 0.1, 0.17], [r + 0.03, 0.21], [0.2, 0.25], [0.11, 0.27], [0.0, 0.275],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const capGeo = new THREE.LatheGeometry(capProfile, 72);
  const topCap = new THREE.Mesh(capGeo, chrome);
  topCap.position.y = POLE.height / 2;
  const bottomCap = new THREE.Mesh(capGeo, chrome);
  bottomCap.position.y = -POLE.height / 2;
  bottomCap.scale.y = -1;
  group.add(topCap, bottomCap);

  const ringGeo = new THREE.TorusGeometry(r + 0.1, 0.018, 12, 96);
  for (const y of [POLE.height / 2 + 0.15, -POLE.height / 2 - 0.15]) {
    const ring = new THREE.Mesh(ringGeo, brass);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    group.add(ring);
  }

  const finial = new THREE.Mesh(
    new THREE.LatheGeometry(
      [[0.12, 0], [0.07, -0.05], [0.1, -0.11], [0.05, -0.18], [0.0, -0.22]].map(([x, y]) => new THREE.Vector2(x, y)),
      48,
    ),
    brass,
  );
  finial.position.y = -POLE.height / 2 - 0.27;
  group.add(finial);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.12, 32), chrome);
  neck.position.y = POLE.height / 2 + 0.33;
  group.add(neck);

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 48, 32),
    mk(new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff1d6', emissiveIntensity: 2.6, roughness: 0.2 })),
  );
  globe.position.y = POLE.height / 2 + 0.6;
  group.add(globe);

  // gold light trails
  const trailMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uColor: { value: new THREE.Color('#ffbf5e') } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uFade;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float ends = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
        float comet = pow(fract(vUv.x * 2.0 - uTime * 0.22), 5.0);
        float glow = (0.55 + comet * 3.2) * ends * uFade;
        gl_FragColor = vec4(uColor * glow, glow);
      }
    `,
  });
  const trails = new THREE.Group();
  for (let k = 0; k < 2; k++) {
    const turns = 2.6 + k * 0.5;
    const pts = [];
    for (let i = 0; i <= 400; i++) {
      const t = i / 400;
      const a = t * Math.PI * 2 * turns + k * Math.PI;
      const rad = 0.66 + 0.1 * Math.sin(t * Math.PI) + k * 0.08;
      pts.push(new THREE.Vector3(Math.cos(a) * rad, -0.9 + t * 1.55 + k * 0.1, Math.sin(a) * rad));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 600, 0.007 - k * 0.002, 6), trailMat);
    mesh.rotation.z = -0.12 + k * 0.05;
    trails.add(mesh);
  }
  group.add(trails);

  // sparkle dust along the trails
  const dustCount = 160;
  const dust = new Float32Array(dustCount * 3);
  const dustSeed = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    const t = Math.random();
    const a = t * Math.PI * 2 * 2.6;
    const rad = 0.66 + 0.1 * Math.sin(t * Math.PI) + (Math.random() - 0.5) * 0.12;
    dust[i * 3] = Math.cos(a) * rad;
    dust[i * 3 + 1] = -0.9 + t * 1.55 + (Math.random() - 0.5) * 0.1;
    dust[i * 3 + 2] = Math.sin(a) * rad;
    dustSeed[i] = Math.random();
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dust, 3));
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(dustSeed, 1));
  const dustMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: trailMat.uniforms.uTime, uFade: trailMat.uniforms.uFade, uPx: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      uniform float uPx;
      varying float vTw;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vTw = 0.5 + 0.5 * sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 40.0);
        gl_PointSize = (2.0 + aSeed * 3.0) * uPx * (6.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFade;
      varying float vTw;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vTw * uFade;
        gl_FragColor = vec4(vec3(1.0, 0.78, 0.42) * a * 2.0, a);
      }
    `,
  });
  const dustPoints = new THREE.Points(dustGeo, dustMat);
  trails.add(dustPoints);

  let spin = 0;
  return {
    group,
    core,
    trails,
    uDissolve,
    dustMat,
    update(dt, time, morph) {
      spin += dt * (reducedMotion ? 0 : 0.9);
      core.rotation.y = -spin;
      trailMat.uniforms.uTime.value = time;
      trails.rotation.y = spin * 0.35;
      const s = 1 + morph * 1.6;
      trails.scale.set(s, 1 + morph * 0.5, s);
      trailMat.uniforms.uFade.value = 1 - THREE.MathUtils.smoothstep(morph, 0.0, 0.35);
      uDissolve.value = morph <= 0.001 ? 0 : morph * 1.08;
      group.updateMatrixWorld();
      poleInv.value.copy(group.matrixWorld).invert();
      group.visible = morph < 0.62;
    },
    get spin() {
      return spin;
    },
  };
}
