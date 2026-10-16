import './styles.css';
import { DEFAULT_LOOK } from './config.js';
import { createStage } from './three/stage.js';
import { initBooking } from './ui/booking.js';
import { initStudio } from './ui/studio.js';
import { initStatus } from './ui/status.js';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('stage');

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

let stage = null;
if (webglAvailable()) {
  try {
    stage = createStage(canvas, { reducedMotion, look: DEFAULT_LOOK });
  } catch (err) {
    console.error(err);
  }
}
if (!stage) document.documentElement.classList.add('no-webgl');

const booking = initBooking();
initStudio({ stage, booking });
initStatus();

document.getElementById('pitch-close')?.addEventListener('click', () => {
  document.getElementById('pitch').hidden = true;
});

// ------------------------------------------------------------ scroll → 3D

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const q = (sel) => document.querySelector(sel);
const beats = {
  morph: q('[data-beat="morph"]'),
  consult: q('[data-beat="consult"]'),
  sides: q('[data-beat="sides"]'),
  top: q('[data-beat="top"]'),
  beard: q('[data-beat="beard"]'),
  studio: q('#estilos'),
  after: q('#servicios'),
};
const nav = q('.nav');

function readScroll() {
  const vh = innerHeight;
  const y = scrollY;
  const top = (el) => el.getBoundingClientRect().top + y;
  const seg = (a, b) => clamp01((y - a) / (b - a));
  const step = (el) => seg(top(el) - vh * 0.5, top(el) + el.offsetHeight - vh * 0.5);
  const intro = beats.morph;
  return {
    morph: seg(vh * 0.08, top(intro) + intro.offsetHeight * 0.5 - vh * 0.5),
    consult: step(beats.consult),
    sides: step(beats.sides),
    top: step(beats.top),
    beard: step(beats.beard),
    studio: seg(top(beats.studio) - vh * 0.7, top(beats.studio) - vh * 0.15),
    after: seg(top(beats.after) - vh * 0.85, top(beats.after) - vh * 0.25),
  };
}

let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    nav.classList.toggle('nav--solid', scrollY > 40);
    if (!stage) return;
    const s = readScroll();
    stage.setInput(s);
    canvas.style.opacity = String(1 - s.after);
    stage.setRunning(s.after < 0.999 && !document.hidden);
  });
}

addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', () => {
  stage?.resize();
  onScroll();
});
document.addEventListener('visibilitychange', onScroll);
if (stage) {
  stage.onReady = () => {
    document.documentElement.dataset.stage = 'ready';
    onScroll();
  };
}
document.fonts?.ready.then(onScroll);
onScroll();

// gentle parallax with the mouse
if (stage && matchMedia('(pointer: fine)').matches && !reducedMotion) {
  addEventListener('pointermove', (e) => {
    stage.pointer((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1));
  });
}
