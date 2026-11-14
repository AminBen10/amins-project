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
import { createPole, BLOOM_LAYER, POLE } from './pole.js';
import { meshHead, createHead } from './head.js';
import { createTools } from './tools.js';
import { createCape } from './cape.js';
import { createCameraRig, shotPose } from './camera.js';
import { createClippings } from './clippings.js';
import { ANCHORS, HEAD_POINTS, HEAD_BOUNDS, AXIS_Z } from './hairField.js';

// Stage: the shopfront with the pole as the hero object in front of the room shader, then the
// station with the head, cape and tools. The page drives it two ways (C11):
//  - story: setInput({enter, consult, clipper, scissors, razor, mirror, carta, turn}) beats map onto
//    the STORY program's steps (step.beat, step.at) → hair.show(handle, i, t), tools from toolPath,
//    camera eased between the steps' shots;
//  - film: setFilm(FilmState) plays any prepared program with the shared timing
//    (step total (0.3 + dur + 0.2)/speed, hair t = clamp((local·speed − 0.3)/dur, 0, 1)).
// anchors (CSS px) are projected after every rendered frame for the page's notes.

const { smoothstep, lerp, damp, clamp } = THREE.MathUtils;

// Lights, exactly per the brief: cool overhead key, warm street fill, neutral ambient.
export const LIGHTS = {
  key: { color: '#EEF2F5', intensity: 2.4, position: [0.5, 6, 3] },
  fill: { color: '#FFB874', intensity: 0.35, position: [-4, 1.5, 3] },
  ambient: { sky: '#3A3A3A', ground: '#121212', intensity: 0.35 },
  nape: { color: '#FFE6CC', intensity: 1.6 },
};

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

// Story beats in scroll order; a step's place in the story is beatIndex + at.
const BEATS = ['enter', 'consult', 'clipper', 'scissors', 'razor', 'mirror'];
const INPUTS = ['hero', 'enter', 'consult', 'clipper', 'scissors', 'razor', 'mirror', 'carta', 'turn'];
const VIEW_SHOT = { frente: 'frente', perfil: 'perfil', nuca: 'nuca' };
const MIRROR_RISE = [0.28, 0.45]; // mirror beat range over which the hand mirror comes up
const DIP_S = 0.2; // setFilm(null): back to the story through a 200 ms dip
const smoother = (x) => x * x * x * (x * (x * 6 - 15) + 10);
const ease = (x) => 1 - (1 - x) * (1 - x);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Story map for a prepared STORY handle: every step's [g0, g1] on the story axis (beat index + at)
 * and the camera keys (a step's shot holds from 30 % into the step to its end; quiet runs keep
 * the first quiet step's shot).
 */
function storyMap(handle) {
  const steps = handle.steps.map((s, i) => {
    const b = Math.max(0, BEATS.indexOf(s.beat));
    const at = s.at || [0, 1];
    return { i, g0: b + at[0], g1: b + at[1] };
  });
  const keys = [];
  let quietRun = false;
  handle.steps.forEach((s, i) => {
    const { g0, g1 } = steps[i];
    if (s.quiet && s.op !== 'mirror') {
      if (quietRun) {
        keys[keys.length - 1].gb = g1;
        return;
      }
      quietRun = true;
    } else quietRun = false;
    keys.push({ ga: g0 + 0.3 * (g1 - g0), gb: g1, shot: s.shot || 'frente', mirror: s.op === 'mirror' });
  });
  return { handle, steps, keys };
}

/**
 * createStage(canvas, { reducedMotion, tier, profile, data:{THEME, CLAIMS, GUARDS, STORY} }) → Promise<Stage>
 * Stage per the scene contract (see the interface in plan-scene.json). Resolves as soon as the
 * renderer runs; `ready`/onReady when the head, the story program and every shader are in.
 */
export async function createStage(canvas, { reducedMotion = false, tier, profile, data } = {}) {
  if (!data || !data.STORY) {
    // older callers pass no data: read the active client's
    const cfg = await import('../config.js');
    data = { THEME: cfg.THEME, CLAIMS: cfg.CLAIMS, GUARDS: cfg.GUARDS, STORY: cfg.STORY, ...(data || {}) };
  }
  const GUARDS = data.GUARDS || {};
  tier = tier || profile?.tier || detectTier({ reducedMotion }).tier;
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
  // Nape light: nothing in the brief's rig reaches the back of the head, so the nuca shot and the
  // hand mirror showed a black void. A soft warm light from over the viewer's shoulder, only
  // while a camera looks at the back (the main camera in the nuca shot, the mirror's camera).
  const nape = new THREE.DirectionalLight(LIGHTS.nape.color, 0);
  scene.add(key, fill, hemi, nape, nape.target);
  for (const l of [key, fill, hemi, nape]) l.layers.enable(1); // the hand mirror's camera sees layer 1
  const sc = key.shadow.camera;
  function shadowFit(station) {
    // shop: the pole and facade; station: tight round head and shoulders for a sharper jaw shadow
    if (station) Object.assign(sc, { left: -3, right: 3, top: 3, bottom: -3.4, near: 2, far: 12 });
    else Object.assign(sc, { left: -6, right: 6, top: 5, bottom: -5, near: 1, far: 20 });
    sc.updateProjectionMatrix();
  }
  if (profile.shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    key.castShadow = true;
    key.shadow.mapSize.setScalar(profile.shadows.size || 1024);
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    shadowFit(false);
  }
  let shadowStation = false;

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
  const tools = createTools({ tier: profile.tier, reducedMotion, guards: GUARDS });
  headRig.add(tools.group);
  let cape = null;
  let clippings = null;

  const rig = createCameraRig(camera, { rig: headRig, reducedMotion });
  let frameRect = null; // CSS px rect of the DOM mirror, from setFrame()

  // the dip to black between film shots (and back from a film): one quad over the whole canvas
  const dip = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: { uA: { value: 0 } },
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform float uA; void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, uA); }',
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  dip.frustumCulled = false;
  dip.renderOrder = 1000;
  dip.visible = false;
  scene.add(dip);

  const post = usePost ? createPost(renderer, scene, camera, profile) : null;

  let head = null;
  let story = null;
  let ready = false;
  let onReady = null;
  let onProgress = null;
  let onLost = null;
  let onRestored = null;
  let onMirrorMode = null;
  const frameSubs = new Set();
  let resolveHead;
  const headReady = new Promise((r) => (resolveHead = r));

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

  // Light the back of the head for a view from `eye` (world), k 0..1: the nape light comes from
  // over that viewpoint's shoulder, and the hair's fill turns towards it.
  const _c = new THREE.Vector3(), _d = new THREE.Vector3(), _f = new THREE.Vector3(), _fc = new THREE.Color();
  function lightBack(eye, k) {
    nape.intensity = LIGHTS.nape.intensity * k;
    if (!head) return;
    _c.set(0, HEAD_BOUNDS.center[1], AXIS_Z).applyMatrix4(headRig.matrixWorld);
    _d.copy(eye).sub(_c).normalize();
    _d.y += 0.75;
    _d.x += 0.35 * Math.sign(_d.z || 1);
    _d.normalize();
    nape.position.copy(_c).addScaledVector(_d, 5);
    nape.target.position.copy(_c);
    nape.target.updateMatrixWorld();
    _f.copy(fill.position).normalize().lerp(_d, k).normalize();
    _fc.set(LIGHTS.fill.color).multiplyScalar(LIGHTS.fill.intensity).lerp(_fc.clone().set(LIGHTS.nape.color).multiplyScalar(LIGHTS.nape.intensity * 0.8), k);
    head.setLighting?.({ fillDir: _f, fillColor: _fc });
  }
  const _eye = new THREE.Vector3(), _fwd = new THREE.Vector3();
  // how much the main camera looks at the back of the head (0 face .. 1 nape)
  function backness() {
    _c.set(0, HEAD_BOUNDS.center[1], AXIS_Z).applyMatrix4(headRig.matrixWorld);
    _eye.copy(camera.position).sub(_c).normalize();
    _fwd.set(0, 0, 1).transformDirection(headRig.matrixWorld);
    return smoothstep(-_eye.dot(_fwd), 0.05, 0.6);
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

  const onLayer1 = (o) => o.traverse((c) => c.layers.enable(1));

  (async () => {
    const d = await meshHead({ tier: profile.tier, skinStep: profile.hair.skinStep, hairStep: profile.hair.hairStep }, (p) => onProgress?.(p * 0.8));
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
    clippings = createClippings({ tier: profile.tier, reducedMotion, counts: profile.particles, talc: data.CLAIMS?.talc === 'talco', cape });
    headRig.add(clippings.group);
    for (const g of [head.group, cape.group, tools.group, clippings.group]) onLayer1(g);
    resolveHead();
    onProgress?.(0.85);
    if (data.STORY?.steps?.length) {
      try {
        story = storyMap(await head.hair.prepare(data.STORY, { guards: GUARDS, base: 'overgrown' }));
        head.hair.show(story.handle, -1, 0);
      } catch (err) {
        console.error(err);
      }
    }
    onProgress?.(0.95);
    await warmUp();
    ready = true;
    room.setReady();
    // in-world loading cue: the clipper's LED lights once everything is ready
    tools.setLED(true);
    onProgress?.(1);
    onReady?.();
    runtime.invalidate();
  })().catch((err) => {
    console.error(err);
    onLost?.({ fatal: true, reason: 'error', error: err });
  });

  // scroll-driven targets (written by the page) and their smoothed values
  const input = Object.fromEntries(INPUTS.map((k) => [k, 0]));
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
    runtime?.invalidate();
  }

  // Shop framing, in viewport fractions (x right, y up) at rest: the window
  // on the left, the pier with the pole, the door on the right (desktop); on
  // phones the window fills the top and the pole takes the right edge.
  const SHOPFRONT = {
    wide: { window: [0.035, 0.1, 0.62, 0.88], door: [0.885, 0.0, 1.2, 0.88], pole: [0.752, 0.44], scale: 0.98 },
    narrow: { window: [-0.2, 0.36, 0.66, 0.86], door: null, pole: [0.83, 0.47], scale: 0.66 },
  };
  const POLE_YAW = -0.75;
  // The page's own shopfront grid, when it gives one (setShopfront): the 3D openings and the pole
  // then sit exactly behind the DOM panes and in the pier between them.
  let domShop = null;
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
    shopCamera();
    restCam.copy(camera);
    restCam.position.set(0, 0.15, 9.5);
    restCam.lookAt(0, 0, 0);
    restCam.updateMatrixWorld();
    let L = wide ? SHOPFRONT.wide : SHOPFRONT.narrow;
    if (domShop) {
      // pole scale from the pier's width: its enamel tube fills ~78% of it (z = 0 plane)
      const unitPx = height / (2 * restCam.position.z * Math.tan(THREE.MathUtils.degToRad(restCam.fov / 2)));
      const scale = clamp((domShop.poleW * width * 0.78) / (2 * POLE.radius * unitPx), 0.4, 1.2);
      L = { window: domShop.window, door: domShop.door, pole: domShop.pole, scale };
    }
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
        quality.mirror = c.value;
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

  // ------------------------------------------------------------ hand mirror (C12)
  let hm = null;
  let hmLoading = false;
  let mirrorAngle = 0;
  let mirrorFrame = 0;
  const mirror = { mode: 'off', rect: null };
  const wantsRT = () => profile.mirror?.mode === 'rt' && quality.mirror !== 'mask';
  function loadMirror() {
    if (hm || hmLoading || !wantsRT()) return;
    hmLoading = true;
    import('./handmirror.js')
      .then(({ createHandMirror }) => {
        hm = createHandMirror(renderer, { tier: profile.tier, size: { w: profile.mirror.w, h: profile.mirror.h } });
        hm.setAngle(mirrorAngle);
        scene.add(hm.group);
        runtime.invalidate();
      })
      .catch((err) => console.warn(err))
      .finally(() => (hmLoading = false));
  }
  function setMirrorMode(mode) {
    if (mirror.mode === mode) return;
    mirror.mode = mode;
    onMirrorMode?.(mode);
  }

  // ------------------------------------------------------------ anchors (CSS px, every frame)
  const anchors = {};
  for (const k of Object.keys(ANCHORS)) anchors[k] = { x: 0, y: 0, visible: false };
  anchors.face = { x: 0, y: 0, w: 0, h: 0 };
  anchors.head = { x: 0, y: 0, w: 0, h: 0 };
  const anchorPts = Object.fromEntries(Object.entries(ANCHORS).map(([k, a]) => [k, new THREE.Vector3(a[0], a[1], a[2])]));
  const HP = HEAD_POINTS;
  const facePts = [ANCHORS.flequillo, HP.glabella, HP.nose_tip, HP.pogonion, HP.mouth_corner, [-HP.mouth_corner[0], HP.mouth_corner[1], HP.mouth_corner[2]], [HP.ear_front[0] * 0.86, HP.ear_front[1], HP.ear_front[2] + 0.25], [-HP.ear_front[0] * 0.86, HP.ear_front[1], HP.ear_front[2] + 0.25]].map((a) => new THREE.Vector3(...a));
  const headPts = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    for (const y of [-1.0, -0.4, 0.3, 0.85]) headPts.push(new THREE.Vector3(Math.sin(a) * 0.82, y, AXIS_Z + Math.cos(a) * 0.95));
  }
  headPts.push(new THREE.Vector3(0, 1.12, AXIS_Z));
  const camLocal = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  const P = new THREE.Vector3(), Nn = new THREE.Vector3(), centre = new THREE.Vector3(0, 0.05, AXIS_Z);
  function rectOf(pts, out) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      rig.project(p, P);
      x0 = Math.min(x0, P.x);
      y0 = Math.min(y0, P.y);
      x1 = Math.max(x1, P.x);
      y1 = Math.max(y1, P.y);
    }
    out.x = x0;
    out.y = y0;
    out.w = x1 - x0;
    out.h = y1 - y0;
  }
  function updateAnchors(on) {
    if (!on || !head) {
      for (const k in anchorPts) anchors[k].visible = false;
      return;
    }
    headRig.updateWorldMatrix(true, false);
    inv.copy(headRig.matrixWorld).invert();
    camLocal.copy(camera.position).applyMatrix4(inv);
    for (const k in anchorPts) {
      const a = anchorPts[k];
      rig.project(a, P);
      const o = anchors[k];
      o.x = P.x;
      o.y = P.y;
      // facing the camera (normal from the head's centre), in front of it and on the canvas
      Nn.copy(a).sub(centre).normalize();
      const facing = Nn.dot(tmp.copy(camLocal).sub(a).normalize()) > 0.12;
      o.visible = facing && P.z < 1 && P.x >= 0 && P.y >= 0 && P.x <= width && P.y <= height;
    }
    rectOf(facePts, anchors.face);
    rectOf(headPts, anchors.head);
    // additive: is the face towards the camera (false on the nape views)
    anchors.face.visible = tmp.set(0, 0, 1).dot(camLocal.clone().sub(centre).normalize()) > 0.2;
  }

  // ------------------------------------------------------------ film state
  let film = null;
  let filmShot = null;
  let filmView = null;
  let filmHandle = null;
  let backDip = 0; // s left of the dip back to the story

  let open = true;
  let motionOn = !reducedMotion;
  let time = 0;
  let frameNo = 0;
  let mirrorK = 0;

  // story position: beat index + p of the latest beat that has started
  function storyG() {
    for (let b = BEATS.length - 1; b >= 0; b--) {
      const v = cur[BEATS[b]];
      if (v > 0) return b + v;
    }
    return 0;
  }
  function storyStep(g) {
    let i = -1;
    for (const s of story.steps) if (g >= s.g0) i = s.i;
    if (i < 0) return { i: -1, t: 0 };
    const s = story.steps[i];
    return { i, t: clamp01((g - s.g0) / Math.max(1e-6, s.g1 - s.g0)) };
  }
  function storyCamera(g, maskView) {
    const keys = story.keys;
    const shotOf = (k) => (k.mirror ? (maskView ? 'nuca' : 'frente') : k.shot);
    if (!keys.length) return ['frente', 'frente', 0];
    if (g <= keys[0].ga) return [shotOf(keys[0]), shotOf(keys[0]), 0];
    for (let j = 0; j < keys.length; j++) {
      const k = keys[j];
      if (g <= k.gb) return [shotOf(k), shotOf(k), 0];
      const n = keys[j + 1];
      if (n && g < n.ga) return [shotOf(k), shotOf(n), smoother(clamp01((g - k.gb) / Math.max(1e-6, n.ga - k.gb)))];
    }
    const l = keys[keys.length - 1];
    return [shotOf(l), shotOf(l), 0];
  }

  function frame(dt) {
    time += dt;
    frameNo++;
    let moving = false;
    const rate = reducedMotion ? 20 : 7;
    for (const k in input) {
      cur[k] = damp(cur[k], input[k], rate, dt);
      if (Math.abs(cur[k] - input[k]) < 0.0015) cur[k] = input[k];
      else moving = true;
    }
    const enter = cur.enter;
    const inShop = !film && enter < ENTER_CUT;
    shop.visible = inShop;
    station.visible = !inShop;
    room.setMode(inShop ? 0 : 1);
    if (profile.shadows && shadowStation !== !inShop) {
      shadowStation = !inShop;
      shadowFit(shadowStation);
    }

    if (pole.update(dt)) moving = true;
    room.setPoleSpin(pole.spin);

    const maskView = !wantsRT();
    let dipA = 0;
    if (inShop) {
      // Enter: the camera dollies to brush past the pole until its stripes fill the frame.
      shopCamera();
      const P0 = pole.group.position;
      const e = smoothstep(enter, 0, ENTER_CUT);
      const ee = e * e * (3 - 2 * e);
      camera.position.set(lerp(0, P0.x - 0.3, ee), lerp(0.15, P0.y + 0.1, ee), lerp(9.5, P0.z + 1.2, ee));
      look3.set(lerp(0, P0.x, ee), lerp(0, P0.y + 0.1, ee), lerp(0, P0.z, ee));
      camera.lookAt(look3);
      camera.updateMatrixWorld();
      windowToScreen();
      room.setBlur(0.018);
      room.setView(0, 0, 1);
      mirrorK = 0;
      tools.perform({ dt, time });
    } else {
      room.setBlur(0.016);
      room.setView(0, 0, 1);
      room.setRoom(film ? 0 : clamp01(cur.turn));
      const capeOff = film ? 0 : smoothstep(cur.turn, 0.2, 0.8);
      if (cape) {
        cape.setSnap(film ? 1 : smoothstep(enter, SNAP[0], SNAP[1]));
        cape.setOff(capeOff);
      }
      let handle = null, step = -1, t = 0, still = false;
      if (film && film.handle && head) {
        // ---------------- film
        handle = film.handle;
        const n = handle.steps.length;
        step = film.step < 0 ? -1 : film.step >= n ? n : Math.floor(film.step);
        const s = handle.steps[step];
        const speed = film.speed || 1;
        if (s) t = clamp01(((film.local || 0) * speed - 0.3) / Math.max(0.01, s.dur || 3));
        else t = step >= n ? 1 : 0;
        still = !!film.still;
        if (filmHandle !== handle) {
          filmHandle = handle;
          tools.reset();
          clippings?.reset();
        }
        mirrorK = clamp01(film.mirror || 0);
        const view = film.view && VIEW_SHOT[film.view];
        if (view) {
          if (filmView !== view) {
            filmView = view;
            rig.to(view);
          }
          rig.setYaw(film.yaw || 0);
          rig.setPush(0);
          filmShot = null;
        } else {
          filmView = null;
          let shot = s ? s.shot || 'frente' : 'frente';
          if (mirrorK > 0.5 && maskView) shot = 'nuca';
          if (shot !== filmShot) {
            filmShot = shot;
            rig.cut(shot);
          }
          rig.setYaw(0);
          // films push in 2–4 % over a step
          rig.setPush(still || reducedMotion || !s ? 0 : 0.03 * t);
        }
        dipA = clamp01(film.dip || 0);
        if (rig.update(dt)) moving = true;
      } else if (story && head) {
        // ---------------- story
        handle = story.handle;
        const g = storyG();
        ({ i: step, t } = storyStep(g));
        // the hand mirror comes up over the mirror beat and goes down as the Carta comes in
        const kc = smoothstep(cur.carta, 0.55, 0.95);
        mirrorK = ease(clamp01((cur.mirror - MIRROR_RISE[0]) / (MIRROR_RISE[1] - MIRROR_RISE[0]))) * (1 - kc);
        cape?.setPeel(clamp01(cur.mirror / 0.2));
        const [a, b, k] = storyCamera(g, maskView);
        if (kc > 0) rig.blend(k > 0.5 ? b : a, 'frente', kc);
        else rig.blend(a, b, k);
        rig.setYaw(0);
        rig.setPush(0);
        filmShot = filmView = null;
      }
      if (backDip > 0) {
        backDip = Math.max(0, backDip - dt);
        const k = 1 - backDip / DIP_S;
        dipA = Math.max(dipA, 1 - Math.abs(1 - 2 * k));
        moving = true;
      }
      rig.apply();
      headRig.updateWorldMatrix(true, false);
      lightBack(camera.position, backness());

      if (head && handle) {
        const hair = head.hair;
        hair.show(handle, step, t);
        const n = handle.steps.length;
        const s = step >= 0 && step < n ? handle.steps[step] : null;
        const res = tools.perform({ handle, step: s, t, next: handle.steps[step + 1] || null, still, dt, time, hair });
        if (res.moving) moving = true;
        if (clippings?.update({ hair, handle, step, t, tool: res, off: capeOff, dt })) moving = true;
      } else {
        tools.perform({ dt, time });
      }
    }

    // ---------------- hand mirror: rt (3D mirror, second camera) or mask (camera on the nape + DOM oval)
    if (mirrorK > 0.001) {
      if (wantsRT()) loadMirror();
      setMirrorMode(wantsRT() && hm ? 'rt' : 'mask');
    } else setMirrorMode('off');
    if (hm) {
      if (hm.update(dt, reducedMotion)) moving = true;
      const show = mirror.mode === 'rt';
      hm.place(camera, rig.frame, show ? mirrorK : 0, { phone: rig.phone, headDist: rig.pose.dist });
      if (show) {
        const cad = quality.mirror === 'half' ? 2 : 1;
        const frozen = quality.mirror === 'freeze' && hm.rendered;
        if (!frozen && (frameNo % cad === 0 || !hm.rendered)) {
          const mainBack = backness();
          hm.render(scene, headRig, { hair: head?.hair, layers: profile.mirror?.layers ?? 10, onCamera: (cam) => lightBack(cam.position, 1) });
          lightBack(camera.position, mainBack);
        }
        hm.group.updateMatrixWorld();
        mirror.rect = hm.glassRect(camera, rig.frame);
      }
    }
    if (mirror.mode === 'mask') {
      const h = anchors.head;
      const H = h.h * 1.12;
      mirror.rect = { x: h.x + h.w / 2 - H / 2.6, y: h.y + h.h / 2 - H / 2, w: H / 1.3, h: H };
    } else if (mirror.mode === 'off') mirror.rect = null;

    dip.visible = dipA > 0.001;
    dip.material.uniforms.uA.value = dipA;

    if (room.render(dt)) moving = true;
    if (post) post.render(inShop && open);
    else renderer.render(scene, camera);
    updateAnchors(!inShop);
    for (const fn of frameSubs) fn(anchors);
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

  // ------------------------------------------------------------ plate mode (C13)
  async function renderPlate(program, { size = 320 } = {}) {
    await headReady;
    const hair = head.hair;
    const [{ engrave }, handle] = await Promise.all([import('./plate.js'), hair.prepare(program, { guards: GUARDS, base: 'overgrown' })]);
    const hidden = [shop, room.backdrop, cape.group, tools.group, clippings.group, dip, hm?.group].filter(Boolean);
    const was = hidden.map((o) => o.visible);
    const stationWas = station.visible;
    hidden.forEach((o) => (o.visible = false));
    station.visible = true;
    head.setPlate(true);
    hair.setLift(null);
    hair.setContact(null);
    hair.show(handle, handle.steps.length, 1);
    const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 60);
    const pose = shotPose('tresCuartos', { aspect: 1 });
    const az = 0.95, el = 0.1, d = pose.dist * 0.98;
    headRig.updateWorldMatrix(true, false);
    cam.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(d).add(pose.target).applyMatrix4(headRig.matrixWorld);
    cam.lookAt(pose.target.clone().applyMatrix4(headRig.matrixWorld));
    cam.updateMatrixWorld();
    try {
      return engrave(renderer, scene, cam, size);
    } finally {
      hidden.forEach((o, i) => (o.visible = was[i]));
      station.visible = stationWas;
      head.setPlate(false);
      runtime.invalidate();
    }
  }

  return {
    quality,
    profile,
    renderer,
    get ready() {
      return ready;
    },
    set onReady(fn) {
      onReady = fn;
      if (ready) fn?.();
    },
    set onProgress(fn) {
      onProgress = fn;
    },
    set onLost(fn) {
      onLost = fn;
    },
    set onRestored(fn) {
      onRestored = fn;
    },
    set onMirrorMode(fn) {
      onMirrorMode = fn;
    },
    anchors,
    mirror,
    onFrame(cb) {
      frameSubs.add(cb);
      return () => frameSubs.delete(cb);
    },
    setInput(next) {
      for (const k of INPUTS) if (typeof next[k] === 'number') input[k] = clamp01(next[k]);
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
    /**
     * setShopfront({window:[x0,y0,x1,y1], door:[..]|null, pole:[x,y], poleW}|null): the DOM
     * shopfront at rest in viewport fractions (x right, y up; poleW = pier width / viewport width).
     */
    setShopfront(L) {
      domShop = L && L.window && L.pole ? { window: L.window, door: L.door || null, pole: L.pole, poleW: L.poleW || 0.05 } : null;
      shopLayout();
      if (openings.length) windowToScreen();
      runtime.invalidate();
    },
    setOpen(on) {
      open = !!on;
      pole.setOpen(open);
      room.setOpen(open);
      runtime.invalidate();
    },
    setMotion(on) {
      motionOn = !!on;
      pole.setMotion(motionOn);
      runtime.invalidate();
    },
    setMirrorAngle(deg) {
      mirrorAngle = clamp(+deg || 0, -35, 35);
      hm?.setAngle(mirrorAngle);
      runtime.invalidate();
    },
    /** Compute a program on the head (worker). base 'overgrown' | 'current'; resetParts grown back first. */
    async prepare(program, { base = 'overgrown', resetParts = null } = {}) {
      await headReady;
      return head.hair.prepare(program, { guards: GUARDS, base, resetParts });
    },
    /** FilmState or null (back to the story through a 200 ms dip). */
    setFilm(state) {
      if (!state || !state.handle) {
        if (film) {
          backDip = reducedMotion ? 0 : DIP_S;
          tools.reset();
          clippings?.reset();
          head?.hair.setLift(null);
          head?.hair.setContact(null);
        }
        film = null;
        filmHandle = null;
      } else {
        film = state;
      }
      runtime.invalidate();
    },
    renderPlate,
    setRunning(on) {
      runtime.setRunning(on);
    },
    resize,
    // internals for QA pages
    _internals: { scene, camera, rig, tools, get cape() { return cape; }, get head() { return head; }, get story() { return story; }, get hm() { return hm; }, cur, headRig, runtime, governor },
    dispose() {
      runtime.dispose();
      tools.dispose();
      cape?.dispose();
      clippings?.dispose();
      hm?.dispose();
      post?.dispose();
      pole.dispose();
      room.dispose();
      env.dispose();
      dip.geometry.dispose();
      dip.material.dispose();
      head?.dispose();
      renderer.dispose();
    },
  };
}
