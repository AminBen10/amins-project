// 'Compón tu corte' (motion M6): the perfume-counter mechanic. Laterales (altura + desde) →
// arriba → barba → acabado, each part unlocked by the one before. Every ingredient is played on
// the head at once (only the parts that look different are grown back and cut again), while the
// card, 'En la tarifa' minutes and price and the ficha change in the same frame. With all four
// chosen the program ends on the hand mirror and the card books the composed ficha.
// A Carta plate is a preset: picking one fills the composer with its mix.
import { compose } from '../cuts/compose.js';
import { normalizeMix } from '../cuts/ficha.js';

const ORDER = ['laterales', 'arriba', 'barba', 'acabado'];
const EMPTY = Object.freeze({ id: 'mix-x-x-x-x-x', kind: 'composed', name: '', spec: { sides: null, nape: null, top: null, beard: null }, steps: [] });

/** initComposer({client, carta, reducedMotion}) → {fill(mix), open(fromScratch), read()} */
export function initComposer({ client, carta }) {
  const form = document.getElementById('composer');
  const opener = document.getElementById('composer-open');
  if (!form) return { fill() {}, open() {}, read: () => null };
  const parts = Object.fromEntries(ORDER.map((p) => [p, form.querySelector(`fieldset[data-part="${p}"]`)]));
  const radios = (name) => [...form.querySelectorAll(`input[type=radio][name="${CSS.escape(name)}"]`)];
  const val = (name) => radios(name).find((r) => r.checked)?.value || null;
  let filling = false;

  function read() {
    return normalizeMix({
      laterales: { altura: val('laterales.altura'), desde: val('laterales.desde') },
      arriba: val('arriba'),
      barba: val('barba'),
      acabado: val('acabado'),
    });
  }

  const has = (m, part) => (part === 'laterales' ? !!(m.laterales?.altura && m.laterales?.desde) : !!m[part]);

  // Each fieldset opens once the ones before it are chosen.
  function unlock(m = read()) {
    let open = true;
    for (const p of ORDER) {
      if (parts[p]) parts[p].disabled = !open;
      open = open && has(m, p);
    }
  }

  function set(name, value) {
    for (const r of radios(name)) r.checked = value != null && r.value === String(value);
  }

  /** Fill the radios from a mix (a Carta preset): no film, the card is already the plate's. */
  function fill(mix) {
    const m = normalizeMix(mix);
    filling = true;
    set('laterales.altura', m.laterales?.altura);
    set('laterales.desde', m.laterales?.desde);
    set('arriba', m.arriba);
    // a Carta cut on its own is 'Sin barba' in the composer
    set('barba', m.barba || (m.laterales || m.arriba ? 'ninguna' : null));
    set('acabado', m.acabado);
    filling = false;
    unlock();
  }

  function clear() {
    for (const r of form.querySelectorAll('input[type=radio]')) r.checked = false;
    unlock();
  }

  form.addEventListener('change', (e) => {
    if (filling) return;
    const m = read();
    unlock(m);
    // altura without desde (or the reverse) is not a cut yet
    if (!ORDER.some((p) => has(m, p))) return;
    const part = e.target?.name?.split('.')[0];
    const next = compose(m, client);
    if (!next?.steps?.length) return;
    carta.show(next, { from: 'composer', speed: 1.6, withTitle: false, debounce: 0, changed: part });
  });

  // The Carta and the phone's 'Cambiar' fill the composer with what is on the card.
  carta.onShow((program, from) => {
    if ((from === 'carta' || from === 'sheet') && program?.mix) fill(program.mix);
  });

  async function open(fromScratch) {
    form.hidden = false;
    opener?.setAttribute('aria-expanded', 'true');
    if (fromScratch) {
      clear();
      await carta.blank(EMPTY);
    } else if (carta.current?.mix) fill(carta.current.mix);
    else unlock();
    form.querySelector('fieldset:not(:disabled) input')?.focus({ preventScroll: true });
  }

  opener?.addEventListener('click', () => {
    if (form.hidden) open(!carta.current);
    else {
      form.hidden = true;
      opener.setAttribute('aria-expanded', 'false');
    }
  });

  unlock();
  return { fill, open, read };
}
