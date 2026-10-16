import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createPole } from './pole.js';
import { meshHead, createHead } from './head.js';
import { createTools } from './tools.js';
import { createMorph } from './morph.js';

const { smoothstep, lerp, damp, clamp } = THREE.MathUtils;

export function qualityProfile() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(innerWidth, innerHeight) < 700;
  const low = coarse || small || (navigator.hardwareConcurrency || 8) <= 4;
  return low
    ? { name: 'low', maxDpr: 1.5, layers: 16, step: 0.028, particles: 6000, msaa: 4, bloom: 0.45 }
    : { name: 'high', maxDpr: 1.75, layers: 26, step: 0.022, particles: 12000, msaa: 4, bloom: 0.55 };
}

// Background: deep ink with a warm lamp glow behind the subject.
function backdrop() {
  const mat = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uCenter: { value: new THREE.Vector2(0.7, 0.5) },
      uAspect: { value: 1 },
      uGlow: { value: 1 },
      uInk: { value: new THREE.Color('#0a101c') },
      uWarm: { value: new THREE.Color('#5a3f1c') },
      uCool: { value: new THREE.Color('#13213d') },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec2 uCenter;
      uniform float uAspect;
      uniform float uGlow;
      uniform vec3 uInk;
      uniform vec3 uWarm;
      uniform vec3 uCool;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec2 d = (vUv - uCenter) * vec2(uAspect, 1.0);
        float r = length(d);
        vec3 col = uInk;
        col = mix(col, uCool, smoothstep(1.4, 0.2, length((vUv - vec2(0.5, 1.1)) * vec2(uAspect, 1.0))) * 0.6);
        col += uWarm * exp(-r * r * 3.2) * 0.55 * uGlow;
        col *= 1.0 - smoothstep(0.55, 1.35, length((vUv - 0.5) * vec2(uAspect, 1.0))) * 0.55;
        col += (hash(gl_FragCoord.xy) - 0.5) * 0.004;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

function scanRing() {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc770').multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.006, 8, 160), mat);
  ring.rotation.x = Math.PI / 2;
  ring.visible = false;
  return ring;
}

// keyframes over the ritual timeline (0…4): [t, yaw, pitch]
const RITUAL_POSE = [
  [0, 0.35, 0],
  [0.5, -0.45, 0.02],
  [1.0, 0.15, 0],
  [1.25, 0.95, 0.04],
  [1.85, 0.95, 0.04],
  [2.1, 0.25, 0.38],
  [2.85, 0.15, 0.38],
  [3.1, 0.7, -0.12],
  [3.9, -0.7, -0.12],
  [4.0, 0.35, 0],
];

function ritualPose(t) {
  for (let i = 1; i < RITUAL_POSE.length; i++) {
    const [t1, y1, p1] = RITUAL_POSE[i];
    if (t <= t1) {
      const [t0, y0, p0] = RITUAL_POSE[i - 1];
      const k = smoothstep(t, t0, t1);
      return [lerp(y0, y1, k), lerp(p0, p1, k)];
    }
  }
  const last = RITUAL_POSE[RITUAL_POSE.length - 1];
  return [last[1], last[2]];
}

export function createStage(canvas, { reducedMotion = false, look }) {
  const quality = qualityProfile();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  let dpr = Math.min(devicePixelRatio || 1, quality.maxDpr);
  renderer.setPixelRatio(dpr);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  camera.position.set(0, 0.15, 9.5);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.75;

  const bg = backdrop();
  scene.add(bg);

  const key = new THREE.DirectionalLight('#ffd6a0', 2.1);
  key.position.set(4, 5, 6);
  const rim = new THREE.DirectionalLight('#5f86ff', 3.2);
  rim.position.set(-5, 2.5, -4);
  scene.add(key, rim, new THREE.HemisphereLight('#334066', '#0a0c12', 0.7));

  const anchor = new THREE.Group();
  scene.add(anchor);

  const pole = createPole({ reducedMotion });
  pole.group.scale.setScalar(0.88);
  anchor.add(pole.group);

  const headRig = new THREE.Group();
  headRig.scale.setScalar(0.95);
  anchor.add(headRig);

  const ring = scanRing();
  headRig.add(ring);

  const tools = createTools({ reducedMotion });
  headRig.add(tools.group);

  let head = null;
  let morph = null;
  let currentLook = { ...look };
  let ready = false;

  meshHead(quality.step).then((data) => {
    head = createHead(data, { layers: quality.layers });
    head.hair.uniforms.uKeyDir.value.copy(key.position).normalize();
    head.hair.uniforms.uRimDir.value.copy(rim.position).normalize();
    headRig.add(head.group);
    morph = createMorph(head.geometry, { count: quality.particles });
    morph.uniforms.uPx.value = dpr;
    scene.add(morph.points);
    head.hair.ritual(currentLook, 0, 0, 0);
    ready = true;
    onReady?.();
  });
  let onReady = null;

  // composer: MSAA target so alpha-to-coverage gives soft hair strands
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality.msaa });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), quality.bloom, 0.55, 0.93);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // scroll-driven targets (written by the page) and their smoothed values
  const input = { morph: 0, consult: 0, sides: 0, top: 0, beard: 0, studio: 0, after: 0 };
  const cur = { ...input };
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  let userYaw = 0;
  let userYawVel = 0;
  let layout = { x: 0, y: 0, scale: 1, wide: true };
  let width = 1, height = 1;

  function resize() {
    width = canvas.clientWidth || innerWidth;
    height = canvas.clientHeight || innerHeight;
    dpr = Math.min(devicePixelRatio || 1, quality.maxDpr);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(dpr);
    composer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    pole.dustMat.uniforms.uPx.value = dpr;
    tools.setPixelRatio(dpr);
    if (morph) morph.uniforms.uPx.value = dpr;

    const visH = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const visW = visH * camera.aspect;
    const wide = width >= 900;
    layout = wide
      ? { x: visW * 0.2, y: -0.05, scale: Math.min(1, visW / 9), wide }
      : { x: 0, y: visH * 0.2, scale: Math.min(0.8, (visW * 0.62) / 1.6), wide };
    pole.group.scale.setScalar(wide ? 0.88 : 0.76);
    bg.material.uniforms.uAspect.value = camera.aspect;
  }

  const clock = new THREE.Clock();
  let running = true;
  let rafId = 0;
  let time = 0;
  const v = new THREE.Vector3();

  function frame() {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!running) return;
    time += dt;

    // smooth the scroll input so wheel steps still look continuous
    const rate = reducedMotion ? 20 : 7;
    for (const k in input) {
      cur[k] = damp(cur[k], input[k], rate, dt);
      if (Math.abs(cur[k] - input[k]) < 0.0015) cur[k] = input[k];
    }
    if (!ready) cur.morph = 0;

    const m = cur.morph;
    const ritualT = cur.consult + cur.sides + cur.top + cur.beard;
    let [yaw, pitch] = ritualPose(ritualT);
    if (m < 1) yaw = lerp(0.9, yaw, smoothstep(m, 0.4, 1.0));

    // studio: hand control to the visitor
    userYaw += userYawVel * dt;
    userYawVel = damp(userYawVel, 0, 3, dt);
    if (cur.studio > 0.01 && !reducedMotion && Math.abs(userYawVel) < 0.02) userYaw += dt * 0.12 * Math.sin(time * 0.35);
    yaw = lerp(yaw, 0.4 + userYaw, cur.studio);
    pitch = lerp(pitch, 0, cur.studio);

    headRig.rotation.set(pitch, yaw, 0);
    const bob = reducedMotion ? 0 : Math.sin(time * 0.8) * 0.04;
    const s = layout.scale * lerp(1, 0.85, cur.after);
    anchor.position.set(layout.x, layout.y + bob, 0);
    anchor.scale.setScalar(s);

    // pointer parallax on desktop
    pointer.sx = damp(pointer.sx, pointer.x, 3, dt);
    pointer.sy = damp(pointer.sy, pointer.y, 3, dt);
    camera.position.x = pointer.sx * 0.25;
    camera.position.y = 0.15 + pointer.sy * 0.15;
    camera.lookAt(0, 0, 0);

    scene.updateMatrixWorld();
    pole.update(dt, time, m);

    if (head) {
      head.uReveal.value = m;
      head.group.visible = m > 0.5;
      head.hair.uniforms.uGrow.value = smoothstep(m, 0.82, 1.0);
      if (cur.studio > 0.5) {
        head.hair.settle(currentLook);
      } else {
        head.hair.ritual(currentLook, cur.sides, cur.top, cur.beard);
      }
      head.hair.update(dt);
      tools.update(dt, time, head.hair.activity);
      morph.update(m, pole.spin, pole.group, headRig);
    }

    // consultation scan ring sweeps down the head
    const c = cur.consult;
    ring.visible = c > 0.02 && c < 0.98 && m > 0.99;
    if (ring.visible) {
      const y = lerp(1.15, -0.95, c);
      const r = 0.12 + 0.86 * Math.sqrt(Math.max(0, 1 - ((y - 0.1) / 1.25) ** 2));
      ring.position.y = y;
      ring.scale.setScalar(r);
      ring.material.opacity = Math.sin(c * Math.PI);
    }

    // keep the warm glow behind the subject
    v.setFromMatrixPosition(anchor.matrixWorld).project(camera);
    bg.material.uniforms.uCenter.value.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
    bg.material.uniforms.uGlow.value = 1 - cur.after * 0.6;

    composer.render(dt);
  }

  resize();
  frame();

  return {
    quality,
    renderer,
    get ready() {
      return ready;
    },
    set onReady(fn) {
      onReady = fn;
      if (ready) fn();
    },
    setInput(next) {
      Object.assign(input, next);
    },
    setLook(look2, { animate = true } = {}) {
      currentLook = { ...look2 };
      if (head && head.hair.mode === 'studio') {
        if (animate && !reducedMotion) head.hair.change(currentLook);
        else head.hair.change(currentLook, { duration: 0.01 });
      }
    },
    // dx in radians for this pointer move; keeps a little inertia on release
    drag(dx, dt = 1 / 60) {
      userYaw += dx;
      userYawVel = clamp(dx / Math.max(dt, 1 / 120), -6, 6) * 0.6;
    },
    nudge(amount) {
      userYawVel = clamp(userYawVel + amount, -6, 6);
    },
    pointer(x, y) {
      pointer.x = x;
      pointer.y = y;
    },
    setRunning(on) {
      if (on && !running) clock.getDelta();
      running = on;
    },
    resize,
    dispose() {
      cancelAnimationFrame(rafId);
      renderer.dispose();
    },
  };
}
