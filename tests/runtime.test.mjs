// createRuntime (src/three/runtime.js) against a fake browser: rAF, timers, visibility,
// context loss, ResizeObserver and matchMedia are all driven by hand.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/three/runtime.js';

let now, rafs, rafId, win, doc, observers, coarse, perfNow;
const realPerformance = globalThis.performance;

beforeEach(() => {
  now = 1000;
  rafs = new Map();
  rafId = 0;
  observers = [];
  coarse = false;
  perfNow = 0;
  win = new EventTarget();
  doc = new EventTarget();
  doc.hidden = false;
  Object.assign(globalThis, {
    document: doc,
    devicePixelRatio: 2,
    requestAnimationFrame: (cb) => (rafs.set(++rafId, cb), rafId),
    cancelAnimationFrame: (id) => rafs.delete(id),
    addEventListener: win.addEventListener.bind(win),
    removeEventListener: win.removeEventListener.bind(win),
    matchMedia: (q) => ({ matches: q === '(pointer: coarse)' ? coarse : false, addEventListener() {}, removeEventListener() {} }),
    ResizeObserver: class {
      constructor(cb) {
        this.cb = cb;
        observers.push(this);
      }
      observe() {}
      disconnect() {
        observers = observers.filter((o) => o !== this);
      }
    },
  });
  Object.defineProperty(globalThis, 'performance', { value: { now: () => perfNow }, configurable: true, writable: true });
  mock.timers.enable({ apis: ['setTimeout'] });
});

afterEach(() => {
  mock.timers.reset();
  Object.defineProperty(globalThis, 'performance', { value: realPerformance, configurable: true, writable: true });
  for (const k of ['document', 'devicePixelRatio', 'requestAnimationFrame', 'cancelAnimationFrame', 'addEventListener', 'removeEventListener', 'matchMedia', 'ResizeObserver']) delete globalThis[k];
});

/** Run one display refresh `ms` after the previous one. */
function vsync(ms = 1000 / 60) {
  now += ms;
  const cbs = [...rafs.values()];
  rafs.clear();
  for (const cb of cbs) cb(now);
}
const pending = () => rafs.size;

function makeCanvas(w = 1200, h = 800) {
  const c = new EventTarget();
  c.clientWidth = w;
  c.clientHeight = h;
  return c;
}

function setup(over = {}) {
  const log = { frames: [], lost: [], restored: 0, resized: [], gov: [], resets: 0 };
  const canvas = makeCanvas();
  const rt = createRuntime({
    canvas,
    renderer: { getContext: () => ({ isContextLost: () => false }) },
    frame: (dt, t) => (log.frames.push({ dt, t }), over.more ? over.more(log.frames.length) : false),
    onLost: (info) => log.lost.push(info),
    onRestored: () => log.restored++,
    onResize: (w, h, dpr) => log.resized.push([w, h, dpr]),
    governor: { frame: (ms) => log.gov.push(ms), reset: () => log.resets++ },
    ...over.opts,
  });
  return { rt, log, canvas };
}

function lose(canvas) {
  const e = new Event('webglcontextlost', { cancelable: true });
  canvas.dispatchEvent(e);
  return e;
}

test('nothing is scheduled before start(); frames clamp dt and accumulate t', () => {
  const { rt, log } = setup();
  assert.equal(pending(), 0);
  assert.equal(rt.running, false);
  rt.start();
  assert.equal(rt.running, true);
  vsync();
  vsync();
  vsync(500); // a long hitch
  assert.equal(log.frames.length, 3);
  assert.ok(Math.abs(log.frames[0].dt - 1 / 60) < 1e-9, 'first frame gets a nominal dt');
  assert.ok(Math.abs(log.frames[1].dt - 1 / 60) < 1e-9);
  assert.equal(log.frames[2].dt, 0.1, 'clamped to 0.1 s');
  assert.ok(Math.abs(log.frames[2].t - (2 / 60 + 0.1)) < 1e-9);
  assert.ok(rt.fps > 0);
});

test('setRunning(false) leaves no rAF pending; resuming does not feed the gap to the governor', () => {
  const { rt, log } = setup();
  rt.start();
  vsync();
  vsync();
  rt.setRunning(false);
  assert.equal(pending(), 0);
  assert.equal(rt.running, false);
  now += 10000;
  assert.equal(pending(), 0, 'no idle spinning');
  const fed = log.gov.length;
  const resets = log.resets;
  rt.setRunning(true);
  vsync();
  assert.equal(log.gov.length, fed, 'first frame after a pause is not measured');
  assert.equal(log.resets, resets + 1);
  vsync(20);
  assert.deepEqual(log.gov.slice(fed), [20]);
});

test('hidden tab pauses, visible resumes', () => {
  const { rt, log } = setup();
  rt.start();
  vsync();
  doc.hidden = true;
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(pending(), 0);
  assert.equal(rt.running, false);
  doc.hidden = false;
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(pending(), 1);
  vsync();
  assert.equal(log.frames.length, 2);
  assert.equal(log.frames[1].dt, 1 / 60, 'no jump after the pause');
});

test('on-demand: renders after invalidate() and while frame() returns true', () => {
  let keep = 0;
  const { rt, log } = setup({ more: () => keep-- > 0 });
  rt.setOnDemand(true);
  rt.start();
  vsync();
  assert.equal(log.frames.length, 1);
  assert.equal(pending(), 0, 'idle once frame() returns false');
  vsync();
  vsync();
  assert.equal(log.frames.length, 1);
  keep = 2; // settles over three frames
  rt.invalidate();
  vsync();
  vsync();
  vsync();
  vsync();
  assert.equal(log.frames.length, 4);
  assert.equal(pending(), 0);
  rt.setOnDemand(false);
  vsync();
  vsync();
  assert.equal(log.frames.length, 6, 'continuous again');
  assert.equal(pending(), 1);
});

test('governor gets the interval of consecutive frames only', () => {
  const { rt, log } = setup();
  rt.start();
  vsync(16);
  vsync(17);
  vsync(30);
  assert.deepEqual(log.gov, [17, 30]);
});

test('context loss: preventDefault, stop, onLost; restore restarts', () => {
  const { rt, log, canvas } = setup();
  rt.start();
  vsync();
  const e = lose(canvas);
  assert.equal(e.defaultPrevented, true);
  assert.deepEqual(log.lost, [{ fatal: false }]);
  assert.equal(pending(), 0);
  rt.invalidate();
  rt.setRunning(true);
  assert.equal(pending(), 0, 'nothing renders while lost');
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(log.restored, 1);
  vsync();
  vsync();
  assert.equal(log.frames.length, 3);
});

test('a second loss within 30 s is fatal and never restarts', () => {
  const { rt, log, canvas } = setup();
  rt.start();
  perfNow = 5000;
  lose(canvas);
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  vsync();
  perfNow = 5000 + 29000;
  const e = lose(canvas);
  assert.equal(e.defaultPrevented, false, 'the browser may drop it');
  assert.deepEqual(log.lost.at(-1), { fatal: true, reason: 'lost-again', error: undefined });
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  rt.start();
  rt.invalidate();
  assert.equal(log.restored, 1, 'restore after a fatal loss is ignored');
  assert.equal(pending(), 0);
  assert.equal(rt.running, false);
});

test('losses 30 s apart are each recoverable', () => {
  const { rt, log, canvas } = setup();
  rt.start();
  perfNow = 1000;
  lose(canvas);
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  perfNow = 1000 + 31000;
  lose(canvas);
  assert.deepEqual(log.lost, [{ fatal: false }, { fatal: false }]);
});

test('a runtime stopped before the loss stays stopped after restore', () => {
  const { rt, log, canvas } = setup();
  rt.start();
  vsync();
  rt.stop();
  lose(canvas);
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(log.restored, 1);
  assert.equal(pending(), 0);
});

test('an exception in frame() is fatal: loop stops, onLost({fatal:true})', () => {
  const err = new Error('shader');
  const { rt, log } = setup({
    more: (n) => {
      if (n === 2) throw err;
      return false;
    },
  });
  const quiet = mock.method(console, 'error', () => {});
  rt.start();
  vsync();
  vsync();
  quiet.mock.restore();
  assert.deepEqual(log.lost, [{ fatal: true, reason: 'error', error: err }]);
  assert.equal(pending(), 0);
  rt.invalidate();
  assert.equal(pending(), 0);
});

test('a governor apply() error is fatal too', () => {
  const err = new Error('apply');
  const { rt, log } = setup({ opts: { governor: { frame: () => { throw err; }, reset() {} } } });
  const quiet = mock.method(console, 'error', () => {});
  rt.start();
  vsync();
  vsync();
  quiet.mock.restore();
  assert.deepEqual(log.lost, [{ fatal: true, reason: 'error', error: err }]);
  assert.equal(pending(), 0);
});

test('resize: debounced 150 ms, applied in the next frame, only when the pixel size changes', () => {
  const { rt, log, canvas } = setup();
  rt.start();
  vsync();
  observers[0].cb([]); // ResizeObserver's first call on observe()
  mock.timers.tick(150);
  vsync();
  assert.deepEqual(log.resized, [], 'same size: no onResize');
  canvas.clientWidth = 1000;
  win.dispatchEvent(new Event('resize'));
  mock.timers.tick(100);
  canvas.clientWidth = 900;
  observers[0].cb([]);
  mock.timers.tick(100);
  vsync();
  assert.deepEqual(log.resized, [], 'still inside the debounce');
  mock.timers.tick(50);
  const before = log.frames.length;
  vsync();
  assert.deepEqual(log.resized, [[900, 800, 2]]);
  assert.equal(log.frames.length, before + 1, 'resized and redrawn in the same frame');
});

test('resize: on-demand mode redraws after a resize', () => {
  const { rt, log, canvas } = setup();
  rt.setOnDemand(true);
  rt.start();
  vsync();
  assert.equal(pending(), 0);
  canvas.clientHeight = 600;
  observers[0].cb([]);
  mock.timers.tick(150);
  assert.equal(pending(), 1);
  vsync();
  assert.deepEqual(log.resized, [[1200, 600, 2]]);
});

test('resize: coarse pointer ignores URL-bar height changes under 160 px', () => {
  coarse = true;
  const { rt, log, canvas } = setup();
  rt.start();
  for (const h of [744, 800, 690, 800]) {
    canvas.clientHeight = h;
    win.dispatchEvent(new Event('resize'));
    mock.timers.tick(150);
    vsync();
  }
  assert.deepEqual(log.resized, [], 'URL bar collapsing and expanding');
  canvas.clientHeight = 600; // keyboard or rotation-sized change
  win.dispatchEvent(new Event('resize'));
  mock.timers.tick(150);
  vsync();
  canvas.clientWidth = 1180; // width change, any height delta
  canvas.clientHeight = 640;
  win.dispatchEvent(new Event('resize'));
  mock.timers.tick(150);
  vsync();
  assert.deepEqual(log.resized, [
    [1200, 600, 2],
    [1180, 640, 2],
  ]);
});

test('resize: fine pointer applies small height changes; dpr changes resize', () => {
  const { rt, log, canvas } = setup();
  rt.start();
  canvas.clientHeight = 760;
  win.dispatchEvent(new Event('resize'));
  mock.timers.tick(150);
  vsync();
  globalThis.devicePixelRatio = 1;
  win.dispatchEvent(new Event('resize'));
  mock.timers.tick(150);
  vsync();
  assert.deepEqual(log.resized, [
    [1200, 760, 2],
    [1200, 760, 1],
  ]);
});

test('resizes wait while not running and apply on resume', () => {
  const { rt, log, canvas } = setup();
  rt.start();
  rt.setRunning(false);
  canvas.clientWidth = 800;
  win.dispatchEvent(new Event('resize'));
  mock.timers.tick(150);
  assert.equal(pending(), 0);
  rt.setRunning(true);
  vsync();
  assert.deepEqual(log.resized, [[800, 800, 2]]);
});

test('dispose removes every listener and stops the loop', () => {
  const { rt, log, canvas } = setup();
  rt.start();
  vsync();
  rt.dispose();
  assert.equal(pending(), 0);
  assert.equal(observers.length, 0);
  lose(canvas);
  canvas.clientWidth = 10;
  win.dispatchEvent(new Event('resize'));
  mock.timers.tick(150);
  doc.dispatchEvent(new Event('visibilitychange'));
  rt.start();
  assert.equal(pending(), 0);
  assert.deepEqual(log.lost, []);
  assert.deepEqual(log.resized, []);
});
