import * as THREE from 'three';
import { POLE, POLE_COLORS } from './pole.js';

// The room behind everything, as one full-screen shader rendered into its own
// target only when an input changes, then drawn as the scene's backdrop.
//   uMode 0 (hero): the shop interior seen from the street through the window,
//     softly out of focus: azulejo wall, the station mirror under a fluorescent
//     tube, the chair in silhouette, a dark floor. The tube is dark until the
//     stage is ready, then flickers on twice (~300 ms).
//   uMode 1 (story): the shop as reflected in the station mirror behind the
//     customer: tiles, the warm street window with the pole outside it (its
//     stripes run the other way, only while open), kept dark (≤ 0.18) so
//     the notes on the glass stay readable. uRoom pans it for the chair turn.
// All colours are linear; tone mapping happens in the backdrop blit.

const DEFAULT_THEME = { tile: '#D9D3C4', grout: '#2A2925', window: '#FFB874', night: '#111214', tube: '#EEF2F5' };

const ROOM_FRAG = /* glsl */ `
  precision highp float;
  uniform float uMode;
  uniform float uAspect;
  uniform vec2 uPan;
  uniform float uZoom;
  uniform float uBlur;
  uniform float uTube;
  uniform float uOpen;
  uniform float uPoleSpin;
  uniform float uRoom;
  uniform vec4 uWin;
  uniform vec3 uTile;
  uniform vec3 uGrout;
  uniform vec3 uWindow;
  uniform vec3 uNight;
  uniform vec3 uTubeCol;
  uniform vec3 uRed;
  uniform vec3 uWhite;
  uniform vec3 uBlue;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  // soft box: 1 inside the half-size b around c, blurred over r
  float box(vec2 p, vec2 c, vec2 b, float r) {
    vec2 d = abs(p - c) - b;
    float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
    return 1.0 - smoothstep(-r, r, sd);
  }
  float rbox(vec2 p, vec2 c, vec2 b, float k, float r) {
    vec2 d = abs(p - c) - b + k;
    float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - k;
    return 1.0 - smoothstep(-r, r, sd);
  }
  // azulejo field: tile colour with grout and a per-tile tint of ±3 %
  vec3 tiles(vec2 p, float n, float groutW, float blur) {
    vec2 q = p * n;
    vec2 id = floor(q);
    vec2 f = fract(q);
    vec2 g = min(f, 1.0 - f);
    float aa = max(fwidth(q.x), 1e-4) + blur * n;
    float line = 1.0 - smoothstep(groutW - aa, groutW + aa, min(g.x, g.y));
    float tint = 1.0 + (hash(id) - 0.5) * 0.06;
    // glazed tiles are slightly lighter in the middle (a hint of the cushion edge)
    float cushion = 1.0 - 0.06 * smoothstep(0.25, 0.5, max(abs(f.x - 0.5), abs(f.y - 0.5)));
    // grout contrast collapses when defocused
    line *= 1.0 / (1.0 + blur * 260.0);
    return mix(uTile * tint * cushion, uGrout, line);
  }
  vec3 stripes(float u, float v) {
    float s = u * ${POLE.bands.toFixed(1)} + v * ${(POLE.height * POLE.twist).toFixed(3)};
    float f = fract(s) * 4.0;
    float w = max(fwidth(s) * 4.0, 0.2); // reflected and out of focus
    vec3 c = mix(uRed, uWhite, smoothstep(1.0 - w, 1.0 + w, f));
    c = mix(c, uBlue, smoothstep(2.0 - w, 2.0 + w, f));
    c = mix(c, uWhite, smoothstep(3.0 - w, 3.0 + w, f));
    return mix(c, uRed, smoothstep(4.0 - w, 4.0, f));
  }

  // ---------------------------------------------------------------- hero
  // p is in window units: the shop window spans y −0.5..0.5, x centred on it.
  vec3 hero(vec2 p) {
    float b = uBlur;
    float tube = uTube;
    vec2 tubeC = vec2(-0.1, 0.36);
    // Light on the wall: the tube above the mirror (cool), the street (warm, faint).
    vec2 dt = (p - tubeC) * vec2(0.5, 1.0);
    float lit = tube * (0.06 + 0.4 / (1.0 + dot(dt, dt) * 22.0));
    // the tube's fitting shades the wall and ceiling above it
    lit *= mix(1.0, 0.3, smoothstep(tubeC.y - 0.01, tubeC.y + 0.12, p.y));
    vec3 wallLight = uTubeCol * lit + uWindow * 0.012;

    float floorY = -0.34;
    float wainscot = 0.06;
    vec3 wall = tiles(p - vec2(0.02, floorY), 14.0, 0.04, b) * wallLight;
    vec3 plaster = vec3(0.62, 0.6, 0.56) * wallLight * 0.38;
    vec3 col = mix(wall, plaster, smoothstep(wainscot - b, wainscot + b, p.y));
    // cap rail on the tiles
    col += uTubeCol * box(p, vec2(0.0, wainscot), vec2(3.0, 0.004), b) * lit * 0.35;

    // Station mirror: it shows the dark shop and the street window behind us.
    vec2 mc = vec2(-0.1, 0.1);
    vec2 mb = vec2(0.17, 0.21);
    float mIn = box(p, mc, mb, b);
    float mEdge = box(p, mc, mb + 0.007, b) - mIn;
    vec2 mp = vec2(2.0 * mc.x - p.x, p.y);
    vec3 glass = tiles(mp + vec2(0.3, 0.0), 14.0, 0.04, b) * (uTubeCol * lit * 0.35 + uWindow * 0.01);
    // the street window behind the viewer, reflected: dim and warm, split by its mullion
    float rw = box(mp, vec2(-0.02, 0.12), vec2(0.09, 0.14), b * 1.5);
    rw *= 1.0 - box(mp, vec2(-0.02, 0.12), vec2(0.004, 0.14), b) * 0.8;
    glass = mix(glass, uWindow * 0.022, rw);
    col = mix(col, glass, mIn);
    col += vec3(0.8) * mEdge * (0.02 + lit * 0.7);
    // shelf and the bottles on it, just shapes
    float shelf = box(p, vec2(-0.1, -0.135), vec2(0.21, 0.006), b);
    col = mix(col, uNight * 0.5 + uTubeCol * lit * 0.5, shelf);

    // The tube and its fitting.
    col = mix(col, uNight * 0.6, box(p, tubeC + vec2(0.0, 0.012), vec2(0.2, 0.012), b));
    col += uTubeCol * box(p, tubeC, vec2(0.185, 0.005), b * 0.5) * tube * 0.95;

    // Floor: dark terrazzo, warm street light near the window, the tube smeared in it.
    float fl = smoothstep(floorY + b, floorY - b, p.y);
    vec3 floorCol = uNight * 0.8 + uWindow * 0.01 * smoothstep(-0.2, -0.5, p.y);
    floorCol += uTubeCol * tube * 0.035 * exp(-pow((p.x - tubeC.x) / 0.22, 2.0)) * smoothstep(-0.52, floorY, p.y);
    col = mix(col, floorCol, fl);
    col *= 1.0 - 0.4 * box(p, vec2(0.0, floorY + 0.008), vec2(3.0, 0.01), b * 1.5);

    // Barber chair in front of the mirror: a silhouette against the lit wall.
    vec2 c = p - vec2(-0.1, 0.0);
    float chair = rbox(c, vec2(0.0, -0.02), vec2(0.075, 0.095), 0.04, b);              // back
    chair = max(chair, rbox(c, vec2(0.0, 0.12), vec2(0.036, 0.02), 0.018, b));          // headrest
    chair = max(chair, box(c, vec2(0.0, 0.09), vec2(0.007, 0.02), b));                 // post
    chair = max(chair, rbox(c, vec2(0.0, -0.135), vec2(0.105, 0.028), 0.02, b));        // seat
    chair = max(chair, rbox(c, vec2(-0.115, -0.1), vec2(0.016, 0.011), 0.01, b));       // arms
    chair = max(chair, rbox(c, vec2(0.115, -0.1), vec2(0.016, 0.011), 0.01, b));
    chair = max(chair, box(c, vec2(0.0, -0.225), vec2(0.02, 0.07), b));                // pump column
    chair = max(chair, rbox(c, vec2(0.0, -0.31), vec2(0.1, 0.011), 0.011, b));          // foot plate
    vec3 chairCol = uNight * 0.3 + uTubeCol * lit * 0.08;
    chairCol += vec3(0.7) * lit * 0.5 * box(c, vec2(0.008, -0.225), vec2(0.003, 0.065), b * 0.5);
    chairCol += vec3(0.7) * lit * 0.35 * box(c, vec2(0.0, 0.065), vec2(0.06, 0.004), b);  // seam catching the tube
    col = mix(col, chairCol, chair);

    // The next station along: its tube is off, the mirror just catches ours.
    float m2 = box(p, vec2(0.66, 0.1), vec2(0.17, 0.21), b);
    col = mix(col, uNight * 0.5 + uTubeCol * lit * 0.15, m2);
    col += vec3(0.8) * (box(p, vec2(0.66, 0.1), vec2(0.177, 0.217), b) - m2) * lit * 0.5;
    col = mix(col, uNight * 0.6, box(p, vec2(0.66, 0.372), vec2(0.2, 0.012), b));
    return col;
  }

  // ---------------------------------------------------------------- story
  vec3 story(vec2 p) {
    // a mirror image: x flipped; the chair turn pans across the room
    p.x = -p.x + uRoom * 1.1;
    float b = uBlur;
    // on narrow screens the window straddles the edge of the frame
    vec2 winC = vec2(min(0.5, uAspect * 0.5 + 0.02), 0.12);
    vec2 winB = vec2(0.19, 0.27);
    float win = box(p, winC, winB, b + 0.002);
    // spill of the window onto the tiles, kept ≤ 0.12
    float dW = length(max(abs(p - winC) - winB, 0.0));
    float spill = 0.02 * exp(-dW * 6.0);
    vec3 light = uTubeCol * 0.04 + uWindow * spill;
    vec3 col = tiles(p, 15.0, 0.035, b) * light;
    // window: the night street, warm and dim, split by its mullion
    // the night street: dark, the pavement lit by the shop's own light, the
    // building opposite with a few lit windows, all out of focus
    float sy = (p.y - (winC.y - winB.y)) / (2.0 * winB.y);   // 0 sill … 1 head
    vec3 street = uNight * 0.35;
    street += uWindow * 0.045 * smoothstep(0.35, 0.0, sy);
    vec2 cell = floor((p - winC) * vec2(9.0, 7.0) + vec2(0.3, 0.6));
    float lw = step(0.62, hash(cell + 3.1)) * box(fract((p - winC) * vec2(9.0, 7.0) + vec2(0.3, 0.6)), vec2(0.5), vec2(0.22, 0.28), 0.12);
    street += uWindow * 0.05 * lw * smoothstep(0.45, 0.6, sy);
    street = mix(street, uNight * 0.3, box(p, winC, vec2(0.005, winB.y), b));
    // the pole outside, seen from inside: a narrow band at the window's edge
    float px = winC.x - winB.x + 0.07;
    float band = box(p, vec2(px, winC.y + 0.02), vec2(0.024, winB.y - 0.06), b * 1.5);
    float caps = box(p, vec2(px, winC.y + 0.02), vec2(0.03, winB.y - 0.02), b * 1.5) - band;
    float a = (p.x - px) / 0.024;               // -1..1 across the band
    float ang = asin(clamp(a, -1.0, 1.0));
    vec3 pole = stripes(ang / 6.2831853 + uPoleSpin / 6.2831853, (p.y - winC.y) * 2.0) * 0.12 * (0.45 + 0.55 * cos(ang));
    street = mix(street, pole, band * uOpen);
    street = mix(street, vec3(0.05), caps * uOpen);
    col = mix(col, street, win);
    // window frame
    col = mix(col, uNight * 0.3, box(p, winC, winB + 0.012, b) - win);
    // downward falloff ≤ 15 %
    col *= 1.0 - 0.15 * smoothstep(0.5, -0.5, p.y);
    return col;
  }

  void main() {
    vec2 p = ((vUv - 0.5) * vec2(uAspect, 1.0)) / uZoom + uPan;
    // hero coordinates follow the shop window (uWin: uv rect x0, y0, x1, y1)
    vec2 wc = 0.5 * (uWin.xy + uWin.zw);
    vec2 hp = ((vUv - wc) * vec2(uAspect, 1.0)) / max(uWin.w - uWin.y, 0.05) / uZoom + uPan;
    vec3 col = uMode < 0.5 ? hero(hp) : story(p);
    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }
`;

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/**
 * createRoom(renderer, { theme, tier, reducedMotion }) → Room
 * Room{ backdrop (Mesh to add to the scene), uniforms, setMode(0|1), setReady(), setOpen(bool),
 *   setPoleSpin(rad), setRoom(0..1), setView({pan:[x,y], zoom}), setSize(w,h,dpr),
 *   render() → true while animating, dispose() }
 */
export function createRoom(renderer, { theme = {}, tier = 'high', reducedMotion = false } = {}) {
  const T = { ...DEFAULT_THEME, ...theme };
  const col = (c) => new THREE.Color(c);
  const uniforms = {
    uMode: { value: 0 },
    uAspect: { value: 1 },
    uPan: { value: new THREE.Vector2(0, 0) },
    uZoom: { value: 1 },
    uBlur: { value: 0.012 },
    uTube: { value: 0 },
    uOpen: { value: 1 },
    uPoleSpin: { value: 0 },
    uRoom: { value: 0 },
    uWin: { value: new THREE.Vector4(0, 0, 1, 1) },
    uTile: { value: col(T.tile) },
    uGrout: { value: col(T.grout) },
    uWindow: { value: col(T.window) },
    uNight: { value: col(T.night) },
    uTubeCol: { value: col(T.tube) },
    uRed: { value: col(POLE_COLORS.red) },
    uWhite: { value: col(POLE_COLORS.white) },
    uBlue: { value: col(POLE_COLORS.blue) },
  };
  const scale = tier === 'high' ? 1 : 0.5;
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const roomMat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: ROOM_FRAG, depthTest: false, depthWrite: false });
  const roomMesh = new THREE.Mesh(quadGeo, roomMat);
  roomMesh.frustumCulled = false;
  const roomScene = new THREE.Scene();
  roomScene.add(roomMesh);
  const roomCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // Backdrop: samples the room target, tone mapped with the rest of the frame.
  const backdropMat = new THREE.ShaderMaterial({
    uniforms: { tRoom: { value: target.texture } },
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tRoom;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec3 c = texture2D(tRoom, vUv).rgb;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        // dither below one 8-bit step against banding in the dark wall
        gl_FragColor.rgb += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
      }
    `,
  });
  const backdrop = new THREE.Mesh(quadGeo, backdropMat);
  backdrop.frustumCulled = false;
  backdrop.renderOrder = -10;

  let dirty = true;
  let ready = false;
  let flickerT = -1; // seconds since ready, while flickering
  const set = (u, v) => {
    if (uniforms[u].value !== v) {
      uniforms[u].value = v;
      dirty = true;
    }
  };
  // Two short flickers, then steady: on/off pairs in seconds over ~300 ms.
  const FLICKER = [
    [0.0, 0.035, 0.7],
    [0.09, 0.13, 0.85],
    [0.2, Infinity, 1],
  ];
  function tubeAt(t) {
    for (const [a, b, v] of FLICKER) if (t >= a && t < b) return v;
    return 0.04; // between flickers the cathodes glow faintly
  }

  return {
    backdrop,
    uniforms,
    target,
    setMode(mode) {
      set('uMode', mode);
    },
    setReady() {
      if (ready) return;
      ready = true;
      if (reducedMotion) set('uTube', 1);
      else flickerT = 0;
    },
    setOpen(on) {
      set('uOpen', on ? 1 : 0);
    },
    setPoleSpin(rad) {
      // only the story mode shows the pole
      if (uniforms.uMode.value === 1 && uniforms.uOpen.value > 0) set('uPoleSpin', -rad);
    },
    setRoom(v) {
      set('uRoom', v);
    },
    setBlur(v) {
      set('uBlur', v);
    },
    // Shop window in viewport uv (0..1, y up): the hero interior is framed by it.
    setWindow(x0, y0, x1, y1) {
      const w = uniforms.uWin.value;
      if (w.x !== x0 || w.y !== y0 || w.z !== x1 || w.w !== y1) {
        w.set(x0, y0, x1, y1);
        dirty = true;
      }
    },
    setView(panX, panY, zoom) {
      if (uniforms.uPan.value.x !== panX || uniforms.uPan.value.y !== panY) {
        uniforms.uPan.value.set(panX, panY);
        dirty = true;
      }
      set('uZoom', zoom);
    },
    setSize(w, h, dpr) {
      const W = Math.max(1, Math.round(w * dpr * scale));
      const H = Math.max(1, Math.round(h * dpr * scale));
      if (target.width !== W || target.height !== H) {
        target.setSize(W, H);
        dirty = true;
      }
      set('uAspect', w / h);
    },
    invalidate() {
      dirty = true;
    },
    // Re-render the room only when something changed. Returns true while the tube flickers.
    render(dt = 0) {
      if (flickerT >= 0) {
        flickerT += dt;
        set('uTube', tubeAt(flickerT));
        if (flickerT > 0.3) flickerT = -1;
      }
      if (dirty) {
        const prev = renderer.getRenderTarget();
        renderer.setRenderTarget(target);
        renderer.render(roomScene, roomCam);
        renderer.setRenderTarget(prev);
        dirty = false;
      }
      return flickerT >= 0;
    },
    dispose() {
      target.dispose();
      quadGeo.dispose();
      roomMat.dispose();
      backdropMat.dispose();
    },
  };
}

/**
 * The street side of the shop: a painted facade with the window and door cut
 * out, lit by the overhead key, the street and the pole's globe. The room
 * shader shows through the openings. Built in a plane at z = 0 of its group;
 * openings are rects {x0, y0, x1, y1} in the group's units.
 * createFacade({ theme }) → { group, setOpenings(outer, holes[]), dispose }
 */
export function createFacade({ theme = {} } = {}) {
  const group = new THREE.Group();
  // Painted tongue-and-groove boards, a shopfront at night: the grooves are a
  // darker line every 9 cm with a faint lit lip on one side.
  const paint = new THREE.MeshStandardMaterial({ color: theme.facade || '#2b2c2e', roughness: 0.55, metalness: 0 });
  paint.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFacade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFacade;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float bx = vFacade.x / 0.09;
        float g = abs(fract(bx) - 0.5);
        float aa = fwidth(bx);
        diffuseColor.rgb *= 1.0 - 0.55 * (1.0 - smoothstep(0.47 - aa, 0.47 + aa, 0.5 - g));
        diffuseColor.rgb *= 1.0 + (fract(sin(floor(bx) * 91.7) * 4375.85) - 0.5) * 0.06;`,
      );
  };
  paint.customProgramCacheKey = () => 'facade-boards';
  const reveal = new THREE.MeshStandardMaterial({ color: '#1c1d1f', roughness: 0.6, metalness: 0 });
  const moulding = new THREE.MeshStandardMaterial({ color: '#3a3b3e', roughness: 0.45, metalness: 0 });
  let parts = [];
  const DEPTH = 0.16;

  function clear() {
    for (const m of parts) {
      group.remove(m);
      m.geometry.dispose();
    }
    parts = [];
  }

  return {
    group,
    setOpenings(outer, holes) {
      clear();
      const shape = new THREE.Shape();
      shape.moveTo(outer.x0, outer.y0);
      shape.lineTo(outer.x1, outer.y0);
      shape.lineTo(outer.x1, outer.y1);
      shape.lineTo(outer.x0, outer.y1);
      shape.closePath();
      for (const h of holes) {
        const p = new THREE.Path();
        p.moveTo(h.x0, h.y0);
        p.lineTo(h.x0, h.y1);
        p.lineTo(h.x1, h.y1);
        p.lineTo(h.x1, h.y0);
        p.closePath();
        shape.holes.push(p);
      }
      const wall = new THREE.Mesh(new THREE.ShapeGeometry(shape), paint);
      parts.push(wall);
      // jambs, head and sill of each opening, going into the wall
      for (const h of holes) {
        const w = h.x1 - h.x0;
        const ht = h.y1 - h.y0;
        const jamb = (x, y, sx, sy) => {
          const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, DEPTH), reveal);
          m.position.set(x, y, -DEPTH / 2);
          parts.push(m);
        };
        jamb(h.x0 - 0.01, (h.y0 + h.y1) / 2, 0.02, ht);
        jamb(h.x1 + 0.01, (h.y0 + h.y1) / 2, 0.02, ht);
        jamb((h.x0 + h.x1) / 2, h.y1 + 0.01, w + 0.04, 0.02);
        jamb((h.x0 + h.x1) / 2, h.y0 - 0.01, w + 0.04, 0.02);
        // a moulding proud of the wall, bevelled by its own shading
        const MW = 0.06;
        const mould = (x, y, sx, sy) => {
          const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.035), moulding);
          m.position.set(x, y, 0.0175);
          parts.push(m);
        };
        mould(h.x0 - MW / 2, (h.y0 + h.y1) / 2, MW, ht + 2 * MW);
        mould(h.x1 + MW / 2, (h.y0 + h.y1) / 2, MW, ht + 2 * MW);
        mould((h.x0 + h.x1) / 2, h.y1 + MW / 2, w, MW);
        mould((h.x0 + h.x1) / 2, h.y0 - MW / 2, w, MW);
      }
      for (const m of parts) {
        m.receiveShadow = true;
        group.add(m);
      }
    },
    dispose() {
      clear();
      paint.dispose();
      reveal.dispose();
      moulding.dispose();
    },
  };
}
