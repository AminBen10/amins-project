import * as THREE from 'three';
import { studioMaterials } from './env.js';

// The barber pole beside the door: an enamelled striped core turning inside a
// glass sleeve, turned chrome caps, a brass finial, a frosted globe on top
// and a chrome bracket back to the facade. It turns only while the shop is
// open and motion is allowed. The globe is the only bloom on the page: it
// sits alone on BLOOM_LAYER (high tier) or gets a small sprite (low tier).

export const POLE = {
  radius: 0.3,
  height: 2.1,
  // red, white, blue, white: two full sets around the pole, 0.75 turns per unit
  bands: 2,
  twist: 0.75,
  spinRate: 0.9, // rad/s
};

export const POLE_COLORS = { red: '#C1272D', white: '#F4EFE4', blue: '#1D4FB0' };
export const BLOOM_LAYER = 2;

// Stripe index (0 red, 1 white, 2 blue, 3 white) at angle a and height y, pole-local.
export function stripeIndex(a, y, spin = 0) {
  const u = (a - spin) / (Math.PI * 2);
  const v = (y + POLE.height / 2) / POLE.height;
  const s = (((u * POLE.bands + v * POLE.height * POLE.twist) % 1) + 1) % 1;
  return Math.floor(s * 4) % 4;
}

// On-screen angle of the stripes for a front view (radians from horizontal);
// the cape hem uses it for the match cut.
// Along a stripe ds = 0: bands·dx/(2πR) + twist·dy = 0 → |dy/dx| = bands/(2πR·twist) ≈ 54.7°.
export const STRIPE_ANGLE = Math.atan(POLE.bands / (2 * Math.PI * POLE.radius * POLE.twist));

// Enamel core: MeshPhysical (clearcoat only on high) with procedural stripes.
function coreMaterial(uniforms, hi) {
  const mat = new (hi ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial)({ color: '#ffffff', roughness: 0.35, metalness: 0 });
  if (hi) {
    mat.clearcoat = 0.6;
    mat.clearcoatRoughness = 0.12;
  }
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPoleUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvPoleUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vPoleUv;
        uniform float uSpin;
        uniform vec3 uRed;
        uniform vec3 uWhite;
        uniform vec3 uBlue;
        uniform float uBands;
        uniform float uTwist;
        uniform float uHeight;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // the sleeve refracts the stripes sideways towards the silhouette
          vec3 nV = normalize(vNormal);
          vec3 vV = normalize(vViewPosition);
          float ndv = clamp(dot(nV, vV), 0.0, 1.0);
          // minus: the stripes climb as the pole turns
          float u = vPoleUv.x - uSpin / 6.2831853;
          u += pow(1.0 - ndv, 2.0) * 0.06 * sign(nV.x);
          float s = u * uBands + vPoleUv.y * uHeight * uTwist;
          float w = max(fwidth(s) * 4.0, 1e-4);
          float f = fract(s) * 4.0;
          // weights of the four bands with a pixel-wide AA edge
          float e0 = smoothstep(-w * 0.5, w * 0.5, f - 1.0);
          float e1 = smoothstep(-w * 0.5, w * 0.5, f - 2.0);
          float e2 = smoothstep(-w * 0.5, w * 0.5, f - 3.0);
          float wrap = smoothstep(4.0 - w, 4.0, f);
          vec3 col = mix(uRed, uWhite, e0);
          col = mix(col, uBlue, e1);
          col = mix(col, uWhite, e2);
          col = mix(col, uRed, wrap);
          diffuseColor.rgb = col;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'pole-core-' + (hi ? 'h' : 'l');
  return mat;
}

// Glass sleeve: Fresnel rim, two vertical window streaks and a darker edge
// line that gives the glass its thickness. Drawn after the core, no depth write.
function glassMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uStreak: { value: new THREE.Color('#fff2e2') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uStreak;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec3 n = normalize(vN);
        float ndv = clamp(dot(n, normalize(vV)), 0.0, 1.0);
        float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
        // two vertical reflections: the street window (strong, fill side) and the tube (thin, key side)
        float x = n.x;
        float s1 = smoothstep(0.07, 0.0, abs(x + 0.55)) * 0.42;
        float s2 = smoothstep(0.025, 0.0, abs(x - 0.38)) * 0.35;
        // inner wall of the sleeve: a dark line just inside the silhouette
        float edge = smoothstep(0.32, 0.14, ndv) * (1.0 - smoothstep(0.1, 0.0, ndv));
        vec3 col = uStreak * (s1 + s2) + vec3(0.9) * fres * 0.5;
        float a = clamp(s1 + s2 + fres * 0.5, 0.0, 0.9);
        // premultiplied-style: darken behind the edge, add light on top
        col = mix(col, vec3(0.0), edge * 0.6);
        a = max(a, edge * 0.38);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

// Frosted globe: emissive mix(#ffb766, white, NdotV²)·3 with a small filament.
function globeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uWarm: { value: new THREE.Color('#ffb766') },
      uIntensity: { value: 3 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vP;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        vP = position;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uWarm;
      uniform float uIntensity;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vP;
      void main() {
        vec3 n = normalize(vN);
        float ndv = clamp(dot(n, normalize(vV)), 0.0, 1.0);
        vec3 col = mix(uWarm, vec3(1.0), ndv * ndv) * uIntensity;
        // frosted rim falls off to the warm glass tint
        col *= 0.22 + 0.78 * smoothstep(0.0, 0.85, ndv);
        // filament: a short vertical line seen through the frost
        float fil = exp(-pow(n.x / 0.07, 2.0)) * smoothstep(0.42, 0.25, abs(n.y)) * smoothstep(0.6, 0.9, ndv);
        col += vec3(1.0, 0.9, 0.75) * fil * 1.5 * uIntensity;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

// Small camera-facing glow for the low tier (no composer). Drawn once.
function glowSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,214,160,0.55)');
  grad.addColorStop(0.35, 'rgba(255,190,120,0.16)');
  grad.addColorStop(1, 'rgba(255,180,110,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sprite.renderOrder = 3;
  return sprite;
}

function lathe(points, segments = 96) {
  return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segments);
}

/**
 * createPole({ tier, reducedMotion, sprite }) → { group, globe, uniforms, setOpen, setMotion, update(dt), spin, dispose }
 * sprite: draw the low-tier glow sprite (default: tier !== 'high').
 */
export function createPole({ tier = 'high', reducedMotion = false, sprite } = {}) {
  const hi = tier === 'high';
  const group = new THREE.Group();
  const m = studioMaterials({ tier });
  const disposables = [m.chrome, m.steel, m.brass, m.abs, m.walnut];
  const keep = (x) => (disposables.push(x), x);

  const uniforms = {
    uSpin: { value: 0 },
    uRed: { value: new THREE.Color(POLE_COLORS.red) },
    uWhite: { value: new THREE.Color(POLE_COLORS.white) },
    uBlue: { value: new THREE.Color(POLE_COLORS.blue) },
    uBands: { value: POLE.bands },
    uTwist: { value: POLE.twist },
    uHeight: { value: POLE.height },
  };

  const R = POLE.radius;
  const H = POLE.height;

  const core = new THREE.Mesh(keep(new THREE.CylinderGeometry(R, R, H, 128, 1, true)), keep(coreMaterial(uniforms, hi)));
  group.add(core);

  const glass = new THREE.Mesh(keep(new THREE.CylinderGeometry(R + 0.04, R + 0.04, H + 0.02, 96, 1, true)), keep(glassMaterial()));
  glass.renderOrder = 2;
  group.add(glass);

  // Turned cap: collar over the sleeve, bead, cove, bead, shoulder, dome to the neck.
  const capGeo = keep(
    lathe([
      [R + 0.035, -0.03], [R + 0.075, -0.02], [R + 0.085, 0.0],
      [R + 0.085, 0.03], [R + 0.105, 0.045], [R + 0.105, 0.065], [R + 0.085, 0.08], // bead
      [R + 0.07, 0.095], [R + 0.065, 0.11], [R + 0.07, 0.125], // cove
      [R + 0.095, 0.135], [R + 0.11, 0.15], [R + 0.095, 0.165], // bead
      [R + 0.085, 0.175], [R + 0.085, 0.19], [R + 0.06, 0.205], // shoulder
      [R - 0.02, 0.235], [0.17, 0.26], [0.1, 0.275], [0.0, 0.28],
    ]),
  );
  const topCap = new THREE.Mesh(capGeo, m.chrome);
  topCap.position.y = H / 2;
  const bottomCap = new THREE.Mesh(capGeo, m.chrome);
  bottomCap.position.y = -H / 2;
  bottomCap.scale.y = -1;
  group.add(topCap, bottomCap);

  // brass rings where the caps meet the sleeve
  const ringGeo = keep(new THREE.TorusGeometry(R + 0.042, 0.012, 12, 96));
  for (const y of [H / 2 - 0.01, -H / 2 + 0.01]) {
    const ring = new THREE.Mesh(ringGeo, m.brass);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    group.add(ring);
  }

  // brass finial under the bottom cap
  const finial = new THREE.Mesh(
    keep(lathe([[0.1, 0], [0.12, -0.02], [0.08, -0.05], [0.07, -0.07], [0.105, -0.11], [0.09, -0.14], [0.05, -0.18], [0.02, -0.215], [0.0, -0.225]], 64)),
    m.brass,
  );
  finial.position.y = -H / 2 - 0.27;
  group.add(finial);

  // neck and gallery that hold the globe
  const neck = new THREE.Mesh(
    keep(lathe([[0.1, 0], [0.065, 0.03], [0.055, 0.08], [0.075, 0.1], [0.12, 0.115], [0.13, 0.13], [0.11, 0.14], [0.0, 0.14]], 64)),
    m.chrome,
  );
  neck.position.y = H / 2 + 0.27;
  group.add(neck);

  const GLOBE_R = 0.21;
  const globe = new THREE.Mesh(keep(new THREE.SphereGeometry(GLOBE_R, 64, 40)), keep(globeMaterial()));
  globe.position.y = H / 2 + 0.41 + GLOBE_R * 0.92;
  globe.layers.enable(BLOOM_LAYER);
  group.add(globe);

  let glow = null;
  if (sprite ?? !hi) {
    glow = glowSprite();
    keep(glow.material.map);
    keep(glow.material);
    glow.scale.setScalar(GLOBE_R * 6);
    glow.position.copy(globe.position);
    group.add(glow);
  }

  // Chrome wall bracket: two arms from clamp collars back to round wall plates.
  const WALL = -0.95; // facade plane, pole-local z
  const armGeo = keep(new THREE.CylinderGeometry(0.028, 0.028, 1, 24));
  const collarGeo = keep(new THREE.TorusGeometry(R + 0.105, 0.022, 14, 72));
  const plateGeo = keep(lathe([[0.0, 0.0], [0.11, 0.0], [0.12, 0.012], [0.11, 0.024], [0.06, 0.04], [0.035, 0.05], [0.0, 0.05]], 48));
  for (const y of [H / 2 + 0.1, -H / 2 - 0.1]) {
    const collar = new THREE.Mesh(collarGeo, m.chrome);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = y;
    group.add(collar);
    const len = -WALL - (R + 0.11);
    const arm = new THREE.Mesh(armGeo, m.chrome);
    arm.rotation.x = Math.PI / 2;
    arm.scale.y = len;
    arm.position.set(0, y, -(R + 0.11) - len / 2);
    group.add(arm);
    const plate = new THREE.Mesh(plateGeo, m.chrome);
    plate.rotation.x = Math.PI / 2;
    plate.position.set(0, y, WALL);
    group.add(plate);
  }

  let spin = 0;
  let open = true;
  let motion = !reducedMotion;
  const turning = () => open && motion && !reducedMotion;

  return {
    group,
    core,
    globe,
    glow,
    uniforms,
    wallZ: WALL,
    setOpen(on) {
      open = !!on;
    },
    setMotion(on) {
      motion = !!on;
    },
    get turning() {
      return turning();
    },
    // Returns true while the pole is moving (the stage keeps rendering).
    update(dt) {
      if (!turning()) return false;
      spin = (spin + dt * POLE.spinRate) % (Math.PI * 2 * 64);
      uniforms.uSpin.value = spin;
      return true;
    },
    get spin() {
      return spin;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
