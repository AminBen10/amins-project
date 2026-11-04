import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { detectTier, qualityProfile, createGovernor } from './quality.js';
import { createRuntime } from './runtime.js';
import { createEnvironment } from './env.js';
import { createRoom, createFacade } from './room.js';
import { createPole, BLOOM_LAYER } from './pole.js';
import { meshHead, createHead } from './head.js';
import { createTools } from './tools.js';
import { createCape } from './cape.js';
import { createCameraRig } from './camera.js';

// Stage: the shopfront with the pole as the hero object in front of the room shader, then the
// station with the head, cape and tools. Runtime, tiers and the selective globe bloom (C2), cape
// (C6), tools (C7) and camera shots (C10) are in; the full stage API, story/film mapping and
// toolPath choreography (C8, C11) land on top of this.

const { smoothstep, lerp, damp, clamp } = THREE.MathUtils;

// Lights, exactly per the brief: cool overhead key, warm street fill, neutral ambient.
export const LIGHTS = {
  key: { color: '#EEF2F5', intensity: 2.4, position: [0.5, 6, 3] },
  fill: { color: '#FFB874', intensity: 0.35, position: [-4, 1.5, 3] },
  ambient: { sky: '#3A3A3A', ground: '#121212', intensity: 0.35 },
};

// Interim story shots for the legacy ritual timeline (0…4: consult, sides, top, beard):
// [t, shot A, shot B, blend]. C11 replaces this with the STORY program's beats.
const RITUAL_SHOTS = [
  [0, 'frente'],
  [0.6, 'tresCuartos'],
  [1.05, 'perfil'],
  [1.65, 'perfil'],
  [1.85, 'tresCuartosAtras'],
  [2.15, 'arriba'],
  [2.85, 'arriba'],
  [3.15, 'detalle-barba'],
  [3.85, 'detalle-barba'],
  [4.0, 'frente'],
];
function ritualShot(t) {
  for (let i = 1; i < RITUAL_SHOTS.length; i++) {
    const [t1, b] = RITUAL_SHOTS[i];
    if (t <= t1) {
      const [t0, a] = RITUAL_SHOTS[i - 1];
      return [a, b, THREE.MathUtils.smootherstep(t, t0, t1)];
    }
  }
  return ['frente', 'frente', 0];
}

const ENTER_CUT = 0.7; // hard match cut from the pole to the station

const SNAP = [0.72, 0.94]; // enter range over which the cape snaps from the sheet onto the shoulders

// Composite pass: the half-res globe bloom added to the full frame before tone mapping.
const MixShader = {
  uniforms: { tDiffuse: { value: null }, tBloom: { value: null }, uBloom: { value: 1 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tBloom;
    uniform float uBloom;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb += uBloom * texture2D(tBloom, vUv).rgb;
      gl_FragColor = c;
    }
  `,
};

/**
 * High tier: HalfFloat MSAA composer, the globe alone on BLOOM_LAYER rendered at half res into an
 * UnrealBloom(0.35, 0.4, 0), added in the composite before the output pass (tone map + sRGB).
 */
function createPost(renderer, scene, camera, profile) {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: profile.msaa || 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloomRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const bloomComposer = new EffectComposer(renderer, bloomRT);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(new RenderPass(scene, camera, null, new THREE.Color(0x000000), 1));
  const b = profile.bloom || { strength: 0.35, radius: 0.4 };
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), b.strength, b.radius, 0);
  bloomComposer.addPass(bloom);
  const mix = new ShaderPass(new THREE.ShaderMaterial(MixShader), 'tDiffuse');
  mix.material.uniforms.tBloom.value = bloomComposer.renderTarget2.texture;
  composer.addPass(mix);
  composer.addPass(new OutputPass());
  return {
    setSize(w, h, dpr) {
      composer.setPixelRatio(dpr);
      composer.setSize(w, h);
      bloomComposer.setPixelRatio(dpr);
      bloomComposer.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    },
    render(withBloom) {
      mix.material.uniforms.uBloom.value = withBloom ? 1 : 0;
      if (withBloom) {
        const mask = camera.layers.mask;
        const bg = scene.background;
        scene.background = null;
        camera.layers.set(BLOOM_LAYER);
        bloomComposer.render();
        camera.layers.mask = mask;
        scene.background = bg;
      }
      composer.render();
    },
    dispose() {
      composer.dispose();
      bloomComposer.dispose();
      bloom.dispose();
      mix.material.dispose();
      rt.dispose();
      bloomRT.dispose();
    },
  };
}

export function createStage(canvas, { reducedMotion = false, look, tier, profile, data = {} } = {}) {
  tier = tier || detectTier({ reducedMotion }).tier;
  profile = profile || qualityProfile(tier);
  const hi = profile.tier === 'high';
  const usePost = !!profile.composer;

  // Composer path: MSAA lives in the HalfFloat target; low: the default framebuffer antialias.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !usePost, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  let dpr = Math.min(devicePixelRatio || 1, profile.dpr.start);
  renderer.setPixelRatio(dpr);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  camera.position.set(0, 0.15, 9.5);

  let env = createEnvironment(renderer, { size: profile.env?.size ?? 256 });
  scene.environment = env.texture;

  const room = createRoom(renderer, { theme: data.THEME, tier: profile.tier, reducedMotion });
  scene.add(room.backdrop);

  const key = new THREE.DirectionalLight(LIGHTS.key.color, LIGHTS.key.intensity);
  key.position.set(...LIGHTS.key.position);
  const fill = new THREE.DirectionalLight(LIGHTS.fill.color, LIGHTS.fill.intensity);
  fill.position.set(...LIGHTS.fill.position);
  const hemi = new THREE.HemisphereLight(LIGHTS.ambient.sky, LIGHTS.ambient.ground, LIGHTS.ambient.intensity);
  scene.add(key, fill, hemi);
  if (profile.shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    key.castShadow = true;
    key.shadow.mapSize.setScalar(profile.shadows.size || 1024);
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    const sc = key.shadow.camera;
    sc.left = -6; sc.right = 6; sc.top = 5; sc.bottom = -5; sc.near = 1; sc.far = 20;
  }

  // Shopfront: the pole beside the door, bracketed to the facade.
  const shop = new THREE.Group();
  scene.add(shop);
  // high: the globe blooms through the composer; low: a camera-facing glow sprite
  const pole = createPole({ tier: profile.tier, reducedMotion, sprite: !usePost });
  shop.add(pole.group);
  const globeLight = new THREE.PointLight('#ffb766', 1.6, 0, 2);
  pole.globe.add(globeLight);
  const facade = createFacade({ theme: data.THEME });
  shop.add(facade.group);
  pole.group.traverse((o) => {
    if (o.isMesh && o !== pole.globe) o.castShadow = true;
  });

  // Station: the head in the chair at the origin; the camera rig moves, the head does not.
  const station = new THREE.Group();
  station.visible = false;
  scene.add(station);
  const headRig = new THREE.Group();
  station.add(headRig);
  const tools = createTools({ tier: profile.tier, reducedMotion, guards: data.GUARDS || {} });
  headRig.add(tools.group);
  let cape = null;

  const rig = createCameraRig(camera, { rig: headRig, reducedMotion });
  let frameRect = null; // CSS px rect of the DOM mirror, from setFrame()

  const post = usePost ? createPost(renderer, scene, camera, profile) : null;

  let head = null;
  let currentLook = { ...look };
  let ready = false;
  let onReady = null;
  let onLost = null;
  let onRestored = null;
  const frameSubs = new Set();

  function lightHead() {
    const keyDir = key.position.clone().normalize();
    const fillDir = fill.position.clone().normalize();
    head.setLighting?.({
      keyDir,
      keyColor: new THREE.Color(LIGHTS.key.color).multiplyScalar(LIGHTS.key.intensity),
      fillDir,
      fillColor: new THREE.Color(LIGHTS.fill.color).multiplyScalar(LIGHTS.fill.intensity),
      ambient: new THREE.Color(LIGHTS.ambient.sky).multiplyScalar(LIGHTS.ambient.intensity),
    });
  }

  // Compile every program the story will need (tools, guard, cape, both modes) before ready, so
  // nothing compiles while scrolling.
  async function warmUp() {
    const vis = [shop.visible, station.visible];
    shop.visible = station.visible = true;
    tools.showAll();
    try {
      if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
      else renderer.compile(scene, camera);
    } catch (err) {
      console.warn(err);
    }
    tools.hideAll();
    tools.setGuard(null);
    [shop.visible, station.visible] = vis;
  }

  meshHead({ tier: profile.tier, skinStep: profile.hair.skinStep }).then(async (d) => {
    head = createHead(d, { layers: governor.state.layers, tier: profile.tier });
    lightHead();
    headRig.add(head.group);
    head.group.traverse((o) => {
      if (o.isMesh) {
        o.receiveShadow = true;
        if (o === head.skin) o.castShadow = true;
      }
    });
    cape = createCape(head.bounds, { tier: profile.tier, seg: profile.cape?.seg });
    headRig.add(cape.group);
    head.hair?.ritual?.(currentLook, 0, 0, 0);
    await warmUp();
    ready = true;
    room.setReady();
    // in-world loading cue: the clipper's LED lights once everything is ready
    tools.setLED(true);
    onReady?.();
    runtime.invalidate();
  });

  // scroll-driven targets (written by the page) and their smoothed values
  const input = { hero: 0, enter: 0, morph: 0, consult: 0, sides: 0, top: 0, beard: 0, studio: 0, after: 0, turn: 0 };
  const cur = { ...input };
  let width = 1, height = 1, wide = true;

  function setSizes(w, h) {
    width = w;
    height = h;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    post?.setSize(width, height, dpr);
    room.setSize(width, height, dpr);
    rig.setFrame(frameRect, width, height);
    wide = width >= 900;
    shopLayout();
  }
  function resize() {
    setSizes(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight);
  }

  // Shop framing, in viewport fractions (x right, y up) at rest: the window
  // on the left, the pier with the pole, the door on the right (desktop); on
  // phones the window fills the top and the pole takes the right edge.
  const SHOPFRONT = {
    wide: { window: [0.035, 0.1, 0.62, 0.88], door: [0.885, 0.0, 1.2, 0.88], pole: [0.752, 0.44], scale: 0.98 },
    narrow: { window: [-0.2, 0.36, 0.66, 0.86], door: null, pole: [0.83, 0.47], scale: 0.66 },
  };
  const POLE_YAW = -0.75;
  const restCam = new THREE.PerspectiveCamera();
  const look3 = new THREE.Vector3();
  const ray = new THREE.Ray();
  const tmp = new THREE.Vector3();
  let wallZ = 0;
  let openings = [];
  function atFrac(fx, fy, zPlane, out) {
    ray.origin.copy(restCam.position);
    ray.direction.set(fx * 2 - 1, fy * 2 - 1, 0.5).unproject(restCam).sub(restCam.position).normalize();
    const t = (zPlane - ray.origin.z) / ray.direction.z;
    return out.copy(ray.direction).multiplyScalar(t).add(ray.origin);
  }
  function shopCamera() {
    camera.clearViewOffset();
    camera.fov = 30;
    camera.aspect = width / height;
    camera.near = 0.1;
    camera.far = 60;
    camera.updateProjectionMatrix();
  }
  function shopLayout() {
    const L = wide ? SHOPFRONT.wide : SHOPFRONT.narrow;
    shopCamera();
    restCam.copy(camera);
    restCam.position.set(0, 0.15, 9.5);
    restCam.lookAt(0, 0, 0);
    restCam.updateMatrixWorld();
    pole.group.scale.setScalar(L.scale);
    pole.group.rotation.y = POLE_YAW;
    wallZ = pole.wallZ * L.scale * Math.cos(POLE_YAW);
    atFrac(L.pole[0], L.pole[1], 0, pole.group.position);
    facade.group.position.set(0, 0, wallZ);
    const rect = (r) => {
      const a = atFrac(r[0], r[1], wallZ, new THREE.Vector3());
      const b = atFrac(r[2], r[3], wallZ, new THREE.Vector3());
      return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
    };
    openings = [L.window, L.door].filter(Boolean).map(rect);
    facade.setOpenings({ x0: -40, y0: -30, x1: 40, y1: 30 }, openings);
  }
  function windowToScreen() {
    const w = openings[0];
    tmp.set(w.x0, w.y0, wallZ).project(camera);
    const x0 = tmp.x * 0.5 + 0.5, y0 = tmp.y * 0.5 + 0.5;
    tmp.set(w.x1, w.y1, wallZ).project(camera);
    room.setWindow(x0, y0, tmp.x * 0.5 + 0.5, tmp.y * 0.5 + 0.5);
  }

  // ------------------------------------------------------------ governor and runtime
  const quality = { tier: profile.tier, level: 0, mirror: profile.mirror?.mode || 'mask' };
  const governor = createGovernor({
    profile,
    apply(c) {
      if (c.type === 'dpr') {
        dpr = c.value;
        setSizes(width, height);
      } else if (c.type === 'layers') {
        head?.setLayers(c.value);
      } else if (c.type === 'shadows') {
        key.castShadow = !!c.value && !!profile.shadows;
      } else if (c.type === 'mirror') {
        quality.mirror = c.value; // read by the hand mirror (C12)
      }
      quality.level = governor.level;
    },
  });

  function restoreContext() {
    // GPU-side content is gone: re-bake the PMREM, redraw the room target, re-upload canvases
    // (the old PMREM belonged to the lost context: drop it, deleting it would only warn)
    env = createEnvironment(renderer, { size: profile.env?.size ?? 256 });
    scene.environment = env.texture;
    room.invalidate();
    if (pole.glow) pole.glow.material.map.needsUpdate = true;
    setSizes(width, height);
    governor.reset();
    onRestored?.();
  }

  let open = true;
  let motionOn = !reducedMotion;
  let time = 0;

  function frame(dt) {
    time += dt;
    let moving = false;
    const rate = reducedMotion ? 20 : 7;
    for (const k in input) {
      cur[k] = THREE.MathUtils.damp(cur[k], input[k], rate, dt);
      if (Math.abs(cur[k] - input[k]) < 0.0015) cur[k] = input[k];
      else moving = true;
    }
    // `morph` is the old main.js scroll key for the same beat; drop it once motion sends `enter`
    const enter = Math.max(cur.enter, cur.morph);
    const inShop = enter < ENTER_CUT;
    shop.visible = inShop;
    station.visible = !inShop;
    room.setMode(inShop ? 0 : 1);

    if (pole.update(dt)) moving = true;
    room.setPoleSpin(pole.spin);

    if (inShop) {
      // Enter: the camera dollies to brush past the pole until its stripes fill the frame.
      shopCamera();
      const P = pole.group.position;
      const e = smoothstep(enter, 0, ENTER_CUT);
      const ee = e * e * (3 - 2 * e);
      camera.position.set(lerp(0, P.x - 0.3, ee), lerp(0.15, P.y + 0.1, ee), lerp(9.5, P.z + 1.2, ee));
      look3.set(lerp(0, P.x, ee), lerp(0, P.y + 0.1, ee), lerp(0, P.z, ee));
      camera.lookAt(look3);
      camera.updateMatrixWorld();
      windowToScreen();
      room.setBlur(0.018);
      room.setView(0, 0, 1);
    } else {
      const ritualT = cur.consult + cur.sides + cur.top + cur.beard;
      const [a, b, k] = ritualShot(ritualT);
      rig.blend(a, b, cur.studio > 0.5 ? 0 : k);
      if (cur.studio > 0.5) rig.blend('tresCuartos', 'tresCuartos', 0);
      if (rig.update(dt)) moving = true;
      rig.apply();
      room.setBlur(0.016);
      room.setView(0, 0, 1);
      room.setRoom(clamp(cur.turn, 0, 1));
      if (cape) {
        cape.setSnap(smoothstep(enter, SNAP[0], SNAP[1]));
        cape.setOff(smoothstep(cur.turn, 0.2, 0.8));
      }
      if (head) {
        if (cur.studio > 0.5) head.hair.settle?.(currentLook);
        else head.hair.ritual?.(currentLook, cur.sides, cur.top, cur.beard);
        head.hair.update?.(dt);
        if (head.hair.activity) tools.update(dt, time, head.hair.activity);
      }
    }

    if (room.render(dt)) moving = true;
    if (post) post.render(inShop && open);
    else renderer.render(scene, camera);
    for (const fn of frameSubs) fn();
    return moving;
  }

  const runtime = createRuntime({
    canvas,
    renderer,
    frame,
    governor,
    onResize: (w, h) => setSizes(w, h),
    onLost: (info) => onLost?.(info),
    onRestored: restoreContext,
  });

  resize();
  runtime.start();

  return {
    quality,
    profile,
    renderer,
    get ready() {
      return ready;
    },
    set onReady(fn) {
      onReady = fn;
      if (ready) fn();
    },
    set onLost(fn) {
      onLost = fn;
    },
    set onRestored(fn) {
      onRestored = fn;
    },
    onFrame(cb) {
      frameSubs.add(cb);
      return () => frameSubs.delete(cb);
    },
    setInput(next) {
      Object.assign(input, next);
      runtime.invalidate();
    },
    snap() {
      Object.assign(cur, input);
      runtime.invalidate();
    },
    // the DOM mirror rect (CSS px) the head is framed into; null = default
    setFrame(rect) {
      frameRect = rect ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : null;
      rig.setFrame(frameRect, width, height);
      runtime.invalidate();
    },
    setOpen(on) {
      open = !!on;
      pole.setOpen(open);
      room.setOpen(open);
    },
    setMotion(on) {
      motionOn = !!on;
      pole.setMotion(motionOn);
    },
    setLook(look2, { animate = true } = {}) {
      currentLook = { ...look2 };
      if (head && head.hair.mode === 'studio') {
        if (animate && !reducedMotion) head.hair.change(currentLook);
        else head.hair.change(currentLook, { duration: 0.01 });
      }
    },
    setRunning(on) {
      runtime.setRunning(on);
    },
    resize,
    // internals for the next scene tasks (C8/C11/C12) and QA pages
    _internals: { scene, camera, rig, tools, get cape() { return cape; }, get head() { return head; }, headRig, runtime, governor },
    dispose() {
      runtime.dispose();
      tools.dispose();
      cape?.dispose();
      post?.dispose();
      pole.dispose();
      room.dispose();
      env.dispose();
      renderer.dispose();
    },
  };
}
