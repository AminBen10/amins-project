import * as THREE from 'three';

// Procedural studio environment, baked once into a PMREM: the shop at night as
// chrome sees it. A dark tiled room, one long overhead fluorescent strip (the
// key), a warm street-window card on the fill side and a dim warm floor.
// Nothing here is drawn on screen; it only feeds reflections.

export const ENV_COLORS = {
  room: '#0d0e10',
  tube: '#EEF2F5',
  window: '#FFB874',
  floor: '#2a1d14',
};

function emissive(color, intensity) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide, toneMapped: false });
}

function buildRoom() {
  const scene = new THREE.Scene();
  const disposables = [];
  const add = (geo, mat, setup) => {
    const m = new THREE.Mesh(geo, mat);
    setup?.(m);
    scene.add(m);
    disposables.push(geo, mat);
    return m;
  };

  // Room box, 9 × 3.2 × 9, dark with faintly lighter tile courses on the walls.
  add(new THREE.BoxGeometry(9, 3.2, 9), new THREE.MeshBasicMaterial({ color: ENV_COLORS.room, side: THREE.BackSide }), (m) => {
    m.position.y = 0.6;
  });
  // A wainscot band of tile: a touch lighter so caps pick up a horizon line.
  add(new THREE.CylinderGeometry(4.4, 4.4, 1.0, 32, 1, true), new THREE.MeshBasicMaterial({ color: '#16171a', side: THREE.BackSide }), (m) => {
    m.position.y = -0.3;
  });

  // Overhead fluorescent strip: long and thin, running front to back, so
  // vertical chrome shows a crisp cap highlight and curved profiles a streak.
  add(new THREE.BoxGeometry(0.16, 0.04, 5.2), emissive(ENV_COLORS.tube, 6), (m) => {
    m.position.set(0.35, 2.15, 0.4);
  });

  // Warm street window on the fill side (−x): a tall card, the main vertical streak.
  add(new THREE.PlaneGeometry(2.4, 1.9), emissive(ENV_COLORS.window, 2.5), (m) => {
    m.position.set(-4.35, 0.75, 1.1);
    m.rotation.y = Math.PI / 2;
  });
  // Window mullion: splits the warm card so long reflections read as glazing.
  add(new THREE.BoxGeometry(0.06, 2.0, 0.08), new THREE.MeshBasicMaterial({ color: '#050506' }), (m) => {
    m.position.set(-4.3, 0.75, 1.1);
  });

  // The station mirror across the room returns a dim strip of the tube: a
  // second, much weaker streak on the key side so chrome has a dark band between.
  add(new THREE.PlaneGeometry(0.5, 1.6), emissive('#d9d6cf', 0.35), (m) => {
    m.position.set(4.35, 0.9, -1.2);
    m.rotation.y = -Math.PI / 2;
  });

  // Product-film fill: a broad, dim ceiling softbox and a soft card behind the camera, so flat
  // chrome (blades, razor faces) reads as graded silver instead of black mirror.
  add(new THREE.PlaneGeometry(3.6, 2.6), emissive('#e9ecef', 0.9), (m) => {
    m.position.set(0, 2.18, 0.6);
    m.rotation.x = Math.PI / 2;
  });
  add(new THREE.PlaneGeometry(5.0, 1.6), emissive('#e8e2d8', 0.42), (m) => {
    m.position.set(0.4, 0.9, 4.45);
    m.rotation.y = Math.PI;
  });

  // Dim warm floor (street light spilling in), darker towards the back.
  add(new THREE.PlaneGeometry(9, 9), emissive(ENV_COLORS.floor, 0.35), (m) => {
    m.rotation.x = -Math.PI / 2;
    m.position.y = -0.99;
  });

  return {
    scene,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/**
 * Bake the environment. `size` is the cube face size (profile.env.size: 256 high, 128 low).
 * Returns { texture, dispose }. The PMREM generator and the cube target are freed after the bake.
 */
export function createEnvironment(renderer, { size = 256 } = {}) {
  const room = buildRoom();
  const cubeRT = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cam = new THREE.CubeCamera(0.05, 20, cubeRT);
  cam.position.set(0, 0.3, 0);
  room.scene.add(cam);
  const prevTarget = renderer.getRenderTarget();
  cam.update(renderer, room.scene);
  renderer.setRenderTarget(prevTarget);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromCubemap(cubeRT.texture);
  pmrem.dispose();
  cubeRT.dispose();
  room.dispose();
  return {
    texture: rt.texture,
    dispose() {
      rt.dispose();
    },
  };
}

/**
 * The shop's metals and plastics, tuned for this environment. Shared by pole and tools.
 * high: brass gets physical anisotropy (brushed look); low keeps MeshStandard.
 */
export function studioMaterials({ tier = 'high' } = {}) {
  const hi = tier === 'high';
  const Phys = hi ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const brass = new Phys({ color: '#c9a35b', metalness: 1, roughness: 0.22 });
  if (hi) {
    brass.anisotropy = 0.5;
  }
  return {
    chrome: new THREE.MeshStandardMaterial({ color: '#d4d7da', metalness: 1, roughness: 0.08 }),
    steel: new THREE.MeshStandardMaterial({ color: '#b9bec4', metalness: 1, roughness: 0.25 }),
    brass,
    abs: new THREE.MeshStandardMaterial({ color: '#141518', metalness: 0, roughness: 0.45 }),
    walnut: new THREE.MeshStandardMaterial({ color: '#3b2417', metalness: 0, roughness: 0.4 }),
  };
}

/**
 * Studio materials plus the tool-only finishes: guard-comb plastic, cutting-comb
 * carbon, printed guard ink, badger knot, soft neck-brush hair, paper neck strip and the
 * clipper's ready LED (emissive ≤ 1 so it never blooms).
 */
export function toolMaterials({ tier = 'high' } = {}) {
  const m = studioMaterials({ tier });
  return {
    ...m,
    // satin chrome for blade housings and ferrules (less mirror, reads as machined)
    // the clipper's waist band: brushed, so the tube does not burn it white
    brassBand: new THREE.MeshStandardMaterial({ color: '#b8904c', metalness: 1, roughness: 0.42 }),
    satin: new THREE.MeshStandardMaterial({ color: '#c4c8cc', metalness: 1, roughness: 0.32 }),
    // polished blade faces: brushed enough to hold the softboxes as a grey gradient
    blade: new THREE.MeshStandardMaterial({ color: '#cfd3d7', metalness: 1, roughness: 0.2 }),
    // smoked guard plastic, a step lighter than the body so the fins read against it
    guard: new THREE.MeshStandardMaterial({ color: '#2b2d31', metalness: 0, roughness: 0.26 }),
    carbon: new THREE.MeshStandardMaterial({ color: '#1b1b1d', metalness: 0, roughness: 0.55 }),
    grip: new THREE.MeshStandardMaterial({ color: '#0e0f11', metalness: 0, roughness: 0.75 }),
    ivory: new THREE.MeshStandardMaterial({ color: '#e7dfcf', metalness: 0, roughness: 0.28 }),
    knot: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.92 }),
    soft: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.95 }),
    lather: new THREE.MeshStandardMaterial({ color: '#f3f1ec', metalness: 0, roughness: 0.6 }),
    led: new THREE.MeshStandardMaterial({ color: '#0b0d0c', emissive: '#7dffb0', emissiveIntensity: 0, roughness: 0.2 }),
  };
}
