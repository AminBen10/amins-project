// The hand mirror (motion M7): the client tilts it to see the nape. Input only; the stage draws
// it (setMirrorAngle). #hand-mirror-slider is a role=slider (←/→ ±5°, Home 0°); a horizontal drag
// over the mirror itself (stage.mirror.rect) turns it too, while vertical swipes still scroll.
// 'Moverlo con el móvil' only where the device has orientation, and the iOS prompt only on that tap.
// In mask mode (no second render) the DOM oval is laid over the nape view at stage.mirror.rect.
const MAX = 35;
const KEY_STEP = 5;
const clamp = (v) => Math.max(-MAX, Math.min(MAX, v));

export function initHandMirror({ reducedMotion = false } = {}) {
  const root = document.documentElement;
  const slider = document.getElementById('hand-mirror-slider');
  const mask = document.getElementById('hand-mirror-mask');
  const tilt = document.getElementById('mirror-tilt');
  let stage = null;
  let angle = 0;
  let target = 0;
  let raf = 0;
  let unsub = null;

  function apply(v) {
    angle = v;
    root.style.setProperty('--mirror-angle', String(Math.round(v * 10) / 10));
    stage?.setMirrorAngle?.(v);
  }
  // The slider reports where it is going, not the eased frame in between.
  function announce() {
    const n = Math.round(target);
    if (slider && slider.getAttribute('aria-valuenow') !== String(n)) {
      slider.setAttribute('aria-valuenow', String(n));
      slider.setAttribute('aria-valuetext', `${n}°`);
    }
  }

  // Damped towards the target; reduced motion jumps (no easing, no inertia).
  function tick() {
    raf = 0;
    const d = target - angle;
    if (Math.abs(d) < 0.05) return apply(target);
    apply(angle + d * 0.22);
    raf = requestAnimationFrame(tick);
  }
  function setTarget(v, instant = false) {
    target = clamp(v);
    announce();
    if (instant || reducedMotion) {
      cancelAnimationFrame(raf);
      raf = 0;
      apply(target);
    } else if (!raf) raf = requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------- the slider

  if (slider) {
    slider.addEventListener('keydown', (e) => {
      let v = null;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = target - KEY_STEP;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = target + KEY_STEP;
      else if (e.key === 'PageDown') v = target - 2 * KEY_STEP;
      else if (e.key === 'PageUp') v = target + 2 * KEY_STEP;
      else if (e.key === 'Home') v = 0;
      else if (e.key === 'End') v = MAX;
      if (v == null) return;
      e.preventDefault();
      setTarget(Math.round(v / KEY_STEP) * KEY_STEP);
    });
    const fromX = (x) => {
      const r = slider.getBoundingClientRect();
      return ((x - r.left) / Math.max(1, r.width)) * 2 * MAX - MAX;
    };
    let id = null;
    slider.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      id = e.pointerId;
      slider.setPointerCapture?.(id);
      setTarget(fromX(e.clientX));
    });
    slider.addEventListener('pointermove', (e) => {
      if (e.pointerId === id) setTarget(fromX(e.clientX));
    });
    const up = (e) => {
      if (e.pointerId === id) id = null;
    };
    slider.addEventListener('pointerup', up);
    slider.addEventListener('pointercancel', up);
  }

  // ---------------------------------------------------------------- drag over the mirror

  // The beat under the mirror lets the browser keep vertical pans (scroll) and gives us horizontal ones.
  const beat = document.querySelector('.beat--mirror');
  if (beat) beat.style.touchAction = 'pan-y';
  let drag = null;
  const inRect = (r, x, y) => r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  addEventListener(
    'pointerdown',
    (e) => {
      if (!stage || e.button !== 0 || !stage.mirror || stage.mirror.mode === 'off') return;
      if (e.target.closest?.('button, a, input, select, textarea, [role=slider], #carta-player')) return;
      if (!inRect(stage.mirror.rect, e.clientX, e.clientY)) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, a: target, w: stage.mirror.rect.w, live: false };
    },
    { passive: true },
  );
  addEventListener(
    'pointermove',
    (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.live) {
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) return void (drag = null); // a scroll
        if (Math.abs(dx) < 6) return;
        drag.live = true;
      }
      // the mirror's width is the whole swing
      setTarget(drag.a + (dx / Math.max(80, drag.w)) * 2 * MAX);
    },
    { passive: true },
  );
  const end = (e) => {
    if (drag && e.pointerId === drag.id) drag = null;
  };
  addEventListener('pointerup', end, { passive: true });
  addEventListener('pointercancel', end, { passive: true });

  // ---------------------------------------------------------------- device orientation

  let tilting = false;
  const onOrient = (e) => {
    if (typeof e.gamma === 'number') setTarget(e.gamma);
  };
  if (tilt && 'DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches) {
    tilt.hidden = false;
    tilt.setAttribute('aria-pressed', 'false');
    tilt.addEventListener('click', async () => {
      if (tilting) {
        tilting = false;
        removeEventListener('deviceorientation', onOrient);
        tilt.setAttribute('aria-pressed', 'false');
        return;
      }
      const D = window.DeviceOrientationEvent;
      if (typeof D.requestPermission === 'function') {
        try {
          if ((await D.requestPermission()) !== 'granted') return;
        } catch {
          return;
        }
      }
      tilting = true;
      addEventListener('deviceorientation', onOrient);
      tilt.setAttribute('aria-pressed', 'true');
    });
  }

  // ---------------------------------------------------------------- the mask oval

  let lastRect = '';
  function placeMask() {
    if (!mask || root.dataset.mirror !== 'mask') return;
    const r = stage?.mirror?.rect;
    if (!r) return;
    const k = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`;
    if (k === lastRect) return;
    lastRect = k;
    Object.assign(mask.style, { left: `${Math.round(r.x)}px`, top: `${Math.round(r.y)}px`, width: `${Math.round(r.w)}px`, height: `${Math.round(r.h)}px`, right: 'auto', bottom: 'auto' });
  }

  return {
    get angle() {
      return target;
    },
    set: (deg) => setTarget(+deg || 0, true),
    setStage(s) {
      unsub?.();
      stage = s;
      unsub = stage?.onFrame?.(placeMask) || null;
      if (stage) apply(target);
    },
  };
}
