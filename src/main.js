// Boot (motion M1). The page works on its own first: the door sign, the book, the thumb bar,
// the Carta's recipe card, the notes on the glass. three.js is never in the first bundle:
// the stage is imported after the first paint, only when the tier allows it.
import './styles.css';
import * as client from './config.js';
import { compose, mixOf } from './cuts/compose.js';
import { renderRecipe, programParts } from './cuts/recipe.js';
import { serviceFor } from './cuts/ficha.js';
import { detectTier, qualityProfile } from './three/quality.js';
import { initBooking } from './ui/booking.js';
import { initStatus } from './ui/status.js';
import { initThumbbar } from './ui/thumbbar.js';
import { initScroll } from './ui/scroll.js';
import { initCallouts } from './ui/callouts.js';

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

// Interim Carta (until carta.js, M5): the chosen plate's recipe card, so 'Pedir hora con este
// corte' works, and a plain player on the stage's film.
const cartaForm = document.getElementById('carta-form');
const recipeEl = document.getElementById('recipe');
let shown = null;
let film = null;
function showRecipe() {
  if (!cartaForm || !recipeEl) return;
  const cut = cartaForm.elements.corte?.value || null;
  const beard = cartaForm.elements.barba?.value;
  const program = compose(mixOf(cut, beard && beard !== 'none' ? beard : null, client), client);
  shown = program?.steps?.length ? program : null;
  recipeEl.innerHTML = shown ? renderRecipe(shown, client) : '';
  if (film && shown) loadShown();
}
cartaForm?.addEventListener('change', showRecipe);

// Any recipe card's booking link presets the book with that cut.
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a.recipe__book');
  if (!a) return;
  const d = a.dataset;
  const all = [...client.CUTS, ...client.BEARDS];
  const program = (shown && shown.id === d.program ? shown : null) || all.find((p) => p.id === d.program) || null;
  const parts = programParts(program);
  booking.preset({
    serviceId: d.service || serviceFor(program, client)?.id,
    cutId: d.cut || parts.cut,
    beardId: d.beard || parts.beard,
    cutLabel: d.cutLabel || parts.cutLabel,
    beardLabel: d.beardLabel || parts.beardLabel,
    ficha: program?.ficha || null,
  });
});

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
  const carta = document.getElementById('carta');
  carta?.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
});

// ---------------------------------------------------------------- interim player (M5 replaces it)

const player = document.getElementById('carta-player');
const titleEl = document.getElementById('film-title');
const captionEl = document.getElementById('film-caption');
const btn = (name) => player?.querySelector(`[data-film="${name}"]`);
let loadTimer = 0;
function loadShown() {
  clearTimeout(loadTimer);
  // 400 ms selection debounce, as carta.js will have it
  loadTimer = setTimeout(() => film.load(shown, { autoplay: false }), 400);
}
function wirePlayer() {
  if (!player || !film) return;
  film.on('title', ({ program }) => {
    titleEl.textContent = program.n ? `Nº ${program.n} · ${program.name}` : program.name || '';
  });
  film.on('step', ({ step }) => {
    captionEl.textContent = step.caption || step.label || '';
  });
  film.on('end', ({ program }) => {
    captionEl.textContent = `Terminado. Así queda: ${program.name}.`;
  });
  film.on('state', ({ state }) => {
    btn('play').hidden = state === 'playing' || state === 'paused';
    btn('pause').hidden = state !== 'playing';
    btn('resume').hidden = state !== 'paused';
  });
  player.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const f = b.dataset.film;
    if (f === 'play') {
      if (!film.program && shown) film.load(shown);
      else film.play();
    } else if (f === 'pause') film.pause();
    else if (f === 'resume') film.resume();
    else if (f === 'repeat') film.repeat();
    else if (f === 'finish') film.finish();
    else if (f === 'back') film.stop();
    else if (b.dataset.view) {
      for (const v of player.querySelectorAll('[data-view]')) v.setAttribute('aria-pressed', String(v === b));
      film.view(b.dataset.view);
    }
  });
  if (shown) loadShown();
}

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
    const [{ createStage }, { createFilm }] = await Promise.all([import('./three/stage.js'), import('./ui/film.js')]);
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
      if (fatal) resolveStage(null);
    };
    stage.onRestored = () => {
      root.classList.remove('no-webgl');
      root.dataset.stage = 'ready';
      callouts.setStage(stage);
      scroll.measure();
    };
    stage.onReady = () => {
      root.dataset.stage = 'ready';
      hidePosters();
      status.setStage(stage);
      scroll.setStage(stage);
      callouts.setStage(stage);
      film = createFilm(stage, { reducedMotion, section: document.getElementById('carta') });
      wirePlayer();
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
  const later = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200));
  requestAnimationFrame(() => later(boot));
}

// ---------------------------------------------------------------- QA hooks (?qa=1)

if (params.get('qa') === '1') {
  import('./ui/qa.js').then(({ initQA }) => {
    const qa = initQA({ stageReady, getStage: () => stage, getFilm: () => film, scroll, tier });
    const poster = params.get('poster');
    if (poster) {
      root.classList.add('poster-capture');
      qa.poster(poster);
    }
  });
}
