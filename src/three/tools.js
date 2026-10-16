import * as THREE from 'three';

// Procedural clipper, scissors and straight razor, plus the little particle
// burst of cut hair. Tools live in head space and follow the haircut
// progress reported by the hair system.

const lerp = THREE.MathUtils.lerp;

function materials() {
  return {
    chrome: new THREE.MeshStandardMaterial({ color: '#e3e6ec', metalness: 1, roughness: 0.12 }),
    steel: new THREE.MeshStandardMaterial({ color: '#c3c8d0', metalness: 1, roughness: 0.3 }),
    brass: new THREE.MeshStandardMaterial({ color: '#c9a35b', metalness: 1, roughness: 0.28 }),
    black: new THREE.MeshStandardMaterial({ color: '#15171c', metalness: 0.2, roughness: 0.42 }),
    wood: new THREE.MeshStandardMaterial({ color: '#3a2216', metalness: 0, roughness: 0.38 }),
  };
}

function extrude(points, depth, bevel = 0.012) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 16,
  });
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  return geo;
}

// Clipper: long axis +Y, blade at the top, blade teeth facing +Z.
function clipper(m) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    extrude([[-0.13, -0.5], [0.13, -0.5], [0.17, 0.12], [0.2, 0.36], [-0.2, 0.36], [-0.17, 0.12]], 0.2, 0.05),
    m.black,
  );
  g.add(body);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.19, 0.06, 4, 1, false, Math.PI / 4), m.brass);
  band.scale.set(1.05, 1, 0.66);
  band.position.y = 0.12;
  g.add(band);
  const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 16), m.brass);
  lever.rotation.z = Math.PI / 2;
  lever.position.set(0.24, 0.22, 0);
  g.add(lever);
  const switchKnob = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.03), m.brass);
  switchKnob.position.set(0, -0.12, 0.15);
  g.add(switchKnob);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.07, 0.16), m.chrome);
  plate.position.y = 0.44;
  g.add(plate);
  const teethGeo = new THREE.BoxGeometry(0.016, 0.08, 0.02);
  for (let i = 0; i < 17; i++) {
    const tooth = new THREE.Mesh(teethGeo, m.steel);
    tooth.position.set(-0.2 + i * 0.025, 0.5, 0.06);
    g.add(tooth);
  }
  g.userData.tip = new THREE.Vector3(0, 0.54, 0.05);
  return g;
}

function blade(m, flip) {
  const s = flip ? -1 : 1;
  const g = new THREE.Group();
  const edge = new THREE.Mesh(
    extrude([[0, 0.03], [0.82, 0.012], [0.86, 0.0], [0.82, -0.012], [0.12, -0.045], [0, -0.03]], 0.012, 0.004),
    m.chrome,
  );
  edge.scale.y = s;
  g.add(edge);
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.26, 12), m.steel);
  shank.rotation.z = Math.PI / 2 + s * 0.35;
  shank.position.set(-0.13, -s * 0.045, 0);
  g.add(shank);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.02, 12, 40), m.brass);
  ring.position.set(-0.3, -s * 0.11, 0);
  ring.scale.set(1.15, 1, 1);
  g.add(ring);
  return g;
}

// Scissors: pivot at origin, blades pointing +X, opening in the XY plane.
function scissors(m) {
  const g = new THREE.Group();
  const a = blade(m, false);
  const b = blade(m, true);
  a.position.z = 0.01;
  b.position.z = -0.01;
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 20), m.brass);
  screw.rotation.x = Math.PI / 2;
  g.add(a, b, screw);
  g.userData.blades = [a, b];
  g.userData.tip = new THREE.Vector3(0.6, 0, 0);
  return g;
}

// Straight razor: blade along +X with the edge facing -Y, handle opened behind.
function razor(m) {
  const g = new THREE.Group();
  const bladeMesh = new THREE.Mesh(
    extrude([[0, 0.05], [0.62, 0.05], [0.7, 0.02], [0.7, -0.05], [0.64, -0.1], [0.08, -0.085], [0, -0.04]], 0.014, 0.004),
    m.chrome,
  );
  g.add(bladeMesh);
  const tang = new THREE.Mesh(extrude([[-0.12, 0.04], [0.01, 0.045], [0.01, -0.035], [-0.12, -0.02]], 0.012, 0.003), m.steel);
  g.add(tang);
  const handle = new THREE.Group();
  const scale = new THREE.Mesh(extrude([[0, 0.045], [0.78, 0.035], [0.8, 0.0], [0.78, -0.04], [0, -0.05]], 0.05, 0.015), m.wood);
  handle.add(scale);
  for (const x of [0.03, 0.75]) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.09, 12), m.brass);
    pin.rotation.x = Math.PI / 2;
    pin.position.x = x;
    handle.add(pin);
  }
  handle.rotation.z = Math.PI - 0.32;
  handle.position.x = -0.1;
  g.add(handle);
  g.userData.tip = new THREE.Vector3(0.4, -0.09, 0);
  return g;
}

function clippings(count = 240) {
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const life = new Float32Array(count);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uPx: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aLife;
      uniform float uPx;
      varying float vLife;
      void main() {
        vLife = aLife;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 2.6 * uPx * (7.0 / -mv.z) * step(0.001, aLife);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vLife;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(vec3(0.07, 0.05, 0.04), smoothstep(0.0, 0.25, vLife));
      }
    `,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  let cursor = 0;
  return {
    points,
    mat,
    emit(p, n) {
      for (let i = 0; i < n; i++) {
        const k = cursor++ % count;
        pos[k * 3] = p.x + (Math.random() - 0.5) * 0.08;
        pos[k * 3 + 1] = p.y + (Math.random() - 0.5) * 0.08;
        pos[k * 3 + 2] = p.z + (Math.random() - 0.5) * 0.08;
        vel[k * 3] = (Math.random() - 0.5) * 0.6;
        vel[k * 3 + 1] = Math.random() * 0.4;
        vel[k * 3 + 2] = (Math.random() - 0.2) * 0.6;
        life[k] = 0.9 + Math.random() * 0.6;
      }
    },
    update(dt) {
      let any = false;
      for (let k = 0; k < count; k++) {
        if (life[k] <= 0) continue;
        any = true;
        life[k] = Math.max(0, life[k] - dt);
        vel[k * 3 + 1] -= 2.6 * dt;
        pos[k * 3] += vel[k * 3] * dt;
        pos[k * 3 + 1] += vel[k * 3 + 1] * dt;
        pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
      }
      if (any) {
        geo.attributes.position.needsUpdate = true;
        geo.attributes.aLife.needsUpdate = true;
      }
    },
  };
}

export function createTools({ reducedMotion = false } = {}) {
  const m = materials();
  const group = new THREE.Group();
  const c = clipper(m);
  const s = scissors(m);
  const r = razor(m);
  c.scale.setScalar(0.85);
  s.scale.setScalar(0.95);
  r.scale.setScalar(0.95);
  for (const t of [c, s, r]) {
    t.visible = false;
    group.add(t);
  }
  const bits = clippings();
  group.add(bits.points);

  const tip = new THREE.Vector3();
  const vis = [0, 0, 0];
  const last = [0, 0, 0];
  let emitClock = 0;

  // ease a tool in/out of view while its pass is running
  function presence(i, active, dt) {
    vis[i] = THREE.MathUtils.damp(vis[i], active ? 1 : 0, 9, dt);
    return vis[i];
  }

  return {
    group,
    setPixelRatio(px) {
      bits.mat.uniforms.uPx.value = px;
    },
    // activity: { sides, top, beard, zones: [bool,bool,bool] }
    update(dt, time, activity) {
      const buzz = reducedMotion ? 0 : 1;
      const [zs, zt, zb] = activity.zones;
      const runS = zs && activity.sides > 0.001 && activity.sides < 0.999;
      const runT = zt && activity.top > 0.001 && activity.top < 0.999;
      const runB = zb && activity.beard > 0.001 && activity.beard < 0.999;
      // only shed hair while the cut is actually moving
      const moving =
        Math.abs(activity.sides - last[0]) + Math.abs(activity.top - last[1]) + Math.abs(activity.beard - last[2]) > 1e-4;
      last[0] = activity.sides;
      last[1] = activity.top;
      last[2] = activity.beard;

      // clipper climbs the left side of the head in short strokes
      const ps = presence(0, runS, dt);
      c.visible = ps > 0.01;
      if (c.visible) {
        const p = activity.sides;
        const y = lerp(-0.62, 0.62, p);
        const stroke = Math.sin(p * Math.PI * 7) * 0.16;
        c.position.set(-0.86 - 0.12 * (1 - ps), y - 0.25, -0.05 + stroke);
        c.rotation.set(0.1, -Math.PI / 2 + 0.25, 0.18);
        c.position.x += Math.sin(time * 90) * 0.004 * buzz;
        c.scale.setScalar(0.85 * ps);
        if (runS) {
          c.localToWorld(tip.copy(c.userData.tip));
          group.worldToLocal(tip);
        }
      }

      // scissors snip across the top, front to back
      const pt = presence(1, runT, dt);
      s.visible = pt > 0.01;
      if (s.visible) {
        const p = activity.top;
        s.position.set(-0.25 + Math.sin(p * Math.PI * 3) * 0.25, 1.55 + 0.15 * (1 - pt), lerp(0.55, -0.45, p));
        s.rotation.set(0.15, 0.35, -Math.PI / 2 + 0.55);
        const open = reducedMotion ? 0.12 : 0.05 + 0.2 * (0.5 + 0.5 * Math.sin(time * 16));
        s.userData.blades[0].rotation.z = open;
        s.userData.blades[1].rotation.z = -open;
        s.scale.setScalar(0.95 * pt);
        if (runT) {
          s.localToWorld(tip.copy(s.userData.tip));
          group.worldToLocal(tip);
        }
      }

      // razor traces the jawline from one ear to the other
      const pb = presence(2, runB, dt);
      r.visible = pb > 0.01;
      if (r.visible) {
        const a = lerp(-1.45, 1.45, activity.beard);
        const rad = 0.86 + 0.08 * (1 - pb);
        r.position.set(Math.sin(a) * rad, -0.62 - 0.3 * Math.cos(a), Math.cos(a) * rad * 0.92 - 0.05);
        r.rotation.set(0, a + Math.PI / 2, -0.5);
        r.scale.setScalar(0.95 * pb);
        if (runB) {
          r.localToWorld(tip.copy(r.userData.tip));
          group.worldToLocal(tip);
        }
      }

      emitClock += dt;
      if (moving && (runS || runT || runB) && emitClock > 0.03) {
        emitClock = 0;
        bits.emit(tip, runB ? 1 : 3);
      }
      bits.update(dt);
    },
  };
}
