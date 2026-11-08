// Boot (motion M1). The page works on its own first: the door sign, the book, the thumb bar,
// the Carta's recipe card, the notes on the glass. three.js is never in the first bundle:
// the stage is imported after the first paint, only when the tier allows it.
import './styles.css';
import * as client from './config.js';
import { detectTier, qualityProfile } from './three/quality.js';
import { initBooking } from './ui/booking.js';
import { initStatus } from './ui/status.js';
import { initThumbbar } from './ui/thumbbar.js';
import { initScroll } from './ui/scroll.js';
import { initCallouts } from './ui/callouts.js';
import { initCarta } from './ui/carta.js';

const root = document.documentElement;
root.classList.replace('no-js', 'js');
const params = new URLSearchParams(location.search);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('stage');

// ---------------------------------------------------------------- motion choice (WCAG 2.2.2)

const MOTION_KEY = 'barberia:motion';
function storedMotion() {
  try {
    return localStorage.getItem(MOTION_KEY);
  } catch {
    return null;
  }
}
let motionOn = !reducedMotion && storedMotion() !== 'off';
if (!motionOn) root.dataset.motion = 'off';

// ---------------------------------------------------------------- the page (works without 3D)

const thumbbar = initThumbbar();
const booking = initBooking({ onCut: (cut) => thumbbar.setCut(cut) });
const status = initStatus();
const scroll = initScroll({ stage: null, canvas, reducedMotion });
const callouts = initCallouts({ scroll });

document.getElementById('pitch-close')?.addEventListener('click', () => {
  document.getElementById('pitch').hidden = true;
});

// La Carta, its player and 'Compón tu corte' (the card works without 3D; the film joins on ready).
const carta = initCarta({ client, booking, thumbbar, reducedMotion });
const later = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200));
// 'Compón tu corte' is its own chunk, fetched when the page is idle (or on the first tap).
let composer = null;
let composerP = null;
const loadComposer = () =>
  (composerP ||= import('./ui/composer.js').then(({ initComposer }) => (composer = initComposer({ client, carta }))));
document.getElementById('composer-open')?.addEventListener(
  'click',
  async () => {
    if (composer) return; // its own listener has it
    await loadComposer();
    composer.open(!carta.current);
  },
  { once: true },
);
later(() => loadComposer().catch((err) => console.error(err)));
let handMirror = null; // the hand-mirror input rides in with the stage
const cartaForm = document.getElementById('carta-form');

// Las sillas: 'Ver su …' picks that cut on the Carta and that barber in the book.
document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('.ledger__see[data-cut]');
  if (!btn) return;
  const input = cartaForm?.querySelector(`input[value="${CSS.escape(btn.dataset.cut)}"]`);
  if (input) {
    // A chair's cut is shown on its own: no beard from an earlier pick.
    const none = input.name === 'corte' ? cartaForm.querySelector('input[name=barba][value=none]') : null;
    if (none) none.checked = true;
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (btn.dataset.barber) booking.preset({ barberId: btn.dataset.barber });
  document.getElementById('carta')?.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
});

// ---------------------------------------------------------------- the pole's motion button

function motionButton(stage) {
  if (reducedMotion) return; // nothing moves on its own already
  const door = document.querySelector('.shop__door');
  if (!door || document.getElementById('pole-motion')) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.id = 'pole-motion';
  b.className = 'textbtn';
  // in the door's lower panel, under the glass (the sign's text is rewritten every minute)
  b.style.cssText = 'position:absolute;left:50%;bottom:18px;transform:translateX(-50%);z-index:3;pointer-events:auto;white-space:nowrap;font-size:0.875rem;';
  const paint = () => {
    b.textContent = motionOn ? 'Parar el poste' : 'Mover el poste';
    b.setAttribute('aria-pressed', String(!motionOn));
  };
  b.addEventListener('click', () => {
    motionOn = !motionOn;
    if (motionOn) delete root.dataset.motion;
    else root.dataset.motion = 'off';
    try {
      localStorage.setItem(MOTION_KEY, motionOn ? 'on' : 'off');
    } catch {
      /* private mode: the choice lasts this visit */
    }
    stage.setMotion?.(motionOn);
    paint();
  });
  paint();
  door.append(b);
}

// ---------------------------------------------------------------- the 3D stage

let stage = null;
let film = null;
let resolveStage;
const stageReady = new Promise((r) => (resolveStage = r));
const { tier } = detectTier({ search: location.search, reducedMotion });

function noWebgl(state = 'off') {
  root.classList.add('no-webgl');
  root.dataset.stage = state;
  callouts.setStage(null);
}

// The engineering posters give way to the live stage (no fade under reduced motion).
function hidePosters() {
  for (const el of document.querySelectorAll('.shop__glass [data-poster]')) {
    if (reducedMotion) el.style.visibility = 'hidden';
    else {
      el.style.transition = 'opacity 0.3s linear, visibility 0s linear 0.3s';
      el.style.opacity = '0';
      el.style.visibility = 'hidden';
    }
  }
}

async function boot() {
  try {
    // the film timeline only matters with a stage: it rides in with it
    const [{ createStage }, { createFilm }, { initHandMirror }] = await Promise.all([
      import('./three/stage.js'),
      import('./ui/film.js'),
      import('./ui/handmirror.js'),
    ]);
    handMirror = initHandMirror({ reducedMotion });
    const data = { THEME: client.THEME, CLAIMS: client.CLAIMS, GUARDS: client.GUARDS, STORY: client.STORY };
    const profile = qualityProfile(tier);
    stage = await createStage(canvas, { reducedMotion, tier, profile, data });
    if (!motionOn) stage.setMotion?.(false);
    stage.onMirrorMode = (mode) => {
      if (mode === 'off') delete root.dataset.mirror;
      else root.dataset.mirror = mode;
    };
    stage.onLost = ({ fatal } = {}) => {
      film?.pause();
      noWebgl('lost');
      handMirror?.setStage(null);
      if (fatal) resolveStage(null);
    };
    stage.onRestored = () => {
      root.classList.remove('no-webgl');
      root.dataset.stage = 'ready';
      callouts.setStage(stage);
      handMirror?.setStage(stage);
      scroll.measure();
    };
    stage.onReady = () => {
      root.dataset.stage = 'ready';
      hidePosters();
      status.setStage(stage);
      scroll.setStage(stage);
      callouts.setStage(stage);
      film = createFilm(stage, { reducedMotion, section: document.getElementById('carta') });
      handMirror.setStage(stage);
      carta.setFilm(film, stage);
      motionButton(stage);
      resolveStage(stage);
    };
    // the scroll story starts feeding the stage while the head still loads
    scroll.setStage(stage);
    status.setStage(stage);
  } catch (err) {
    console.error(err);
    noWebgl('off');
    resolveStage(null);
  }
}

if (!canvas || tier === 'poster') {
  noWebgl('off');
  resolveStage(null);
} else {
  root.dataset.stage = 'loading';
  // after the first paint, when the main thread is free (1.5 s at most)
  requestAnimationFrame(() => later(boot));
}

// ---------------------------------------------------------------- QA hooks (?qa=1)

if (params.get('qa') === '1') {
  import('./ui/qa.js').then(({ initQA }) => {
    const qa = initQA({ stageReady, getStage: () => stage, getFilm: () => film, scroll, tier, carta, getHandMirror: () => handMirror });
    const poster = params.get('poster');
    if (poster) {
      root.classList.add('poster-capture');
      qa.poster(poster);
    }
  });
}
