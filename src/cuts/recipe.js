// The recipe card for a program: the same HTML string at build time (content.js,
// inside <template data-recipe="{id}">) and at runtime (the Carta and the
// composer). Labels are the copy deck's (carta.recipe.labels, carta.note,
// carta.diagram.caption, carta.cta). Pure string building, no DOM.
//
// Hooks for the player and the booking: ol.recipe__steps > li > button[data-step=i]
// (i = index in program.steps; the closing hand-mirror step is not listed),
// a#carta-book with data-program / data-service / data-cut / data-beard and the
// labels the WhatsApp line needs.
import { serviceFor, tarifaLine, formatFicha } from './ficha.js';
import { guiaSVG } from './guia.js';
import { renderSlip, mixLines } from './slip.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const attr = (name, v) => (v == null || v === '' ? '' : ` ${name}="${esc(v)}"`);

const ROWS = [
  ['lados', 'Lados'],
  ['nuca', 'Nuca'],
  ['arriba', 'Arriba'],
  ['barba', 'Barba'],
  ['contornos', 'Contornos'],
  ['acabado', 'Acabado'],
  ['tiempo', 'Tiempo'],
  ['repaso', 'Repaso'],
];

export const RECIPE_COPY = {
  note: 'Medidas orientativas, sobre una cabeza de prácticas. En la silla te lo ajustamos a tu pelo y a tus remolinos.',
  guia: 'Guía de corte. Los números son los peines.',
  tarifa: 'En la tarifa',
  ficha: 'Para el barbero',
  cta: 'Pedir hora con este corte',
  steps: 'Pasos',
  more: 'Medidas y pasos',
};

/** The cut and beard a program stands for (Carta ids, labels for the booking line). */
export function programParts(p) {
  if (!p) return { cut: null, beard: null, cutLabel: null, beardLabel: null };
  if (p.kind === 'cut') return { cut: p.id, beard: null, cutLabel: p.name, beardLabel: null };
  if (p.kind === 'beard') return { cut: null, beard: p.id, cutLabel: null, beardLabel: p.name };
  return {
    cut: p.base?.cut ?? null,
    beard: p.base?.beard ?? null,
    cutLabel: p.labels?.cut ?? p.name ?? null,
    beardLabel: p.labels?.beard ?? null,
  };
}

/**
 * The recipe card HTML. opts: {heading: 'h3', idPrefix: 'receta', bookId:
 * 'carta-book'} (the heading level, the prefix of the card's title id, which ends
 * with the program id, and the booking link's id; pass bookId: null when several
 * cards are on the page at once, as in the no-JS list).
 */
export function renderRecipe(program, client, opts = {}) {
  const p = program;
  if (!p) return '';
  const h = opts.heading || 'h3';
  const tid = `${opts.idPrefix || 'receta'}-${p.id}`;
  const service = serviceFor(p, client);
  const r = { ...(p.recipe || {}), tiempo: service && !service.estimate ? `${service.minutes} min` : null };
  const parts = programParts(p);

  const title =
    `<${h} class="recipe__name" id="${esc(tid)}">${esc(p.name)}` +
    (p.alias ? ` <span class="recipe__alias">(<span lang="en">${esc(p.alias)}</span>)</span>` : '') +
    `</${h}>`;
  const head =
    `<header class="recipe__head">` +
    (p.n ? `<p class="recipe__n">Nº ${p.n}</p>` : '') +
    title +
    (p.desc ? `<p class="recipe__desc">${esc(p.desc)}</p>` : '') +
    `</header>`;

  const rows = ROWS.filter(([k]) => r[k])
    .map(([k, label]) => `<div class="recipe__row recipe__row--${k}"><dt>${label}</dt><dd>${esc(r[k])}</dd></div>`)
    .join('');
  const dl = rows ? `<dl class="recipe__spec">${rows}</dl>` : '';

  const steps = (p.steps || [])
    .map((s, i) => (s.op === 'mirror' ? '' : `<li><button type="button" class="recipe__step" data-step="${i}">${esc(s.label)}</button></li>`))
    .join('');
  const ol = steps ? `<ol class="recipe__steps" aria-label="${RECIPE_COPY.steps}">${steps}</ol>` : '';

  const tarifa = service
    ? `<p class="recipe__tarifa"><span class="recipe__k">${RECIPE_COPY.tarifa}</span> <span class="recipe__v">${esc(tarifaLine(service))}</span></p>`
    : '';
  const spec = p.spec || {};
  const view = spec.sides || spec.top || spec.nape ? 'both' : 'perfil';
  const guia =
    spec.sides || spec.top || spec.beard
      ? `<figure class="recipe__guia">${guiaSVG(spec, { view })}<figcaption>${RECIPE_COPY.guia}</figcaption></figure>`
      : '';
  const fichaText = formatFicha(p);
  const ficha = fichaText
    ? `<div class="recipe__ficha"><p class="recipe__k">${RECIPE_COPY.ficha}</p>${renderSlip({ lines: p.mix ? mixLines(p.mix, client) : [], sentence: fichaText })}</div>`
    : '';
  const note = `<p class="recipe__note">${RECIPE_COPY.note}</p>`;
  // The measurements and the steps fold away: the card reads name, price, guía, ficha.
  const more = dl || ol ? `<details class="recipe__more"><summary>${RECIPE_COPY.more}</summary>${dl}${ol}${note}</details>` : note;
  const book =
    `<div class="recipe__foot"><a class="recipe__book"${attr('id', opts.bookId === undefined ? 'carta-book' : opts.bookId)} href="#reservar"` +
    attr('data-program', p.id) +
    attr('data-service', service?.id) +
    attr('data-cut', parts.cut) +
    attr('data-beard', parts.beard) +
    attr('data-cut-label', parts.cutLabel) +
    attr('data-beard-label', parts.beardLabel) +
    `>${RECIPE_COPY.cta}</a></div>`;

  return (
    `<article class="recipe" data-program="${esc(p.id)}" aria-labelledby="${esc(tid)}">` +
    head +
    tarifa +
    guia +
    ficha +
    more +
    book +
    `</article>`
  );
}
