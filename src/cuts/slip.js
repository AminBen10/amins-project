// La ficha: the narrow printed slip that carries a cut from the Carta to the chair.
// The same HTML string at build time and in the browser (no DOM): the composer
// writes it line by line, the player shows it when a film ends, the book clips it
// to its left page and the appointment card carries it on its back.
// Lines come from the mix (the composer's ingredients) in the client's own words.
import { clientData, normalizeMix, serviceFor, tarifaLine } from './ficha.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const lowerFirst = (s) => (s ? s.charAt(0).toLocaleLowerCase('es') + s.slice(1) : s);
const norm = (v) => (v == null ? null : String(v).replace('.', ','));

export const SLIP_PARTS = ['laterales', 'arriba', 'barba', 'acabado'];
export const STAMP = 'Para el barbero';

// The printed word of an option (by field key) and the legend of a part.
function optionLabel(C, key, id) {
  if (id == null) return null;
  for (const g of C.INGREDIENTS) {
    for (const f of g.fields) {
      if (f.key !== key) continue;
      const o = f.options.find((x) => norm(x.id) === norm(id));
      return o ? o.label : null;
    }
  }
  return null;
}

function legendOf(C, part) {
  const g = C.INGREDIENTS.find((x) => x.part === part);
  return g?.legend || part.charAt(0).toUpperCase() + part.slice(1);
}

/**
 * The ficha's lines for a mix: [{part, k, v}] in the composer's order, v null when the
 * part is not chosen yet ('Medio, del 0', 'A tijera', 'Corta', 'Con producto').
 */
export function mixLines(mix, client) {
  const C = clientData(client);
  const m = normalizeMix(mix);
  return SLIP_PARTS.map((part) => {
    let v = null;
    if (part === 'laterales') {
      const a = optionLabel(C, 'laterales.altura', m.laterales?.altura);
      const d = optionLabel(C, 'laterales.desde', m.laterales?.desde);
      v = a && d ? `${a}, ${lowerFirst(d)}` : a || (d ? lowerFirst(d) : null);
    } else v = optionLabel(C, part, m[part]);
    return { part, k: legendOf(C, part), v };
  });
}

/** True when the four parts are chosen (the composer's stamp). */
export function mixComplete(mix) {
  const m = normalizeMix(mix);
  return !!(m.laterales?.altura && m.laterales?.desde && m.arriba && m.barba && m.acabado);
}

/** The foot of the slip: 'Degradado · 40 min · 18 €' from the shop's own tarifa. */
export function slipTotal(x, client) {
  return tarifaLine(serviceFor(x, client));
}

/**
 * The slip HTML. opts: {title, lines ([{part,k,v}]), all (show unchosen parts with '—'),
 * sentence (the ficha 'Para el barbero'), total, stamp (bool), cta (html), cls, live}.
 */
export function renderSlip(opts = {}) {
  const lines = (opts.lines || []).filter((l) => opts.all || l.v);
  const rows = lines
    .map((l) => `<div class="slip__line${l.v ? '' : ' slip__line--open'}" data-part="${esc(l.part)}"><dt>${esc(l.k)}</dt><dd>${l.v ? esc(l.v) : '—'}</dd></div>`)
    .join('');
  return (
    `<div class="slip${opts.stamp ? ' slip--stamped' : ''}${opts.cls ? ` ${opts.cls}` : ''}">` +
    (opts.title ? `<p class="slip__title">${esc(opts.title)}</p>` : '') +
    (rows ? `<dl class="slip__lines">${rows}</dl>` : '') +
    (opts.sentence ? `<p class="slip__sentence">${esc(opts.sentence)}</p>` : '') +
    (opts.total ? `<p class="slip__total">${esc(opts.total)}</p>` : '') +
    (opts.stamp ? `<span class="slip__stamp">${STAMP}</span>` : '') +
    (opts.cta || '') +
    `</div>`
  );
}

/** The slip of a whole program (a Carta cut or beard, or a composed mix). */
export function programSlip(p, client, extra = {}) {
  if (!p) return '';
  return renderSlip({
    title: p.n ? `Nº ${p.n} · ${p.name}` : p.name || '',
    lines: p.mix ? mixLines(p.mix, client) : [],
    sentence: p.ficha || '',
    total: slipTotal(p, client),
    ...extra,
  });
}
