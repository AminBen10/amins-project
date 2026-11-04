// Boot. Interim (motion M8–M10, M2): the book, the door sign, the thumb bar,
// the chairs and the scroll story run on the new page; the 3D stage still is
// the old one, loaded lazily and fed through a small adapter until the scene
// stream's stage lands (M1 rewrites this boot).
import './styles.css';
import * as client from './config.js';
import { compose, mixOf } from './cuts/compose.js';
import { renderRecipe, programParts } from './cuts/recipe.js';
import { serviceFor } from './cuts/ficha.js';
import { initBooking } from './ui/booking.js';
import { initStatus } from './ui/status.js';
import { initThumbbar } from './ui/thumbbar.js';
import { initScroll } from './ui/scroll.js';

const root = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reducedMotion) root.dataset.motion = 'off';
const canvas = document.getElementById('stage');

function webglAvailable() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- the page (works without 3D)

const thumbbar = initThumbbar();
const booking = initBooking({ onCut: (cut) => thumbbar.setCut(cut) });
const status = initStatus();

document.getElementById('pitch-close')?.addEventListener('click', () => {
  document.getElementById('pitch').hidden = true;
});

// Interim Carta: the chosen plate's recipe card, so 'Pedir hora con este corte'
// works before the Carta player (carta.js) exists.
const cartaForm = document.getElementById('carta-form');
const recipeEl = document.getElementById('recipe');
let shown = null;
function showRecipe() {
  if (!cartaForm || !recipeEl) return;
  const cut = cartaForm.elements.corte?.value || null;
  const beard = cartaForm.elements.barba?.value;
  const program = compose(mixOf(cut, beard && beard !== 'none' ? beard : null, client), client);
  shown = program?.steps?.length ? program : null;
  recipeEl.innerHTML = shown ? renderRecipe(shown, client) : '';
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

// ---------------------------------------------------------------- the 3D stage

// The old stage speaks {morph, consult, sides, top, beard, studio, after}; map the
// story beats onto it. A stage with the new API (setFrame) is used as is.
function adapt(old) {
  if (typeof old.setFrame === 'function') return old;
  return {
    setInput(i) {
      old.setInput({ morph: i.enter, consult: i.consult, sides: i.clipper, top: i.scissors, beard: i.razor, studio: i.carta, after: i.turn });
    },
    setRunning: (on) => old.setRunning(on),
    resize: () => old.resize?.(),
    snap() {},
    setOpen() {},
  };
}

const scroll = initScroll({ stage: null, canvas, reducedMotion });

if (canvas && webglAvailable()) {
  root.dataset.stage = 'loading';
  import('./three/stage.js')
    .then(async ({ createStage }) => {
      const old = await createStage(canvas, { reducedMotion, look: client.DEFAULT_LOOK || { hair: 'fade', beard: 'short' } });
      const stage = adapt(old);
      old.onReady = () => {
        root.dataset.stage = 'ready';
        scroll.update();
      };
      status.setStage(stage);
      scroll.setStage(stage);
      addEventListener('resize', () => stage.resize());
    })
    .catch((err) => {
      console.error(err);
      root.dataset.stage = 'off';
      root.classList.add('no-webgl');
    });
} else {
  root.classList.add('no-webgl');
  root.dataset.stage = 'off';
}
