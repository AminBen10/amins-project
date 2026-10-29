// HTML rendered from the active client file at build time (see vite.config.js):
// the shopfront, the story notes, the Carta, the tarifa, the sillas, the
// appointment book and the door are all in the page source, so the page reads
// and books without JS or WebGL, and search engines see prices and hours.
// Every visible string comes from the client file or the copy deck.
import { priceLabel } from './price.js';
import { renderRecipe } from './cuts/recipe.js';
import { guiaSVG, plateSVG } from './cuts/guia.js';
import { FAMILIES } from './cuts/catalog.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const attr = (name, v) => (v == null || v === '' || v === false ? '' : v === true ? ` ${name}` : ` ${name}="${esc(v)}"`);

// ---------------------------------------------------------------- assets

// Node only (build time): optional posters and plates from engineering. In the
// browser this module never touches the file system.
const fs = globalThis.process?.getBuiltinModule?.('node:fs') ?? null;
const ROOT = new URL('../', import.meta.url);
const exists = (rel) => {
  try {
    return !!fs && fs.existsSync(new URL(rel, ROOT));
  } catch {
    return false;
  }
};

/** Client file id ('corte-real', 'barberia-bk'), from CLIENT_ID or the shop name. */
export function clientId(c) {
  if (c.CLIENT_ID) return c.CLIENT_ID;
  return String(c.BRAND?.name || 'shop')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// <picture> for src/posters/<client>-<name>.avif|webp, or '' when neither exists.
function posterPicture(c, name, alt, extra = '') {
  const base = `src/posters/${clientId(c)}-${name}`;
  const avif = exists(`${base}.avif`);
  const webp = exists(`${base}.webp`);
  if (!avif && !webp) return '';
  return (
    `<picture class="poster"${extra}>` +
    (avif && webp ? `<source srcset="/${base}.avif" type="image/avif">` : '') +
    `<img src="/${base}.${webp ? 'webp' : 'avif'}" alt="${esc(alt)}" decoding="async" loading="lazy">` +
    `</picture>`
  );
}

// ---------------------------------------------------------------- trade drawings
// Line drawings of the trade's objects, stroke only, in currentColor. They are the
// only icons on the page (no icon library, no ornaments).

const LINE = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

function comb(w = 168) {
  let teeth = '';
  for (let x = 9; x <= 86; x += 3) teeth += `M${x} 15V29`;
  for (let x = 92; x <= 158; x += 5) teeth += `M${x} 15V32`;
  return `<svg class="drawing drawing--comb" viewBox="0 0 168 40" width="${w}" aria-hidden="true"><g ${LINE}><path d="M5 9Q5 6 8 6H160Q163 6 163 9V15H5Z"/><path d="${teeth}" stroke-width="1.1"/></g></svg>`;
}

export const DRAWINGS = {
  clipper: `<svg class="drawing drawing--clipper" viewBox="0 0 176 72" width="176" aria-hidden="true"><g ${LINE}>
<path d="M32 17L126 20Q156 22 158 36Q156 50 126 52L32 55Q26 55 26 49V23Q26 17 32 17Z"/>
<path d="M26 24H15V48H26"/><path d="M15 22L5 26V46L15 50"/><path d="M8 27V45M11 25V47" stroke-width="1"/>
<path d="M62 17L68 8H77L75 18"/><rect x="94" y="30" width="20" height="8" rx="2"/>
<path d="M40 25H118M40 47H118" stroke-width="0.9" stroke-dasharray="1 3"/>
<path d="M158 36C170 36 168 60 156 68"/></g></svg>`,
  scissors: `<svg class="drawing drawing--scissors" viewBox="0 0 176 72" width="176" aria-hidden="true"><g ${LINE}>
<path d="M78 33L164 25Q168 25 166 28L80 38Z"/><path d="M78 39L164 45Q168 46 164 48L80 34Z"/>
<circle cx="80" cy="36" r="2.4"/>
<path d="M78 33L46 24"/><circle cx="35" cy="21" r="11"/><circle cx="35" cy="21" r="6.5" stroke-width="1"/>
<path d="M78 39L50 50"/><ellipse cx="37" cy="54" rx="13.5" ry="10.5"/><ellipse cx="37" cy="54" rx="8.5" ry="6" stroke-width="1"/>
<path d="M27 62Q18 70 10 64"/></g></svg>`,
  razor: `<svg class="drawing drawing--razor" viewBox="0 0 176 72" width="176" aria-hidden="true"><g ${LINE}>
<path d="M82 16H160Q166 16 166 22V28Q166 34 156 36L92 37Q85 37 83 31Z"/><path d="M90 21H160" stroke-width="1"/>
<path d="M82 16L74 20L77 29L83 31"/><circle cx="77" cy="25" r="2"/>
<path d="M75 22L14 50Q6 54 10 60Q14 65 21 61L80 29"/><path d="M22 52L66 31" stroke-width="0.9"/></g></svg>`,
  chair: `<svg class="drawing drawing--chair" viewBox="0 0 120 164" width="120" aria-hidden="true"><g ${LINE}>
<rect x="70" y="6" width="24" height="13" rx="5"/><path d="M82 19V28"/>
<path d="M68 28H97Q101 28 100 33L95 86H63L65 33Q65 28 68 28Z"/>
<path d="M28 86H98Q102 86 102 91V97Q102 99 99 99H28Q24 99 24 94V90Q24 86 28 86Z"/>
<path d="M32 70H90M38 70V86M86 70V86"/>
<path d="M30 99L16 128M6 129H26"/>
<rect x="58" y="99" width="12" height="36" rx="2"/><path d="M60 112H68M60 120H68" stroke-width="0.9"/>
<ellipse cx="64" cy="146" rx="36" ry="7"/><path d="M72 141L94 136"/></g></svg>`,
  mirror: `<svg class="drawing drawing--mirror" viewBox="0 0 100 164" width="100" aria-hidden="true"><g ${LINE}>
<ellipse cx="50" cy="50" rx="38" ry="44"/><ellipse cx="50" cy="50" rx="32" ry="38" stroke-width="1"/>
<path d="M44 94V150Q44 156 50 156Q56 156 56 150V94"/></g></svg>`,
  comb: comb(),
};

// ---------------------------------------------------------------- theme

const kebab = (k) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** THEME tokens as :root custom properties (--night, --cta-ink, --sign-open…). */
export function themeStyle(c) {
  const t = c.THEME || {};
  const decls = Object.entries(t)
    .filter(([, v]) => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v))
    .map(([k, v]) => `--${kebab(k)}:${v}`)
    .join(';');
  return `<style id="theme">:root{${decls}}</style>`;
}

// Derived switches for CSS, written on <html> through {{site.*}} tokens.
function site(c) {
  return {
    client: clientId(c),
    board: c.THEME?.felt ? 'felt' : 'glass',
    mode: c.BOOKING?.mode || 'demo',
    night: c.THEME?.night || '#111214',
  };
}

// ---------------------------------------------------------------- nav

export function navLinks(c) {
  const links = [['#carta', 'Carta de cortes'], ['#tarifa', 'Tarifa'], c.BARBERS?.length ? ['#sillas', 'Las sillas'] : null].filter(Boolean);
  return links.map(([href, label]) => `<a href="${href}">${label}</a>`).join('\n        ');
}

export function pitchStrip(c) {
  if (!c.PITCH) return '';
  return `
    <aside class="pitch" id="pitch" aria-label="Aviso">
      <p class="pitch__text">${esc(c.PITCH.strip)}</p>
      <button type="button" class="pitch__close" id="pitch-close">${esc(c.PITCH.close)}</button>
    </aside>`;
}

// ---------------------------------------------------------------- shopfront

/** The sign-writing on the glass: CR 'CORTE REAL' over a smaller 'BARBERÍA'; BK 'BARBERÍA BK'. */
export function signLines(c) {
  const lines = c.BRAND.signLines?.length ? c.BRAND.signLines : [c.BRAND.name.toUpperCase()];
  return lines
    .map((l, i) => `<span class="sign__line${i ? ' sign__line--small' : ''}">${esc(l)}</span>`)
    .join(lines.length > 1 ? '<span class="sr-only">, </span>' : '');
}

export function heroFacts(c) {
  return c.COPY.facts.map((f) => `<span class="facts__line">${esc(f)}</span>`).join(' ');
}

// The shop seen through the glass when there is no 3D: tiled wall, station
// mirror under the fluorescent tube, the chair. Flat shapes, low contrast.
// The client's wall tiles as an SVG <pattern>: square cream tiles (CR) or
// green-white metro tiles laid in bond (BK), with full grout.
function tilePattern(c, id, scale = 1) {
  const t = scale === 1 ? '' : ` patternTransform="scale(${scale})"`;
  return c.THEME?.felt
    ? `<pattern id="${id}" width="64" height="32" patternUnits="userSpaceOnUse"${t}><rect width="64" height="32" fill="var(--grout)"/><g fill="var(--tile)" class="tile"><rect x="1.5" y="1.5" width="61" height="13"/><rect x="-30.5" y="17.5" width="61" height="13"/><rect x="33.5" y="17.5" width="61" height="13"/></g></pattern>`
    : `<pattern id="${id}" width="48" height="48" patternUnits="userSpaceOnUse"${t}><rect width="48" height="48" fill="var(--grout)"/><rect x="1.5" y="1.5" width="45" height="45" fill="var(--tile)" class="tile"/></pattern>`;
}

/** The tiled wall of the room behind the tarifa (tile at ~40% over the night). */
export function wall(c) {
  return `<svg class="wall" aria-hidden="true" focusable="false"><defs>${tilePattern(c, 'wall-tiles', 0.8)}</defs><rect width="100%" height="100%" fill="url(#wall-tiles)"/></svg>`;
}

export function slotsHint(c) {
  const h = c.COPY.hoursHint;
  return h && !h.includes('{') ? esc(h) : '';
}

export function shopInterior(c) {
  // Three stations along the back wall (mirror under its tube, counter, chair
  // seen from behind), tiles below the rail. Drawn dim: it is behind night glass.
  const station = (x) => {
    const cx = x + 110;
    return `<rect x="${x - 6}" y="96" width="232" height="10" fill="#08090a"/>
          <rect x="${x}" y="122" width="220" height="246" fill="var(--interior-mirror)" stroke="var(--chrome)" stroke-opacity=".38" stroke-width="2"/>
          <path d="M${x + 14} 136H${x + 96}L${x + 14} 240Z" fill="var(--interior-glare)"/>
          <rect x="${x - 14}" y="376" width="248" height="10" fill="var(--interior-rail)"/>
          <g fill="#060607">
            <rect x="${cx - 24}" y="300" width="48" height="28" rx="11"/>
            <path d="M${cx - 52} 344Q${cx - 52} 334 ${cx - 42} 334H${cx + 42}Q${cx + 52} 334 ${cx + 52} 344L${cx + 44} 478H${cx - 44}Z"/>
            <rect x="${cx - 90}" y="440" width="24" height="62" rx="7"/><rect x="${cx + 66}" y="440" width="24" height="62" rx="7"/>
            <rect x="${cx - 78}" y="478" width="156" height="32" rx="10"/>
            <rect x="${cx - 13}" y="510" width="26" height="78"/>
            <ellipse cx="${cx}" cy="600" rx="74" ry="13"/>
          </g>
          <g fill="none" stroke="var(--chrome)" stroke-opacity=".22" stroke-width="2">
            <path d="M${cx - 13} 512V586M${cx - 74} 600A74 13 0 0 0 ${cx + 74} 600"/>
          </g>`;
  };
  return `<svg class="shop__interior" viewBox="0 0 1200 690" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
        <defs>${tilePattern(c, 'tiles', 0.72)}</defs>
        <rect width="1200" height="690" fill="var(--interior-wall)"/>
        <rect y="410" width="1200" height="176" fill="url(#tiles)" class="shop__tiles"/>
        <rect y="584" width="1200" height="216" fill="#08080a"/>
        <rect y="584" width="1200" height="2" fill="var(--interior-rail)"/>
        <rect y="404" width="1200" height="6" fill="var(--interior-rail)"/>
        ${[130, 490, 850].map(station).join('')}
        <rect width="1200" height="690" fill="var(--glass-tint)"/>
        <g fill="var(--tube, #E6EFEE)" class="shop__tube">${[130, 490, 850].map((x) => `<rect x="${x + 10}" y="106" width="200" height="5"/>`).join('')}</g>
      </svg>`;
}

// BK: the galvanised shutter, painted CERRADO; shown only when the shop is closed.
export function shutter(c) {
  if (!c.THEME?.shutter) return '';
  return `<div class="shutter" aria-hidden="true"><span class="shutter__paint">CERRADO</span></div>`;
}

export function heroPoster(c) {
  return posterPicture(c, 'hero', c.COPY.posterAlt, ' data-poster="hero"');
}

// ---------------------------------------------------------------- the visit (story)

const fmtAt = (at) => (Array.isArray(at) ? at.map((n) => +Number(n).toFixed(3)).join(',') : '');

function storyNotes(c, beat) {
  const steps = (c.STORY?.steps || []).filter((s) => s.beat === beat && !s.quiet);
  return steps
    .map(
      (s) =>
        `<p class="note"${attr('data-anchor', s.anchor)}${attr('data-at', fmtAt(s.at))}${attr('data-stamp', s.stamp)}>` +
        `<span class="note__text">${esc(s.caption)}</span>` +
        (s.stamp ? `<span class="note__stamp">${esc(s.stamp)}</span>` : '') +
        `</p>`,
    )
    .join('\n            ');
}

// The figure of a beat: the engineering poster when present, else a drawing.
function beatFigure(c, posters, fallback, cls = '') {
  const pics = posters.map(([name, alt]) => posterPicture(c, name, alt, ` data-poster="${name}"`)).filter(Boolean);
  if (pics.length) return `<figure class="beat__figure beat__figure--poster${cls}">${pics.join('')}</figure>`;
  return `<figure class="beat__figure${cls}" aria-hidden="true">${fallback}</figure>`;
}

const MAQUINA_ALT = 'El lateral con los cinco escalones del degradado, antes de difuminar. | El mismo lateral, ya difuminado a mano alzada.'.split(' | ');
const NUCA_ALT = 'La nuca en el espejo de mano: degradado del 0 al 3 y contorno a navaja.';

export function storyBeats(c) {
  const spec = c.STORY?.spec || {};
  const sides = { sides: spec.sides, nape: spec.nape, top: spec.top };
  const beat = (name, notes, figure, extra = '') =>
    `
        <div class="beat beat--${name}" data-beat="${name}">
          <div class="beat__notes">
            ${notes}${extra}
          </div>
          ${figure}
        </div>`;
  return [
    beat('enter', storyNotes(c, 'enter'), beatFigure(c, [], DRAWINGS.chair)),
    beat('consult', storyNotes(c, 'consult'), beatFigure(c, [], DRAWINGS.comb)),
    beat(
      'clipper',
      storyNotes(c, 'clipper'),
      beatFigure(c, [['maquina-bandas', MAQUINA_ALT[0]], ['maquina-difuminado', MAQUINA_ALT[1]]], guiaSVG(sides, { view: 'perfil', id: 'story-perfil' }), ' beat__figure--guia'),
    ),
    beat('scissors', storyNotes(c, 'scissors'), beatFigure(c, [], DRAWINGS.scissors)),
    beat('razor', storyNotes(c, 'razor'), beatFigure(c, [], DRAWINGS.razor)),
    beat(
      'mirror',
      `<p class="spoken">${esc(storyLine(c, 'mirror') || 'Así te queda por detrás.')}</p>`,
      beatFigure(
        c,
        [['nuca', NUCA_ALT]],
        `<div class="beat__hand">${DRAWINGS.mirror}<span class="beat__hand-guia">${guiaSVG(sides, { view: 'nuca', id: 'story-nuca' })}</span></div>`,
        ' beat__figure--mirror',
      ),
      `
            <p class="hint" data-coarse="Desliza el dedo para mover el espejo.">Arrastra para mover el espejo.</p>
            <div class="hand-mirror__slider" id="hand-mirror-slider" role="slider" tabindex="0" aria-label="Ángulo del espejo de mano" aria-valuemin="-35" aria-valuemax="35" aria-valuenow="0" aria-valuetext="0°"><span class="hand-mirror__track"></span><span class="hand-mirror__thumb"></span></div>
            <button type="button" class="textbtn" id="mirror-tilt" hidden>Moverlo con el móvil</button>
            <svg id="hand-mirror-mask" class="hand-mirror__mask" viewBox="0 0 100 120" aria-hidden="true" focusable="false"><ellipse cx="50" cy="58" rx="44" ry="54" fill="none" stroke="currentColor" stroke-width="2"/><ellipse cx="50" cy="58" rx="41" ry="51" fill="none" stroke="currentColor" stroke-width="0.6"/></svg>`,
    ),
  ].join('');
}

function storyLine(c, beat) {
  return (c.STORY?.steps || []).find((s) => s.beat === beat)?.caption;
}

// ---------------------------------------------------------------- Carta de cortes

function cartaPrograms(c) {
  const all = [...c.CUTS, ...c.BEARDS];
  return [...(c.CARTA?.cuts || []), ...(c.CARTA?.beards || [])].map((id) => all.find((p) => p.id === id)).filter(Boolean);
}

const TICK = `<svg class="plate__tick" viewBox="0 0 28 22" aria-hidden="true"><path d="M3 12.5C6 14 8.5 16.5 10.5 19.5C14 11 19 5.5 25.5 2.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;

function plateImage(p) {
  if (exists(`src/plates/${p.id}.webp`)) {
    return `<picture class="plate__img"><img src="/src/plates/${p.id}.webp" alt="" width="160" height="160" decoding="async" loading="lazy"></picture>`;
  }
  return `<span class="plate__img">${plateSVG(p.spec)}</span>`;
}

function plate(p, name, checked) {
  const id = `${name}-${p.id}`;
  return `
              <label class="plate" for="${id}">
                <input type="radio" name="${name}" id="${id}" value="${esc(p.id)}"${checked ? ' checked' : ''}>
                ${plateImage(p)}${TICK}
                <span class="plate__n">Nº ${p.n}</span>
                <span class="plate__name">${esc(p.name)}</span>${p.alias ? `\n                <span class="plate__alias" lang="en">${esc(p.alias)}</span>` : ''}
              </label>`;
}

/** The chart: one fieldset of plates per family (name=corte), then the beards (name=barba). */
export function cartaPlates(c) {
  const story = c.STORY_CUT || {};
  const progs = cartaPrograms(c).filter((p) => p.ready !== false);
  const cuts = progs.filter((p) => p.kind === 'cut');
  const beards = progs.filter((p) => p.kind === 'beard');
  const out = [];
  for (const fam of FAMILIES.filter((f) => f.id !== 'barba')) {
    const list = cuts.filter((p) => p.family === fam.id);
    if (!list.length) continue;
    out.push(`
            <fieldset class="family family--${fam.id}">
              <legend class="family__name">${esc(fam.label)}</legend>
              <div class="family__plates">${list.map((p) => plate(p, 'corte', p.id === story.hair)).join('')}
              </div>
            </fieldset>`);
  }
  if (beards.length) {
    const barba = FAMILIES.find((f) => f.id === 'barba');
    out.push(`
            <fieldset class="family family--barba">
              <legend class="family__name">${esc(barba?.label || 'Barba')}</legend>
              <div class="family__plates">${beards.map((p) => plate(p, 'barba', p.id === story.beard)).join('')}
              </div>
              <label class="plate plate--none" for="barba-none"><input type="radio" name="barba" id="barba-none" value="none"><span class="plate__name">Sin barba</span></label>
            </fieldset>`);
  }
  return out.join('');
}

/** 'Compón tu corte': ruled radio rows per ingredient, from the client's INGREDIENTS. */
export function composerFieldsets(c) {
  return (c.INGREDIENTS || [])
    .map((g) => {
      const fields = g.fields
        .map((f) => {
          const opts = f.options.filter((o) => o.ready !== false);
          if (!opts.length) return '';
          const rows = opts
            .map((o) => {
              const id = `mix-${f.key.replace(/\W+/g, '-')}-${String(o.id).replace(/\W+/g, '-')}`;
              return `<label class="rule" for="${id}"><input type="radio" name="${esc(f.key)}" id="${id}" value="${esc(o.id)}"><span>${esc(o.label)}</span></label>`;
            })
            .join('');
          const sub = g.fields.length > 1 ? `<p class="composer__label">${esc(f.label)}</p>` : '';
          return `${sub}<div class="composer__rules">${rows}</div>`;
        })
        .join('');
      return `
              <fieldset class="composer__part" data-part="${esc(g.part)}">
                <legend>${esc(g.legend)}</legend>
                ${fields}
              </fieldset>`;
    })
    .join('');
}

// One recipe card per Carta program, as <template data-recipe="{id}">: the Carta
// and the player clone them, so the card in the page source and the one built at
// runtime (src/cuts/recipe.js) are the same HTML.
export function recipeTemplates(c) {
  return cartaPrograms(c)
    .map((p) => `<template data-recipe="${esc(p.id)}">${renderRecipe(p, c)}</template>`)
    .join('\n');
}

// The same cards for the page without JS (inside <noscript>): only the ready
// looks, without per-card ids. A CSS rule per card shows the one whose plate is
// checked, so the chart still works with no script at all.
export function recipeList(c) {
  const progs = cartaPrograms(c).filter((p) => p.ready !== false);
  const cards = progs.map((p) => renderRecipe(p, c, { idPrefix: 'receta-lista', bookId: null })).join('\n');
  const rules = progs
    .map((p) => {
      const name = p.kind === 'beard' ? 'barba' : 'corte';
      return `#carta:has(input[name="${name}"][value="${p.id}"]:checked) .carta__nojs .recipe[data-program="${p.id}"]`;
    })
    .join(',\n');
  return `<style>@supports selector(:has(a)){.carta__nojs .recipe{display:none}${rules}{display:block}}</style>
          <div class="carta__nojs">${cards}</div>`;
}

// ---------------------------------------------------------------- tarifa

function serviceRow(s) {
  return (
    `<span class="row__name">${esc(s.name)}</span>` +
    `<span class="row__min">${s.minutes} min</span>` +
    `<span class="row__price">${esc(priceLabel(s.price, s.from))}</span>`
  );
}

function reviewPin(r, cls = '') {
  return `<figure class="pin${cls}">
                <blockquote lang="${esc(r.lang || 'es')}"><p>“${esc(r.text)}”</p></blockquote>
                <figcaption>${esc(r.name)} · ${esc(r.source)}</figcaption>
              </figure>`;
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function longDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return `${d} de ${MONTHS[m - 1]} de ${y}`;
}

/** The board: one line per service (name, minutes, price); BK review pins next to the service they mention. */
export function tarifaBoard(c) {
  const reviews = c.REVIEWS || [];
  const rows = c.SERVICES.map((s) => {
    const pins = reviews.filter((r) => r.about === s.id).map((r) => reviewPin(r)).join('');
    return `
            <li class="board__row" data-service="${esc(s.id)}">${serviceRow(s)}${pins ? `\n              <div class="board__pins">${pins}</div>` : ''}</li>`;
  }).join('');
  return rows;
}

export function tarifaFoot(c) {
  const reviews = c.REVIEWS || [];
  const loose = reviews.filter((r) => !r.about || !c.SERVICES.some((s) => s.id === r.about));
  const ratings = (c.RATINGS || []).map((r) => `${esc(r.source)} ${esc(r.score)} · ${r.count} reseñas`);
  const line = ratings.length
    ? `<p class="tarifa__ratings">${ratings.join(' — ')}${c.RATINGS_AS_OF ? ` · consultado el <time datetime="${esc(c.RATINGS_AS_OF)}">${longDate(c.RATINGS_AS_OF)}</time>` : ''}</p>`
    : '';
  const intro = reviews.length && c.COPY.reviewsIntro ? `<p class="tarifa__reviews-intro">${esc(c.COPY.reviewsIntro)}</p>` : '';
  const pins = loose.map((r) => reviewPin(r, ' pin--foot')).join('');
  if (!line && !intro && !pins) return '';
  return `
          <div class="tarifa__foot">
            ${pins}
            <div class="tarifa__source">${intro}${line}</div>
          </div>`;
}

export function tarifaIncludes(c) {
  return c.SERVICES.map((s) => `<div class="includes__row"><dt>${esc(s.name)}</dt><dd>${esc(s.desc)}</dd></div>`).join('');
}

// ---------------------------------------------------------------- las sillas (CR)

function floorPlan(c) {
  const names = c.BARBERS.map((b) => b.name);
  // Front of the shop at the bottom (window and door), mirror wall on the left;
  // the first chair is by the window, the last at the back.
  const ys = [176, 118, 60];
  const chairs = ys
    .slice(0, names.length)
    .map(
      (y, i) =>
        `<rect x="18" y="${y - 22}" width="5" height="44"/><g transform="translate(52 ${y})"><rect x="-13" y="-13" width="26" height="26" rx="5"/><path d="M13 -13Q22 0 13 13M-9 -16H9M-9 16H9"/></g>` +
        `<text x="84" y="${y + 5}" stroke="none" fill="currentColor">${esc(names[i])}</text>`,
    )
    .join('');
  return `<svg class="plan" viewBox="0 0 360 250" role="img" aria-label="Plano de la barbería: ${esc(c.BARBERS.map((b) => `${b.chair}, ${b.name}`).join('; '))}">
            <g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <path d="M228 236H350V12H12V236H24" stroke-width="2.5"/>
              <path d="M24 236H200M24 230H200" stroke-width="1"/><path d="M200 230V236"/>
              <path d="M260 236V184M260 184A52 52 0 0 1 312 236" stroke-width="1" stroke-dasharray="2 3"/>
              <path d="M312 236H350" stroke-width="2.5"/>
              <rect x="318" y="66" width="20" height="104" rx="2" stroke-width="1"/>
              <rect x="226" y="22" width="104" height="22" rx="2" stroke-width="1"/>
              ${chairs}
            </g>
          </svg>`;
}

export function sillasSection(c) {
  if (!c.BARBERS?.length) return '';
  const rows = c.BARBERS.map(
    (b) => `
            <li class="ledger__row">
              <span class="ledger__tool">${DRAWINGS[b.tool] || ''}</span>
              <p class="ledger__chair">${esc(b.chair)}</p>
              <p class="ledger__name">${esc(b.name)}</p>
              <p class="ledger__days">${esc(b.days)}</p>
              <p class="ledger__known">${esc(b.knownFor)}</p>
              <button type="button" class="textbtn ledger__see" data-cut="${esc(b.signatureCut)}" data-barber="${esc(b.id)}">${esc(b.signatureLabel)}</button>
            </li>`,
  ).join('');
  return `
      <section id="sillas" class="sillas" aria-labelledby="sillas-title">
        <h2 id="sillas-title" class="title">Las sillas</h2>
        <div class="sillas__grid">
          ${floorPlan(c)}
          <ol class="ledger">${rows}
          </ol>
        </div>
      </section>`;
}

// ---------------------------------------------------------------- pide hora

export function bookingServices(c) {
  return c.SERVICES.map(
    (s) => `
                <label class="line line--service" for="service-${esc(s.id)}">
                  <input type="radio" name="service" id="service-${esc(s.id)}" value="${esc(s.id)}">
                  ${serviceRow(s)}
                </label>`,
  ).join('');
}

export function bookingBarbers(c) {
  if (!c.BARBERS?.length) return '';
  const all = [{ id: 'any', name: 'Me da igual' }, ...c.BARBERS];
  const opts = all
    .map(
      (b) =>
        `<label class="line line--barber" for="barber-${esc(b.id)}"><input type="radio" name="barber" id="barber-${esc(b.id)}" value="${esc(b.id)}"${b.id === 'any' ? ' checked' : ''}><span class="row__name">${esc(b.name)}</span>${b.chair ? `<span class="row__note">${esc(b.chair)}</span>` : ''}</label>`,
    )
    .join('\n                ');
  return `
              <fieldset class="book__group book__group--barber">
                <legend>Con quién</legend>
                ${opts}
              </fieldset>`;
}

function waBase(c) {
  const n = c.BOOKING?.whatsapp || c.BRAND.whatsapp;
  return n ? `https://wa.me/${n}` : null;
}
const localPhone = (c) => String(c.BRAND.phone).replace(/^\+34\s*/, '');

/** The fields only one mode has: the móvil (CR demo). */
export function bookingPhone(c) {
  if (c.BOOKING?.mode === 'whatsapp') return '';
  return `
                <label class="field" for="book-phone">
                  <span class="field__label">Móvil</span>
                  <input type="tel" id="book-phone" name="phone" autocomplete="tel" inputmode="tel" placeholder="${esc(c.COPY.phonePlaceholder || '600 123 456')}">
                </label>`;
}

/** The action: BK opens WhatsApp with the message (motion builds the text); CR 'Apúntame'. */
export function bookingAction(c) {
  if (c.BOOKING?.mode === 'whatsapp') {
    const tw = c.BOOKING.treatwell || c.BRAND.treatwell;
    return `
              <a class="cta cta--book" id="book-wa" href="${esc(waBase(c))}" target="_blank" rel="noopener" aria-disabled="true">${esc(c.COPY.bookCta)}</a>
              <p class="book__ctanote">${esc(c.COPY.bookCtaNote)}</p>
              <p class="book__alt">${esc(c.COPY.treatwellLead)} <a href="${esc(tw)}" target="_blank" rel="noopener">${esc(c.COPY.treatwellLink)}</a> · <a href="${esc(c.BRAND.phoneHref)}">${esc(c.COPY.callLink)}</a></p>`;
  }
  return `
              <button type="submit" class="cta cta--book" id="book-submit">${esc(c.COPY.bookCta || 'Apúntame')}</button>`;
}

// The page without JS: plain links that book (BK WhatsApp without text,
// Treatwell, the phone; CR the phone).
export function bookingNoScript(c) {
  let links;
  if (c.BOOKING?.mode === 'whatsapp') {
    const tw = c.BOOKING.treatwell || c.BRAND.treatwell;
    links = `<a class="cta" href="${esc(waBase(c))}" target="_blank" rel="noopener">Escribir por WhatsApp</a>
                <a href="${esc(tw)}" target="_blank" rel="noopener">Reservar en Treatwell</a>
                <a href="${esc(c.BRAND.phoneHref)}">Llamar al ${esc(localPhone(c))}</a>`;
  } else {
    links = `<a class="cta" href="${esc(c.BRAND.phoneHref)}">Llamar al ${esc(localPhone(c))}</a>`;
  }
  return `<noscript>
              <div class="book__nojs">
                <p class="book__nojs-lead">Para pedir hora:</p>
                ${links}
              </div>
            </noscript>`;
}

/** The cream appointment card, hidden until the book is sent. */
export function bookingCard(c) {
  const wa = c.BOOKING?.mode === 'whatsapp';
  const tw = c.BOOKING?.treatwell || c.BRAND.treatwell;
  const rows = [
    ['day', 'Día'],
    ['time', 'Hora'],
    ['service', 'Servicio'],
    ['cut', 'Corte'],
    ['with', 'Con'],
    ['name', 'Nombre'],
  ]
    .map(([k, l]) => `<div class="card__row card__row--${k}"><dt>${l}</dt><dd id="card-${k}"></dd></div>`)
    .join('');
  const actions = wa
    ? `<button type="button" class="textbtn" id="card-copy">Copiar mensaje</button>
                <a class="textbtn" id="card-call" href="${esc(c.BRAND.phoneHref)}">Llamar</a>
                <a class="textbtn" id="card-treatwell" href="${esc(tw)}" target="_blank" rel="noopener">Reservar en Treatwell</a>
                <button type="button" class="textbtn" id="card-change">Cambiar algo</button>`
    : `<a class="textbtn" id="card-call" href="${esc(c.BRAND.phoneHref)}">Llamar</a>
                <button type="button" class="textbtn" id="card-again">${esc(c.COPY.doneAgain || 'Pedir otra hora')}</button>`;
  return `
          <div class="card" id="book-card" hidden tabindex="-1" aria-labelledby="card-title">
            <div class="card__front">
              <p class="card__header">PRÓXIMA CITA · ${esc(c.BRAND.name.toUpperCase())}</p>
              <dl class="card__rows">${rows}</dl>
              <div class="card__back">
                <p class="card__ficha"><span class="card__k">Para el barbero:</span> <span id="card-ficha"></span></p>
              </div>
            </div>
            <div class="card__text">
              <h3 class="card__title" id="card-title">${wa ? esc(c.COPY.doneTitle) : ''}</h3>
              <p class="card__body" id="card-body">${wa ? esc(c.COPY.doneBody) : ''}</p>
              ${wa ? `<p class="card__fallback">${esc(c.COPY.doneFallback)}</p>` : `<p class="card__demo" id="card-demo">${esc(c.COPY.doneDemo)}</p>`}
              <div class="card__actions">
                ${actions}
              </div>
            </div>
          </div>`;
}

// ---------------------------------------------------------------- la puerta

export function doorBlock(c) {
  const B = c.BRAND;
  const links = [];
  if (c.BOOKING?.mode === 'whatsapp') {
    links.push(`<a href="${esc(waBase(c))}" target="_blank" rel="noopener">WhatsApp</a>`);
    if (B.treatwell) links.push(`<a href="${esc(B.treatwell)}" target="_blank" rel="noopener">Treatwell</a>`);
  }
  if (B.instagram) links.push(`<span class="selectable">${esc(B.instagram)}</span>`);
  const transit = B.transit
    ? (() => {
        const [line, ...rest] = B.transit.split(' ');
        return `<p class="door__transit"><span class="door__metro">${esc(line)}</span> ${esc(rest.join(' '))}</p>`;
      })()
    : '';
  const notice = c.PITCH ? c.PITCH.door : c.EXAMPLE_NOTICE;
  return `
        <div class="door__glass">
          <p class="door__number" aria-hidden="true">${esc(B.number)}</p>
          <div class="door__vinyl">
            <h2 class="door__name">${esc(B.name)}</h2>
            <p class="door__address">${esc(c.COPY.doorAddress)}</p>
            <p class="door__hours">${esc(c.COPY.doorHours)}</p>
            ${transit}
            ${links.length ? `<p class="door__links">${links.join(' · ')}</p>` : ''}
          </div>
          <p class="door-sign door-sign--door" data-door-sign></p>
          <span class="door__handle" aria-hidden="true"></span>
        </div>
        <div class="door__step">
          <a class="cta cta--call" href="${esc(B.phoneHref)}">Llamar <span class="cta__sub">${esc(localPhone(c))}</span></a>
          ${notice ? `<p class="door__notice">${esc(notice)}</p>` : ''}
        </div>`;
}

export function hoursRows(c) {
  return c.HOURS_TABLE.map(([d, h]) => `<div class="hours__row"><dt>${esc(d)}</dt><dd>${esc(h)}</dd></div>`).join('');
}

// ---------------------------------------------------------------- schema.org

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LANGS = { español: 'es', inglés: 'en', francés: 'fr', árabe: 'ar' };

export function jsonLd(c) {
  const B = c.BRAND;
  // Days with known hours only ('consultar' and closed days are left out).
  const byHours = new Map();
  for (const [d, h] of Object.entries(c.OPENING)) {
    if (!Array.isArray(h)) continue;
    const k = h.join('-');
    if (!byHours.has(k)) byHours.set(k, { opens: h[0], closes: h[1], days: [] });
    byHours.get(k).days.push(`https://schema.org/${WEEKDAYS[d]}`);
  }
  const data = {
    '@context': 'https://schema.org',
    '@type': 'BarberShop',
    name: B.name,
    telephone: B.phone,
    priceRange: B.priceRange,
    currenciesAccepted: 'EUR',
    address: {
      '@type': 'PostalAddress',
      streetAddress: B.street,
      postalCode: B.postalCode,
      addressLocality: B.city,
      addressRegion: B.area,
      addressCountry: 'ES',
    },
    openingHoursSpecification: [...byHours.values()].map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: h.days,
      opens: h.opens,
      closes: h.closes,
    })),
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Tarifa',
      itemListElement: c.SERVICES.map((s) => ({
        '@type': 'Offer',
        ...(s.price != null
          ? s.from
            ? { priceSpecification: { '@type': 'PriceSpecification', minPrice: s.price, priceCurrency: 'EUR' } }
            : { price: s.price, priceCurrency: 'EUR' }
          : {}),
        itemOffered: { '@type': 'Service', name: s.name, description: s.desc },
      })),
    },
  };
  // The languages line of the facts, when there is one (BK).
  const langs = Object.entries(LANGS)
    .filter(([w]) => c.COPY.facts.some((f) => f.includes(w)))
    .map(([, code]) => code);
  if (langs.length > 1) data.knowsLanguage = langs;
  if (B.url) data.url = B.url;
  const sameAs = [B.treatwell].filter(Boolean);
  if (sameAs.length) data.sameAs = sameAs;
  if (c.BOOKING?.mode === 'whatsapp' && B.treatwell) {
    data.potentialAction = { '@type': 'ReserveAction', target: B.treatwell };
  }
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

// ---------------------------------------------------------------- page

// Replaces <!--@name--> markers and {{brand.*}} / {{copy.*}} / {{site.*}} tokens in index.html.
export function renderPage(html, c) {
  const blocks = {
    theme: themeStyle,
    jsonld: jsonLd,
    navLinks,
    pitch: pitchStrip,
    sign: signLines,
    heroFacts,
    shopInterior,
    wall,
    slotsHint,
    shutter,
    heroPoster,
    story: storyBeats,
    cartaPlates,
    composer: composerFieldsets,
    recipes: recipeTemplates,
    recipeList,
    tarifa: tarifaBoard,
    tarifaFoot,
    includes: tarifaIncludes,
    sillas: sillasSection,
    bookingServices,
    bookingBarbers,
    bookingPhone,
    bookingAction,
    bookingNoScript,
    bookingCard,
    hours: hoursRows,
    door: doorBlock,
  };
  const S = site(c);
  let out = html.replace(/<!--@(\w+)-->/g, (m, name) => (blocks[name] ? blocks[name](c) : m));
  out = out.replace(/\{\{(brand|copy|site)\.(\w+)\}\}/g, (m, group, k) => {
    const src = group === 'brand' ? c.BRAND : group === 'copy' ? c.COPY : S;
    return k in src && src[k] != null ? esc(src[k]) : '';
  });
  return out;
}

