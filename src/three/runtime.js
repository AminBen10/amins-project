// Render loop for the stage: rAF only while there is something to draw, context loss and
// restore, debounced resizes and the quality governor feed. Plain DOM, no three.js import.

const LOST_AGAIN_MS = 30000; // a second loss within this window is fatal
const RESIZE_DEBOUNCE_MS = 150;
const URL_BAR_PX = 160; // height-only changes below this are the mobile URL bar

/**
 * Drive the stage.
 * - frame(dt, t): dt in s (clamped to 0.1; damping sub-steps are the stage's job), t = sum of dt
 *   (does not jump after pauses). Return true while something still moves; in on-demand mode the
 *   loop keeps going only while frame() returns true, then waits for invalidate().
 * - The loop runs only when started, setRunning(true) (default), the tab is visible and the
 *   context is alive. No rAF is pending otherwise.
 * - webglcontextlost: preventDefault, stop, onLost({fatal:false}); webglcontextrestored:
 *   onRestored(), then start() (if it was started). A second loss within 30 s of the previous
 *   one, or an exception thrown by frame(), onResize() or the governor's apply(), calls
 *   onLost({fatal:true, reason:'lost-again'|'error', error}) and the loop never restarts.
 * - Resizes (ResizeObserver on the canvas, window resize, devicePixelRatio changes) are debounced
 *   150 ms and applied at the start of the next rendered frame, so the new size and the redraw land
 *   together. onResize(w, h, dpr) (CSS px, devicePixelRatio) fires only when the drawing-buffer size
 *   (w·dpr × h·dpr) changes, never for the size at creation (the stage sizes itself); with a
 *   coarse pointer, height-only changes < 160 px are ignored (URL bar; size the canvas in lvh).
 * - governor.frame(ms) gets the interval of each rendered frame that directly follows another
 *   (idle gaps and the first frame after a pause are not fed); governor.reset() runs on (re)start.
 * @param {{canvas: HTMLCanvasElement, renderer?: {getContext?: () => WebGLRenderingContext},
 *   frame: (dt: number, t: number) => boolean|void, onLost?: (info: {fatal: boolean, reason?: string, error?: unknown}) => void,
 *   onRestored?: () => void, onResize?: (w: number, h: number, dpr: number) => void,
 *   governor?: {frame(ms: number): void, reset?(): void}}} opts
 * @returns {{start(): void, stop(): void, setRunning(on: boolean): void, invalidate(): void,
 *   setOnDemand(on: boolean): void, readonly running: boolean, readonly fps: number, dispose(): void}}
 */
export function createRuntime({ canvas, renderer, frame, onLost, onRestored, onResize, governor }) {
  const g = globalThis;
  const doc = g.document;
  let started = false, wanted = true, hidden = !!doc?.hidden, lost = false, dead = false;
  let onDemand = false, dirty = true, raf = 0, last = -1, t = 0, fps = 0, lostAt = -Infinity;
  let size = measure(), resizePending = false, timer = 0, dprQuery = null;

  const active = () => started && wanted && !hidden && !lost && !dead;

  function schedule() {
    if (!raf && active() && (dirty || !onDemand)) raf = g.requestAnimationFrame(tick);
  }
  function halt() {
    if (raf) g.cancelAnimationFrame(raf);
    raf = 0;
    last = -1;
  }

  function tick(now) {
    raf = 0;
    if (!active()) return void (last = -1);
    if (renderer?.getContext?.()?.isContextLost?.()) return void (last = -1); // event not here yet
    const follows = last >= 0;
    const ms = follows ? Math.max(0, now - last) : 1000 / 60;
    last = now;
    const dt = Math.min(ms, 100) / 1000;
    t += dt;
    dirty = false;
    let more;
    try {
      if (resizePending) applyResize();
      more = frame(dt, t);
      if (follows && ms > 0) {
        fps = fps ? fps * 0.9 + 100 / ms : 1000 / ms;
        governor?.frame(ms); // may call the stage's apply()
      }
    } catch (error) {
      die('error', error);
      return;
    }
    if (onDemand && more) dirty = true;
    if (onDemand && !dirty) last = -1; // idle until invalidate(): the next dt is not the gap
    else schedule();
  }

  function die(reason, error) {
    halt();
    dead = true;
    if (error) console.error(error);
    onLost?.({ fatal: true, reason, error });
  }

  function measure() {
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = g.devicePixelRatio || 1;
    return { w, h, dpr, pw: Math.round(w * dpr), ph: Math.round(h * dpr) };
  }
  function applyResize() {
    resizePending = false;
    const m = measure();
    if (m.pw === size.pw && m.ph === size.ph) return;
    const urlBar = m.w === size.w && m.dpr === size.dpr && Math.abs(m.h - size.h) < URL_BAR_PX;
    if (urlBar && g.matchMedia?.('(pointer: coarse)').matches) return;
    size = m;
    onResize?.(m.w, m.h, m.dpr);
  }
  function requestResize() {
    g.clearTimeout(timer);
    timer = g.setTimeout(() => {
      resizePending = true;
      dirty = true;
      schedule();
    }, RESIZE_DEBOUNCE_MS);
  }
  function watchDpr() {
    dprQuery?.removeEventListener?.('change', onDprChange);
    dprQuery = g.matchMedia?.(`(resolution: ${g.devicePixelRatio || 1}dppx)`) || null;
    dprQuery?.addEventListener?.('change', onDprChange);
  }
  function onDprChange() {
    watchDpr();
    requestResize();
  }

  function onVisibility() {
    hidden = !!doc.hidden;
    if (hidden) return halt();
    resume();
  }
  function resume() {
    governor?.reset?.();
    dirty = true;
    schedule();
  }
  function onContextLost(e) {
    const now = g.performance.now();
    const again = now - lostAt < LOST_AGAIN_MS;
    lostAt = now;
    if (again) return die('lost-again');
    e.preventDefault(); // lets the browser restore it
    lost = true;
    halt();
    onLost?.({ fatal: false });
  }
  function onContextRestored() {
    if (dead) return;
    lost = false;
    try {
      onRestored?.();
    } catch (error) {
      return die('error', error);
    }
    resizePending = true;
    if (started) api.start(); // a runtime stopped before the loss stays stopped
  }

  const ro = g.ResizeObserver ? new g.ResizeObserver(requestResize) : null;
  ro?.observe(canvas);
  g.addEventListener?.('resize', requestResize);
  doc?.addEventListener('visibilitychange', onVisibility);
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  watchDpr();

  const api = {
    /** Begin (or resume after stop()) rendering. */
    start() {
      started = true;
      resume();
    },
    /** Stop rendering until start(). */
    stop() {
      started = false;
      halt();
    },
    /** External gate (section out of view, chair turn done). Default on. */
    setRunning(on) {
      if (wanted === !!on) return;
      wanted = !!on;
      if (wanted) resume();
      else halt();
    },
    /** Ask for a frame (on-demand mode); harmless in continuous mode. */
    invalidate() {
      dirty = true;
      schedule();
    },
    /** On: render only after invalidate() and while frame() returns true. Off: every rAF. */
    setOnDemand(on) {
      onDemand = !!on;
      dirty = true;
      schedule();
    },
    get running() {
      return active();
    },
    /** Smoothed frames per second over consecutive frames (0 before the first pair). */
    get fps() {
      return fps;
    },
    dispose() {
      halt();
      dead = true;
      g.clearTimeout(timer);
      ro?.disconnect();
      g.removeEventListener?.('resize', requestResize);
      doc?.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      dprQuery?.removeEventListener?.('change', onDprChange);
    },
  };
  return api;
}
