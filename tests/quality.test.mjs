// detectTier, qualityProfile and the governor (src/three/quality.js), no browser needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectTier, qualityProfile, createGovernor } from '../src/three/quality.js';

// ------------------------------------------------------------------ detectTier

const RENDERER = 0x1f01;
const UNMASKED = 0x9246;

function fakeEnv({ gl = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)', masked = true, coarse = false, screen = [2560, 1440], cores = 8, memory = 8, saveData = false, throws = false } = {}) {
  const calls = { lost: 0, canvases: 0 };
  const ctx = gl && {
    RENDERER,
    getParameter: (p) => (p === RENDERER ? (masked ? 'WebKit WebGL' : gl) : p === UNMASKED ? gl : null),
    getExtension: (name) =>
      name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: UNMASKED } : name === 'WEBGL_lose_context' ? { loseContext: () => calls.lost++ } : null,
  };
  return {
    calls,
    env: {
      navigator: { hardwareConcurrency: cores, deviceMemory: memory, connection: saveData ? { saveData: true } : undefined },
      screen: screen && { width: screen[0], height: screen[1] },
      matchMedia: (q) => ({ matches: coarse && q === '(pointer: coarse)' }),
      createCanvas: () => {
        calls.canvases++;
        if (throws) throw new Error('blocked');
        return { getContext: (type) => (type === 'webgl2' ? ctx || null : null) };
      },
    },
  };
}

const SWIFTSHADER = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
const TABLE = [
  ['desktop dGPU', {}, '', 'high', 'capable'],
  ['Iris Xe laptop', { gl: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' }, '', 'high', 'capable'],
  ['Firefox, unmasked RENDERER', { gl: 'Apple M1, or similar', masked: false }, '', 'high', 'capable'],
  ['no Device Memory / cores API (Safari)', { cores: undefined, memory: undefined }, '', 'high', 'capable'],
  ['headless SwiftShader', { gl: SWIFTSHADER, cores: 16 }, '', 'low', 'software'],
  ['llvmpipe', { gl: 'llvmpipe (LLVM 15.0.7, 256 bits)' }, '', 'low', 'software'],
  ['Windows Basic Render', { gl: 'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)' }, '', 'low', 'software'],
  ['Firefox software', { gl: 'Software Rasterizer', masked: false }, '', 'low', 'software'],
  ['phone', { gl: 'Apple GPU', coarse: true, screen: [390, 844], cores: 6, memory: undefined }, '', 'low', 'coarse-pointer'],
  ['small screen, fine pointer', { screen: [1024, 600] }, '', 'low', 'small-screen'],
  ['4 cores', { cores: 4 }, '', 'low', 'cores'],
  ['4 GB', { memory: 4 }, '', 'low', 'memory'],
  ['no WebGL2', { gl: null }, '', 'poster', 'no-webgl2'],
  ['canvas throws', { throws: true }, '', 'poster', 'no-webgl2'],
  ['Save-Data', { saveData: true }, '', 'poster', 'save-data'],
  ['?q=high on a phone', { coarse: true, screen: [390, 844] }, '?q=high', 'high', 'override'],
  ['?q=low on a desktop', {}, '?x=1&q=low', 'low', 'override'],
  ['?q=poster', {}, '?q=poster', 'poster', 'override'],
  ['?q=high wins over Save-Data', { saveData: true }, '?q=high', 'high', 'override'],
  ['?q=high without WebGL2', { gl: null }, '?q=high', 'poster', 'no-webgl2'],
  ['unknown ?q is ignored', { gl: SWIFTSHADER }, '?q=ultra', 'low', 'software'],
];

for (const [name, opts, search, tier, reason] of TABLE) {
  test(`detectTier: ${name} → ${tier} (${reason})`, () => {
    const { env, calls } = fakeEnv(opts);
    const r = detectTier({ search, reducedMotion: false, env });
    assert.equal(r.tier, tier);
    assert.equal(r.reason, reason);
    assert.equal(r.webgl2, !!opts.gl || (opts.gl === undefined && !opts.throws));
    assert.equal(calls.canvases, 1, 'one probe canvas');
    assert.equal(calls.lost, r.webgl2 ? 1 : 0, 'probe context released');
  });
}

test('detectTier reports the unmasked renderer string', () => {
  const r = detectTier({ search: '', env: fakeEnv({ gl: SWIFTSHADER }).env });
  assert.equal(r.renderer, SWIFTSHADER);
  assert.deepEqual(Object.keys(r).sort(), ['reason', 'renderer', 'tier', 'webgl2']);
});

test('detectTier: reduced motion never changes the tier', () => {
  for (const [, opts, search, tier] of TABLE) {
    assert.equal(detectTier({ search, reducedMotion: true, env: fakeEnv(opts).env }).tier, tier);
  }
});

// ------------------------------------------------------------------ qualityProfile

const HIGH = {
  tier: 'high',
  dpr: { start: 1.75, min: 1, step: 0.25 },
  composer: true,
  msaa: 4,
  bloom: { strength: 0.35, radius: 0.4, threshold: 1.1, selective: true },
  hair: { layers: 26, minLayers: 10, skinStep: 0.018, hairStep: 0.022, density: 110, worley: 9 },
  mirror: { w: 384, h: 512, layers: 10, cadence: 1, mode: 'rt' },
  shadows: { size: 1024 },
  cape: { seg: 48 },
  particles: { clippings: 1200, talc: 150, steam: 3 },
  env: { size: 256 },
  maxAnisotropy: 8,
};
const LOW = {
  tier: 'low',
  dpr: { start: 1.5, min: 1, step: 0.25 },
  composer: false,
  msaa: 4,
  bloom: null,
  hair: { layers: 16, minLayers: 10, skinStep: 0.026, hairStep: 0.03, density: 80, worley: 4 },
  mirror: { w: 256, h: 340, layers: 8, cadence: 2, mode: 'mask' },
  shadows: null,
  cape: { seg: 28 },
  particles: { clippings: 400, talc: 80, steam: 2 },
  env: { size: 128 },
  maxAnisotropy: 4,
};

test('qualityProfile: exact high and low shapes', () => {
  assert.deepEqual(qualityProfile('high'), HIGH);
  assert.deepEqual(qualityProfile('low'), LOW);
});

test('qualityProfile: poster and unknown tiers get the low values', () => {
  assert.deepEqual(qualityProfile('poster'), { ...LOW, tier: 'poster' });
  assert.deepEqual(qualityProfile('ultra'), LOW);
  assert.deepEqual(qualityProfile(), LOW);
});

test('qualityProfile returns a fresh object each call', () => {
  const a = qualityProfile('high');
  a.hair.layers = 1;
  a.mirror.mode = 'mask';
  assert.equal(qualityProfile('high').hair.layers, 26);
  assert.equal(qualityProfile('high').mirror.mode, 'rt');
});

// ------------------------------------------------------------------ governor

/** Governor wired to a fake device whose frame time comes from `cost(state, level)`. */
function rig(tier = 'high', { cost, deviceDpr = 2, ...opts } = {}) {
  const changes = [];
  let clock = 0;
  const gov = createGovernor({ profile: qualityProfile(tier), apply: (c) => changes.push({ ...c, at: clock }), deviceDpr: () => deviceDpr, ...opts });
  const run = (ms) => {
    const dt = typeof cost === 'function' && ms === undefined ? cost(gov.state, gov.level) : ms;
    clock += dt;
    gov.frame(dt);
  };
  const runFor = (totalMs, ms) => {
    const end = clock + totalMs;
    while (clock < end) run(ms);
  };
  return { gov, changes, run, runFor, get clock() { return clock; } };
}
const plain = (changes) => changes.map(({ type, value }) => ({ type, value }));

const HIGH_LADDER = [
  { type: 'dpr', value: 1.5 },
  { type: 'dpr', value: 1.25 },
  { type: 'dpr', value: 1 },
  { type: 'layers', value: 22 },
  { type: 'layers', value: 18 },
  { type: 'layers', value: 14 },
  { type: 'layers', value: 10 },
  { type: 'shadows', value: false },
  { type: 'mirror', value: 'half' },
  { type: 'mirror', value: 'freeze' },
  { type: 'mirror', value: 'mask' },
];

test('governor: steady 60 fps never changes anything', () => {
  const r = rig('high');
  r.runFor(60000, 16.7);
  assert.equal(r.changes.length, 0);
  assert.equal(r.gov.level, 0);
});

test('governor: steps down in the documented order (high tier)', () => {
  // Each step makes frames 3 ms cheaper: always measurable, always still over 22 ms.
  const r = rig('high', { cost: (s, level) => 60 - 3 * level });
  r.runFor(120000);
  assert.deepEqual(plain(r.changes), HIGH_LADDER);
  assert.equal(r.gov.level, HIGH_LADDER.length);
  assert.deepEqual(r.gov.state, { dpr: 1, layers: 10, shadows: false, mirror: 'mask' });
});

test('governor: low tier has no shadow or mirror steps', () => {
  const r = rig('low', { cost: (s, level) => 40 - 3 * level, deviceDpr: 3 });
  r.runFor(60000);
  assert.deepEqual(plain(r.changes), [
    { type: 'dpr', value: 1.25 },
    { type: 'dpr', value: 1 },
    { type: 'layers', value: 12 },
    { type: 'layers', value: 10 },
  ]);
});

test('governor: dpr steps start from the display, not the profile cap', () => {
  const one = rig('high', { cost: (s, level) => 60 - 3 * level, deviceDpr: 1 });
  one.runFor(10000);
  assert.deepEqual(plain(one.changes)[0], { type: 'layers', value: 22 });
  const odd = rig('high', { cost: (s, level) => 60 - 3 * level, deviceDpr: 1.25 });
  odd.runFor(10000);
  assert.deepEqual(plain(odd.changes).slice(0, 2), [
    { type: 'dpr', value: 1 },
    { type: 'layers', value: 22 },
  ]);
});

test('governor: never more than one change per 1.5 s', () => {
  // 23 ms frames fill the 60-frame window in 1.38 s, so the cooldown is what binds.
  const r = rig('high', { cost: (s, level) => 23 - 0.01 * level, plateau: Infinity, window: 20 });
  r.runFor(60000);
  assert.ok(r.changes.length >= 10, `expected many changes, got ${r.changes.length}`);
  for (let i = 1; i < r.changes.length; i++) assert.ok(r.changes[i].at - r.changes[i - 1].at >= 1500, `gap ${i}`);
});

test('governor: hysteresis, between 12 and 22 ms nothing moves', () => {
  // The first step brings frames to 15 ms: too slow to step back up, fast enough to stay.
  const r = rig('high', { cost: (s, level) => (level ? 15 : 30) });
  r.runFor(60000);
  assert.deepEqual(plain(r.changes), [{ type: 'dpr', value: 1.5 }]);
});

test('governor: one step up only after 5 s under 12 ms, undoing the last step', () => {
  const r = rig('high', { cost: (s, level) => 60 - 3 * level });
  r.runFor(120000); // all the way down
  const down = r.changes.length;
  r.runFor(5000, 8); // window fill + less than 5 s of good time
  assert.equal(r.changes.length, down, 'no step up before 5 s');
  r.runFor(1000, 8);
  assert.equal(r.changes.length, down + 1);
  assert.deepEqual(plain(r.changes.slice(down)), [{ type: 'mirror', value: 'freeze' }]);
  r.runFor(60000, 8);
  const ups = plain(r.changes.slice(down));
  assert.deepEqual(ups, [
    { type: 'mirror', value: 'freeze' },
    { type: 'mirror', value: 'half' },
    { type: 'mirror', value: 'rt' },
    { type: 'shadows', value: true },
    { type: 'layers', value: 14 },
    { type: 'layers', value: 18 },
    { type: 'layers', value: 22 },
    { type: 'layers', value: 26 },
    { type: 'dpr', value: 1.25 },
    { type: 'dpr', value: 1.5 },
    { type: 'dpr', value: 1.75 },
  ]);
  for (let i = down + 1; i < r.changes.length; i++) assert.ok(r.changes[i].at - r.changes[i - 1].at >= 5000);
  assert.equal(r.gov.level, 0);
});

test('governor: a slow frame interrupts the good streak', () => {
  let ms = 30;
  const r = rig('high', { cost: () => ms });
  r.runFor(2000);
  assert.equal(r.changes.length, 1);
  ms = 8;
  r.runFor(4000);
  ms = 16; // mean climbs over 12 ms: streak lost
  r.runFor(1200);
  ms = 8;
  r.runFor(4000);
  assert.equal(r.changes.length, 1);
  r.runFor(3000);
  assert.deepEqual(plain(r.changes), [
    { type: 'dpr', value: 1.5 },
    { type: 'dpr', value: 1.75 },
  ]);
});

test('governor: lock() freezes changes, unlock lets them through', () => {
  const r = rig('high');
  r.gov.lock(true);
  r.runFor(20000, 40);
  assert.equal(r.changes.length, 0);
  r.gov.lock(false);
  r.run(40);
  assert.equal(r.changes.length, 1, 'acts on the measured window right away');
});

test('governor: holds when steps stop helping (refresh cap), reset() resumes', () => {
  const r = rig('high'); // constant 33 ms: a 30 Hz cap no setting can fix
  r.runFor(30000, 33.3);
  assert.equal(r.changes.length, 2, 'two useless steps, then hold');
  r.gov.reset();
  r.runFor(30000, 33.3);
  assert.equal(r.changes.length, 4);
  const off = rig('high', { plateau: Infinity });
  off.runFor(60000, 33.3);
  assert.deepEqual(plain(off.changes), HIGH_LADDER);
});

test('governor: ignores zero, negative and NaN intervals; clamps stalls', () => {
  const r = rig('high');
  for (let i = 0; i < 500; i++) r.gov.frame(i % 3 === 0 ? 0 : i % 3 === 1 ? -5 : NaN);
  assert.equal(r.changes.length, 0);
  // One 5 s stall counts as 100 ms, not enough to push 59 normal frames over 22 ms.
  for (let i = 0; i < 59; i++) r.gov.frame(16.7);
  r.gov.frame(5000);
  r.gov.frame(16.7);
  assert.equal(r.changes.length, 0);
});

test('governor: apply errors propagate and leave the state unchanged', () => {
  const gov = createGovernor({ profile: qualityProfile('high'), apply: () => { throw new Error('boom'); }, deviceDpr: () => 2 });
  assert.throws(() => { for (let i = 0; i < 120; i++) gov.frame(40); }, /boom/);
  assert.equal(gov.state.dpr, 1.75);
  assert.equal(gov.level, 0);
});
