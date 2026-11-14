// The Carta plate: a 96 px line engraving of a cut in profile, drawn from the same
// head as the guía (guia.js). Build time only (content.js): the browser never loads it.
import { nominalMM } from './catalog.js';
import { guardMM } from './ficha.js';
import { HEAD, HAIRLINE, HAIR, EAR, FACE, SCALP, NAPE_Y, hashId, bandLayout, topMarks, r1, clamp } from './guia.js';

// ---------------------------------------------------------------- the engraved plate
// Line engraving, as on a printed barber's chart: the head drawn in ink line, the
// hair laid in with hatching whose density is the guard (skin bare, the 0 a few
// strokes, the 3 close strokes, scissor lengths cross-hatched). The fade height, the
// burst arc, the long nape and the beard zones are read from the bands themselves,
// so Nº 1, 2 and 3 differ where the tone changes. Stroke only: no solid fills.

const HATCH_W = 1.15; // ~0.6 px on a 96 px plate
const LINE_W = 1.7;
const INK = `fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"`;

// Distance between hatch strokes (viewBox units) for a hair length in mm; null = skin.
function spacingFor(mm) {
  if (mm == null || mm <= 0.2) return null;
  if (mm <= 1) return 4.8;
  if (mm <= 2) return 3.9;
  if (mm <= 4) return 3.1;
  if (mm <= 7) return 2.5;
  if (mm <= 11) return 2.05;
  if (mm <= 16) return 1.85;
  return 1.7;
}
const zoneMM = (v, guards) => (typeof v === 'number' ? v : guardMM(v, guards));

// Hair direction on the top, by how it is combed (profile facing left).
const TOP_ANGLE = { up: -72, back: -12, forward: 32, down: 58, side: -34 };

const circlePath = (cx, cy, r) => `M${r1(cx - r)} ${cy}a${r1(r)} ${r1(r)} 0 1 0 ${r1(2 * r)} 0a${r1(r)} ${r1(r)} 0 1 0 ${r1(-2 * r)} 0Z`;

/**
 * Plate for the Carta: a 96 px engraving of the cut in profile. opts.guards: the
 * shop's guard table (mm); opts.id: the id prefix for its patterns and clips.
 */
export function plateSVG(spec, opts = {}) {
  const s = spec || {};
  const id = opts.id || hashId(JSON.stringify(s) + 'plate');
  const guards = opts.guards;
  const defs = [];
  const art = [];
  const pats = new Map();
  // One hatch pattern per (spacing, angle, cross); shared inside the plate.
  const pat = (sp, angle, cross = false, dots = false) => {
    const key = `${sp}|${angle}|${cross}|${dots}`;
    if (pats.has(key)) return pats.get(key);
    const pid = `${id}p${pats.size}`;
    pats.set(key, pid);
    const h = r1(cross ? sp * 1.5 : sp);
    const body = dots
      ? `<circle cx="${r1(h / 2)}" cy="${r1(h / 2)}" r="0.55" fill="currentColor"/>`
      : `<path d="M0 ${r1(h / 2)}H${h}${cross ? `M${r1(h / 2)} 0V${h}` : ''}" stroke="currentColor" stroke-width="${HATCH_W}" fill="none"/>`;
    defs.push(`<pattern id="${pid}" width="${h}" height="${h}" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle})">${body}</pattern>`);
    return pid;
  };
  const clip = (cid, d, evenodd = false) => defs.push(`<clipPath id="${cid}"><path d="${d}"${evenodd ? ' clip-rule="evenodd"' : ''}/></clipPath>`);
  const tone = (d, mm, angle, cross = false) => {
    const sp = spacingFor(mm);
    if (!sp) return '';
    return `<path d="${d}" fill="url(#${pat(sp, angle, cross)})"/>`;
  };
  const band = (y0, y1) => `M30 ${r1(y0)}H160V${r1(y1)}H30Z`;

  // The side hair, ear left bare.
  clip(`${id}h`, `${HAIR}${EAR}`, true);
  const top = s.top;
  const topMM = top ? Math.max(top.frontMM || 0, top.crownMM || 0) : null;
  const topAngle = top ? TOP_ANGLE[top.fringe] ?? -34 : -34;
  const topCross = !!top && topMM >= 60;
  const sides = s.sides;
  const hairOnly = !sides && !top; // a beard plate: the hair is drawn light and even
  const side = [];

  if (sides?.shape === 'burst') {
    const bands = bandLayout(sides);
    const r = bands.map((b, i) => r1(20 + (nominalMM(sides.bands[i].upTo) - 45) * 0.75));
    let inner = 0;
    r.forEach((rad, i) => {
      const ring = inner ? `${circlePath(112, 128, rad)}${circlePath(112, 128, inner)}` : circlePath(112, 128, rad);
      clip(`${id}r${i}`, ring, true);
      const t = tone(band(-20, 220), guardMM(bands[i].guard, guards), 56);
      if (t) side.push(`<g clip-path="url(#${id}r${i})">${t}</g>`);
      inner = rad;
    });
    clip(`${id}ro`, `M-20 -20H200V220H-20Z${circlePath(112, 128, inner)}`, true);
    side.push(`<g clip-path="url(#${id}ro)">${tone(band(-20, 220), topMM, topAngle, topCross)}</g>`);
  } else if (sides) {
    const bands = bandLayout(sides);
    let below = NAPE_Y + 6;
    for (const b of bands) {
      side.push(tone(band(b.y, below), guardMM(b.guard, guards), 58));
      below = b.y;
    }
    // above the fade: the top's own length on the side of the head
    side.push(tone(band(-20, below), topMM ?? 6, topAngle, topCross));
  } else if (hairOnly) {
    side.push(tone(band(-20, 220), 0.8, -34));
  } else if (top) {
    side.push(tone(band(-20, 220), topMM, topAngle, topCross));
  }
  if (side.length) art.push(`<g clip-path="url(#${id}h)">${side.join('')}</g>`);

  // The volume over the scalp.
  if (top) {
    const t = topMarks(top);
    const vol = `${t.curve}L146 58Q134 22 98 22Q70 24 52 50z`;
    art.push(tone(vol, topMM, topAngle, topCross));
    art.push(`<path d="${t.curve}" ${INK}/>`);
  } else if (hairOnly) {
    art.push(`<path d="M52 50Q60 36 70 30" ${INK}/>`);
  }
  // The long nape (mullet, burst).
  if (s.nape?.shape === 'long') {
    const l = r1(clamp((s.nape.lenMM || 50) * 0.35, 8, 32));
    const d = `M146 112Q150 ${r1(150 + l * 0.5)} ${r1(141 + l * 0.15)} ${r1(160 + l)}L127 ${r1(166 + l * 0.6)}Q127 162 133 155z`;
    art.push(tone(d, s.nape.lenMM || 50, 74), `<path d="${d}" ${INK}/>`);
  }

  // The beard, zone by zone (sideburn, cheek, chin, neck); the moustache on its own.
  const beard = s.beard;
  if (beard && beard.style !== 'none') {
    const neckY = 194 - 8 * (beard.neckDedos || 0);
    const cheek = beard.cheek === 'perfilada' ? 'L95 120' : 'Q70 116 95 120';
    const region =
      beard.style === 'goatee'
        ? 'M36 135Q46 134 50 140Q53 152 46 168Q40 160 42 152Q40 147 37 145Q33 142 36 139Z'
        : `M100 112L102 147Q88 ${r1(neckY - 4)} 60 ${neckY}L60 176Q50 172 46 166Q40 160 42 152Q40 147 37 145L46 136${cheek}Z`;
    if (beard.style === 'shaved') {
      art.push(`<path d="${region}" ${INK} stroke-dasharray="0.5 3.2"/>`);
    } else {
      clip(`${id}bd`, region);
      const z = beard.zones || {};
      const len = beard.lenMM;
      const mm = (k) => (len && beard.style !== 'faded' ? len : zoneMM(z[k], guards) ?? len ?? 3);
      const parts = [];
      if (beard.style === 'stubble') {
        parts.push(`<path d="${band(-20, 220)}" fill="url(#${pat(2.6, 0, false, true)})"/>`);
      } else {
        const ang = 64;
        const cross = (len || 0) >= 15;
        parts.push(tone(band(-20, 128), mm('patilla'), ang, cross));
        parts.push(tone(band(128, 150), mm('mejilla'), ang, cross));
        parts.push(tone(band(150, 168), mm('barbilla'), ang, cross));
        parts.push(tone(band(168, 220), mm('cuello'), ang, cross));
      }
      // only the edges a barber cuts: the cheek line and the neck line
      const edges = beard.style === 'goatee' ? region : `M95 120${cheek === 'L95 120' ? 'L46 136' : 'Q70 116 46 136'}M102 147Q88 ${r1(neckY - 4)} 60 ${neckY}`;
      art.push(`<g clip-path="url(#${id}bd)">${parts.join('')}</g>`, `<path d="${edges}" ${INK}/>`);
      if (z.bigote != null && beard.style !== 'stubble') {
        const m = 'M38 129L35 134L36 138Q42 135.5 47 137L46 131Q42 128 38 129Z';
        art.push(tone(m, zoneMM(z.bigote, guards) ?? 6, 20));
      }
    }
  }

  // Ink line over the tone: head, face, ear, hairline.
  const head = top ? HEAD.replace(SCALP, `M133 155`) : HEAD;
  const ink = [`<path d="${head}"/>`, `<path d="${FACE}"/>`, `<path d="${EAR}"/>`];
  if (sides || top) ink.push(`<path d="M133 155${HAIRLINE.replace(/z$/, '')}L52 50"/>`);
  return (
    `<svg class="plate" viewBox="-12 -8 184 184" width="96" height="96" aria-hidden="true">` +
    `<defs>${defs.join('')}</defs>` +
    `<g stroke="none">${art.join('')}</g>` +
    `<g fill="none" stroke="currentColor" stroke-width="${LINE_W}" stroke-linecap="round" stroke-linejoin="round">${ink.join('')}</g></svg>`
  );
}
