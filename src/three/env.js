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
