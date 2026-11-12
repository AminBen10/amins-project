// The Carta de cortes as data: every cut and beard is a Program, a list of the
// steps a barber really does, in order, with the guard, the height (landmark ±
// fingers) and the length each one leaves. The same programs drive the story,
// the films, the recipe card, the guía SVG and the WhatsApp ficha, so they can
// never disagree. Text is transcribed from the copy deck (brief-copy_deck.json).
//
// Plain ES module with no imports: node, the worker and vite all load it.
//
// Schema (design contract):
//   GuardId  'piel'|'0'|'0,5'|'1'|'1,5'|'2'|'3'|'4'|'6'|'8' (mm come from the client's GUARDS)
//   Height   {lm, dedos?}: a landmark on the practice head, ± fingers (1 dedo ≈ 15 mm).
//            For sides.shape 'burst' the heights read as distance from the ear (the arc).
//   Step     {part, op, zone, guard?, lever?, upTo?, from?, lengthMM?, shot, dur, caption,
//             stamp?, label, tool, beat?, at?}
//            + additive: anchor (where the caption's leader points), quiet (story only:
//            the step has no note of its own on the glass; the previous note stays).
//   Spec     {sides, nape, top, beard}; a part the program does not touch is null.
//   Program  {id, n?, kind, name, alias?, desc?, family?, spec, steps, recipe, ficha,
//             serviceId, mix, ready}
//
// Durations: dur is the working time of a step in seconds (2.5–5; otherSide 1.5,
// hold free). A film (cut or beard) adds up to 12–35 s. The story is scroll-driven:
// its steps carry beat + at [p0, p1] inside that beat and dur is nominal.
//
// Zones: sides (the side above the ear), nape, sidesNape (side and nape together),
// top, fringe, crown, contour (the hairline outline: sideburns, around the ears,
// nape; in the story also the beard outline), neck (under the jaw down to the
// neckline), cheeks (sideburn, cheek and jaw side), chin, moustache, beard (all of it).

export const GUARD_IDS = ['piel', '0', '0,5', '1', '1,5', '2', '3', '4', '6', '8'];

// Standard clipper guard lengths (Wahl/Andis numbering, 1/8 in per number;
// 0 = bare blade with the lever closed). Clients copy this as GUARDS and may edit it.
export const STANDARD_GUARDS = Object.freeze({
  piel: 0,
  0: 0.8,
  '0,5': 1.5,
  1: 3,
  '1,5': 4.5,
  2: 6,
  3: 10,
  4: 13,
  6: 19,
  8: 25,
});

export const LANDMARK_NAMES = ['NUCA', 'OREJA', 'SIEN', 'ESQUINA', 'CORONILLA', 'PATILLA', 'FLEQUILLO', 'NUEZ'];
export const ANCHOR_NAMES = ['flequillo', 'sien', 'esquina', 'coronilla', 'nuca', 'patilla', 'oreja', 'lineaBarba', 'bigote', 'barbilla', 'cuello'];
export const PARTS = ['consulta', 'laterales', 'arriba', 'barba', 'acabado'];
export const OPS = [
  'comb', 'clipper', 'hold', 'blend', 'scissorOverComb', 'clipperOverComb', 'pointCut', 'thinning', 'scissor', 'part',
  'trimmer', 'lather', 'razor', 'towel', 'dryer', 'product', 'neckBrush', 'talc', 'otherSide', 'mirror',
];
export const ZONES = ['sides', 'nape', 'sidesNape', 'top', 'fringe', 'crown', 'contour', 'neck', 'cheeks', 'chin', 'moustache', 'beard'];
export const TOOLS = ['clipper', 'trimmer', 'scissors', 'thinning', 'comb', 'razor', 'brush', 'neckBrush', 'dryer', 'towel', 'hands'];
export const LEVERS = ['open', 'half', 'closed'];
// Camera presets (scene contract, camera.js).
export const SHOTS = [
  'frente', 'perfil', 'tresCuartos', 'tresCuartosAtras', 'nuca', 'arriba', 'bajo',
  'detalle-patilla', 'detalle-oreja', 'detalle-nuca', 'detalle-barba',
];
export const BEATS = ['enter', 'consult', 'clipper', 'scissors', 'razor', 'mirror'];
export const KINDS = ['cut', 'beard', 'composed', 'story'];

export const FAMILIES = [
  { id: 'degradados', label: 'Degradados' },
  { id: 'peinado', label: 'Con peinado' },
  { id: 'maquina', label: 'A máquina' },
  { id: 'mullet', label: 'Mullet y rizos' },
  { id: 'barba', label: 'Barba' },
];

// Tool names for '{herramienta}: {nota}' (carta.aria).
export const TOOL_NAMES = {
  clipper: 'Máquina',
  trimmer: 'Trimmer',
  scissors: 'Tijera',
  thinning: 'Tijera de entresacar',
  comb: 'Peine',
  razor: 'Navaja',
  brush: 'Brocha',
  neckBrush: 'Cepillo de cuello',
  dryer: 'Secador',
  towel: 'Toalla',
  hands: 'Con los dedos',
};

// v1: the looks the hair engine renders credibly. The others join when the
// subject stream reports they pass the quality gate (tech notes §8).
const READY = new Set(['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n8', 'n12', 'n13', 'b16', 'b17', 'b18', 'b19', 'b20']);

// On screen a film is 1.4 s (dip + title card) plus dur + 0.5 s per step (src/ui/film.js).
export const FILM_MAX_S = 35;
export const filmOnScreen = (steps) => 1.4 + steps.reduce((t, s) => t + s.dur + 0.5, 0);

const OTHER_SIDE = 'Igual en el otro lado';
const END = 'Así queda por detrás';

// ---------------------------------------------------------------- helpers

const H = (lm, dedos) => (dedos ? { lm, dedos } : { lm });

const decimal = (n) => String(Math.round(n * 10) / 10).replace('.', ',');

/** '1,5 mm', 'menos de 1 mm' (bare blade), '0 mm'. */
export function mmLabel(mm) {
  if (mm > 0 && mm < 1) return 'menos de 1 mm';
  return `${decimal(mm)} mm`;
}

/** The guard as the barber names it: 'del 2', 'al 0', 'a piel'. */
export function guardName(id) {
  if (id === 'piel') return 'a piel';
  if (id === '0') return 'al 0';
  return `del ${id}`;
}

/**
 * The stamp on the glass (and the decal on the guard), e.g. 'Peine del 3 · 10 mm',
 * 'Sin peine · menos de 1 mm', 'A piel'. style 'mm' is the trimmer's own guards:
 * 'Peine de 3 mm'.
 */
export function guardStamp(id, guards = STANDARD_GUARDS, style) {
  const mm = guards[id];
  if (id === 'piel') return 'A piel';
  if (style === 'mm') return `Peine de ${mmLabel(mm)}`;
  if (id === '0') return `Sin peine · ${mmLabel(mm)}`;
  return `Peine del ${id} · ${mmLabel(mm)}`;
}

const DEFAULT_TOOL = {
  comb: 'comb',
  clipper: 'clipper',
  hold: null,
  blend: 'clipper',
  scissorOverComb: 'scissors',
  clipperOverComb: 'clipper',
  pointCut: 'scissors',
  thinning: 'thinning',
  scissor: 'scissors',
  part: 'trimmer',
  trimmer: 'trimmer',
  lather: 'brush',
  razor: 'razor',
  towel: 'towel',
  dryer: 'dryer',
  product: 'hands',
  neckBrush: 'neckBrush',
  talc: 'neckBrush',
  otherSide: null,
  mirror: null,
};

const DEFAULT_SHOT = {
  sides: 'perfil',
  sidesNape: 'perfil',
  nape: 'nuca',
  top: 'tresCuartos',
  fringe: 'frente',
  crown: 'arriba',
  contour: 'detalle-patilla',
  neck: 'bajo',
  cheeks: 'tresCuartos',
  chin: 'tresCuartos',
  moustache: 'detalle-barba',
  beard: 'tresCuartos',
};

const DEFAULT_ANCHOR = {
  sides: 'sien',
  sidesNape: 'sien',
  nape: 'nuca',
  top: 'coronilla',
  fringe: 'flequillo',
  crown: 'coronilla',
  contour: 'patilla',
  neck: 'cuello',
  cheeks: 'lineaBarba',
  chin: 'barbilla',
  moustache: 'bigote',
  beard: 'lineaBarba',
};

// Raw step builders. Labels are the deck's 'Pasos' lines ('Herramienta · dónde').
const clip = (guard, zone, upTo, label, o) => ({ part: 'laterales', op: 'clipper', zone, guard, upTo, label, ...o });
const blend = (upTo, label, o) => ({ part: 'laterales', op: 'blend', zone: 'sidesNape', lever: 'half', upTo, label, ...o });
const other = () => ({ part: 'laterales', op: 'otherSide', zone: 'sidesNape', label: OTHER_SIDE, caption: `${OTHER_SIDE}.`, shot: 'nuca', dur: 1.5, anchor: 'nuca' });
const top = (op, zone, lengthMM, label, o) => ({ part: 'arriba', op, zone, lengthMM, label, ...o });
const finish = (op, zone, label, o) => ({ part: 'acabado', op, zone, label, ...o });
const contour = (op, label, o) => ({ part: 'laterales', op, zone: 'contour', label, ...o });
const beard = (op, zone, label, o) => ({ part: 'barba', op, zone, label, ...o });
const mirror = (shot = 'nuca') => ({ part: 'acabado', op: 'mirror', zone: 'nape', label: END, caption: `${END}.`, shot, dur: 2.5, anchor: null });

// Fills tool, shot, anchor, stamp and caption. For a guard pass the caption is the
// stamp plus where it goes ('Peine del 2 · 6 mm · un dedo más abajo'), so the
// decal and the caption always say the same number. compose.js builds its steps
// through the same function.
export function normalizeStep(raw, guards = STANDARD_GUARDS) {
  const s = { ...raw };
  if (!('tool' in s)) s.tool = DEFAULT_TOOL[s.op] ?? null;
  if (!s.shot) s.shot = DEFAULT_SHOT[s.zone] || 'tresCuartos';
  if (!('anchor' in s)) s.anchor = DEFAULT_ANCHOR[s.zone] ?? null;
  if (s.dur == null) s.dur = 3;
  if (typeof s.label === 'function') s.label = s.label(guards);
  // A story note is the barber's own sentence: it is the caption as written.
  if (s.beat && !s.quiet && !s.caption) s.caption = s.label;
  if (s.guard != null && !s.stamp) {
    const trimmerMM = /^Trimmer con peine/.test(s.label);
    s.stamp = guardStamp(s.guard, guards, trimmerMM ? 'mm' : undefined);
    if (!s.caption) {
      if (s.op === 'clipper' && !trimmerMM) {
        const where = s.label.includes(' · ') ? s.label.slice(s.label.indexOf(' · ') + 3) : '';
        s.caption = where ? `${s.stamp} · ${where}` : s.stamp;
      } else {
        s.caption = s.label;
      }
    }
  }
  if (!s.caption) s.caption = s.label;
  for (const k of Object.keys(s)) if (s[k] === undefined) delete s[k];
  return s;
}

const baseMix = () => ({ laterales: null, arriba: null, barba: null, acabado: null });

function makeProgram(raw, guards) {
  return clean({
    id: raw.id,
    n: raw.n,
    kind: raw.kind,
    name: raw.name,
    alias: raw.alias,
    desc: raw.desc,
    family: raw.family,
    spec: raw.spec,
    steps: fitFilm(raw.steps.map((s) => normalizeStep(s, guards))),
    recipe: raw.recipe,
    ficha: raw.ficha,
    serviceId: null,
    mix: { ...baseMix(), ...raw.mix },
    ready: READY.has(raw.id),
  });
}

function clean(o) {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

const sides = (shape, bands, blendOn = true) => ({ shape, bands: bands.map(([guard, upTo]) => ({ guard, upTo })), blend: blendOn });
const topSpec = (o) => ({ frontMM: 40, crownMM: 40, fringe: 'side', part: null, lift: 0.2, texture: 0.4, shine: 0.1, curl: null, ...o });
const beardSpec = (o) => ({ style: 'none', zones: { patilla: null, mejilla: null, barbilla: null, bigote: null, cuello: null }, cheek: 'natural', neckDedos: 2, razor: true, ...o });
const cutMix = (altura, desde, arriba, acabado) => ({ laterales: { altura, desde }, arriba, acabado });

// ---------------------------------------------------------------- cuts Nº 1–15

const CUT_DEFS = [
  {
    id: 'n1', n: 1, kind: 'cut', family: 'degradados',
    name: 'Degradado bajo', alias: 'low fade',
    desc: 'Empieza justo encima de la oreja y baja por la nuca; el lateral conserva casi todo el largo.',
    recipe: {
      lados: 'Del 3 al 0, con la línea a un dedo por encima de la oreja.',
      nuca: 'Al 0 en el borde, contorno natural.',
      arriba: '4–5 cm a tijera.',
      acabado: 'Perfilado con trimmer; cera mate.',
      repaso: 'Cada 3–4 semanas.',
    },
    ficha: 'Degradado bajo: lados del 3 al 0, línea a un dedo por encima de la oreja, arriba 4–5 cm a tijera, nuca natural.',
    spec: {
      sides: sides('line', [['0', H('OREJA', -1)], ['0,5', H('OREJA')], ['1', H('OREJA', 1)], ['2', H('SIEN')], ['3', H('ESQUINA')]]),
      nape: { shape: 'natural' },
      top: topSpec({ frontMM: 45, crownMM: 45 }),
      beard: null,
    },
    mix: cutMix('bajo', '0', 'tijera', 'producto'),
    steps: [
      clip('3', 'sidesNape', H('ESQUINA'), 'Peine del 3 · todo el lateral y la nuca', { dur: 3.5, anchor: 'esquina' }),
      clip('2', 'sidesNape', H('SIEN'), 'Peine del 2 · hasta media altura', { anchor: 'sien' }),
      clip('1', 'sidesNape', H('OREJA', 1), 'Peine del 1 · hasta un dedo por encima de la oreja', { anchor: 'oreja' }),
      // Deck line 'Peine del 0,5 y al 0 · …' is two passes: one guard per pass.
      clip('0,5', 'sidesNape', H('OREJA'), 'Peine del 0,5 · solo el borde', { shot: 'detalle-oreja', anchor: 'oreja', dur: 2.5 }),
      clip('0', 'sidesNape', H('OREJA', -1), 'Al 0 · alrededor de la oreja y en la nuca', { lever: 'closed', shot: 'tresCuartosAtras', anchor: 'nuca' }),
      blend(H('ESQUINA'), 'A mano alzada · palanca y peine del 1,5 hasta borrar las líneas', { guard: '1,5', dur: 4 }),
      other(),
      top('scissorOverComb', 'top', 45, 'Tijera sobre peine · arriba, 4–5 cm, de delante atrás', { dur: 4.5, anchor: 'flequillo' }),
      contour('trimmer', 'Perfilado · trimmer en patillas, oreja y nuca'),
      finish('product', 'top', 'Acabado · cera mate con los dedos', { dur: 2.5 }),
      mirror(),
    ],
  },
  {
    id: 'n2', n: 2, kind: 'cut', family: 'degradados',
    name: 'Degradado medio', alias: 'mid fade',
    desc: 'La línea sube hasta la sien: el degradado se ve de frente.',
    recipe: {
      lados: 'Del 3 al 0, con la línea a la altura de la sien.',
      nuca: 'Degradada, contorno natural.',
      arriba: '4 cm a tijera, entresacado.',
      acabado: 'Perfilado con trimmer y navaja; cera mate.',
      repaso: 'Cada 2–3 semanas.',
    },
    ficha: 'Degradado medio: lados del 3 al 0, línea a la altura de la sien, arriba 4 cm a tijera, nuca natural.',
    spec: {
      sides: sides('line', [['0', H('OREJA')], ['0,5', H('OREJA', 1)], ['1', H('SIEN')], ['2', H('ESQUINA', -1)], ['3', H('ESQUINA')]]),
      nape: { shape: 'natural' },
      // The crown keeps a little more for the cowlick (story consult note).
      top: topSpec({ frontMM: 40, crownMM: 45, lift: 0.25, texture: 0.5 }),
      beard: null,
    },
    mix: cutMix('medio', '0', 'tijera', 'producto'),
    steps: [
      clip('3', 'sidesNape', H('ESQUINA'), 'Peine del 3 · todo el lateral, hasta la esquina', { anchor: 'esquina' }),
      clip('2', 'sidesNape', H('ESQUINA', -1), 'Peine del 2 · un dedo más abajo', { anchor: 'esquina' }),
      clip('1', 'sidesNape', H('SIEN'), 'Peine del 1 · hasta la sien', { anchor: 'sien' }),
      clip('0,5', 'sidesNape', H('OREJA', 1), 'Peine del 0,5 · por encima de la oreja', { anchor: 'oreja' }),
      clip('0', 'sidesNape', H('OREJA'), 'Al 0 · alrededor de la oreja y en la nuca', { lever: 'closed', shot: 'tresCuartosAtras', anchor: 'nuca' }),
      blend(H('ESQUINA'), 'A mano alzada · hasta que no se vea el escalón', { dur: 4 }),
      other(),
      top('scissorOverComb', 'top', [40, 45], 'Tijera sobre peine · arriba, 4 cm', { dur: 4.5, anchor: 'flequillo' }),
      top('thinning', 'top', undefined, 'Entresacado · para que caiga solo', { anchor: 'coronilla' }),
      contour('trimmer', 'Perfilado · trimmer y navaja en el contorno'),
      mirror(),
    ],
  },
  {
    id: 'n3', n: 3, kind: 'cut', family: 'degradados',
    name: 'Degradado alto', alias: 'high fade',
    desc: 'Sube hasta la esquina de la cabeza: mucho contraste con lo de arriba.',
    recipe: {
      lados: 'Del 2 al 0, con la línea en la esquina.',
      nuca: 'Al 0 casi entera.',
      arriba: '3–5 cm a tijera.',
      acabado: 'Perfilado con trimmer y navaja; polvo texturizante.',
      repaso: 'Cada 2 semanas.',
    },
    ficha: 'Degradado alto: lados del 2 al 0, línea en la esquina, arriba 3–5 cm a tijera.',
    spec: {
      sides: sides('line', [['0', H('ESQUINA', -3)], ['0,5', H('ESQUINA', -2)], ['1', H('ESQUINA')], ['2', H('ESQUINA', 1)]]),
      nape: { shape: 'natural' },
      top: topSpec({ frontMM: 40, crownMM: 40, texture: 0.6, shine: 0 }),
      beard: null,
    },
    mix: cutMix('alto', '0', 'tijera', 'producto'),
    steps: [
      // The 2 goes just over the corner: it is the bridge into the scissor top.
      clip('2', 'sidesNape', H('ESQUINA', 1), 'Peine del 2 · todo el lateral', { dur: 3.5, anchor: 'esquina' }),
      clip('1', 'sidesNape', H('ESQUINA'), 'Peine del 1 · hasta la esquina', { anchor: 'esquina' }),
      clip('0,5', 'sidesNape', H('ESQUINA', -2), 'Peine del 0,5 · hasta dos dedos por debajo de la esquina', { anchor: 'sien' }),
      clip('0', 'sidesNape', H('ESQUINA', -3), 'Al 0 · el resto del lateral y la nuca', { lever: 'closed', shot: 'tresCuartosAtras', anchor: 'nuca', dur: 3.5 }),
      blend(H('ESQUINA', 1), 'A mano alzada · borrar el escalón de la esquina', { dur: 4, anchor: 'esquina' }),
      other(),
      top('scissorOverComb', 'top', 40, 'Tijera sobre peine · arriba, 3–5 cm', { dur: 4.5, anchor: 'flequillo' }),
      contour('trimmer', 'Perfilado · trimmer y navaja'),
      mirror(),
    ],
  },
  {
    id: 'n4', n: 4, kind: 'cut', family: 'degradados',
    name: 'Degradado a piel', alias: 'skin fade',
    desc: 'Abajo, a piel; sube en degradado hasta el largo de arriba.',
    recipe: {
      lados: 'De piel al 2, con la línea a la altura de la sien (también se hace bajo o alto).',
      nuca: 'A piel en el borde.',
      arriba: '3–5 cm a tijera.',
      acabado: 'Afeitadora o navaja en la piel; cera mate.',
      repaso: 'Cada 2 semanas.',
    },
    ficha: 'Degradado a piel: de piel al 2, línea a la altura de la sien, arriba 3–5 cm a tijera.',
    spec: {
      sides: sides('line', [['piel', H('OREJA')], ['0', H('OREJA', 1)], ['1', H('SIEN')], ['2', H('ESQUINA')]]),
      nape: { shape: 'natural' },
      top: topSpec({ frontMM: 40, crownMM: 40, texture: 0.5 }),
      beard: null,
    },
    mix: cutMix('medio', 'piel', 'tijera', 'producto'),
    steps: [
      clip('2', 'sidesNape', H('ESQUINA'), 'Peine del 2 · todo el lateral, hasta la esquina', { dur: 3.5, anchor: 'esquina' }),
      clip('1', 'sidesNape', H('SIEN'), 'Peine del 1 · hasta la sien', { anchor: 'sien' }),
      clip('0', 'sidesNape', H('OREJA', 1), 'Al 0 · por encima de la oreja', { lever: 'closed', anchor: 'oreja' }),
      // Foil shaver: no model of its own, the trimmer stands in for it.
      clip('piel', 'sidesNape', H('OREJA'), 'A piel · afeitadora en el borde de abajo', { tool: 'trimmer', shot: 'detalle-oreja', anchor: 'oreja', dur: 3.5 }),
      blend(H('SIEN'), 'A mano alzada · palanca y peine del 0,5 para unir la piel con el 1', { guard: '0,5', dur: 4 }),
      other(),
      top('scissorOverComb', 'top', 40, 'Tijera sobre peine · arriba, 3–5 cm', { dur: 4.5, anchor: 'flequillo' }),
      contour('razor', 'Perfilado · navaja en patillas y nuca'),
      mirror(),
    ],
  },
  {
    id: 'n5', n: 5, kind: 'cut', family: 'degradados',
    name: 'Taper', alias: null,
    desc: 'Solo se degradan las patillas y la nuca; el lateral se queda con largo.',
    recipe: {
      lados: 'Peine del 4 o tijera; el degradado, solo en el borde.',
      nuca: 'Del 2 al 0 en los últimos 2–3 cm.',
      arriba: '4–6 cm a tijera.',
      acabado: 'Contorno natural, sin línea marcada; crema o cera.',
      repaso: 'Cada 3–4 semanas.',
    },
    ficha: 'Taper: lateral del 4, patillas y nuca del 2 al 0 en el borde, arriba 4–6 cm a tijera, contorno natural.',
    spec: {
      sides: sides('taper', [['0', H('NUCA')], ['1', H('NUCA', 1)], ['2', H('NUCA', 2)], ['4', H('ESQUINA')]]),
      nape: { shape: 'natural' },
      top: topSpec({ frontMM: 50, crownMM: 50, shine: 0.2 }),
      beard: null,
    },
    mix: cutMix('taper', '0', 'tijera', 'producto'),
    steps: [
      clip('4', 'sidesNape', H('ESQUINA'), 'Peine del 4 · lateral y nuca, para igualar', { dur: 3.5, anchor: 'sien' }),
      // Scissor over comb across the corner: a bridge length between the 4 and the top.
      { part: 'laterales', op: 'scissorOverComb', zone: 'sides', from: H('ESQUINA'), upTo: H('ESQUINA', 1), lengthMM: 25, label: 'Tijera sobre peine · unir el lateral con lo de arriba', dur: 4, anchor: 'esquina' },
      // Deck line 'Peine del 2 y del 1 · …' is two passes: one guard per pass.
      clip('2', 'sidesNape', H('NUCA', 2), 'Peine del 2 · solo patilla y nuca, los últimos centímetros', { shot: 'tresCuartosAtras', anchor: 'nuca' }),
      clip('1', 'sidesNape', H('NUCA', 1), 'Peine del 1 · solo patilla y nuca, un dedo más abajo', { shot: 'tresCuartosAtras', anchor: 'nuca' }),
      clip('0', 'sidesNape', H('NUCA'), 'Al 0 · el borde', { lever: 'closed', shot: 'detalle-nuca', anchor: 'nuca', dur: 2.5 }),
      blend(H('NUCA', 2), 'A mano alzada · que no se vea la línea', { shot: 'tresCuartosAtras', anchor: 'nuca', dur: 3.5 }),
      other(),
      top('scissorOverComb', 'top', 50, 'Tijera sobre peine · arriba, 4–6 cm', { dur: 4.5, anchor: 'flequillo' }),
      // No line-up: the brush shows the nape left with its natural contour.
      finish('neckBrush', 'neck', 'Acabado · contorno natural, sin marcar', { shot: 'detalle-nuca', anchor: 'nuca' }),
      mirror(),
    ],
  },
  {
    id: 'n6', n: 6, kind: 'cut', family: 'degradados',
    name: 'Burst fade', alias: null,
    desc: 'Degradado en arco alrededor de la oreja; la nuca se queda con largo.',
    recipe: {
      lados: 'Un arco al 0 alrededor de la oreja que se abre hasta el 2.',
      nuca: 'Con largo, sin degradar.',
      arriba: '4–6 cm, con textura.',
      acabado: 'Perfilado del arco con trimmer; polvo texturizante.',
      repaso: 'Cada 2–3 semanas.',
    },
    ficha: 'Burst fade: arco al 0 alrededor de la oreja abriendo hasta el 2, nuca larga, arriba 4–6 cm con textura.',
    spec: {
      // burst: the heights are the arc's radius around the ear.
      sides: sides('burst', [['0', H('OREJA')], ['1', H('OREJA', 1)], ['2', H('SIEN')]]),
      nape: { shape: 'long', lenMM: 50 },
      top: topSpec({ frontMM: 50, crownMM: 50, fringe: 'up', lift: 0.3, texture: 0.7, shine: 0 }),
      beard: null,
    },
    mix: cutMix('burst', '0', 'tijera', 'producto'),
    steps: [
      clip('0', 'sides', H('OREJA'), 'Al 0 · un arco alrededor de la oreja', { lever: 'closed', shot: 'detalle-oreja', anchor: 'oreja', dur: 3.5 }),
      clip('1', 'sides', H('OREJA', 1), 'Peine del 1 · un dedo más afuera del arco', { anchor: 'oreja' }),
      clip('2', 'sides', H('SIEN'), 'Peine del 2 · abrir el arco hacia la sien y hacia atrás', { anchor: 'sien' }),
      { ...blend(H('SIEN'), 'A mano alzada · que el arco quede redondo', { dur: 3.5 }), zone: 'sides' },
      other(),
      top('scissor', 'nape', 50, 'Tijera · la nuca se deja larga; solo se limpia el contorno', { shot: 'nuca', anchor: 'nuca' }),
      top('scissorOverComb', 'top', 50, 'Tijera sobre peine · arriba, con textura', { dur: 4.5, anchor: 'flequillo' }),
      contour('trimmer', 'Perfilado · trimmer en el borde del arco', { shot: 'detalle-oreja', anchor: 'oreja' }),
      mirror(),
    ],
  },
  {
    id: 'n7', n: 7, kind: 'cut', family: 'peinado',
    name: 'Crop texturizado', alias: 'French crop',
    desc: 'Corto y con textura arriba, flequillo hacia delante y recto.',
    recipe: {
      lados: 'Degradado medio o alto, del 2 al 0.',
      nuca: 'Degradada.',
      arriba: '2–4 cm; flequillo de 1–2 cm.',
      acabado: 'Punteado a tijera para la textura; pasta mate.',
      repaso: 'Cada 3 semanas.',
    },
    ficha: 'Crop texturizado: lados del 2 al 0 a media altura, arriba 3 cm hacia delante, flequillo recto a 1–2 cm.',
    spec: {
      sides: sides('line', [['0', H('OREJA')], ['0,5', H('OREJA', 1)], ['1', H('SIEN')], ['2', H('ESQUINA')]]),
      nape: { shape: 'natural' },
      top: topSpec({ frontMM: 15, crownMM: 30, fringe: 'forward', lift: 0.1, texture: 0.8, shine: 0 }),
      beard: null,
    },
    mix: cutMix('medio', '0', 'crop', 'producto'),
    steps: [
      clip('2', 'sidesNape', H('ESQUINA'), 'Peine del 2 · lateral y nuca', { dur: 3.5, anchor: 'esquina' }),
      clip('1', 'sidesNape', H('SIEN'), 'Peine del 1 · la línea, a media altura', { anchor: 'sien' }),
      clip('0,5', 'sidesNape', H('OREJA', 1), 'Peine del 0,5 · un dedo más abajo', { anchor: 'oreja' }),
      // 'del 2 al 0': the 0 the deck's step list leaves implicit.
      clip('0', 'sidesNape', H('OREJA'), 'Al 0 · alrededor de la oreja y en la nuca', { lever: 'closed', shot: 'tresCuartosAtras', anchor: 'nuca', dur: 2.5 }),
      blend(H('ESQUINA'), 'A mano alzada · borrar escalones', { dur: 3.5 }),
      other(),
      top('scissorOverComb', 'top', 30, 'Tijera sobre peine · arriba, 3 cm, peinado hacia delante', { dur: 4, anchor: 'flequillo' }),
      top('scissor', 'fringe', 15, 'Flequillo · recto a tijera, a 1–2 cm', { shot: 'frente', anchor: 'flequillo' }),
      top('pointCut', 'top', undefined, 'Punteado · tijera en vertical para la textura', { dur: 3.5, anchor: 'coronilla' }),
      finish('product', 'top', 'Acabado · pasta mate con los dedos', { dur: 2.5, anchor: 'flequillo' }),
      mirror(),
    ],
  },
  {
    id: 'n8', n: 8, kind: 'cut', family: 'peinado',
    name: 'Tupé', alias: 'quiff',
    desc: 'Volumen delante, peinado hacia arriba y atrás; lados cortos.',
    recipe: {
      lados: 'Degradado del 2 al 0,5.',
      nuca: 'Degradada.',
      arriba: '6–8 cm delante, 4–5 cm en la coronilla.',
      acabado: 'Secador con cepillo hacia arriba; pomada de fijación media.',
      repaso: 'Cada 3–4 semanas.',
    },
    ficha: 'Tupé: lados del 2 al 0,5, delante 6–8 cm, coronilla 4–5 cm, peinado hacia arriba y atrás.',
    spec: {
      sides: sides('line', [['0,5', H('OREJA')], ['1', H('OREJA', 1)], ['2', H('ESQUINA')]]),
      nape: { shape: 'natural' },
      top: topSpec({ frontMM: 70, crownMM: 45, fringe: 'up', lift: 0.8, texture: 0.4, shine: 0.4 }),
      beard: null,
    },
    mix: cutMix('bajo', '0,5', 'tupe', 'producto'),
    steps: [
      clip('2', 'sidesNape', H('ESQUINA'), 'Peine del 2 · lateral y nuca', { dur: 3.5, anchor: 'esquina' }),
      clip('1', 'sidesNape', H('OREJA', 1), 'Peine del 1 · el tercio de abajo', { anchor: 'sien' }),
      clip('0,5', 'sidesNape', H('OREJA'), 'Peine del 0,5 · un dedo más abajo', { anchor: 'oreja' }),
      blend(H('ESQUINA'), 'A mano alzada · unir', { dur: 3.5 }),
      other(),
      top('scissorOverComb', 'crown', 45, 'Tijera sobre peine · coronilla a 4–5 cm', { shot: 'tresCuartosAtras', dur: 4 }),
      top('scissor', 'top', [70, 45], 'Tijera · delante se dejan 6–8 cm, desfilado', { shot: 'perfil', dur: 4, anchor: 'flequillo' }),
      finish('dryer', 'top', 'Secador y cepillo · hacia arriba y atrás', { shot: 'perfil', dur: 4.5, anchor: 'flequillo' }),
      finish('product', 'top', 'Acabado · pomada, con los dedos', { anchor: 'flequillo' }),
      mirror(),
    ],
  },
  {
    id: 'n9', n: 9, kind: 'cut', family: 'peinado',
    name: 'Pompadour', alias: null,
    desc: 'Más largo y más alto que el tupé, todo hacia atrás y con brillo.',
    recipe: {
      lados: 'Taper del 3 al 1, o a tijera.',
      nuca: 'Degradada o natural.',
      arriba: '8–12 cm delante, 6–8 cm en la coronilla.',
      acabado: 'Secador con cepillo redondo; pomada con brillo y peine.',
      repaso: 'Cada 4 semanas.',
    },
    ficha: 'Pompadour: lados en taper del 3 al 1, delante 8–12 cm, coronilla 6–8 cm, hacia atrás con brillo.',
    spec: {
      sides: sides('taper', [['1', H('NUCA', 1)], ['2', H('NUCA', 2)], ['3', H('ESQUINA')]], false),
      nape: { shape: 'natural' },
      top: topSpec({ frontMM: 100, crownMM: 70, fringe: 'back', lift: 0.9, texture: 0.1, shine: 0.9 }),
      beard: null,
    },
    mix: cutMix('taper', '1', 'pompadour', 'producto'),
    steps: [
      clip('3', 'sidesNape', H('ESQUINA'), 'Peine del 3 · lateral, sin pasar de la esquina', { dur: 4, anchor: 'esquina' }),
      clip('2', 'sidesNape', H('NUCA', 2), 'Peine del 2 · el borde, en taper', { shot: 'tresCuartosAtras', anchor: 'nuca' }),
      clip('1', 'sidesNape', H('NUCA', 1), 'Peine del 1 · el borde, un dedo más abajo', { shot: 'tresCuartosAtras', anchor: 'nuca' }),
      other(),
      top('scissor', 'top', [100, 70], 'Tijera · arriba solo se igualan las puntas; el largo se respeta', { shot: 'perfil', dur: 5, anchor: 'flequillo' }),
      finish('dryer', 'top', 'Secador y cepillo redondo · volumen delante, hacia atrás', { shot: 'perfil', dur: 5, anchor: 'flequillo' }),
      finish('product', 'top', 'Acabado · pomada con brillo y peine', { tool: 'comb', shot: 'perfil', dur: 5, anchor: 'coronilla' }),
      mirror(),
    ],
  },
  {
    id: 'n10', n: 10, kind: 'cut', family: 'peinado',
    name: 'Peinado hacia atrás', alias: 'slick back',
    desc: 'Largo arriba, todo hacia atrás con pomada; lados en taper o degradado.',
    recipe: {
      lados: 'Degradado o taper del 2 al 0.',
      nuca: 'Degradada.',
      arriba: '8–12 cm, más largo delante.',
      acabado: 'Pomada con brillo, peinado hacia atrás con peine.',
      repaso: 'Cada 4–5 semanas.',
    },
    ficha: 'Peinado hacia atrás: lados del 2 al 0, arriba 8–12 cm solo puntas, todo hacia atrás con pomada.',
    spec: {
      sides: sides('line', [['0', H('OREJA', -1)], ['1', H('OREJA')], ['2', H('ESQUINA')]]),
      nape: { shape: 'natural' },
      top: topSpec({ frontMM: 110, crownMM: 90, fringe: 'back', lift: 0.2, texture: 0.1, shine: 0.9 }),
      beard: null,
    },
    mix: cutMix('bajo', '0', 'atras', 'producto'),
    steps: [
      clip('2', 'sidesNape', H('ESQUINA'), 'Peine del 2 · lateral y nuca', { dur: 3.5, anchor: 'esquina' }),
      clip('1', 'sidesNape', H('OREJA'), 'Peine del 1 · el borde', { anchor: 'oreja' }),
      clip('0', 'sidesNape', H('OREJA', -1), 'Al 0 · alrededor de la oreja y en la nuca', { lever: 'closed', shot: 'tresCuartosAtras', anchor: 'nuca' }),
      blend(H('ESQUINA'), 'A mano alzada · unir', { dur: 3.5 }),
      other(),
      top('scissor', 'top', [110, 90], 'Tijera · arriba, solo puntas', { shot: 'perfil', dur: 4, anchor: 'coronilla' }),
      finish('product', 'top', 'Acabado · pomada y peine, todo hacia atrás', { tool: 'comb', shot: 'perfil', dur: 4.5, anchor: 'coronilla' }),
      mirror(),
    ],
  },
  {
    id: 'n11', n: 11, kind: 'cut', family: 'peinado',
    name: 'Raya al lado', alias: 'side part',
    desc: 'Peinado de lado, con la raya donde te sale; si la quieres marcada, a navaja.',
    recipe: {
      lados: 'Taper del 3 al 1, o a tijera.',
      nuca: 'Degradada.',
      arriba: '5–7 cm.',
      acabado: 'Raya natural o marcada con trimmer y navaja; pomada mate y peine.',
      repaso: 'Cada 3–4 semanas.',
    },
    // Deck: 'raya {natural | marcada a navaja} a la {izquierda | derecha}'; the preset
    // is the marked part on the left, as its steps show.
    ficha: 'Raya al lado: lados en taper del 3 al 1, arriba 5–7 cm, raya marcada a navaja a la izquierda.',
    spec: {
      sides: sides('taper', [['1', H('NUCA', 1)], ['2', H('NUCA', 2)], ['3', H('ESQUINA')]], false),
      nape: { shape: 'natural' },
      top: topSpec({ frontMM: 60, crownMM: 60, fringe: 'side', part: { side: 'left', hard: true }, lift: 0.3, texture: 0.2, shine: 0.3 }),
      beard: null,
    },
    mix: cutMix('taper', '1', 'raya', 'producto'),
    steps: [
      clip('3', 'sidesNape', H('ESQUINA'), 'Peine del 3 · lateral', { dur: 3.5, anchor: 'esquina' }),
      clip('2', 'sidesNape', H('NUCA', 2), 'Peine del 2 · el borde', { shot: 'tresCuartosAtras', anchor: 'nuca' }),
      clip('1', 'sidesNape', H('NUCA', 1), 'Peine del 1 · el borde, un dedo más abajo', { shot: 'tresCuartosAtras', anchor: 'nuca' }),
      other(),
      top('scissorOverComb', 'top', 60, 'Tijera sobre peine · arriba, 5–7 cm', { dur: 4.5, anchor: 'flequillo' }),
      top('part', 'top', undefined, 'La raya · donde te sale sola, marcada con trimmer', { shot: 'arriba', dur: 3.5, anchor: 'coronilla' }),
      top('razor', 'top', undefined, 'Navaja · limpiar la raya', { shot: 'arriba', anchor: 'coronilla' }),
      finish('product', 'top', 'Acabado · pomada y peine, de lado', { tool: 'comb', dur: 3.5, anchor: 'flequillo' }),
      mirror(),
    ],
  },
  {
    id: 'n12', n: 12, kind: 'cut', family: 'maquina',
    name: 'Rapado', alias: 'buzz cut',
    desc: 'Todo a máquina con el mismo peine y los contornos marcados.',
    recipe: {
      lados: 'Peine del 2 (se hace del 1 al 3).',
      arriba: 'El mismo peine.',
      nuca: 'Cuadrada o redondeada, perfilada.',
      acabado: 'Perfilado con trimmer; sin producto.',
      repaso: 'Cada 2–3 semanas.',
    },
    // Deck: 'nuca {cuadrada | redondeada}'; the preset squares it.
    ficha: 'Rapado: todo del 2, contornos perfilados, nuca cuadrada.',
    spec: {
      sides: sides('uniform', [['2', H('ESQUINA')]], false),
      nape: { shape: 'square' },
      top: topSpec({ frontMM: 6, crownMM: 6, fringe: 'up', lift: 0, texture: 0, shine: 0 }),
      beard: null,
    },
    mix: cutMix('sin', '2', 'rapado', 'seco'),
    steps: [
      // 'Peine del 2 · toda la cabeza, a contrapelo': the sides first, then the top.
      clip('2', 'sidesNape', H('ESQUINA'), 'Peine del 2 · los lados y la nuca, a contrapelo', { dur: 4.5, anchor: 'sien' }),
      { ...clip('2', 'top', undefined, 'Peine del 2 · arriba, a contrapelo', { shot: 'arriba', dur: 4, anchor: 'coronilla' }), part: 'arriba' },
      contour('trimmer', 'Perfilado · frente, patillas y nuca con trimmer', { shot: 'tresCuartosAtras', dur: 4, anchor: 'nuca' }),
      mirror(),
    ],
  },
  {
    id: 'n13', n: 13, kind: 'cut', family: 'maquina',
    name: 'Crew cut', alias: null,
    desc: 'Corto arriba, un poco más largo en el flequillo; lados a máquina.',
    recipe: {
      lados: 'Del 2 al 1, más corto abajo.',
      nuca: 'Redondeada.',
      arriba: '2–3 cm, más largo delante.',
      acabado: 'Cera mate, hacia arriba o de lado.',
      repaso: 'Cada 3 semanas.',
    },
    ficha: 'Crew cut: lados del 2 al 1, arriba 2–3 cm más largo delante, nuca redondeada.',
    spec: {
      sides: sides('line', [['1', H('OREJA', 1)], ['2', H('ESQUINA')]]),
      nape: { shape: 'round' },
      top: topSpec({ frontMM: 30, crownMM: 20, fringe: 'up', lift: 0.3, texture: 0.5, shine: 0 }),
      beard: null,
    },
    mix: cutMix('bajo', '1', 'maquina', 'producto'),
    steps: [
      clip('2', 'sidesNape', H('ESQUINA'), 'Peine del 2 · lateral y nuca', { dur: 3.5, anchor: 'esquina' }),
      clip('1', 'sidesNape', H('OREJA', 1), 'Peine del 1 · la parte de abajo', { anchor: 'oreja' }),
      blend(H('ESQUINA'), 'A mano alzada · unir', { dur: 3.5 }),
      other(),
      top('clipperOverComb', 'top', [30, 20], 'Máquina sobre peine · arriba, 2–3 cm, más largo delante', { dur: 4.5, anchor: 'flequillo' }),
      contour('trimmer', 'Perfilado · nuca redondeada', { shot: 'detalle-nuca', anchor: 'nuca' }),
      finish('product', 'top', 'Acabado · cera mate', { dur: 2.5, anchor: 'flequillo' }),
      mirror(),
    ],
  },
  {
    id: 'n14', n: 14, kind: 'cut', family: 'mullet',
    name: 'Mullet', alias: null,
    desc: 'Corto de lados, con textura arriba y largo en la nuca.',
    recipe: {
      lados: 'Taper o arco del 2 al 0.',
      nuca: 'Con largo (6–10 cm), desfilada.',
      arriba: '4–6 cm, con textura.',
      acabado: 'Tijera de entresacar en la nuca; crema de peinado.',
      repaso: 'Lados cada 3 semanas; nuca cada 6–8.',
    },
    ficha: 'Mullet: lados del 2 al 0 con arco en la oreja, arriba 4–6 cm con textura, nuca larga desfilada.',
    spec: {
      sides: sides('burst', [['0', H('OREJA')], ['2', H('ESQUINA')]]),
      nape: { shape: 'long', lenMM: 80 },
      top: topSpec({ frontMM: 50, crownMM: 50, fringe: 'forward', lift: 0.3, texture: 0.7, shine: 0.2 }),
      beard: null,
    },
    mix: cutMix('burst', '0', 'mullet', 'producto'),
    steps: [
      clip('2', 'sides', H('ESQUINA'), 'Peine del 2 · lateral, sin tocar la nuca', { dur: 3.5, anchor: 'sien' }),
      clip('0', 'sides', H('OREJA'), 'Al 0 · un arco alrededor de la oreja', { lever: 'closed', shot: 'detalle-oreja', anchor: 'oreja', dur: 3.5 }),
      { ...blend(H('ESQUINA'), 'A mano alzada · unir', { dur: 3.5 }), zone: 'sides' },
      other(),
      top('thinning', 'nape', undefined, 'Tijera · la nuca se deja larga, solo desfilada', { shot: 'nuca', dur: 4, anchor: 'nuca' }),
      top('scissorOverComb', 'top', 50, 'Tijera sobre peine · arriba, con textura', { dur: 4.5, anchor: 'flequillo' }),
      finish('product', 'top', 'Acabado · crema, con los dedos', { anchor: 'flequillo' }),
      mirror(),
    ],
  },
  {
    id: 'n15', n: 15, kind: 'cut', family: 'mullet',
    name: 'Rizos con degradado', alias: 'curly top',
    desc: 'Rizos arriba, cortados en seco rizo a rizo; lados en degradado.',
    recipe: {
      lados: 'Degradado medio o alto, de piel al 2.',
      nuca: 'Degradada.',
      arriba: '4–7 cm de rizo.',
      acabado: 'Crema de rizos; no se peina en seco.',
      repaso: 'Cada 3–4 semanas (lados, cada 2–3).',
    },
    ficha: 'Rizos con degradado: lados de piel al 2, arriba 4–7 cm de rizo cortado en seco.',
    spec: {
      sides: sides('line', [['piel', H('OREJA')], ['0', H('OREJA', 1)], ['1', H('SIEN')], ['2', H('ESQUINA')]]),
      nape: { shape: 'natural' },
      top: topSpec({ frontMM: 55, crownMM: 55, fringe: 'up', lift: 0.5, texture: 0.6, shine: 0.3, curl: { radiusMM: 8, turns: 2 } }),
      beard: null,
    },
    mix: cutMix('medio', 'piel', 'rizos', 'producto'),
    steps: [
      clip('2', 'sidesNape', H('ESQUINA'), 'Peine del 2 · lateral y nuca', { dur: 3.5, anchor: 'esquina' }),
      clip('1', 'sidesNape', H('SIEN'), 'Peine del 1 · la línea, a media altura', { anchor: 'sien' }),
      clip('0', 'sidesNape', H('OREJA', 1), 'Al 0 · por encima de la oreja', { lever: 'closed', anchor: 'oreja' }),
      // 'de piel al 2': the skin pass the deck's step list leaves implicit.
      clip('piel', 'sidesNape', H('OREJA'), 'A piel · afeitadora en el borde de abajo', { tool: 'trimmer', shot: 'detalle-oreja', anchor: 'oreja' }),
      blend(H('ESQUINA'), 'A mano alzada · unir', { dur: 3.5 }),
      other(),
      top('scissor', 'top', 55, 'Tijera · arriba en seco, rizo a rizo, siguiendo la forma', { dur: 5, anchor: 'coronilla' }),
      contour('trimmer', 'Perfilado · frente y patillas', { shot: 'frente', anchor: 'patilla' }),
      finish('product', 'top', 'Acabado · crema de rizos', { anchor: 'coronilla' }),
      mirror(),
    ],
  },
];

// ---------------------------------------------------------------- beards Nº 16–21

const BEARD_DEFS = [
  {
    id: 'b16', n: 16, kind: 'beard', family: 'barba',
    name: 'Afeitado clásico', alias: null,
    desc: 'Toalla caliente, espuma a brocha y navaja.',
    recipe: {
      barba: 'A navaja, sin barba.',
      acabado: 'Bálsamo.',
      repaso: 'Cuando quieras; la barba vuelve a salir en dos o tres días.',
    },
    ficha: 'Afeitado clásico a navaja.',
    spec: {
      sides: null, nape: null, top: null,
      beard: beardSpec({ style: 'shaved', zones: { patilla: 'piel', mejilla: 'piel', barbilla: 'piel', bigote: 'piel', cuello: 'piel' }, cheek: 'natural', neckDedos: null }),
    },
    mix: { barba: 'afeitado' },
    steps: [
      beard('towel', 'beard', 'Toalla caliente · un par de minutos', { shot: 'frente', dur: 3.5, anchor: 'barbilla' }),
      beard('lather', 'beard', 'Espuma a brocha', { dur: 3.5 }),
      beard('razor', 'beard', 'Navaja · a favor del pelo', { dur: 5 }),
      beard('razor', 'neck', 'Segunda pasada · a contrapelo donde haga falta', { shot: 'bajo', dur: 4 }),
      beard('product', 'beard', 'Bálsamo', { anchor: 'lineaBarba' }),
      mirror('tresCuartos'),
    ],
  },
  {
    id: 'b17', n: 17, kind: 'beard', family: 'barba',
    name: 'Barba de tres días', alias: null,
    desc: 'Igual de corta por toda la cara, con el cuello limpio.',
    recipe: {
      barba: 'Trimmer con peine de 3 mm (de 1 a 3 mm, a tu gusto).',
      contornos: 'Mejillas naturales; cuello a navaja, a dos dedos de la nuez.',
      repaso: 'Cada 1–2 semanas.',
    },
    ficha: 'Barba de tres días a 3 mm, cuello a navaja.',
    spec: {
      sides: null, nape: null, top: null,
      beard: beardSpec({ style: 'stubble', zones: { patilla: '1', mejilla: '1', barbilla: '1', bigote: '1', cuello: '1' }, lenMM: 3, cheek: 'natural', neckDedos: 2 }),
    },
    mix: { barba: 'tres-dias' },
    steps: [
      beard('clipper', 'beard', (g) => `Trimmer con peine de ${mmLabel(g['1'])} · toda la barba`, { guard: '1', tool: 'trimmer', dur: 5 }),
      beard('razor', 'neck', 'Cuello · espuma y navaja, a dos dedos de la nuez', { upTo: H('NUEZ', 2), dur: 4.5 }),
      mirror('tresCuartos'),
    ],
  },
  {
    id: 'b18', n: 18, kind: 'beard', family: 'barba',
    name: 'Barba corta', alias: null,
    desc: 'Recortada con peine corto y contornos a navaja.',
    recipe: {
      barba: 'Peine del 2 (6 mm) en mejillas, del 3 en la barbilla.',
      contornos: 'Mejillas y cuello a navaja.',
      repaso: 'Cada 2 semanas.',
    },
    ficha: 'Barba corta: peine del 2, barbilla del 3, contornos a navaja.',
    spec: {
      sides: null, nape: null, top: null,
      beard: beardSpec({ style: 'short', zones: { patilla: '2', mejilla: '2', barbilla: '3', bigote: 8, cuello: '2' }, cheek: 'perfilada', neckDedos: 2 }),
    },
    mix: { barba: 'corta' },
    steps: [
      // 'Peine del 2 · mejillas y cuello' avoids the chin, which keeps the 3: two passes.
      beard('clipper', 'cheeks', 'Peine del 2 · mejillas', { guard: '2' }),
      beard('clipper', 'neck', 'Peine del 2 · cuello', { guard: '2', shot: 'bajo' }),
      beard('clipper', 'chin', 'Peine del 3 · barbilla, para darle forma', { guard: '3', dur: 3.5 }),
      beard('scissor', 'moustache', 'Bigote · a tijera, que no tape el labio', { lengthMM: 8, dur: 3.5 }),
      beard('razor', 'beard', 'Perfilado · espuma y navaja en mejillas y cuello', { upTo: H('NUEZ', 2), dur: 4.5 }),
      mirror('tresCuartos'),
    ],
  },
  {
    id: 'b19', n: 19, kind: 'beard', family: 'barba',
    name: 'Barba degradada', alias: null,
    desc: 'La patilla sale del degradado y va ganando largo hasta la barbilla.',
    recipe: {
      barba: 'Patilla del 0 al 1, mejilla del 2, barbilla del 3 o del 4.',
      contornos: 'Mejilla y cuello a navaja.',
      repaso: 'Cada 2 semanas.',
    },
    ficha: 'Barba degradada: patilla del 0 al 1, mejilla del 2, barbilla del 3, contornos a navaja.',
    spec: {
      sides: null, nape: null, top: null,
      beard: beardSpec({ style: 'faded', zones: { patilla: '0', mejilla: '2', barbilla: '3', bigote: null, cuello: '2' }, cheek: 'perfilada', neckDedos: 2 }),
    },
    mix: { barba: 'degradada' },
    steps: [
      beard('clipper', 'cheeks', 'Al 0 · la patilla, unida al degradado del pelo', { guard: '0', lever: 'closed', from: H('PATILLA'), shot: 'detalle-patilla', anchor: 'patilla' }),
      beard('clipper', 'cheeks', 'Peine del 1 · el principio de la mejilla', { guard: '1', from: H('PATILLA', -1), upTo: H('PATILLA') }),
      beard('clipper', 'cheeks', 'Peine del 2 · la mejilla', { guard: '2', upTo: H('PATILLA', -1), dur: 3.5 }),
      beard('clipper', 'chin', 'Peine del 3 · la barbilla', { guard: '3' }),
      beard('blend', 'beard', 'A mano alzada · unir', { lever: 'half', dur: 3.5 }),
      beard('razor', 'beard', 'Perfilado · navaja en mejilla y cuello', { upTo: H('NUEZ', 2), dur: 4 }),
      mirror('tresCuartos'),
    ],
  },
  {
    id: 'b20', n: 20, kind: 'beard', family: 'barba',
    name: 'Barba completa', alias: null,
    desc: 'Con largo, recortada a tijera y con forma; el cuello, a dos dedos de la nuez.',
    recipe: {
      barba: '1–3 cm, forma a tijera sobre peine.',
      contornos: 'Mejillas naturales o perfiladas; cuello a navaja.',
      acabado: 'Aceite y cepillo.',
      repaso: 'Cada 3–4 semanas.',
    },
    ficha: 'Barba completa: 1–3 cm a tijera, cuello a navaja a dos dedos de la nuez.',
    spec: {
      sides: null, nape: null, top: null,
      beard: beardSpec({ style: 'full', zones: { patilla: 20, mejilla: 20, barbilla: 20, bigote: 10, cuello: 20 }, lenMM: 20, cheek: 'natural', neckDedos: 2 }),
    },
    mix: { barba: 'completa' },
    steps: [
      beard('scissorOverComb', 'beard', 'Tijera sobre peine · la forma de la barba', { lengthMM: 20, dur: 5 }),
      beard('scissor', 'moustache', 'Bigote · a tijera, por encima del labio', { lengthMM: 10, dur: 3.5 }),
      beard('razor', 'neck', 'Cuello · navaja a dos dedos de la nuez', { upTo: H('NUEZ', 2), dur: 4 }),
      beard('product', 'beard', 'Acabado · aceite y cepillo', { tool: 'brush' }),
      mirror('tresCuartos'),
    ],
  },
  {
    id: 'b21', n: 21, kind: 'beard', family: 'barba',
    name: 'Candado', alias: null,
    desc: 'Bigote y perilla unidos; las mejillas, afeitadas.',
    recipe: {
      barba: 'Perilla y bigote a 3–6 mm.',
      contornos: 'Mejillas y cuello a navaja.',
      repaso: 'Cada 1–2 semanas.',
    },
    ficha: 'Candado: perilla y bigote a 3–6 mm, mejillas y cuello a navaja.',
    spec: {
      sides: null, nape: null, top: null,
      beard: beardSpec({ style: 'goatee', zones: { patilla: 'piel', mejilla: 'piel', barbilla: '1', bigote: '1', cuello: 'piel' }, lenMM: 3, cheek: 'perfilada', neckDedos: null }),
    },
    mix: { barba: 'candado' },
    steps: [
      beard('trimmer', 'beard', 'Trimmer · marcar el candado alrededor de la boca', { shot: 'frente', dur: 4, anchor: 'barbilla' }),
      // Over the whole beard: the cheeks and neck are shaved right after.
      beard('clipper', 'beard', 'Peine del 1 · perilla y bigote', { guard: '1', tool: 'trimmer', dur: 3.5, anchor: 'barbilla' }),
      beard('razor', 'cheeks', 'Espuma y navaja · mejillas', { dur: 4 }),
      beard('razor', 'neck', 'Espuma y navaja · cuello', { dur: 3.5 }),
      mirror('tresCuartos'),
    ],
  },
];

// ---------------------------------------------------------------- the story (Nº 2 + Nº 18)

// Beat ranges and notes follow the signature spec A word for word (clipper beat);
// the razor beat switches its notes on the client's confirmed CLAIMS.
function storyDef(claims = {}) {
  const n2 = CUT_DEFS.find((c) => c.id === 'n2');
  const n18 = BEARD_DEFS.find((b) => b.id === 'b18');
  const steps = [
    // entrar: the cape snaps on from 0.70
    { part: 'consulta', op: 'hold', zone: 'top', label: 'Siéntate, que te subo un poco.', tool: null, shot: 'frente', dur: 2, anchor: null, beat: 'enter', at: [0.72, 1] },

    // en el espejo, la consulta
    { part: 'consulta', op: 'comb', zone: 'top', label: 'A ver cómo te nace el pelo.', shot: 'frente', anchor: 'flequillo', beat: 'consult', at: [0.05, 0.35] },
    { part: 'consulta', op: 'comb', zone: 'crown', label: 'Remolino en la coronilla: ahí te dejo un poco más de largo.', shot: 'arriba', anchor: 'coronilla', beat: 'consult', at: [0.35, 0.65] },
    { part: 'consulta', op: 'hold', zone: 'top', label: '¿Te peinas con los dedos o con peine?', tool: 'comb', shot: 'frente', dur: 2, anchor: null, beat: 'consult', at: [0.65, 0.95] },

    // peine a peine (signature spec A); the gaps between ranges are the guard swaps
    clip('3', 'sidesNape', H('ESQUINA'), 'Peine del 3 en todo el lateral, hasta la esquina.', { beat: 'clipper', at: [0.05, 0.2], anchor: 'esquina' }),
    clip('2', 'sidesNape', H('ESQUINA', -1), 'Del 2, un dedo más abajo.', { beat: 'clipper', at: [0.23, 0.36], anchor: 'esquina' }),
    clip('1', 'sidesNape', H('SIEN'), 'Del 1, hasta la sien.', { beat: 'clipper', at: [0.39, 0.51], anchor: 'sien' }),
    clip('0,5', 'sidesNape', H('OREJA', 1), 'Del 0,5, por encima de la oreja.', { beat: 'clipper', at: [0.54, 0.62], anchor: 'oreja' }),
    clip('0', 'sidesNape', H('OREJA'), 'Y al 0 alrededor de la oreja y en la nuca.', { lever: 'closed', shot: 'tresCuartosAtras', beat: 'clipper', at: [0.65, 0.72], anchor: 'nuca' }),
    { part: 'laterales', op: 'hold', zone: 'sidesNape', label: 'Tranquilo, que así no te vas.', tool: 'clipper', shot: 'tresCuartosAtras', dur: 2, anchor: null, beat: 'clipper', at: [0.72, 0.78] },
    blend(H('ESQUINA'), 'Ahora a mano alzada, hasta que no se vea el escalón.', { shot: 'tresCuartosAtras', beat: 'clipper', at: [0.78, 0.95], dur: 4 }),

    // tijera sobre peine; then Nº 18's lengths, quietly, before the razor
    top('scissorOverComb', 'top', [40, 45], 'Arriba, tijera sobre peine. Te dejo unos cuatro centímetros.', { beat: 'scissors', at: [0.04, 0.4], dur: 4.5, anchor: 'flequillo' }),
    top('thinning', 'top', undefined, 'Entresaco un poco para que caiga solo.', { beat: 'scissors', at: [0.42, 0.62], anchor: 'coronilla' }),
    ...n18.steps
      .filter((s) => s.op !== 'razor' && s.op !== 'mirror')
      .map((s, i, arr) => {
        const span = (0.97 - 0.64) / arr.length;
        const at = [round(0.64 + i * span), round(0.64 + (i + 1) * span)];
        // The first beard pass is spoken so the trim is shown, not only the razor.
        if (i === 0) {
          const line = 'Y la barba: peine del 2 en las mejillas, del 3 en la barbilla.';
          return { ...s, label: line, caption: line, anchor: 'lineaBarba', beat: 'scissors', at };
        }
        return { ...s, quiet: true, beat: 'scissors', at };
      }),
  ];

  // navaja: one beat, notes gated on what the shop has confirmed. Order as done at
  // the chair: towel, a new blade in the razor, lather and razor, then talc.
  const razorNote = 'Espuma y navaja en las patillas, el contorno de la barba y la nuca.';
  const towel = !!claims.hotTowel;
  if (towel) {
    steps.push({ part: 'barba', op: 'towel', zone: 'beard', label: 'Toalla caliente un par de minutos: abre el poro y la navaja no tira.', shot: 'tresCuartos', anchor: 'barbilla', beat: 'razor', at: [0.02, 0.16] });
  }
  if (claims.newBlade) {
    steps.push({ part: 'barba', op: 'hold', zone: 'contour', label: 'Hoja nueva, como con cada cliente.', tool: 'razor', shot: 'tresCuartos', dur: 2, anchor: 'lineaBarba', beat: 'razor', at: [0.18, 0.28] });
  }
  const latherFrom = claims.newBlade ? 0.3 : towel ? 0.18 : 0.05;
  steps.push({ part: 'barba', op: 'lather', zone: 'contour', label: razorNote, shot: 'tresCuartos', anchor: 'patilla', beat: 'razor', at: [latherFrom, 0.42] });
  steps.push({ part: 'barba', op: 'razor', zone: 'contour', label: razorNote, upTo: H('NUEZ', 2), shot: 'tresCuartos', dur: 4, anchor: 'lineaBarba', quiet: true, beat: 'razor', at: [0.44, 0.74] });
  if (claims.talc === 'talco') {
    steps.push({ part: 'acabado', op: 'talc', zone: 'nape', label: 'Un poco de talco en la nuca, para que no pique.', shot: 'tresCuartosAtras', anchor: 'nuca', beat: 'razor', at: [0.78, 0.95] });
  } else if (claims.talc === 'bálsamo') {
    steps.push({ part: 'acabado', op: 'product', zone: 'beard', label: 'Un poco de bálsamo, para que no se irrite.', shot: 'tresCuartos', anchor: 'lineaBarba', beat: 'razor', at: [0.78, 0.95] });
  } else {
    steps.push({ part: 'acabado', op: 'neckBrush', zone: 'neck', label: 'Te quito los pelos del cuello.', shot: 'tresCuartosAtras', anchor: 'cuello', beat: 'razor', at: [0.78, 0.95] });
  }

  // así te queda por detrás: the line is the spoken one (p.spoken), not a note
  steps.push({ ...mirror('frente'), label: 'Así te queda por detrás.', caption: 'Así te queda por detrás.', quiet: true, beat: 'mirror', at: [0.28, 0.45] });

  return {
    id: 'story',
    kind: 'story',
    name: 'Degradado medio con barba corta',
    spec: { ...n2.spec, beard: n18.spec.beard },
    recipe: { ...n2.recipe, barba: n18.recipe.barba, contornos: n18.recipe.contornos },
    ficha: `${n2.ficha} ${n18.ficha}`,
    mix: { ...n2.mix, ...n18.mix },
    steps,
  };
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}

// ---------------------------------------------------------------- Compón tu corte

// Every option knows what it means on the head, so compose() can build a program:
// altura gives the fade line, desde the bottom guard, arriba the top (and the guard
// the side ladder climbs to), barba a beard program, acabado what the service must
// include. ready mirrors the preset that renders that look.
const INGREDIENT_DEFS = [
  {
    id: 'laterales',
    part: 'laterales',
    legend: 'Laterales',
    fields: [
      {
        id: 'altura',
        key: 'laterales.altura',
        label: 'Altura',
        options: [
          { id: 'bajo', label: 'Bajo', name: 'Degradado bajo', line: H('OREJA', 1), preset: 'n1' },
          { id: 'medio', label: 'Medio', name: 'Degradado medio', line: H('SIEN'), preset: 'n2' },
          { id: 'alto', label: 'Alto', name: 'Degradado alto', line: H('ESQUINA'), preset: 'n3' },
          { id: 'taper', label: 'Taper', name: 'Taper', line: H('NUCA', 2), edge: true, preset: 'n5' },
          { id: 'sin', label: 'Sin degradado', name: 'Lados sin degradado', line: null, preset: 'n12' },
          { id: 'burst', label: 'Burst', name: 'Burst fade', line: H('SIEN'), arc: true, preset: 'n6' },
        ],
      },
      {
        id: 'desde',
        key: 'laterales.desde',
        label: 'Desde',
        options: [
          { id: 'piel', label: 'A piel', phrase: 'a piel', guard: 'piel' },
          { id: '0', label: 'Del 0', phrase: 'desde el 0', guard: '0' },
          { id: '0,5', label: 'Del 0,5', phrase: 'desde el 0,5', guard: '0,5' },
          { id: '1', label: 'Del 1', phrase: 'desde el 1', guard: '1' },
          { id: '2', label: 'Del 2', phrase: 'desde el 2', guard: '2' },
          { id: '3', label: 'Del 3', phrase: 'desde el 3', guard: '3' },
        ],
      },
    ],
  },
  {
    id: 'arriba',
    part: 'arriba',
    legend: 'Arriba',
    fields: [
      {
        id: 'arriba',
        key: 'arriba',
        label: 'Arriba',
        options: [
          { id: 'rapado', label: 'Rapado', phrase: 'rapado arriba', topGuard: null, preset: 'n12' },
          { id: 'maquina', label: 'Corto a máquina', phrase: 'arriba corto a máquina', topGuard: '2', preset: 'n13' },
          { id: 'crop', label: 'Crop texturizado', phrase: 'crop texturizado', topGuard: '2', preset: 'n7' },
          { id: 'tijera', label: 'A tijera', phrase: 'arriba a tijera', topGuard: '3', preset: 'n2' },
          { id: 'tupe', label: 'Tupé', phrase: 'tupé', topGuard: '2', preset: 'n8' },
          { id: 'atras', label: 'Hacia atrás', phrase: 'peinado hacia atrás', topGuard: '2', preset: 'n10' },
          { id: 'raya', label: 'Raya al lado', phrase: 'raya al lado', topGuard: '3', preset: 'n11' },
          { id: 'pompadour', label: 'Pompadour', phrase: 'pompadour', topGuard: '3', preset: 'n9' },
          { id: 'rizos', label: 'Rizos', phrase: 'rizos', topGuard: '2', preset: 'n15' },
          { id: 'mullet', label: 'Mullet', phrase: 'mullet', topGuard: '2', preset: 'n14' },
        ],
      },
    ],
  },
  {
    id: 'barba',
    part: 'barba',
    legend: 'Barba',
    fields: [
      {
        id: 'barba',
        key: 'barba',
        label: 'Barba',
        options: [
          { id: 'ninguna', label: 'Sin barba', phrase: 'sin barba', beard: null },
          { id: 'tres-dias', label: 'Tres días', phrase: 'con barba de tres días', beard: 'b17' },
          { id: 'corta', label: 'Corta', phrase: 'con barba corta', beard: 'b18' },
          { id: 'degradada', label: 'Degradada', phrase: 'con barba degradada', beard: 'b19' },
          { id: 'completa', label: 'Completa', phrase: 'con barba completa', beard: 'b20' },
          { id: 'candado', label: 'Candado', phrase: 'con candado', beard: 'b21' },
          { id: 'afeitado', label: 'Afeitado', phrase: 'con afeitado clásico', beard: 'b16', claim: 'afeitado' },
        ],
      },
    ],
  },
  {
    id: 'acabado',
    part: 'acabado',
    legend: 'Acabado',
    fields: [
      {
        id: 'acabado',
        key: 'acabado',
        label: 'Acabado',
        options: [
          { id: 'seco', label: 'En seco', includes: 'seco' },
          { id: 'producto', label: 'Con producto', includes: 'producto' },
          { id: 'lavado', label: 'Lavado y peinado', includes: 'lavado' },
          { id: 'toalla', label: 'Toalla caliente', includes: 'toalla', claim: 'hotTowel' },
        ],
      },
    ],
  },
];

// Option readiness follows the gated looks named in the plan (burst, pompadour,
// rizos, mullet, candado) and the Carta: an option whose preset look is not READY
// (crop n7, hacia atrás n10, raya n11) stays off the composer too.
const GATED_OPTIONS = new Set(['burst', 'pompadour', 'rizos', 'mullet', 'candado']);

function buildIngredients({ claims, services } = {}) {
  const haircut = services ? services.filter((s) => (s.includes || []).includes('corte')) : null;
  const keep = (opt, fieldId) => {
    if (opt.claim && claims && !claims[opt.claim]) return false;
    if (fieldId === 'acabado' && haircut) return haircut.some((s) => (s.includes || []).includes(opt.includes));
    return true;
  };
  return INGREDIENT_DEFS.map((set) => ({
    ...set,
    fields: set.fields.map((f) => ({
      ...f,
      options: f.options.filter((o) => keep(o, f.id)).map((o) => ({ ...o, ready: !GATED_OPTIONS.has(o.id) && (!o.preset || READY.has(o.preset)) })),
    })),
  }));
}

// ---------------------------------------------------------------- build

/**
 * Builds the programs for one shop: its guard table (stamps and captions), its
 * confirmed claims (story notes, afeitado, toalla) and its services (acabado
 * options), and sets serviceId from its SERVICE_MAP:
 *   { cuts: {default, <id>: serviceId}, beards: {default, <id>: serviceId|null}, cutAndBeard }
 */
export function buildCatalog({ guards = STANDARD_GUARDS, claims = {}, services, serviceMap } = {}) {
  const serviceOf = (p) => {
    if (!serviceMap) return null;
    if (p.kind === 'story') return serviceMap.cutAndBeard ?? null;
    const table = p.kind === 'beard' ? serviceMap.beards : serviceMap.cuts;
    if (!table) return null;
    return p.id in table ? table[p.id] : (table.default ?? null);
  };
  const bind = (raw) => {
    const p = makeProgram(raw, guards);
    p.serviceId = serviceOf(p);
    return p;
  };
  const CUTS = CUT_DEFS.map(bind);
  const BEARDS = BEARD_DEFS.map(bind);
  const STORY = bind(storyDef(claims));
  STORY.ready = true;
  const INGREDIENTS = buildIngredients({ claims, services });
  return { CUTS, BEARDS, STORY, INGREDIENTS };
}

// Defaults: standard guards, nothing claimed, no service filter or mapping.
const DEFAULT = buildCatalog();
export const CUTS = DEFAULT.CUTS;
export const BEARDS = DEFAULT.BEARDS;
export const STORY = DEFAULT.STORY;
export const INGREDIENTS = DEFAULT.INGREDIENTS;
/** Every composer option before any shop filter (compose.js and ficha.js read option data here). */
export const ALL_INGREDIENTS = buildIngredients({ claims: null, services: null });

export const programById = (id, list = [...CUTS, ...BEARDS]) => list.find((p) => p.id === id) || null;


/**
 * fitFilm(steps) → steps: shortens the working steps of a long program (in place, never under
 * 2.5 s; otherSide and the mirror keep their beat) so the film stays within FILM_MAX_S.
 */
export function fitFilm(steps, max = FILM_MAX_S - 0.5) {
  const over = filmOnScreen(steps) - max;
  if (over <= 0) return steps;
  const flex = steps.filter((s) => s.op !== 'otherSide' && s.op !== 'mirror' && s.op !== 'hold' && s.dur > 2.5);
  const room = flex.reduce((t, s) => t + s.dur - 2.5, 0);
  const k = room > 0 ? Math.min(1, over / room) : 0;
  for (const s of flex) s.dur = Math.max(2.5, Math.floor((s.dur - (s.dur - 2.5) * k) * 10) / 10);
  return steps;
}

/** Seconds of working time in a program (sum of dur). */
export const filmSeconds = (program) => program.steps.reduce((t, s) => t + s.dur, 0);

// ---------------------------------------------------------------- validation

// Nominal heights in mm along the side of the head, only to check that bands and
// steps climb in the right order; the real ones come from the head (hairField).
const NOMINAL = { NUCA: 0, OREJA: 45, SIEN: 75, ESQUINA: 110, CORONILLA: 150, PATILLA: 55, FLEQUILLO: 140, NUEZ: -60 };
const nominal = (h) => NOMINAL[h.lm] + (h.dedos || 0) * 15;
/** Nominal height of a Height in mm above the nape (ordering only; see NOMINAL). */
export const nominalMM = nominal;

function checkHeight(h, where, errors) {
  if (!h || typeof h !== 'object' || !LANDMARK_NAMES.includes(h.lm)) errors.push(`${where}: bad height ${JSON.stringify(h)}`);
  else if (h.dedos != null && typeof h.dedos !== 'number') errors.push(`${where}: dedos must be a number`);
}

/** Returns a list of problems (empty when the program follows the schema). */
export function validateProgram(p, { guards = STANDARD_GUARDS } = {}) {
  const e = [];
  const id = p?.id || '?';
  if (!p || typeof p !== 'object') return ['not an object'];
  if (typeof p.id !== 'string') e.push('id');
  if (!KINDS.includes(p.kind)) e.push(`${id}: kind ${p.kind}`);
  if (typeof p.name !== 'string' || !p.name) e.push(`${id}: name`);
  if ((p.kind === 'cut' || p.kind === 'beard') && !Number.isInteger(p.n)) e.push(`${id}: n`);
  if (p.family != null && !FAMILIES.some((f) => f.id === p.family)) e.push(`${id}: family ${p.family}`);
  if (typeof p.ficha !== 'string' || !p.ficha.endsWith('.')) e.push(`${id}: ficha`);
  if (!p.recipe || typeof p.recipe !== 'object') e.push(`${id}: recipe`);
  if (typeof p.ready !== 'boolean') e.push(`${id}: ready`);
  if (!p.mix || !('laterales' in p.mix) || !('arriba' in p.mix) || !('barba' in p.mix) || !('acabado' in p.mix)) e.push(`${id}: mix`);
  if (!Array.isArray(p.steps) || !p.steps.length) return [...e, `${id}: steps`];

  // spec
  const sp = p.spec || {};
  if (sp.sides) {
    if (!['line', 'drop', 'burst', 'taper', 'uniform', 'scissor'].includes(sp.sides.shape)) e.push(`${id}: sides.shape`);
    let last = -Infinity;
    for (const b of sp.sides.bands || []) {
      if (!GUARD_IDS.includes(b.guard)) e.push(`${id}: band guard ${b.guard}`);
      checkHeight(b.upTo, `${id} band`, e);
      if (b.upTo && nominal(b.upTo) <= last) e.push(`${id}: bands must climb bottom→top`);
      if (b.upTo) last = nominal(b.upTo);
    }
    const mm = (sp.sides.bands || []).map((b) => guards[b.guard]);
    if (mm.some((v, i) => i && v <= mm[i - 1])) e.push(`${id}: band guards must lengthen bottom→top`);
  }
  if (sp.nape && !['natural', 'round', 'square', 'long'].includes(sp.nape.shape)) e.push(`${id}: nape.shape`);
  if (sp.top) {
    const t = sp.top;
    if (typeof t.frontMM !== 'number' || typeof t.crownMM !== 'number') e.push(`${id}: top mm`);
    if (!['forward', 'up', 'back', 'side', 'down'].includes(t.fringe)) e.push(`${id}: top.fringe`);
    for (const k of ['lift', 'texture', 'shine']) if (!(t[k] >= 0 && t[k] <= 1)) e.push(`${id}: top.${k}`);
  }
  if (sp.beard) {
    if (!['none', 'shaved', 'stubble', 'short', 'faded', 'full', 'goatee'].includes(sp.beard.style)) e.push(`${id}: beard.style`);
    for (const [z, v] of Object.entries(sp.beard.zones || {})) {
      if (v != null && typeof v !== 'number' && !GUARD_IDS.includes(v)) e.push(`${id}: beard zone ${z}`);
    }
  }

  // steps
  p.steps.forEach((s, i) => {
    const w = `${id}#${i}`;
    if (!PARTS.includes(s.part)) e.push(`${w}: part ${s.part}`);
    if (!OPS.includes(s.op)) e.push(`${w}: op ${s.op}`);
    if (!ZONES.includes(s.zone)) e.push(`${w}: zone ${s.zone}`);
    if (!SHOTS.includes(s.shot)) e.push(`${w}: shot ${s.shot}`);
    if (s.tool !== null && !TOOLS.includes(s.tool)) e.push(`${w}: tool ${s.tool}`);
    if (s.anchor != null && !ANCHOR_NAMES.includes(s.anchor)) e.push(`${w}: anchor ${s.anchor}`);
    if (s.lever != null && !LEVERS.includes(s.lever)) e.push(`${w}: lever`);
    if (typeof s.label !== 'string' || !s.label) e.push(`${w}: label`);
    if (typeof s.caption !== 'string' || !s.caption) e.push(`${w}: caption`);
    if (s.guard != null) {
      if (!GUARD_IDS.includes(s.guard) || !(s.guard in guards)) e.push(`${w}: guard ${s.guard}`);
      if (!s.stamp) e.push(`${w}: guard without stamp`);
      else if (s.op === 'clipper' && p.kind !== 'story' && !s.caption.startsWith(s.stamp) && !s.caption.includes(s.stamp.replace('Peine de ', 'peine de '))) e.push(`${w}: caption must carry the stamp`);
    }
    if (s.op === 'clipper' && s.guard == null) e.push(`${w}: clipper pass without guard`);
    if (s.upTo) checkHeight(s.upTo, `${w} upTo`, e);
    if (s.from) checkHeight(s.from, `${w} from`, e);
    if (s.from && s.upTo && nominal(s.from) >= nominal(s.upTo)) e.push(`${w}: from must be below upTo`);
    if (s.lengthMM != null) {
      const ok = typeof s.lengthMM === 'number' || (Array.isArray(s.lengthMM) && s.lengthMM.length === 2 && s.lengthMM.every((v) => typeof v === 'number'));
      if (!ok) e.push(`${w}: lengthMM`);
    }
    if (typeof s.dur !== 'number') e.push(`${w}: dur`);
    else if (s.op === 'otherSide') {
      if (s.dur !== 1.5 || s.shot !== 'nuca') e.push(`${w}: otherSide is 1.5 s on the nape`);
    } else if (s.op !== 'hold' && p.kind !== 'story' && (s.dur < 2.5 || s.dur > 5)) e.push(`${w}: dur ${s.dur} outside 2.5–5 s`);
    if (p.kind === 'story') {
      if (!BEATS.includes(s.beat)) e.push(`${w}: beat`);
      if (!Array.isArray(s.at) || s.at.length !== 2 || !(s.at[0] >= 0 && s.at[0] < s.at[1] && s.at[1] <= 1)) e.push(`${w}: at`);
    }
  });

  if (p.kind === 'cut' || p.kind === 'beard') {
    const t = filmSeconds(p);
    if (t < 12 || t > 35) e.push(`${id}: film ${t} s outside 12–35 s`);
    if (filmOnScreen(p.steps) > FILM_MAX_S + 1e-9) e.push(`${id}: film runs ${filmOnScreen(p.steps).toFixed(1)} s on screen (max ${FILM_MAX_S})`);
    if (p.steps.at(-1).op !== 'mirror') e.push(`${id}: a film ends in the hand mirror`);
    if (p.steps.filter((s) => s.op === 'mirror').length !== 1) e.push(`${id}: one mirror step`);
  }
  if (p.kind === 'story') {
    for (const beat of BEATS) {
      const r = p.steps.filter((s) => s.beat === beat).map((s) => s.at);
      if (r.some((a, i) => i && a[0] < r[i - 1][1] - 1e-9)) e.push(`${id}: ${beat} ranges overlap or go backwards`);
    }
  }
  return e;
}
