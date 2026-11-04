import * as THREE from 'three';
import { ANCHORS, HEAD_BOUNDS, HEAD_POINTS } from './hairField.js';

// Shot presets and framing for the station camera. No orbit, no drift: a shot is a fixed pose
// computed from the head's bounds and landmarks; the story eases between two shots by scroll, the
// films hard-cut (with a 2-frame dip) and push in 2–4 %. Framing fits the subject into the DOM
// mirror rect with camera.setViewOffset, so the canvas can stay full-screen.
//
// Head-local frame (hairField): Y up, the face looks down +Z, +X is the head's left (the side the
// films show). Azimuth `az` is measured from the face (+Z) towards +X; elevation `el` upwards.

const C = HEAD_BOUNDS.center;
const P = HEAD_POINTS;
const mid = (a, b, k = 0.5) => a.map((v, i) => v + (b[i] - v) * k);

/**
 * SHOTS: name → { az, el, target [x,y,z] head-local, size (head units that must fit the frame's
 * height), fov (deg) }. Phones use the same presets slightly tighter (PHONE_TIGHTEN).
 */
export const SHOTS = Object.freeze({
  frente: { az: 0.0, el: 0.05, target: [0, -0.02, C[2]], size: 3.3, fov: 24 },
  perfil: { az: Math.PI / 2, el: 0.04, target: [0, -0.02, C[2] - 0.04], size: 3.3, fov: 24 },
  tresCuartos: { az: 0.68, el: 0.08, target: [0, -0.02, C[2]], size: 3.3, fov: 24 },
  tresCuartosAtras: { az: 2.25, el: 0.14, target: [0, -0.04, C[2] - 0.1], size: 3.3, fov: 24 },
  nuca: { az: Math.PI, el: 0.1, target: [0, -0.06, C[2] - 0.1], size: 3.3, fov: 24 },
  arriba: { az: 0.45, el: 0.95, target: [0, 0.35, -0.05], size: 3.1, fov: 24 },
  bajo: { az: 0.5, el: -0.32, target: [0, -0.2, 0.1], size: 3.3, fov: 24 },
  'detalle-patilla': { az: 1.2, el: 0.04, target: ANCHORS.patilla.slice(), size: 1.8, fov: 22 },
  'detalle-oreja': { az: 1.5, el: 0.06, target: mid(ANCHORS.oreja, P.ear_bottom), size: 1.9, fov: 22 },
  'detalle-nuca': { az: Math.PI - 0.3, el: 0.12, target: mid(ANCHORS.nuca, ANCHORS.coronilla, 0.25), size: 2.0, fov: 22 },
  'detalle-barba': { az: 0.85, el: -0.06, target: mid(ANCHORS.lineaBarba, ANCHORS.barbilla, 0.35), size: 2.0, fov: 22 },
});

export const SHOT_NAMES = Object.keys(SHOTS);
const PHONE_TIGHTEN = 0.9;

/** A shot as a plain pose {az, el, dist, target: Vector3, fov} for a frame aspect. */
export function shotPose(name, { aspect = 1, phone = false, out } = {}) {
  const s = SHOTS[name] || SHOTS.frente;
  const pose = out || { target: new THREE.Vector3() };
  const fov = s.fov;
  const size = s.size * (phone ? PHONE_TIGHTEN : 1);
  // fit `size` vertically, and 0.8·size horizontally on narrow frames
  const half = THREE.MathUtils.degToRad(fov / 2);
  const needH = size / 2;
  const needW = (size * 0.8) / 2 / Math.max(aspect, 0.01);
  pose.az = s.az;
  pose.el = s.el;
  pose.fov = fov;
  pose.dist = Math.max(needH, needW) / Math.tan(half);
  pose.target.set(s.target[0], s.target[1], s.target[2]);
  return pose;
}

function lerpPose(a, b, k, out) {
  // shortest way round in azimuth
  let d = b.az - a.az;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  out.az = a.az + d * k;
  out.el = a.el + (b.el - a.el) * k;
  out.dist = a.dist + (b.dist - a.dist) * k;
  out.fov = a.fov + (b.fov - a.fov) * k;
  out.target.lerpVectors(a.target, b.target, k);
  return out;
}

/**
 * createCameraRig(camera, { rig, reducedMotion }) → CameraRig
 * rig: the Object3D holding the head (its world matrix maps head-local → world).
 * CameraRig{ setFrame(rect {x,y,w,h} CSS px | null, viewW, viewH), frame, phone,
 *   shot(name) → pose, blend(a, b, k) (story: eased by scroll), cut(name) (films: hard cut),
 *   to(name) (free view: damped 0.6 s), setPush(0..0.04), setYaw(rad) (film free-view yaw),
 *   update(dt) → true while moving, apply() (writes the camera), project(v3 head-local, out) → CSS px }
 */
export function createCameraRig(camera, { rig, reducedMotion = false } = {}) {
  const frame = { x: 0, y: 0, w: 1, h: 1, W: 1, H: 1 };
  let phone = false;
  const cur = { az: 0, el: 0, dist: 8, fov: 24, target: new THREE.Vector3() };
  const goal = { az: 0, el: 0, dist: 8, fov: 24, target: new THREE.Vector3() };
  const pa = { target: new THREE.Vector3() };
  const pb = { target: new THREE.Vector3() };
  let damping = false;
  let push = 0;
  let yaw = 0;
  const aspect = () => frame.w / Math.max(frame.h, 1);
  const tmp = new THREE.Vector3();
  const tgt = new THREE.Vector3();

  function apply() {
    const az = cur.az + yaw;
    const d = cur.dist * (1 - push);
    tgt.copy(cur.target);
    tmp.set(Math.sin(az) * Math.cos(cur.el), Math.sin(cur.el), Math.cos(az) * Math.cos(cur.el)).multiplyScalar(d).add(tgt);
    rig.updateWorldMatrix(true, false);
    const s = rig.matrixWorld.getMaxScaleOnAxis();
    tmp.applyMatrix4(rig.matrixWorld);
    tgt.applyMatrix4(rig.matrixWorld);
    camera.position.copy(tmp);
    camera.up.set(0, 1, 0);
    camera.lookAt(tgt);
    camera.fov = cur.fov;
    camera.near = Math.max(0.05, d * s * 0.2);
    camera.far = d * s + 60;
    // the frustum belongs to the frame rect; the canvas around it shows the room
    camera.aspect = aspect();
    camera.setViewOffset(frame.w, frame.h, -frame.x, -frame.y, frame.W, frame.H);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  const api = {
    get frame() {
      return frame;
    },
    get phone() {
      return phone;
    },
    get pose() {
      return cur;
    },
    setFrame(rect, W, H) {
      frame.W = Math.max(1, W);
      frame.H = Math.max(1, H);
      phone = Math.min(W, H) < 600 || W < 700;
      const r = rect || api.defaultFrame(W, H);
      frame.x = r.x;
      frame.y = r.y;
      frame.w = Math.max(1, r.w);
      frame.h = Math.max(1, r.h);
    },
    // where the mirror sits when the page has not told us: right 56 % on wide, upper 60 % on phones
    defaultFrame(W, H) {
      if (W >= 900) return { x: W * 0.42, y: H * 0.05, w: W * 0.56, h: H * 0.9 };
      return { x: 0, y: H * 0.02, w: W, h: H * 0.6 };
    },
    shot(name, out) {
      return shotPose(name, { aspect: aspect(), phone, out });
    },
    blend(a, b, k) {
      shotPose(a, { aspect: aspect(), phone, out: pa });
      shotPose(b, { aspect: aspect(), phone, out: pb });
      lerpPose(pa, pb, THREE.MathUtils.clamp(k, 0, 1), cur);
      lerpPose(pa, pb, THREE.MathUtils.clamp(k, 0, 1), goal);
      damping = false;
    },
    cut(name) {
      api.shot(name, cur);
      api.shot(name, goal);
      damping = false;
    },
    to(name) {
      api.shot(name, goal);
      if (reducedMotion) api.cut(name);
      else damping = true;
    },
    setPush(v) {
      push = THREE.MathUtils.clamp(v, 0, 0.06);
    },
    setYaw(rad) {
      yaw = rad;
    },
    update(dt) {
      if (!damping) return false;
      // critically damped approach, ~0.6 s to settle, no overshoot
      const k = 1 - Math.exp(-dt * 7.5);
      lerpPose(cur, goal, k, cur);
      const done = Math.abs(cur.az - goal.az) + Math.abs(cur.el - goal.el) + Math.abs(cur.dist - goal.dist) + cur.target.distanceTo(goal.target) < 1e-4;
      if (done) {
        lerpPose(cur, goal, 1, cur);
        damping = false;
      }
      return !done;
    },
    apply,
    /** Project a head-local point to CSS px in the full canvas. */
    project(local, out = new THREE.Vector3()) {
      out.copy(local).applyMatrix4(rig.matrixWorld).project(camera);
      return out.set((out.x * 0.5 + 0.5) * frame.W, (0.5 - out.y * 0.5) * frame.H, out.z);
    },
  };
  return api;
}
