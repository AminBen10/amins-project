// 'Compón tu corte' (motion M6): the perfume-counter mechanic. Laterales (altura + desde) →
// arriba → barba → acabado, each part unlocked by the one before. Every ingredient is played on
// the head at once (only the parts that look different are grown back and cut again), while the
// card, 'En la tarifa' minutes and price and the ficha change in the same frame. With all four
// chosen the program ends on the hand mirror and the card books the composed ficha.
// A Carta plate is a preset: picking one fills the composer with its mix.
import { compose } from '../cuts/compose.js';
import { normalizeMix, mixHasHair } from '../cuts/ficha.js';
import { mixLines, mixComplete, renderSlip, slipTotal } from '../cuts/slip.js';

const ORDER = ['laterales', 'arriba', 'barba', 'acabado'];
const EMPTY = Object.freeze({ id: 'mix-x-x-x-x-x', kind: 'composed', name: '', spec: { sides: null, nape: null, top: null, beard: null }, steps: [] });

/** initComposer({client, carta, reducedMotion}) → {fill(mix), open(fromScratch), read()} */
export function initComposer({ client, carta }) {
  const form = document.getElementById('composer');
  const opener = document.getElementById('composer-open');
  const chartTab = document.getElementById('carta-tab');
  const fichaEl = document.getElementById('ficha');
  if (!form) return { fill() {}, open() {}, read: () => null };
  const parts = Object.fromEntries(ORDER.map((p) => [p, form.querySelector(`fieldset[data-part="${p}"]`)]));
  const radios = (name) => [...form.querySelectorAll(`input[type=radio][name="${CSS.escape(name)}"]`)];
  const val = (name) => radios(name).find((r) => r.checked)?.value || null;
  let filling = false;
  // The arriba the sides on the head were built for: changing only the top (or the
  // beard, the finish) keeps those sides and their name (compose opts.sidesFrom).
  // undefined: nothing on the head to keep yet.
  let sidesFor;

  function read() {
    return normalizeMix({
      laterales: { altura: val('laterales.altura'), desde: val('laterales.desde') },
      arriba: val('arriba'),
      barba: val('barba'),
      acabado: val('acabado'),
    });
  }

  // The ficha: every pick is written on it at once, with minutes and price from the
  // tarifa at its foot; with the four parts chosen the stamp lands and one action shows.
  const CTA = 'Pedir hora con esta ficha';
  let stamped = false;
  function writeFicha(m = read()) {
    if (!fichaEl) return;
    const any = ORDER.some((p) => has(m, p)) || !!m.laterales?.altura || !!m.laterales?.desde;
    const done = mixComplete(m);
    // the fade height alone already says which line of the tarifa it is
    const priced = m.laterales?.altura && !m.laterales.desde ? { ...m, laterales: { altura: m.laterales.altura, desde: '0' } } : m;
    const total = any && (mixHasHair(priced) || (m.barba && m.barba !== 'ninguna')) ? slipTotal(priced, client) : '';
    const title = done ? carta.current?.name || '' : '';
    fichaEl.innerHTML = renderSlip({
      title,
      lines: mixLines(m, client),
      all: true,
      total,
      stamp: done,
      cta: done ? `<a class="cta ficha__book recipe__book" href="#reservar">${CTA}</a>` : '',
      cls: done && !stamped ? 'slip--landing' : '',
    });
    stamped = done;
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
    sidesFor = m.laterales?.altura && m.laterales?.desde ? m.arriba : undefined;
    filling = false;
    unlock();
    stamped = mixComplete(read());
    writeFicha();
  }

  function clear() {
    for (const r of form.querySelectorAll('input[type=radio]')) r.checked = false;
    sidesFor = undefined;
    unlock();
    stamped = false;
    writeFicha();
  }

  form.addEventListener('change', (e) => {
    if (filling) return;
    const m = read();
    unlock(m);
    // altura without desde (or the reverse) is not a cut yet
    if (!ORDER.some((p) => has(m, p))) return writeFicha(m);
    const part = e.target?.name?.split('.')[0];
    const keep = part !== 'laterales' && sidesFor !== undefined;
    const next = compose(m, client, keep ? { sidesFrom: sidesFor } : {});
    if (!next?.steps?.length) return writeFicha(m);
    // sides rebuilt (laterales changed, or a rapado/mullet top): they are now the new top's
    if (!String(next.id).includes('~')) sidesFor = m.laterales?.altura && m.laterales?.desde ? m.arriba : undefined;
    carta.show(next, { from: 'composer', speed: 1.6, withTitle: false, debounce: 0, changed: part });
    writeFicha(m);
  });

  // The Carta and the phone's 'Cambiar' fill the composer with what is on the card.
  carta.onShow((program, from) => {
    if ((from === 'carta' || from === 'sheet') && program?.mix) fill(program.mix);
  });

  // Desktop: with the composer open the chart steps aside (styles.css), so the
  // ingredients sit next to the head while it plays. The two tabs on top of the sheet
  // switch between them.
  function setOpen(on) {
    form.hidden = !on;
    opener?.setAttribute('aria-expanded', String(on));
    chartTab?.setAttribute('aria-pressed', String(!on));
    const sheet = form.closest('.carta__sheet');
    sheet?.classList.toggle('is-composing', on);
    if (sheet && matchMedia('(min-width: 900px)').matches) {
      const r = sheet.getBoundingClientRect();
      const nav = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 60;
      if (r.top < nav || r.top > innerHeight * 0.5) scrollBy({ top: r.top - nav - 24, behavior: 'instant' });
    }
  }

  async function open(fromScratch) {
    setOpen(true);
    if (fromScratch) {
      clear();
      await carta.blank(EMPTY);
    } else if (carta.current?.mix) fill(carta.current.mix);
    else unlock();
    form.querySelector('fieldset:not(:disabled) input')?.focus({ preventScroll: true });
  }

  opener?.addEventListener('click', () => {
    if (form.hidden) open(!carta.current);
  });
  chartTab?.addEventListener('click', () => {
    if (!form.hidden) setOpen(false);
  });

  unlock();
  writeFicha();
  return { fill, open, read };
}
