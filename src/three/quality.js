// Quality tiers and the frame-time governor.
// No three.js import: main.js loads this before the 3D chunk to decide whether to load it at all.

const SOFTWARE_GL = /swiftshader|llvmpipe|software|basic render/i;

/**
 * Pick the quality tier for this device. First match wins:
 * 1. `?q=high|low|poster` in `search` (QA override; high/low still need WebGL2).
 * 2. Save-Data → 'poster'. No WebGL2 → 'poster'.
 * 3. Software rasteriser (SwiftShader, llvmpipe, Basic Render…) → 'low', so headless QA still renders.
 * 4. Coarse pointer, smaller screen side < 700 CSS px, ≤ 4 cores or ≤ 4 GB → 'low'.
 * 5. Otherwise 'high'.
 * The WebGL2 probe context is released with WEBGL_lose_context. Reduced motion never changes
 * the tier (the stage renders stills on demand instead).
 * @param {{search?: string, reducedMotion?: boolean, env?: {navigator?, screen?, matchMedia?, createCanvas?}}} [opts]
 *   `env` replaces the browser globals (tests).
 * @returns {{tier: 'high'|'low'|'poster', reason: string, webgl2: boolean, renderer: string}}
 *   reason ∈ override | save-data | no-webgl2 | software | coarse-pointer | small-screen | cores | memory | capable
 */
export function detectTier({ search, env = {} } = {}) {
  const g = globalThis;
  const nav = env.navigator || g.navigator || {};
  const scr = env.screen || g.screen;
  const mm = env.matchMedia || g.matchMedia; // [Global] operation: callable unbound
  const q = new URLSearchParams(search ?? g.location?.search ?? '').get('q');
  const { webgl2, renderer } = probe(env.createCanvas || (() => g.document.createElement('canvas')));
  const out = (tier, reason) => ({ tier, reason, webgl2, renderer });

  if (q === 'poster') return out('poster', 'override');
  if (!webgl2) return out('poster', 'no-webgl2');
  if (q === 'high' || q === 'low') return out(q, 'override');
  if (nav.connection?.saveData === true) return out('poster', 'save-data');
  if (SOFTWARE_GL.test(renderer)) return out('low', 'software');
  if (mm?.('(pointer: coarse)')?.matches) return out('low', 'coarse-pointer');
  if (scr && Math.min(scr.width, scr.height) < 700) return out('low', 'small-screen');
  if (nav.hardwareConcurrency && nav.hardwareConcurrency <= 4) return out('low', 'cores');
  if (nav.deviceMemory && nav.deviceMemory <= 4) return out('low', 'memory');
  return out('high', 'capable');
}

function probe(createCanvas) {
  let gl, renderer = '';
  try {
    gl = createCanvas().getContext('webgl2');
  } catch {
    /* no canvas or blocked */
  }
  if (!gl) return { webgl2: false, renderer };
  try {
    // RENDERER is unmasked in Firefox; Chrome and Safari say "WebKit WebGL" and need the extension.
    renderer = '' + (gl.getParameter(gl.RENDERER) || '');
    const ext = /^webkit webgl$/i.test(renderer) && gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) renderer = '' + (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || renderer);
  } catch {
    /* keep what we have */
  }
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { webgl2: true, renderer };
}

/**
 * Settings for a tier. Returns a fresh object (the stage may mutate it); unknown tiers and
 * 'poster' get the low values (tier keeps its name for 'poster').
 * @param {'high'|'low'|'poster'} tier
 */
export function qualityProfile(tier) {
  const hi = tier === 'high';
  const v = (h, l) => (hi ? h : l);
  return {
    tier: hi || tier === 'poster' ? tier : 'low',
    dpr: { start: v(1.75, 1.5), min: 1, step: 0.25 },
    composer: hi,
    msaa: 4,
    bloom: hi ? { strength: 0.35, radius: 0.4, threshold: 1.1, selective: true } : null,
    hair: {
      layers: v(26, 16),
      minLayers: 10,
      skinStep: v(0.018, 0.026),
      hairStep: v(0.022, 0.03),
      density: v(110, 80),
      worley: v(9, 4),
    },
    mirror: { w: v(384, 256), h: v(512, 340), layers: v(10, 8), cadence: v(1, 2), mode: v('rt', 'mask') },
    shadows: hi ? { size: 1024 } : null,
    cape: { seg: v(48, 28) },
    particles: { clippings: v(1200, 400), talc: v(150, 80), steam: v(3, 2) },
    env: { size: v(256, 128) },
    maxAnisotropy: v(8, 4),
  };
}

const MIRROR_DOWN = { rt: 'half', half: 'freeze', freeze: 'mask' };

/**
 * Frame-time governor. Feed it the interval of every consecutive rendered frame; it calls
 * `apply(change)` synchronously, at most once per `cooldownMs`.
 * Down, when the mean of the last `window` frames > `downMs`, one step in this order (steps the
 * profile or display cannot use are skipped): dpr −step to dpr.min (never above devicePixelRatio)
 * → hair layers −4 to hair.minLayers → shadows off → mirror 'half' (RT every 2nd frame) →
 * 'freeze' (RT stops updating) → 'mask' (DOM oval + camera move; only when profile.mirror.mode is 'rt').
 * Up, after the mean stays < `upMs` for `upAfterMs`: undo the last step (shadows → true, mirror
 * 'half' → 'rt'). The window restarts after each change. If `plateau` steps in a row gain < 3 %,
 * the bottleneck is not ours (refresh cap, main thread): stepping down holds until reset().
 * `lock(true)` freezes changes (film shots, enter dolly, warm-up); frames are still measured.
 * `reset()` clears the measurements, keeps the level (call after pauses and context restore).
 * @param {{profile: object, apply: (change: {type: 'dpr'|'layers'|'shadows'|'mirror', value: number|boolean|string}) => void,
 *   deviceDpr?: () => number, window?: number, downMs?: number, upMs?: number, upAfterMs?: number,
 *   cooldownMs?: number, plateau?: number}} opts
 * @returns {{frame(dtMs: number): void, lock(on: boolean): void, reset(): void, readonly level: number,
 *   readonly state: {dpr: number, layers: number, shadows: boolean, mirror: string}}}
 */
export function createGovernor({
  profile,
  apply,
  deviceDpr = () => globalThis.devicePixelRatio || 1,
  window: size = 60,
  downMs = 22,
  upMs = 12,
  upAfterMs = 5000,
  cooldownMs = 1500,
  plateau = 2,
}) {
  const { dpr, hair, mirror } = profile;
  const state = { dpr: dpr.start, layers: hair.layers, shadows: !!profile.shadows, mirror: mirror.mode };
  const done = []; // applied down-steps, for undo: {type, from}
  const ring = new Float64Array(size);
  let n = 0, sum = 0, since = Infinity, good = 0, locked = false;
  let judge = 0, useless = 0, held = false; // judge: mean that triggered the last down-step

  function nextDown() {
    const eff = Math.min(state.dpr, deviceDpr());
    if (eff > dpr.min + 1e-3) return { type: 'dpr', value: Math.max(dpr.min, eff - dpr.step) };
    if (state.layers > hair.minLayers) return { type: 'layers', value: Math.max(hair.minLayers, state.layers - 4) };
    if (state.shadows) return { type: 'shadows', value: false };
    const m = mirror.mode === 'rt' && MIRROR_DOWN[state.mirror];
    return m ? { type: 'mirror', value: m } : null;
  }
  function change(c) {
    apply(c);
    state[c.type] = c.value;
    clear();
    since = 0;
  }
  function clear() {
    n = sum = good = 0;
  }

  return {
    frame(dtMs) {
      if (!(dtMs > 0)) return;
      const ms = Math.min(dtMs, 100);
      since += ms;
      sum += ms - (n >= size ? ring[n % size] : 0);
      ring[n % size] = ms;
      n++;
      if (n < size) return;
      const mean = sum / size;
      if (judge) {
        useless = mean > judge * 0.97 ? useless + 1 : 0;
        held = useless >= plateau;
        judge = 0;
      }
      if (locked) {
        good = 0;
        return;
      }
      if (mean > downMs) {
        good = 0;
        const c = !held && since >= cooldownMs && nextDown();
        if (c) {
          const from = state[c.type];
          change(c);
          done.push({ type: c.type, from });
          judge = mean;
        }
      } else if (mean < upMs && done.length) {
        good += ms;
        if (good >= upAfterMs && since >= cooldownMs) {
          const last = done[done.length - 1];
          change({ type: last.type, value: last.from });
          done.pop();
          held = false;
          useless = 0;
        }
      } else good = 0;
    },
    lock(on) {
      locked = !!on;
    },
    reset() {
      clear();
      judge = useless = 0;
      held = false;
    },
    get level() {
      return done.length;
    },
    get state() {
      return { ...state };
    },
  };
}
