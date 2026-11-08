import * as THREE from 'three';
import { MM, ANCHORS, isCutOp } from './hairField.js';

// Clippings (C9): cut hair falls from the blade onto the cape and stays there. The settled pile
// is deterministic (N seeded spots on the shoulders; how many show follows the program's cut
// progress), so it grows and shrinks with the scroll. The falling bits are the only live part
// and are off under reduced motion. Talc: one opaque puff at the nape, only if the shop claims
// it. Head-local units; lives in the head's rig next to the cape.

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const G = 6.5; // fall acceleration (head units/s², hair drifts: well below free fall)
const DRAG = 1.8;

/**
 * createClippings({ tier, reducedMotion, counts:{clippings, talc}, talc:bool, cape }) → Clippings{
 *   group, update({hair, handle, step, t, tool:{tip, normal, touching, main}, off, dt, time}) → moving,
 *   reset(), dispose() }
 * cape: the Cape (capeHeight(x, z) is where a bit lands).
 */
export function createClippings({ tier = 'high', reducedMotion = false, counts = {}, talc = false, cape }) {
  const hi = tier === 'high';
  const N = counts.clippings ?? (hi ? 1200 : 400);
  const FALL = hi ? 90 : 36;
  const group = new THREE.Group();
  group.name = 'clippings';

  // a hair: thin box along x, 1 unit long, scaled per instance
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: '#2a1d14', roughness: 0.85, metalness: 0 });

  // ------------------------------------------------ settled pile
  const pileGroup = new THREE.Group();
  group.add(pileGroup);
  const pile = new THREE.InstancedMesh(geo, mat, N);
  pile.frustumCulled = false;
  pile.count = 0;
  pileGroup.add(pile);
  {
    const r = rng(1873);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let placed = 0, tries = 0;
    while (placed < N && tries < N * 40) {
      tries++;
      // shoulders and chest, more of it on the shoulders (sides are cut first and most)
      const side = r() < 0.5 ? -1 : 1;
      const th = side * (0.35 + r() * 1.5);
      const rad = 0.8 + r() * 1.25;
      const x = Math.sin(th) * rad, z = -0.27 + Math.cos(th) * rad * 0.6;
      const y = cape?.capeHeight(x, z);
      if (y == null) continue;
      p.set(x, y + 0.004 + r() * 0.006, z);
      e.set((r() - 0.5) * 0.3, r() * Math.PI * 2, (r() - 0.5) * 0.3);
      q.setFromEuler(e);
      const short = r() < 0.6;
      const len = (short ? 1.5 + r() * 3 : 4 + r() * 8) * MM;
      const w = (0.35 + r() * 0.2) * MM * 1.6;
      s.set(len, w, w);
      m.compose(p, q, s);
      pile.setMatrixAt(placed++, m);
    }
    pile.userData.max = placed;
    pile.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------ falling bits
  const fall = new THREE.InstancedMesh(geo, mat, FALL);
  fall.frustumCulled = false;
  fall.count = 0;
  fall.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(fall);
  const bits = [];
  for (let i = 0; i < FALL; i++) {
    bits.push({ live: false, p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), len: 0, rest: 0, landed: false });
  }
  const rf = rng(77);
  let emitAcc = 0;

  // ------------------------------------------------ talc
  let puff = null;
  const T = counts.talc ?? (hi ? 150 : 80);
  if (talc) {
    const pos = new Float32Array(T * 3);
    const dir = new Float32Array(T * 3);
    const r = rng(9);
    const a = ANCHORS.nuca;
    for (let i = 0; i < T; i++) {
      pos.set(a, i * 3);
      const u = r() * Math.PI * 2, v = r() * 0.8;
      dir.set([Math.cos(u) * Math.sin(v) * 0.8, (r() - 0.3) * 0.5, -Math.abs(Math.cos(v)) * (0.6 + r() * 0.5)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
    const m = new THREE.ShaderMaterial({
      uniforms: { uK: { value: 0 }, uSize: { value: 2.2 }, uColor: { value: new THREE.Color('#efebe2') } },
      vertexShader: /* glsl */ `
        attribute vec3 aDir;
        uniform float uK;
        uniform float uSize;
        void main() {
          // spreads out over the first 400 ms, then drifts down
          float k = clamp(uK / 0.4, 0.0, 1.0);
          vec3 p = position + aDir * 0.16 * (1.0 - (1.0 - k) * (1.0 - k)) + vec3(0.0, -0.08 * max(uK - 0.4, 0.0), 0.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * (1.0 - smoothstep(1.2, 1.8, uK)) * 6.0 / -mv.z;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          if (dot(d, d) > 0.25) discard;
          gl_FragColor = vec4(uColor, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    puff = new THREE.Points(g, m);
    puff.frustumCulled = false;
    puff.visible = false;
    group.add(puff);
  }
  let puffT = -1, puffStep = null;

  // ------------------------------------------------ pile fraction per handle
  const cache = new WeakMap();
  function pileFrac(handle, i, cf) {
    if (!handle) return 0;
    let c = cache.get(handle);
    if (!c) {
      const info = handle._res?.info;
      const w = handle.steps.map((s, k) => (isCutOp(s.op) ? Math.max(0, +(info?.[k]?.changed ?? 1)) || 0 : 0));
      const cum = [0];
      for (const x of w) cum.push(cum[cum.length - 1] + x);
      c = { w, cum, total: cum[cum.length - 1] || 1 };
      cache.set(handle, c);
    }
    const n = handle.steps.length;
    if (i < 0) return 0;
    if (i >= n) return 1;
    return Math.min(1, (c.cum[i] + c.w[i] * cf) / c.total);
  }

  const M = new THREE.Matrix4(), S = new THREE.Vector3(), dq = new THREE.Quaternion();

  function update({ hair = null, handle = null, step = -1, t = 0, tool = null, off = 0, dt = 0 } = {}) {
    let moving = false;
    if (hair) mat.color.copy(hair.colors.root).multiplyScalar(0.9);
    const a = hair?.activity;
    // the pile: deterministic from where the program is
    const cf = a && a.handle === handle ? a.cutFraction : t;
    const frac = pileFrac(handle, step, cf);
    pile.count = Math.floor(frac * (pile.userData.max || 0));
    // cape whipped off: the pile slides off the shoulders and drops out of frame
    const o = off * off;
    pileGroup.position.set(0, -o * 5.5, o * 1.6);
    pileGroup.rotation.x = o * 0.5;
    pileGroup.visible = off < 0.995;

    // falling bits from the blade
    const cutting = !!(a && a.cutting && tool && tool.touching && !reducedMotion && off < 0.01);
    if (cutting) {
      emitAcc += dt * (hi ? 70 : 32);
      while (emitAcc >= 1) {
        emitAcc -= 1;
        const b = bits.find((x) => !x.live);
        if (!b) break;
        b.live = true;
        b.landed = false;
        b.rest = 0;
        b.p.copy(tool.tip).add(S.set(rf() - 0.5, rf() - 0.5, rf() - 0.5).multiplyScalar(0.03));
        b.v.copy(tool.normal).multiplyScalar(0.25 + rf() * 0.3).add(S.set(rf() - 0.5, rf() * 0.4, rf() - 0.5).multiplyScalar(0.5));
        b.q.setFromEuler(new THREE.Euler(rf() * 6.3, rf() * 6.3, rf() * 6.3));
        b.w.set(rf() - 0.5, rf() - 0.5, rf() - 0.5).multiplyScalar(12);
        b.len = (a.zone === 'top' || a.zone === 'fringe' || a.zone === 'crown' ? 5 + rf() * 9 : 1.5 + rf() * 3) * MM;
      }
    } else emitAcc = 0;
    let n = 0;
    for (const b of bits) {
      if (!b.live) continue;
      if (reducedMotion || off > 0.01) {
        b.live = false;
        continue;
      }
      if (!b.landed) {
        b.v.y -= G * dt;
        b.v.multiplyScalar(Math.exp(-DRAG * dt));
        b.p.addScaledVector(b.v, dt);
        dq.setFromAxisAngle(S.copy(b.w).normalize(), b.w.length() * dt);
        b.q.multiply(dq);
        const y = cape?.capeHeight(b.p.x, b.p.z);
        if (y != null && b.p.y <= y + 0.004) {
          b.p.y = y + 0.004;
          b.landed = true;
        } else if (b.p.y < -5) {
          b.live = false;
          continue;
        }
      } else {
        // a landed bit joins the pile: it fades into it
        b.rest += dt;
        if (b.rest > 0.9) {
          b.live = false;
          continue;
        }
      }
      const k = b.landed ? 1 - b.rest / 0.9 : 1;
      M.compose(b.p, b.q, S.set(b.len * k, 0.6 * MM * 1.6 * k, 0.6 * MM * 1.6 * k));
      fall.setMatrixAt(n++, M);
      moving = true;
    }
    fall.count = n;
    if (n) fall.instanceMatrix.needsUpdate = true;

    // talc: one puff when the talc step gets going
    if (puff) {
      const s = handle?.steps?.[step];
      const on = !reducedMotion && s && s.op === 'talc' && t > 0.25 && t < 1;
      if (on && puffStep !== s) {
        puffStep = s;
        puffT = 0;
      }
      if (!s || s.op !== 'talc' || t <= 0.25) puffStep = null;
      if (puffT >= 0) {
        puffT += dt;
        puff.material.uniforms.uK.value = puffT;
        puff.visible = puffT < 1.8;
        if (puffT >= 1.8) puffT = -1;
        else moving = true;
      } else puff.visible = false;
    }
    return moving;
  }

  return {
    group,
    update,
    reset() {
      for (const b of bits) b.live = false;
      fall.count = 0;
      puffT = -1;
      if (puff) puff.visible = false;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      pile.dispose();
      fall.dispose();
      if (puff) {
        puff.geometry.dispose();
        puff.material.dispose();
      }
    },
  };
}
