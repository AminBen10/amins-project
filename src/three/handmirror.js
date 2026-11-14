import * as THREE from 'three';
import { HEAD_BOUNDS, AXIS_Z } from './hairField.js';

// The hand mirror (C12), loaded on demand. An oval black-lacquer frame (1 : 1.3) with a chrome
// bezel and a turned handle; the glass shows a second camera's view of the back of the head
// (render target, x flipped like a mirror) with the edge darkening a real glass has. The mirror
// camera rides a ±35° arc behind the head (setAngle). Only the 'rt' mode uses this module; the
// 'mask' mode is a camera move in the stage plus a DOM oval.

export const MIRROR_LAYER = 1;

class Oval extends THREE.Curve {
  constructor(rx, ry) {
    super();
    this.rx = rx;
    this.ry = ry;
  }
  getPoint(t, out = new THREE.Vector3()) {
    const a = t * Math.PI * 2;
    return out.set(Math.cos(a) * this.rx, Math.sin(a) * this.ry, 0);
  }
}

function ovalShape(rx, ry, n = 96) {
  const s = new THREE.Shape();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    if (i === 0) s.moveTo(rx, 0);
    else s.lineTo(Math.cos(a) * rx, Math.sin(a) * ry);
  }
  return s;
}

const GLASS = {
  uniforms: { map: { value: null }, uOn: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      vUv = uv;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D map;
    uniform float uOn;
    varying vec2 vUv;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      vec3 c = texture2D(map, vec2(1.0 - vUv.x, vUv.y)).rgb * uOn;
      // silvered glass: a touch darker and cooler than the room, darker at the rim and at grazing angles
      vec2 d = (vUv - 0.5) * 2.0;
      float r = length(d);
      float rim = smoothstep(0.78, 1.0, r);
      float fres = pow(1.0 - clamp(dot(vN, vV), 0.0, 1.0), 3.0);
      c *= vec3(0.9, 0.92, 0.94) * (1.0 - 0.55 * rim) * (1.0 - 0.4 * fres);
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

/**
 * createHandMirror(renderer, { tier, size:{w,h}, layers }) → HandMirror{ group (world, place() moves it),
 *   camera, setAngle(deg), place(mainCamera, frame{x,y,w,h,W,H}, k 0..1, phone), render(scene, head, opts),
 *   glassRect(mainCamera, frame) → CSS px rect, dispose() }
 */
export function createHandMirror(renderer, { tier = 'high', size = { w: 384, h: 512 } } = {}) {
  const lacquer = new THREE.MeshPhysicalMaterial({ color: '#0b0b0c', roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#d6d9dc', roughness: 0.12, metalness: 1 });
  const RX = 1, RY = 1.3;
  const group = new THREE.Group();
  group.name = 'handMirror';
  const geos = [];
  const add = (geo, mat, setup) => {
    geos.push(geo);
    const m = new THREE.Mesh(geo, mat);
    setup?.(m);
    group.add(m);
    return m;
  };
  // frame: lacquer tube round the oval, chrome bezel inside it, lacquer back
  add(new THREE.TubeGeometry(new Oval(RX + 0.1, RY + 0.1), 160, 0.11, 18, true), lacquer);
  add(new THREE.TubeGeometry(new Oval(RX + 0.012, RY + 0.012), 160, 0.026, 10, true), chrome, (m) => (m.position.z = 0.03));
  add(new THREE.ExtrudeGeometry(ovalShape(RX + 0.12, RY + 0.12), { depth: 0.06, bevelEnabled: false, curveSegments: 48 }), lacquer, (m) => (m.position.z = -0.1));
  // handle: turned lacquer with a chrome ferrule, hanging from the bottom of the oval
  const handle = add(
    new THREE.LatheGeometry([[0, 0], [0.13, 0.02], [0.16, 0.25], [0.12, 0.6], [0.105, 1.2], [0.13, 1.75], [0.1, 1.95], [0, 2.0]].map(([r, y]) => new THREE.Vector2(r, y)), 32),
    lacquer,
    (m) => {
      m.rotation.z = Math.PI;
      m.position.y = -(RY + 0.16);
    },
  );
  add(new THREE.CylinderGeometry(0.15, 0.15, 0.12, 32), chrome, (m) => (m.position.y = -(RY + 0.2)));
  void handle;

  // glass: oval with uv over its bounding box
  const gShape = new THREE.ShapeGeometry(ovalShape(RX, RY), 48);
  {
    const p = gShape.attributes.position, uv = gShape.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / (2 * RX) + 0.5, p.getY(i) / (2 * RY) + 0.5);
  }
  const rt = new THREE.WebGLRenderTarget(size.w, size.h, { type: THREE.HalfFloatType, samples: tier === 'high' ? 4 : 0 });
  const glassMat = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(GLASS.uniforms), vertexShader: GLASS.vertexShader, fragmentShader: GLASS.fragmentShader });
  glassMat.uniforms.map.value = rt.texture;
  add(gShape, glassMat, (m) => (m.position.z = 0.005));
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = false;
  });
  group.visible = false;

  const camera = new THREE.PerspectiveCamera(28, size.w / size.h, 0.5, 40);
  camera.layers.set(MIRROR_LAYER);
  let angle = 0, goal = 0;
  const C = new THREE.Vector3(HEAD_BOUNDS.center[0], HEAD_BOUNDS.center[1] - 0.1, AXIS_Z);
  const v = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const tan = Math.tan(THREE.MathUtils.degToRad(14));
  const dist = 1.75 / tan;

  // frame-relative point (fx, fy in 0..1 of the frame rect, y down) at view distance d → world
  function framePoint(cam, frame, fx, fy, d, out) {
    const t = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const aspect = frame.w / Math.max(1, frame.h);
    out.set((fx * 2 - 1) * t * aspect * d, (1 - fy * 2) * t * d, -d);
    return out.applyMatrix4(cam.matrixWorld);
  }

  let rendered = false;
  return {
    group,
    camera,
    rt,
    MIRROR_LAYER,
    get angle() {
      return angle;
    },
    setAngle(deg) {
      goal = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(deg, -35, 35));
    },
    // damped toward the asked angle; true while moving
    update(dt, reduced) {
      if (reduced) angle = goal;
      else angle += (goal - angle) * (1 - Math.exp(-dt * 8));
      if (Math.abs(goal - angle) < 1e-4) {
        angle = goal;
        return false;
      }
      return true;
    },
    /**
     * Rises from below the frame's bottom-right to its upper right (k 0..1, eased by the caller),
     * held beyond the head so the head can overlap it, facing the viewer with a slight cant.
     */
    place(cam, frame, k, { phone = false, headDist = 8 } = {}) {
      group.visible = k > 0.001;
      if (!group.visible) return;
      const d = headDist * 1.12;
      const fx = phone ? 0.82 : 0.84;
      const fy = THREE.MathUtils.lerp(1.45, phone ? 0.33 : 0.37, k);
      framePoint(cam, frame, fx, fy, d, group.position);
      const h = 2 * d * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * (phone ? 0.36 : 0.44);
      group.scale.setScalar(h / (2 * RY + 0.24));
      q.copy(cam.quaternion);
      group.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(e.set(0.05, -0.22, -0.12 + (1 - k) * 0.25)));
    },
    /** CSS px rect of the glass (for drag input). */
    glassRect(cam, frame) {
      if (!group.visible) return null;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        v.set(Math.cos(a) * RX, Math.sin(a) * RY, 0).applyMatrix4(group.matrixWorld).project(cam);
        const x = (v.x * 0.5 + 0.5) * frame.W, y = (0.5 - v.y * 0.5) * frame.H;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    },
    /** Render the back of the head into the glass. rig: the head's parent (head-local → world). */
    render(scene, rig, { hair = null, layers = 10, clear = '#0d0c0b', onCamera = null } = {}) {
      rig.updateWorldMatrix(true, false);
      const a = Math.PI + angle;
      v.set(Math.sin(a) * dist, 0.25, Math.cos(a) * dist).add(C).applyMatrix4(rig.matrixWorld);
      camera.position.copy(v);
      camera.lookAt(v.copy(C).applyMatrix4(rig.matrixWorld));
      camera.updateMatrixWorld();
      // the caller lights the back of the head for this viewpoint (stage: nape light)
      onCamera?.(camera);
      const prevLayers = hair?.layers;
      if (hair && prevLayers) hair.setLayers(Math.min(prevLayers, layers));
      const prevTarget = renderer.getRenderTarget();
      const prevClear = renderer.getClearColor(new THREE.Color());
      const prevAlpha = renderer.getClearAlpha();
      const bg = scene.background;
      scene.background = null;
      renderer.setRenderTarget(rt);
      renderer.setClearColor(clear, 1);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(prevClear, prevAlpha);
      scene.background = bg;
      if (hair && prevLayers) hair.setLayers(prevLayers);
      glassMat.uniforms.uOn.value = 1;
      rendered = true;
    },
    get rendered() {
      return rendered;
    },
    dispose() {
      for (const g of geos) g.dispose();
      lacquer.dispose();
      chrome.dispose();
      glassMat.dispose();
      rt.dispose();
    },
  };
}
