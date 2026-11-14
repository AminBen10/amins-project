import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// Plate mode (C13): the finished cut in 3/4 profile as an engraving, ink #1B1A17 hatched by
// luminance on paper #EFE7D6, two hatch angles plus a contour line. Used by engineering's plates
// script through stage.renderPlate(program) → PNG data URL.

// raw sRGB values: the target is read back as is, without colour management
const srgb = (hex) => new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
const INK = srgb(0x1b1a17);
const PAPER = srgb(0xefe7d6);

const EngraveShader = {
  uniforms: {
    tScene: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uInk: { value: INK },
    uPaper: { value: PAPER },
    uPitch: { value: 3.2 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tScene;
    uniform vec2 uRes;
    uniform vec3 uInk;
    uniform vec3 uPaper;
    uniform float uPitch;
    varying vec2 vUv;
    float lum(vec2 uv) {
      vec4 c = texture2D(tScene, uv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      l = 1.0 - exp(-l * 3.2);          // exposure: plaster mid-tones land mid-page
      return mix(1.0, pow(l, 0.8), c.a); // background reads as paper
    }
    float alphaAt(vec2 uv) { return texture2D(tScene, uv).a; }
    float hatch(vec2 p, float ang, float width) {
      vec2 d = vec2(cos(ang), sin(ang));
      float v = dot(p, d) / uPitch;
      float f = abs(fract(v) - 0.5) * 2.0;    // 0 on the line, 1 between
      return (1.0 - smoothstep(width - 0.09, width + 0.09, f)) * smoothstep(0.0, 0.08, width);
    }
    void main() {
      vec2 px = vUv * uRes;
      float l = lum(vUv);
      // two hatch angles; the second comes in for the darker tones, a third pass for the deepest
      float h1 = hatch(px, 0.785, mix(0.0, 0.62, smoothstep(0.82, 0.25, l)));
      float h2 = hatch(px, -0.35, mix(0.0, 0.55, smoothstep(0.55, 0.12, l)));
      float h3 = hatch(px + 1.6, 0.785, mix(0.0, 0.5, smoothstep(0.25, 0.04, l)));
      float ink = max(max(h1, h2), h3);
      // contour: where the silhouette or the tone breaks sharply
      vec2 e = 1.0 / uRes;
      float a = alphaAt(vUv);
      float ax = alphaAt(vUv + vec2(e.x, 0.0)) - alphaAt(vUv - vec2(e.x, 0.0));
      float ay = alphaAt(vUv + vec2(0.0, e.y)) - alphaAt(vUv - vec2(0.0, e.y));
      float lx = lum(vUv + vec2(e.x, 0.0)) - lum(vUv - vec2(e.x, 0.0));
      float ly = lum(vUv + vec2(0.0, e.y)) - lum(vUv - vec2(0.0, e.y));
      float edge = clamp(length(vec2(ax, ay)) * 1.4 + smoothstep(0.18, 0.4, length(vec2(lx, ly))) * a, 0.0, 1.0);
      ink = max(ink, edge);
      gl_FragColor = vec4(mix(uPaper, uInk, ink), 1.0);
    }`,
};

/**
 * engrave(renderer, scene, camera, size) → PNG data URL (sync). The caller stages the scene (only the head showing, plate material on) and restores it; this
 * renders that scene from `camera` into a supersampled target and engraves it at `size`.
 */
export function engrave(renderer, scene, camera, size = 320) {
  const ss = 2;
  const src = new THREE.WebGLRenderTarget(size * ss, size * ss, { type: THREE.HalfFloatType, samples: 4 });
  const dst = new THREE.WebGLRenderTarget(size, size);
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(EngraveShader.uniforms),
    vertexShader: EngraveShader.vertexShader,
    fragmentShader: EngraveShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new FullScreenQuad(mat);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const bg = scene.background;
  scene.background = null;
  try {
    renderer.setRenderTarget(src);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    mat.uniforms.tScene.value = src.texture;
    mat.uniforms.uRes.value.set(size, size);
    renderer.setRenderTarget(dst);
    quad.render(renderer);
    const px = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(dst, 0, 0, size, size, px);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    // flip: GL rows are bottom-up
    for (let y = 0; y < size; y++) img.data.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    scene.background = bg;
    quad.dispose();
    mat.dispose();
    src.dispose();
    dst.dispose();
  }
}
