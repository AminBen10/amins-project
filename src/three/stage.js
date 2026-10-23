import * as THREE from 'three';
import { detectTier, qualityProfile } from './quality.js';
import { createEnvironment } from './env.js';
import { createRoom, createFacade } from './room.js';
import { createPole } from './pole.js';
import { meshHead, createHead } from './head.js';
import { createTools } from './tools.js';

// Interim stage (scene stream C1/C3/C4/C5): the shopfront with the pole as the
// hero object in front of the room shader, then the station with the head.
// The runtime, tiers, selective globe bloom (C2), camera presets (C10) and the
// full stage API (C11) land on top of this.

const { smoothstep, lerp, damp, clamp } = THREE.MathUtils;

// Lights, exactly per the brief: cool overhead key, warm street fill, neutral ambient.
export const LIGHTS = {
  key: { color: '#EEF2F5', intensity: 2.4, position: [0.5, 6, 3] },
  fill: { color: '#FFB874', intensity: 0.35, position: [-4, 1.5, 3] },
  ambient: { sky: '#3A3A3A', ground: '#121212', intensity: 0.35 },
};

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

const ENTER_CUT = 0.7; // hard match cut from the pole to the station

export function createStage(canvas, { reducedMotion = false, look, tier, profile, data = {} } = {}) {
  tier = tier || detectTier({ reducedMotion }).tier;
  profile = profile || qualityProfile(tier);
  const hi = profile.tier === 'high';

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  let dpr = Math.min(devicePixelRatio || 1, profile.dpr.start);
  renderer.setPixelRatio(dpr);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  camera.position.set(0, 0.15, 9.5);

  const env = createEnvironment(renderer, { size: profile.env?.size ?? 256 });
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
  // The globe glow sprite stands in for the selective bloom until C2 adds the composer.
  const pole = createPole({ tier: profile.tier, reducedMotion, sprite: true });
  shop.add(pole.group);
  // the globe really lights the pier around it
  const globeLight = new THREE.PointLight('#ffb766', 1.6, 0, 2);
  pole.globe.add(globeLight);
  const facade = createFacade({ theme: data.THEME });
  shop.add(facade.group);
  pole.group.traverse((o) => {
    if (o.isMesh && o !== pole.globe) o.castShadow = true;
  });

  // Station: the head in the chair.
  const station = new THREE.Group();
  station.visible = false;
  scene.add(station);
  const headRig = new THREE.Group();
  headRig.scale.setScalar(0.95);
  station.add(headRig);
  const tools = createTools({ reducedMotion });
  headRig.add(tools.group);

  let head = null;
  let currentLook = { ...look };
  let ready = false;
  let onReady = null;

  function lightHead() {
    const keyDir = key.position.clone().normalize();
    const fillDir = fill.position.clone().normalize();
    if (head.setLighting) {
      head.setLighting({
        keyDir,
        keyColor: new THREE.Color(LIGHTS.key.color).multiplyScalar(LIGHTS.key.intensity),
        fillDir,
        fillColor: new THREE.Color(LIGHTS.fill.color).multiplyScalar(LIGHTS.fill.intensity),
        ambient: new THREE.Color(LIGHTS.ambient.sky).multiplyScalar(LIGHTS.ambient.intensity),
      });
      return;
    }
    // older head: drive the hair uniforms directly (warm only, no blue rim)
    const u = head.hair?.uniforms;
    if (!u) return;
    u.uKeyDir?.value.copy(keyDir);
    u.uKeyCol?.value.set(LIGHTS.key.color).multiplyScalar(1.4);
    u.uRimDir?.value.copy(fillDir);
    u.uRimCol?.value.set('#F0E6D6').multiplyScalar(0.6);
    u.uAmb?.value.set('#262422').multiplyScalar(0.9);
  }

  meshHead(hi ? 0.022 : 0.028).then((d) => {
    head = createHead(d, { layers: profile.hair.layers });
    if (head.uReveal) head.uReveal.value = 1;
    lightHead();
    headRig.add(head.group);
    head.hair?.ritual?.(currentLook, 0, 0, 0);
    ready = true;
    room.setReady();
    onReady?.();
  });

  // scroll-driven targets (written by the page) and their smoothed values
  const input = { hero: 0, enter: 0, morph: 0, consult: 0, sides: 0, top: 0, beard: 0, studio: 0, after: 0, turn: 0 };
  const cur = { ...input };
  let userYaw = 0;
  let userYawVel = 0;
  let width = 1, height = 1, wide = true;

  function resize() {
    width = canvas.clientWidth || innerWidth;
    height = canvas.clientHeight || innerHeight;
    dpr = Math.min(devicePixelRatio || 1, profile.dpr.start);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    tools.setPixelRatio(dpr);
    room.setSize(width, height, dpr);
    wide = width >= 900;
    shopLayout();
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
  const hit = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let wallZ = 0;
  let openings = [];
  // point on the plane z = zPlane under viewport fraction (fx, fy) for the rest camera
  function atFrac(fx, fy, zPlane, out) {
    ray.origin.copy(restCam.position);
    ray.direction.set(fx * 2 - 1, fy * 2 - 1, 0.5).unproject(restCam).sub(restCam.position).normalize();
    const t = (zPlane - ray.origin.z) / ray.direction.z;
    return out.copy(ray.direction).multiplyScalar(t).add(ray.origin);
  }
  function shopLayout() {
    const L = wide ? SHOPFRONT.wide : SHOPFRONT.narrow;
    restCam.copy(camera);
    restCam.position.set(0, 0.15, 9.5);
    restCam.lookAt(0, 0, 0);
    restCam.updateMatrixWorld();
    pole.group.scale.setScalar(L.scale);
    // the bracket reaches back and to the right, to the pier between pole and door
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
  // the room follows the window as the camera moves
  function windowToScreen() {
    const w = openings[0];
    tmp.set(w.x0, w.y0, wallZ).project(camera);
    const x0 = tmp.x * 0.5 + 0.5, y0 = tmp.y * 0.5 + 0.5;
    tmp.set(w.x1, w.y1, wallZ).project(camera);
    room.setWindow(x0, y0, tmp.x * 0.5 + 0.5, tmp.y * 0.5 + 0.5);
  }

  let open = true;
  let motionOn = !reducedMotion;
  let running = true;
  let rafId = 0;
  let time = 0;
  const clock = new THREE.Clock();

  function frame() {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!running) return;
    time += dt;

    const rate = reducedMotion ? 20 : 7;
    for (const k in input) {
      cur[k] = damp(cur[k], input[k], rate, dt);
      if (Math.abs(cur[k] - input[k]) < 0.0015) cur[k] = input[k];
    }
    // `morph` is the old main.js scroll key for the same beat; drop it once motion sends `enter`
    const enter = Math.max(cur.enter, cur.morph);
    const inShop = enter < ENTER_CUT;
    shop.visible = inShop;
    station.visible = !inShop;
    room.setMode(inShop ? 0 : 1);

    pole.update(dt);
    room.setPoleSpin(pole.spin);

    if (inShop) {
      // Enter: the camera dollies to brush past the pole until its stripes fill the frame.
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
      let [yaw, pitch] = ritualPose(ritualT);
      userYaw += userYawVel * dt;
      userYawVel = damp(userYawVel, 0, 3, dt);
      yaw = lerp(yaw, 0.4 + userYaw, cur.studio);
      pitch = lerp(pitch, 0, cur.studio);
      headRig.rotation.set(pitch, yaw, 0);
      const visH = 2 * 9.5 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const visW = visH * camera.aspect;
      station.position.set(wide ? visW * 0.2 : 0, wide ? -0.05 : visH * 0.2, 0);
      station.scale.setScalar((wide ? Math.min(1, visW / 9) : Math.min(0.8, (visW * 0.62) / 1.6)) * lerp(1, 0.85, cur.after));
      camera.position.set(0, 0.15, 9.5);
      camera.lookAt(0, 0, 0);
      room.setBlur(0.016);
      room.setView(0, 0, 1);
      room.setRoom(clamp(cur.turn, 0, 1));
      if (head) {
        if (cur.studio > 0.5) head.hair.settle?.(currentLook);
        else head.hair.ritual?.(currentLook, cur.sides, cur.top, cur.beard);
        head.hair.update?.(dt);
        if (head.hair.activity) tools.update(dt, time, head.hair.activity);
      }
    }

    room.render(dt);
    renderer.render(scene, camera);
  }

  resize();
  frame();

  return {
    quality: { tier: profile.tier, level: 0 },
    profile,
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
    // dx in radians for this pointer move; keeps a little inertia on release
    drag(dx, dt = 1 / 60) {
      userYaw += dx;
      userYawVel = clamp(dx / Math.max(dt, 1 / 120), -6, 6) * 0.6;
    },
    nudge(amount) {
      userYawVel = clamp(userYawVel + amount, -6, 6);
    },
    setRunning(on) {
      if (on && !running) clock.getDelta();
      running = on;
    },
    resize,
    dispose() {
      cancelAnimationFrame(rafId);
      pole.dispose();
      room.dispose();
      env.dispose();
      renderer.dispose();
    },
  };
}
