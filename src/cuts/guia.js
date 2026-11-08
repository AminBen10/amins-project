// The guía de corte: a fixed profile and back-of-head drawing with the program's
// bands labelled by guard number, the top length, the part line and the beard
// zones. Stroke-only, in currentColor (ink on the recipe card's paper). Drawn
// from the Spec alone, at build time and in the browser, with no DOM.
// plateSVG(spec) is the Carta plate fallback: a monochrome profile silhouette
// with the cut engraved in paper-coloured lines.
import { nominalMM } from './catalog.js';
import { guardLabel } from './ficha.js';

const r1 = (n) => Math.round(n * 10) / 10;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Height on the drawing (y, viewBox units) for a Height {lm, dedos}. Landmarks sit
// where they are on the drawn head; fingers interpolate between them. The edge of a
// taper (NUCA + fingers) gets its own scale so each finger stays readable.
const Y_AT = [
  [0, 155],
  [45, 114],
  [75, 90],
  [110, 62],
  [150, 24],
];
function yOf(h) {
  if (h.lm === 'NUCA') return 147 - 10 * (h.dedos || 0);
  const mm = nominalMM(h);
  for (let i = 1; i < Y_AT.length; i++) {
    const [m0, y0] = Y_AT[i - 1];
    const [m1, y1] = Y_AT[i];
    if (mm <= m1 || i === Y_AT.length - 1) return r1(y0 + ((mm - m0) / (m1 - m0)) * (y1 - y0));
  }
  return 155;
}
const NAPE_Y = 155;

// Profile, facing left: head and neck; the hair of the side and back, bounded by
// the hairline (forehead, temple, sideburn, behind the ear, nape), which is also
// the clip for the bands; the ear, filled with paper so the bands pass behind it.
const SCALP = 'Q70 24 98 22Q134 22 146 58Q154 90 148 118Q144 140 133 155';
const HEAD = `M64 200L60 176Q50 172 46 166Q40 160 42 152Q40 147 37 145Q33 142 36 139L35 134Q33 131 38 128L28 123Q26 120 28 118L37 103Q42 98 41 92Q37 68 52 50${SCALP}Q127 164 127 176L129 200`;
const HAIRLINE = 'L112 151L101 138L95 112L89 84L74 62z';
const HAIR = `M52 50${SCALP}${HAIRLINE}`;
const EAR = 'M104 112q15-4 16 14q1 17-12 20q-7 0-7-8q3-13 3-26z';
const FACE = 'M46 164Q76 166 102 146M45 104q4-2 9 0';
// Back of the head; the hair region's bottom edge follows the nape shape.
const BACK = 'M56 200L54 168Q44 160 40 146Q26 124 26 92Q26 26 80 24Q134 26 134 92Q134 124 120 146Q116 160 106 168L104 200M27 110q-12-3-13 13q1 17 14 20M133 110q12-3 13 13q-1 17-14 20';
const BACK_HAIR = 'M40 146Q26 124 26 92Q26 26 80 24Q134 26 134 92Q134 124 120 146';
const NAPE = {
  natural: 'Q114 155 104 157Q80 152 56 157Q46 155 40 146z',
  square: 'L117 157H43z',
  round: 'Q112 162 80 162Q48 162 40 146z',
  long: 'Q124 174 114 192H46Q36 174 40 146z',
};

const mmText = (mm) => (mm >= 10 ? `${String(r1(mm / 10)).replace('.', ',')} cm` : `${String(r1(mm)).replace('.', ',')} mm`);
const zoneText = (v) => (typeof v === 'number' ? mmText(v) : guardLabel(v));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// A short id for clip paths, the same for the same drawing (no counters, so the
// server and the browser agree).
function hashId(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `g${(h >>> 0).toString(36)}`;
}

function text(x, y, s, anchor) {
  return `<text x="${r1(x)}" y="${r1(y)}"${anchor ? ` text-anchor="${anchor}"` : ''}>${esc(s)}</text>`;
}

// Band boundaries (y of each band's top) and label positions, bottom → top.
function bandLayout(sides) {
  const out = [];
  let below = NAPE_Y;
  for (const b of sides.bands || []) {
    const y = yOf(b.upTo);
    out.push({ guard: b.guard, y, mid: (below + y) / 2 });
    below = y;
  }
  return out;
}

// The top: a dashed outline of the hair over the scalp (front → crown) and a
// dimension line with the length above it.
function topMarks(top) {
  const f = clamp(top.frontMM * 0.2, 1.5, 22);
  const k = clamp(top.crownMM * 0.2, 1.5, 22);
  const t = (f + k) / 2 + (top.lift || 0) * 4;
  const lift = top.lift || 0;
  const F = { up: [52 - f * 0.4, 50 - f * (1.1 + lift)], forward: [52 - f, 54 + f * 0.3], down: [52 - f * 0.6, 54 + f * 0.8] }[top.fringe] || [52 - f * 0.6, 50 - f * 0.7];
  const K = [144 + k * 0.75, 52 - k * 0.65];
  const T = [98, 22 - t];
  const cx = 2 * T[0] - (F[0] + K[0]) / 2;
  const cy = 2 * T[1] - (F[1] + K[1]) / 2;
  const lo = Math.min(top.frontMM, top.crownMM);
  const hi = Math.max(top.frontMM, top.crownMM);
  const label = lo === hi || hi - lo < 3 ? mmText(hi) : `${mmText(lo).replace(/ (mm|cm)$/, '')}–${mmText(hi)}`;
  const y0 = 22;
  const y1 = r1(Math.min(y0 - 5, T[1]));
  const curve = `M${r1(F[0])} ${r1(F[1])}Q${r1(cx)} ${r1(cy)} ${r1(K[0])} ${r1(K[1])}`;
  return {
    curve,
    path: `<path stroke-dasharray="2 2" d="${curve}"/>`,
    dim: `<path d="M98 ${y0}V${y1}M95 ${y1}h6M95 ${y0}h6"/>`,
    label: text(98, y1 - 4, label, 'middle'),
    text: label,
  };
}

function beardMarks(beard) {
  if (!beard || beard.style === 'none') return { lines: '', labels: '' };
  const z = beard.zones || {};
  const labels = [];
  if (beard.style === 'shaved') return { lines: '', labels: text(72, 142, 'navaja', 'middle') };
  // Candado: moustache and chin joined round the mouth; cheeks and neck shaved.
  if (beard.style === 'goatee') {
    return {
      lines: '<path d="M36 135q5-2 10 1M46 136Q55 140 53 152Q51 166 44 168"/>',
      labels: text(38, 176, beard.lenMM ? mmText(beard.lenMM) : zoneText(z.barbilla), 'end') + text(76, 142, 'navaja', 'middle'),
    };
  }
  const neckY = 194 - 8 * (beard.neckDedos || 0);
  let lines = beard.cheek === 'perfilada' ? 'M95 120L46 135' : 'M95 120Q70 116 45 136';
  lines += `M102 148Q88 ${r1(neckY - 4)} 60 ${neckY}`;
  if (z.bigote != null) lines += 'M36 135q5-2 10 1';
  const vals = Object.values(z).filter((v) => v != null);
  const same = vals.every((v) => v === vals[0]);
  if (beard.style === 'stubble' && beard.lenMM) labels.push(text(72, 142, mmText(beard.lenMM), 'middle'));
  else if (same && vals.length) labels.push(text(72, 142, zoneText(vals[0]), 'middle'));
  else {
    if (z.mejilla != null) labels.push(text(72, 142, zoneText(z.mejilla), 'middle'));
    if (z.barbilla != null) labels.push(text(38, 174, zoneText(z.barbilla), 'end'));
    if (z.bigote != null) labels.push(text(32, 138, zoneText(z.bigote), 'end'));
    if (z.cuello != null && beard.neckDedos) labels.push(text(86, r1(neckY - 4), zoneText(z.cuello), 'middle'));
  }
  return { lines: `<path d="${lines}"/>`, labels: labels.join('') };
}

function profile(spec, id) {
  const parts = [];
  const labels = [];
  parts.push(`<path d="${HEAD}"/><path d="${FACE}"/>`);
  const sides = spec.sides;
  if (sides) {
    parts.push(`<clipPath id="${id}p"><path d="${HAIR}"/></clipPath><path d="${HAIR}"/>`);
    const bands = bandLayout(sides);
    if (sides.shape === 'burst') {
      const r = bands.map((b) => r1(20 + (nominalMM(sides.bands[bands.indexOf(b)].upTo) - 45) * 0.75));
      parts.push(`<g clip-path="url(#${id}p)">${r.map((x) => `<circle cx="112" cy="128" r="${x}"/>`).join('')}</g>`);
      r.forEach((x, i) => {
        const m = (x + (i ? r[i - 1] : 12)) / 2;
        labels.push(text(112 + m * 0.6, 128 - m * 0.8 + 3.5, guardLabel(bands[i].guard), 'middle'));
      });
    } else {
      const lines = sides.shape === 'uniform' ? [] : bands.map((b) => `M40 ${b.y}H150`);
      if (lines.length) parts.push(`<path clip-path="url(#${id}p)" d="${lines.join('')}"/>`);
      for (const b of bands) labels.push(text(129, b.mid + 3.5, guardLabel(b.guard), 'middle'));
    }
    parts.push(`<path d="${EAR}" style="fill:var(--paper,#EFE7D6)"/>`);
  } else {
    parts.push(`<path d="${EAR}"/>`);
  }
  if (spec.top) {
    const t = topMarks(spec.top);
    parts.push(t.path, t.dim);
    labels.push(t.label);
    if (spec.top.part) parts.push(`<path${spec.top.part.hard ? '' : ' stroke-dasharray="3 3"'} d="M58 44Q80 29 110 27"/>`);
  }
  const b = beardMarks(spec.beard);
  parts.push(b.lines);
  if (b.labels) labels.push(b.labels);
  return { body: parts.join(''), labels: labels.join('') };
}

function back(spec, id) {
  const parts = [`<path d="${BACK}"/>`];
  const labels = [];
  const sides = spec.sides;
  const nape = spec.nape?.shape || 'natural';
  if (sides || spec.nape) {
    const hair = `${BACK_HAIR}${NAPE[nape] || NAPE.natural}`;
    parts.push(`<clipPath id="${id}b"><path d="${hair}"/></clipPath><path d="${hair}"/>`);
    if (sides) {
      const bands = bandLayout(sides);
      // A burst and a mullet leave the nape long: from behind there are no bands.
      if (sides.shape !== 'burst' && nape !== 'long') {
        const lines = sides.shape === 'uniform' ? [] : bands.map((b) => `M20 ${b.y}H140`);
        if (lines.length) parts.push(`<path clip-path="url(#${id}b)" d="${lines.join('')}"/>`);
        for (const b of bands) labels.push(text(80, b.mid + 3.5, guardLabel(b.guard), 'middle'));
      }
    }
    if (nape === 'long' && spec.nape.lenMM) labels.push(text(80, 182, mmText(spec.nape.lenMM), 'middle'));
  }
  return { body: parts.join(''), labels: labels.join('') };
}

function describe(spec) {
  const out = [];
  if (spec.sides?.bands?.length) out.push(`Lados, de abajo arriba: ${spec.sides.bands.map((b) => guardLabel(b.guard)).join(', ')}.`);
  if (spec.top) out.push(`Arriba: ${topMarks(spec.top).text}.`);
  if (spec.beard && spec.beard.style !== 'none') out.push('Zonas de la barba.');
  return `Guía de corte. ${out.join(' ')}`.trim();
}

/**
 * The guía de corte for a Spec. view: 'perfil' | 'nuca' | 'both' (side by side).
 * opts.id overrides the clip-path id prefix.
 */
export function guiaSVG(spec, { view = 'both', id } = {}) {
  const s = spec || {};
  const key = id || hashId(JSON.stringify(s) + view);
  const views = view === 'both' ? ['perfil', 'nuca'] : [view === 'nuca' ? 'nuca' : 'perfil'];
  const w = 160 * views.length;
  const body = [];
  const labels = [];
  views.forEach((v, i) => {
    const d = v === 'nuca' ? back(s, key) : profile(s, key);
    const tr = i ? ` transform="translate(${160 * i})"` : '';
    body.push(`<g${tr}>${d.body}</g>`);
    if (d.labels) labels.push(`<g${tr}>${d.labels}</g>`);
  });
  return (
    `<svg class="guia" viewBox="0 -14 ${w} 214" width="${w}" height="214" role="img" aria-label="${esc(describe(s))}">` +
    `<g fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${body.join('')}</g>` +
    `<g fill="currentColor" font-size="10.5" font-family="'Barlow Condensed','Barlow Condensed Fallback',sans-serif">${labels.join('')}</g></svg>`
  );
}

/**
 * Plate fallback for the Carta: the head in profile as an ink silhouette (hair
 * volume and long nape included), with the hairline, the bands and the beard line
 * engraved in paper colour. Square, for a 160 px plate.
 */
export function plateSVG(spec) {
  const s = spec || {};
  const fill = [`<path d="${HEAD}L64 200z"/>`];
  // The hair over the scalp: the top outline, then back along the scalp.
  if (s.top) fill.push(`<path d="${topMarks(s.top).curve}L146 58Q134 22 98 22Q70 24 52 50z"/>`);
  if (s.nape?.shape === 'long') {
    const l = r1(clamp((s.nape.lenMM || 50) * 0.35, 8, 32));
    fill.push(`<path d="M146 112Q150 ${r1(150 + l * 0.5)} ${r1(141 + l * 0.15)} ${r1(160 + l)}L127 ${r1(166 + l * 0.6)}Q127 162 133 155z"/>`);
  }
  const lines = [`<path d="M133 155${HAIRLINE.replace(/z$/, '')}L52 50"/>`, `<path d="${EAR}"/>`];
  if (s.sides && s.sides.shape !== 'uniform' && s.sides.shape !== 'burst') {
    const id = hashId(JSON.stringify(s) + 'plate');
    lines.push(`<clipPath id="${id}"><path d="${HAIR}"/></clipPath><path clip-path="url(#${id})" stroke-dasharray="1 2" d="${bandLayout(s.sides).map((b) => `M40 ${b.y}H150`).join('')}"/>`);
  }
  if (s.beard && s.beard.style !== 'none' && s.beard.style !== 'shaved') lines.push(beardMarks({ ...s.beard, zones: {} }).lines);
  return (
    `<svg class="plate" viewBox="-12 -8 184 184" width="160" height="160" aria-hidden="true">` +
    `<g fill="currentColor">${fill.join('')}</g>` +
    `<g fill="none" style="stroke:var(--paper,#EFE7D6)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${lines.join('')}</g></svg>`
  );
}
