// 'Compón tu corte': turns the composer's ingredients into a Program the head can
// play, the recipe card can print and the WhatsApp message can carry.
//
// compose(mix, client):
// - a mix that is exactly a Carta program's mix returns that program as it is;
// - a mix whose sides and top are a Carta cut's (only the finish or the beard
//   differ) keeps that cut's passes, name and ficha, so changing the finish never
//   changes the sides;
// - anything else is built like a barber would: the guard ladder from
//   laterales.desde up to the guard the top asks for (bands at landmark heights
//   for bajo/medio/alto, edge only for taper, an arc for burst, one guard without
//   a fade), then the top, the beard and the finish, in that order.
// Minutes and price come from the service the mix books (serviceFor, ficha.js).
//
// Steps are grouped by part and the parts never interleave
// (laterales → arriba → barba → acabado), so the composer can replay one part.
// Pure ES module (no DOM).
import { normalizeStep, nominalMM, guardName, STANDARD_GUARDS } from './catalog.js';
import {
  clientData,
  normalizeMix,
  findPreset,
  hairBase,
  optionOf,
  mixOf,
  serviceIdForMix,
  formatFicha,
  MIX_PARTS,
} from './ficha.js';

export { mixOf };

// ---------------------------------------------------------------- guards and heights

const H = (lm, dedos) => (dedos ? { lm, dedos } : { lm });
// The guards a barber climbs through (1,5 is only for blending a mano alzada).
const SEQ = ['piel', '0', '0,5', '1', '2', '3', '4', '6', '8'];
const rank = (g) => SEQ.indexOf(g);
const above = (g) => SEQ[Math.min(rank(g) + 1, SEQ.length - 1)];
const maxG = (a, b) => (rank(a) >= rank(b) ? a : b);
const range = (lo, hi) => SEQ.filter((g) => rank(g) >= rank(lo) && rank(g) <= rank(hi));

// Band tops by fade height, bottom → top, indexed by the number of guards.
// The short guards (desde, and anything up to the 1) end at the line; the longer
// ones climb to the corner. Nº 1, 2, 3 and 4 come out of these tables exactly.
const LOWER = {
  bajo: [[], [H('OREJA', 1)], [H('OREJA'), H('OREJA', 1)], [H('OREJA', -1), H('OREJA'), H('OREJA', 1)]],
  medio: [[], [H('SIEN')], [H('OREJA', 1), H('SIEN')], [H('OREJA'), H('OREJA', 1), H('SIEN')]],
  alto: [[], [H('ESQUINA')], [H('ESQUINA', -2), H('ESQUINA')], [H('ESQUINA', -3), H('ESQUINA', -2), H('ESQUINA')]],
};
const UPPER = {
  bajo: [[], [H('ESQUINA')], [H('SIEN'), H('ESQUINA')]],
  medio: [[], [H('ESQUINA')], [H('ESQUINA', -1), H('ESQUINA')]],
  // A high fade has one guard over the corner, the bridge into the top (Nº 3).
  alto: [[], [H('ESQUINA', 1)]],
};
// Taper: only the last centimetres of sideburn and nape (Nº 5, 9, 11).
const EDGE = [[], [H('NUCA', 2)], [H('NUCA', 1), H('NUCA', 2)], [H('NUCA'), H('NUCA', 1), H('NUCA', 2)], [H('NUCA'), H('NUCA', 1), H('NUCA', 2), H('NUCA', 3)]];
// Burst: arc radii around the ear (Nº 6).
const ARC = [[], [H('SIEN')], [H('OREJA'), H('SIEN')], [H('OREJA'), H('OREJA', 1), H('SIEN')], [H('OREJA'), H('OREJA', 1), H('SIEN'), H('ESQUINA', -1)]];

const LINE = {
  bajo: 'línea a un dedo por encima de la oreja',
  medio: 'línea a la altura de la sien',
  alto: 'línea en la esquina',
};
const LINE_RECIPE = { bajo: 'a un dedo por encima de la oreja', medio: 'a la altura de la sien', alto: 'en la esquina' };

const DEDOS = ['', 'un dedo', 'dos dedos', 'tres dedos', 'cuatro dedos'];

/** Where a pass goes, as the barber says it. */
function heightPhrase(h) {
  const d = h.dedos || 0;
  const n = DEDOS[Math.abs(d)];
  const rel = (name) => (d === 0 ? `hasta ${name}` : `hasta ${n} por ${d > 0 ? 'encima' : 'debajo'} de ${name}`);
  if (h.lm === 'ESQUINA') return d > 0 ? 'por encima de la esquina' : rel('la esquina');
  if (h.lm === 'SIEN') return rel('la sien');
  if (h.lm === 'OREJA') return d === 0 ? 'hasta la altura de la oreja' : rel('la oreja');
  if (h.lm === 'NUCA') return d === 0 ? 'el borde' : `hasta ${n} del borde`;
  return '';
}
const oneLower = (h, prev) => !!prev && h.lm === prev.lm && (prev.dedos || 0) - (h.dedos || 0) === 1;
const ANCHOR = { ESQUINA: 'esquina', SIEN: 'sien', OREJA: 'oreja', NUCA: 'nuca' };
const pref = (g) => (g === 'piel' ? 'A piel' : g === '0' ? 'Al 0' : `Peine del ${g}`);
const sidesRange = (lo, hi) => (lo === 'piel' ? `de piel al ${hi}` : `del ${hi} al ${lo}`);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const low = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const dot = (s) => (s.endsWith('.') ? s : `${s}.`);
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

// ---------------------------------------------------------------- raw steps

const clip = (guard, zone, upTo, label, o = {}) => {
  const s = { part: 'laterales', op: 'clipper', zone, guard, upTo, label, ...o };
  if (guard === '0') s.lever = 'closed';
  if (guard === 'piel') Object.assign(s, { tool: 'trimmer', shot: o.shot || 'detalle-oreja', anchor: o.anchor || 'oreja' });
  return s;
};
const blend = (upTo, label, o = {}) => ({ part: 'laterales', op: 'blend', zone: 'sidesNape', lever: 'half', upTo, label, dur: 4, ...o });
const OTHER_SIDE = { part: 'laterales', op: 'otherSide', zone: 'sidesNape', label: 'Igual en el otro lado', caption: 'Igual en el otro lado.', shot: 'nuca', dur: 1.5, anchor: 'nuca' };
const finish = (op, zone, label, o = {}) => ({ part: 'acabado', op, zone, label, ...o });

// ---------------------------------------------------------------- the top

// What each 'arriba' option means: its Carta cut (steps, spec, recipe line), the
// ficha clause, and how it is finished (product, dryer, combing).
const TOPS = {
  rapado: { preset: 'n12', style: 'short' },
  maquina: { preset: 'n13', ficha: 'arriba 2–3 cm a máquina, más largo delante', product: 'cera mate' },
  crop: { preset: 'n7', ficha: 'arriba 3 cm con textura hacia delante, flequillo recto a 1–2 cm', product: 'pasta mate' },
  tijera: { preset: 'n2', ficha: 'arriba 4 cm a tijera', product: 'cera mate' },
  tupe: { preset: 'n8', ficha: 'delante 6–8 cm, coronilla 4–5 cm, peinado hacia arriba y atrás', product: 'pomada de fijación media', dryer: 'secador con cepillo hacia arriba', style: 'styled' },
  atras: { preset: 'n10', ficha: 'arriba 8–12 cm solo puntas, todo hacia atrás', withProduct: ' con pomada', product: 'pomada con brillo', how: 'peinado hacia atrás con peine', style: 'combed' },
  raya: { preset: 'n11', ficha: 'arriba 5–7 cm, raya marcada a navaja a la izquierda', product: 'pomada mate', how: 'peinado de lado con peine', style: 'combed' },
  pompadour: { preset: 'n9', ficha: 'delante 8–12 cm, coronilla 6–8 cm, hacia atrás', withProduct: ' con brillo', product: 'pomada con brillo', how: 'peinado hacia atrás con peine', dryer: 'secador con cepillo redondo', style: 'styled' },
  rizos: { preset: 'n15', ficha: 'arriba 4–7 cm de rizo cortado en seco', product: 'crema de rizos', style: 'curls' },
  mullet: { preset: 'n14', ficha: 'arriba 4–6 cm con textura, nuca larga desfilada', product: 'crema de peinado' },
};
// Tops cut with scissors: on a taper or without a fade they need the scissor-over-comb bridge.
const SCISSOR_TOPS = new Set(['crop', 'tijera', 'tupe', 'atras', 'raya', 'pompadour', 'rizos', 'mullet']);
const WITH_PRODUCT = new Set(['producto', 'lavado', 'toalla']);

// The guard a rapado top takes: the side guard without a fade, else a 3 (or one
// above the bottom guard) so the sides climb into it.
const rapadoGuard = (altura, desde) => (altura === 'sin' ? desde : maxG('3', above(desde || '0')));

/** The guard the side ladder climbs to, implied by the top. */
function topGuardFor(altura, desde, arriba) {
  if (!arriba) return '3';
  if (arriba === 'rapado') return rapadoGuard(altura, desde);
  return optionOf('arriba', arriba)?.topGuard || '3';
}

// ---------------------------------------------------------------- the sides

function buildSides(altura, desde, arriba, C) {
  const mullet = arriba === 'mullet';
  const zone = mullet ? 'sides' : 'sidesNape';
  const want = topGuardFor(altura, desde, arriba);
  const steps = [];
  let bands;
  let info;

  if (altura === 'sin') {
    const g = desde;
    const where = mullet ? 'los lados, sin tocar la nuca' : 'los lados y la nuca';
    steps.push(clip(g, zone, H('ESQUINA'), `${pref(g)} · ${where}${arriba === 'rapado' ? ', a contrapelo' : ''}`, { dur: 4.5, anchor: 'sien', shot: g === 'piel' ? 'perfil' : undefined }));
    bands = [[g, H('ESQUINA')]];
    info = { shape: 'uniform', bottom: g, top: g, blend: false };
  } else if (altura === 'taper') {
    const side = maxG(maxG(want, '3'), above(desde));
    const edge = range(desde, side).filter((g) => g !== side && (g !== '0,5' || g === desde)).slice(-4);
    const heights = EDGE[edge.length];
    const strip = mullet ? 'solo la patilla' : 'solo patilla y nuca';
    steps.push(clip(side, zone, H('ESQUINA'), `${pref(side)} · ${mullet ? 'el lateral, para igualar' : 'lateral y nuca, para igualar'}`, { dur: 3.5, anchor: 'sien' }));
    for (let i = edge.length - 1; i >= 0; i--) {
      const g = edge[i];
      const h = heights[i];
      const topmost = i === edge.length - 1;
      let where;
      if (topmost) where = `${strip}, los últimos centímetros`;
      else if ((h.dedos || 0) === 0) where = g === 'piel' ? 'afeitadora en el borde' : 'el borde';
      else where = `${strip}, un dedo más abajo`;
      const edgeShot = (h.dedos || 0) === 0 ? 'detalle-nuca' : 'tresCuartosAtras';
      steps.push(clip(g, zone, h, `${pref(g)} · ${where}`, { shot: edgeShot, anchor: 'nuca', dur: (h.dedos || 0) === 0 ? 2.5 : 3 }));
    }
    steps.push(blend(heights.at(-1), 'A mano alzada · que no se vea la línea', { zone, shot: 'tresCuartosAtras', anchor: 'nuca', dur: 3.5 }));
    steps.push({ ...OTHER_SIDE });
    bands = [...edge.map((g, i) => [g, heights[i]]), [side, H('ESQUINA')]];
    info = { shape: 'taper', bottom: edge[0], edgeTop: edge.at(-1), top: side, blend: true };
  } else if (altura === 'burst') {
    const top = maxG('2', above(desde));
    const arc = range(desde, top).filter((g) => g !== '0,5' || g === desde).slice(-4);
    const heights = ARC[arc.length];
    for (let i = arc.length - 1; i >= 0; i--) {
      const g = arc[i];
      const h = heights[i];
      let where;
      let o = { zone: 'sides' };
      if (i === arc.length - 1) {
        where = 'el lateral, sin tocar la nuca';
        o = { dur: 3.5, anchor: 'sien' };
      } else if (i === 0) {
        where = g === 'piel' ? 'afeitadora, un arco alrededor de la oreja' : 'un arco alrededor de la oreja';
        o = { shot: 'detalle-oreja', anchor: 'oreja', dur: 3.5 };
      } else {
        where = h.lm === 'OREJA' ? 'un arco a un dedo de la oreja' : `el arco, ${heightPhrase(h)}`;
        o = { anchor: 'oreja' };
      }
      steps.push(clip(g, 'sides', h, `${pref(g)} · ${where}`, o));
    }
    steps.push(blend(heights.at(-1), 'A mano alzada · que el arco quede redondo', { zone: 'sides', dur: 3.5 }));
    steps.push({ ...OTHER_SIDE });
    if (!mullet) {
      steps.push({ part: 'laterales', op: 'scissor', zone: 'nape', lengthMM: 50, label: 'Tijera · la nuca se deja larga; solo se limpia el contorno', shot: 'nuca', anchor: 'nuca' });
    }
    bands = arc.map((g, i) => [g, heights[i]]);
    info = { shape: 'burst', bottom: arc[0], top, blend: true };
  } else {
    // bajo, medio, alto
    const top = maxG(want, above(desde));
    let ladder = range(desde, top);
    if (desde === 'piel') ladder = ladder.filter((g) => g !== '0,5'); // skin fades blend with the 0,5 (Nº 4)
    const lower = ladder.filter((g) => g === desde || rank(g) <= rank('1'));
    let upper = ladder.filter((g) => !lower.includes(g));
    if (altura === 'alto') upper = upper.slice(0, 1);
    const guards = [...lower, ...upper];
    const heights = [...LOWER[altura][lower.length], ...UPPER[altura][upper.length]];
    for (let i = guards.length - 1; i >= 0; i--) {
      const g = guards[i];
      const h = heights[i];
      let where;
      let o = {};
      if (i === guards.length - 1) {
        where = mullet ? 'el lateral, sin tocar la nuca' : altura === 'alto' ? 'todo el lateral' : 'todo el lateral, hasta la esquina';
        o = { dur: 3.5, anchor: 'esquina' };
      } else if (i === 0) {
        if (altura === 'alto') where = mullet ? 'el resto del lateral' : 'el resto del lateral y la nuca';
        else if (g === 'piel') where = 'afeitadora en el borde de abajo';
        else if (nominalMM(h) <= nominalMM(H('OREJA'))) where = mullet ? 'alrededor de la oreja' : 'alrededor de la oreja y en la nuca';
        else where = mullet ? heightPhrase(h) : `${heightPhrase(h)} y en la nuca`;
        if (g === 'piel' && altura === 'alto') where = `afeitadora, ${where}`;
        o = g === 'piel' ? { dur: 3.5 } : { shot: 'tresCuartosAtras', anchor: mullet ? 'oreja' : 'nuca', dur: altura === 'alto' ? 3.5 : 3 };
      } else {
        where = oneLower(h, heights[i + 1]) ? 'un dedo más abajo' : heightPhrase(h);
        o = { anchor: ANCHOR[h.lm] };
      }
      steps.push(clip(g, zone, h, `${pref(g)} · ${where}`, o));
    }
    if (desde === 'piel') {
      steps.push(blend(heights[lower.length - 1], `A mano alzada · palanca y peine del 0,5 para unir la piel con el ${lower[2] || lower.at(-1)}`, { zone, guard: '0,5' }));
    } else {
      steps.push(blend(heights.at(-1), 'A mano alzada · hasta que no se vea el escalón', { zone }));
    }
    steps.push({ ...OTHER_SIDE });
    bands = guards.map((g, i) => [g, heights[i]]);
    info = { shape: 'line', bottom: guards[0], top: guards.at(-1), blend: true };
  }

  // The outline, done right after the sides (Nº 1–4, 6 wording); a taper is left natural.
  const contourFrom = altura === 'taper' ? null : altura === 'burst' ? 'n6' : desde === 'piel' && altura !== 'sin' ? 'n4' : { bajo: 'n1', medio: 'n2', alto: 'n3', sin: 'n1' }[altura];
  if (contourFrom) {
    const c = C.CUTS.find((p) => p.id === contourFrom)?.steps.find((s) => s.part === 'laterales' && s.zone === 'contour');
    if (c) steps.push(clone(c));
  }

  const spec = {
    shape: info.shape,
    bands: bands.map(([guard, upTo]) => ({ guard, upTo })),
    blend: info.blend,
  };
  return { steps, spec, info };
}

// ---------------------------------------------------------------- the finish

function productSteps(C, ids) {
  for (const id of ids) {
    const p = C.CUTS.find((x) => x.id === id);
    const s = p?.steps.filter((x) => x.part === 'acabado' && (x.op === 'product' || x.op === 'dryer'));
    if (s && s.length) return s.map(clone);
  }
  return [];
}

function buildFinish({ acabado, arriba, hair, beardSteps, laterales, productFrom, C }) {
  if (!acabado) return [];
  const top = TOPS[arriba] || {};
  // A rapado takes product only when asked for it (Nº 12: sin producto).
  let products = [];
  if (hair && arriba !== 'rapado') products = productSteps(C, [productFrom, top.preset, 'n1']);
  else if (hair && acabado === 'producto') products = productSteps(C, ['n1']);
  const dryers = products.filter((s) => s.op === 'dryer');
  const out = [];
  const towelTop = finish('towel', 'top', 'Lavado · champú y secado con toalla', { tool: 'towel', shot: 'tresCuartos', anchor: 'coronilla', dur: 3 });
  const towelFace = finish('towel', 'beard', 'Toalla caliente · un par de minutos', { tool: 'towel', shot: 'frente', anchor: 'barbilla', dur: 3.5 });
  if (acabado === 'seco') {
    if (!hair) return [];
    if (top.style === 'styled') out.push(...dryers);
    else if (top.style === 'combed') out.push(finish('comb', 'top', 'Peinado · con peine, sin producto', { tool: 'comb', shot: 'perfil', anchor: 'coronilla', dur: 3 }));
    else if (laterales?.altura !== 'taper') out.push(finish('neckBrush', 'neck', 'Acabado · en seco, sin producto', { shot: 'detalle-nuca', anchor: 'nuca', dur: 2.5 }));
    else out.push(finish('neckBrush', 'neck', 'Acabado · contorno natural, sin marcar', { shot: 'detalle-nuca', anchor: 'nuca', dur: 3 }));
  } else if (acabado === 'producto') {
    out.push(...products);
  } else if (acabado === 'lavado') {
    out.push(towelTop);
    if (hair && arriba !== 'rapado') {
      if (!dryers.length && top.style !== 'curls') out.push(finish('dryer', 'top', 'Secador y peine · peinado', { shot: 'perfil', anchor: 'flequillo', dur: 3 }));
      out.push(...products);
    }
  } else if (acabado === 'toalla') {
    if (!beardSteps.some((s) => s.op === 'towel')) out.push(towelFace);
    out.push(...products);
  }
  return out.map((s) => ({ ...s, part: 'acabado' }));
}

function finishText(acabado, arriba) {
  const t = TOPS[arriba] || {};
  const prod = t.product ? [t.dryer, t.product + (t.how ? `, ${t.how}` : '')].filter(Boolean).join('; ') : arriba === 'rapado' ? '' : 'cera mate';
  if (acabado === 'seco') return t.style === 'styled' ? `${t.dryer}, sin producto` : t.style === 'combed' ? 'peinado con peine, sin producto' : 'en seco, sin producto';
  if (acabado === 'producto') return prod || 'cera mate';
  if (acabado === 'lavado') return prod ? `lavado; ${prod}` : 'lavado, sin producto';
  if (acabado === 'toalla') return prod ? `toalla caliente; ${prod}` : 'toalla caliente';
  return '';
}

function contourText(altura, desde) {
  if (altura === 'taper') return 'Contorno natural, sin línea marcada';
  if (altura === 'burst') return 'Perfilado del arco con trimmer';
  if (desde === 'piel' && altura !== 'sin') return 'Afeitadora o navaja en la piel';
  if (altura === 'bajo' || altura === 'sin') return 'Perfilado con trimmer';
  return 'Perfilado con trimmer y navaja';
}

// ---------------------------------------------------------------- texts

const REPASO = { bajo: 'Cada 3–4 semanas.', medio: 'Cada 2–3 semanas.', alto: 'Cada 2 semanas.', taper: 'Cada 3–4 semanas.', burst: 'Cada 2–3 semanas.', sin: 'Cada 2–3 semanas.' };
const NO_BEARD = { style: 'none', zones: { patilla: null, mejilla: null, barbilla: null, bigote: null, cuello: null }, cheek: 'natural', neckDedos: null, razor: false };

function joinBeard(name, beardOpt, beardName) {
  if (!beardName) return name;
  if (!name) return beardName;
  const phrase = beardOpt.phrase; // 'con barba corta', 'con candado'
  if (/ con /.test(name)) return `${name} y ${phrase.replace(/^con /, '')}`;
  if (/ y /.test(name)) return `${name}, ${phrase}`;
  return `${name} ${phrase}`;
}

function topClause(altura, arriba, R, acabado) {
  if (!arriba) return null;
  if (arriba === 'rapado') return altura === 'sin' ? null : `arriba ${guardName(R)}`;
  const t = TOPS[arriba];
  return t.ficha + (t.withProduct && WITH_PRODUCT.has(acabado) ? t.withProduct : '');
}

// ---------------------------------------------------------------- compose

const emptySpec = () => ({ sides: null, nape: null, top: null, beard: null });
const idOf = (m) =>
  'mix-' + [m.laterales?.altura, m.laterales?.desde, m.arriba, m.barba, m.acabado].map((v) => (v ? v.replace(',', '') : 'x')).join('-');

/**
 * The program for a composer mix (see the top of the file). `client` is a client
 * module's exports; without it the shop-neutral catalogue is used.
 * Composed programs add `base: {cut, beard}` (the Carta programs they reuse) and
 * `labels: {cut, beard}` (names for the booking line '{Servicio}: {corte}, con …').
 */
export function compose(mix, client) {
  const C = clientData(client);
  const asked = normalizeMix(mix);

  const preset = findPreset(asked, C);
  if (preset) return clone(preset);

  // Options the shop does not offer (claims, services) are left out.
  const offered = (field, id) => (id && optionOf(field, id, C.INGREDIENTS) ? id : null);
  const lat = asked.laterales
    ? { altura: offered('altura', asked.laterales.altura), desde: offered('desde', asked.laterales.desde) }
    : null;
  const m = {
    laterales: lat && (lat.altura || lat.desde) ? lat : null,
    arriba: offered('arriba', asked.arriba),
    barba: offered('barba', asked.barba),
    acabado: offered('acabado', asked.acabado),
  };
  if (!sameAsAsked(asked, m)) {
    const again = findPreset(m, C);
    if (again) return clone(again);
  }

  const altura = m.laterales?.altura || null;
  const desde = m.laterales?.desde || null;
  const sidesDone = !!(altura && desde);
  const hair = sidesDone || !!m.arriba;
  const beardOpt = m.barba ? optionOf('barba', m.barba) : null;
  const beard = beardOpt?.beard ? C.BEARDS.find((p) => p.id === beardOpt.beard) || null : null;
  const base = hairBase(m, C);
  const complete = sidesDone && !!m.arriba && !!m.barba && !!m.acabado;

  const spec = emptySpec();
  const recipe = {};
  let lateralSteps = [];
  let topSteps = [];
  let name = '';
  let hairFicha = '';
  let desc;
  let R = null;

  if (base) {
    // A Carta cut with another finish or a beard: its own passes and words.
    lateralSteps = base.steps.filter((s) => s.part === 'laterales').map(clone);
    topSteps = base.steps.filter((s) => s.part === 'arriba').map(clone);
    Object.assign(spec, { sides: clone(base.spec.sides), nape: clone(base.spec.nape), top: clone(base.spec.top) });
    Object.assign(recipe, clone(base.recipe));
    name = base.name;
    desc = base.desc;
    hairFicha = base.ficha;
    if (m.acabado !== base.mix.acabado) {
      if (!WITH_PRODUCT.has(m.acabado)) hairFicha = hairFicha.replace(/ con (pomada|brillo)(?=[,.])/g, '');
      // Keep the cut's own first clause (its perfilado or technique) unless it is
      // about styling, which the new finish replaces.
      let first = (base.recipe.acabado || '').split(';')[0].replace(/\.$/, '');
      if (!first || /secador|pomada|cera|crema|pasta|polvo/i.test(first)) {
        first = base.steps.some((s) => s.part === 'laterales' && s.zone === 'contour') ? contourText(altura, desde) : '';
      }
      const fin = finishText(m.acabado, m.arriba);
      if (m.acabado) recipe.acabado = dot(first ? `${first}; ${fin}` : cap(fin));
      else delete recipe.acabado;
    }
  } else {
    const parts = [];
    if (sidesDone) {
      const sides = buildSides(altura, desde, m.arriba, C);
      lateralSteps = sides.steps;
      spec.sides = sides.spec;
      const { info } = sides;
      const alturaOpt = optionOf('altura', altura);
      desc = altura !== 'sin' ? C.CUTS.find((p) => p.id === alturaOpt?.preset)?.desc : undefined;
      if (info.shape === 'line') {
        parts.push(`lados ${sidesRange(info.bottom, info.top)}`, LINE[altura]);
        recipe.lados = `${cap(sidesRange(info.bottom, info.top))}, con la línea ${LINE_RECIPE[altura]}.`;
        recipe.nuca = altura === 'bajo' ? `${cap(guardName(info.bottom))} en el borde, contorno natural.` : altura === 'alto' ? `${cap(guardName(info.bottom))} casi entera.` : 'Degradada, contorno natural.';
      } else if (info.shape === 'taper') {
        const edge = info.edgeTop === info.bottom ? guardName(info.bottom) : sidesRange(info.bottom, info.edgeTop);
        parts.push(`lateral del ${info.top}`, `${m.arriba === 'mullet' ? 'patillas' : 'patillas y nuca'} ${edge} en el borde`);
        recipe.lados = `Peine del ${info.top}; el degradado, solo en el borde.`;
        recipe.nuca = `${cap(edge)} en los últimos 2–3 cm.`;
      } else if (info.shape === 'burst') {
        parts.push(`arco ${guardName(info.bottom)} alrededor de la oreja abriendo hasta el ${info.top}`);
        recipe.lados = `Un arco ${guardName(info.bottom)} alrededor de la oreja que se abre hasta el ${info.top}.`;
        recipe.nuca = 'Con largo, sin degradar.';
      } else {
        R = m.arriba === 'rapado' ? desde : null;
        parts.push(m.arriba === 'rapado' ? `todo ${guardName(desde)}` : `lados ${guardName(desde)}`);
        recipe.lados = m.arriba === 'rapado' ? `${cap(pref(desde))}.` : `${cap(pref(desde))}, sin degradado.`;
        recipe.nuca = m.arriba === 'rapado' ? 'Perfilada, del mismo peine.' : `${cap(guardName(desde))}, contorno natural.`;
      }
      if (m.arriba === 'mullet') recipe.nuca = 'Con largo (6–10 cm), desfilada.';
      spec.nape = m.arriba === 'mullet' ? { shape: 'long', lenMM: 80 } : altura === 'burst' ? { shape: 'long', lenMM: 50 } : { shape: 'natural' };
      recipe.repaso = m.arriba === 'mullet' ? 'Lados cada 3 semanas; nuca cada 6–8.' : desde === 'piel' ? 'Cada 2 semanas.' : REPASO[altura];
    }

    if (m.arriba) {
      const t = TOPS[m.arriba];
      const topPreset = C.CUTS.find((p) => p.id === t.preset);
      if (m.arriba === 'rapado') {
        R = R || (sidesDone ? rapadoGuard(altura, desde) : '2');
        const mm = C.GUARDS[R] ?? STANDARD_GUARDS[R];
        spec.top = { frontMM: mm, crownMM: mm, fringe: 'up', part: null, lift: 0, texture: 0, shine: 0, curl: null };
        topSteps.push(normalizeStep({ part: 'arriba', op: 'clipper', zone: 'top', guard: R, label: `${pref(R)} · arriba, a contrapelo`, shot: 'arriba', dur: 4, anchor: 'coronilla' }, C.GUARDS));
        recipe.arriba = altura === 'sin' ? 'El mismo peine.' : `${cap(pref(R))}, a contrapelo.`;
      } else {
        spec.top = clone(topPreset.spec.top);
        topSteps.push(...topPreset.steps.filter((s) => s.part === 'arriba').map(clone));
        recipe.arriba = topPreset.recipe.arriba;
        if (!spec.nape) spec.nape = m.arriba === 'mullet' ? { shape: 'long', lenMM: 80 } : { shape: 'natural' };
      }
      // A taper or unfaded side meets a scissor top with scissor over comb (Nº 5).
      if (sidesDone && (altura === 'taper' || altura === 'sin') && SCISSOR_TOPS.has(m.arriba)) {
        const sideGuard = spec.sides.bands.at(-1).guard;
        const sideMM = C.GUARDS[sideGuard] ?? 0;
        const topMM = Math.min(spec.top.frontMM, spec.top.crownMM);
        topSteps.unshift(
          normalizeStep(
            { part: 'arriba', op: 'scissorOverComb', zone: 'sides', from: H('ESQUINA'), upTo: H('ESQUINA', 1), lengthMM: Math.round((sideMM + topMM) / 2), label: 'Tijera sobre peine · unir el lateral con lo de arriba', dur: 4, anchor: 'esquina' },
            C.GUARDS,
          ),
        );
        if (altura === 'sin') parts.push('unidos con tijera sobre peine');
      }
      const clause = topClause(altura, m.arriba, R, m.acabado);
      if (clause) parts.push(clause);
      if (!sidesDone) recipe.repaso = 'Cada 3–4 semanas.';
    }

    if (sidesDone) {
      if (altura === 'taper') parts.push('contorno natural');
      else if (altura === 'sin' && m.arriba === 'rapado') parts.push('contornos perfilados');
      if (altura !== 'burst' && altura !== 'taper' && m.arriba !== 'mullet') parts.push('nuca natural');
      else if (altura === 'burst' && m.arriba !== 'mullet') parts.push('nuca larga');
    }

    // Names: '<laterales> con <arriba>' ('Degradado medio desde el 0 con crop
    // texturizado'); tops named by where they are ('arriba a tijera') join with 'y'.
    const alturaOpt = optionOf('altura', altura);
    const desdeOpt = optionOf('desde', desde);
    const topOpt = optionOf('arriba', m.arriba);
    let lname = '';
    let title = '';
    if (altura === 'sin') {
      lname = desde ? `${m.arriba === 'rapado' ? 'Rapado' : 'Lados'} ${guardName(desde)}` : 'Lados sin degradado';
      title = m.arriba === 'rapado' ? 'Rapado' : 'Sin degradado';
    } else if (altura) {
      lname = desde ? `${alturaOpt.name} ${desdeOpt.phrase}` : alturaOpt.name;
      title = `${alturaOpt.name}${desde === 'piel' && altura !== 'taper' && altura !== 'burst' ? ' a piel' : ''}`;
    }
    if (topOpt && !(altura === 'sin' && m.arriba === 'rapado')) {
      if (!lname) lname = m.arriba === 'rapado' ? 'Rapado' : cap(topOpt.phrase);
      else if (m.arriba === 'rapado') lname += sidesDone ? ` y arriba ${guardName(R)}` : ' y rapado arriba';
      else if (m.arriba === 'maquina' || m.arriba === 'tijera') lname += ` y ${topOpt.phrase}`;
      else lname += ` con ${topOpt.phrase}`;
      if (!title) title = m.arriba === 'rapado' ? 'Rapado' : cap(topOpt.label);
    }
    name = lname;
    if (!title) title = alturaOpt?.name || '';
    hairFicha = parts.length ? `${title}: ${parts.join(', ')}.` : '';
    if (m.acabado && hair) {
      recipe.acabado = dot(sidesDone ? `${contourText(altura, desde)}; ${finishText(m.acabado, m.arriba)}` : cap(finishText(m.acabado, m.arriba)));
    }
  }

  // The top's finish: without product it does not shine and sits lower.
  if (spec.top && !(base && m.acabado === base.mix.acabado) && !WITH_PRODUCT.has(m.acabado)) {
    spec.top.shine = 0;
    spec.top.lift = Math.round(spec.top.lift * 70) / 100;
  }

  // The beard.
  let beardSteps = [];
  if (m.barba === 'ninguna') spec.beard = clone(NO_BEARD);
  else if (beard) {
    spec.beard = clone(beard.spec.beard);
    beardSteps = beard.steps.filter((s) => s.op !== 'mirror').map(clone);
    if (beard.recipe.barba) recipe.barba = beard.recipe.barba;
    if (beard.recipe.contornos) recipe.contornos = beard.recipe.contornos;
    if (beard.recipe.acabado) recipe.acabado = recipe.acabado ? `${recipe.acabado} En la barba, ${low(beard.recipe.acabado)}` : beard.recipe.acabado;
    if (beard.recipe.repaso) recipe.repaso = recipe.repaso ? `${recipe.repaso} Barba: ${low(beard.recipe.repaso)}` : beard.recipe.repaso;
    if (!hair) desc = beard.desc;
  }

  // The finish.
  let finishSteps;
  if (base && m.acabado === base.mix.acabado) {
    finishSteps = base.steps.filter((s) => s.part === 'acabado' && s.op !== 'mirror').map(clone);
  } else {
    finishSteps = buildFinish({ acabado: m.acabado, arriba: m.arriba, hair, beardSteps, laterales: m.laterales, productFrom: base?.id, C });
  }

  const steps = [...lateralSteps, ...topSteps, ...beardSteps.map((s) => ({ ...s, part: 'barba' })), ...finishSteps].map((s) => normalizeStep(s, C.GUARDS));
  if (complete) {
    const end = C.CUTS[0]?.steps.at(-1);
    if (end && end.op === 'mirror') steps.push(clone(end));
  }

  const ficha = formatFicha({ ficha: hairFicha }, beard && m.barba !== 'ninguna' ? beard : null);
  const ready = ['altura', 'desde', 'arriba', 'barba', 'acabado'].every((f) => {
    const id = f === 'altura' ? altura : f === 'desde' ? desde : m[f];
    return !id || optionOf(f, id, C.INGREDIENTS)?.ready !== false;
  });

  const program = {
    id: idOf(m),
    kind: 'composed',
    name: name ? joinBeard(name, beardOpt, beard?.name ? low(beard.name) : '') : beard?.name || '',
    desc,
    spec,
    steps,
    recipe,
    ficha,
    serviceId: serviceIdForMix(m, C),
    mix: m,
    ready,
    base: { cut: base?.id ?? null, beard: beard?.id ?? null },
    labels: { cut: name || null, beard: beard?.name ?? null },
  };
  if (program.desc === undefined) delete program.desc;
  // Without a beard it is still that Carta cut: keep its number and alias.
  if (base && !beard) {
    program.n = base.n;
    if (base.alias) program.alias = base.alias;
  }
  return program;
}

function sameAsAsked(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Which parts of the head look different between two programs: the composer
 * resets and replays only these. Sides, top and beard compare by their Spec (the
 * same bands with other words are the same sides); the finish compares by its
 * steps and the top's shine and lift. Changing the top can change the guard the
 * side ladder climbs to, so 'laterales' may be listed with 'arriba'.
 */
export function changedParts(prev, next) {
  const sig = (p, part) => {
    if (!p) return '';
    const sp = p.spec || {};
    if (part === 'laterales') return JSON.stringify([sp.sides, sp.nape]);
    if (part === 'arriba') return JSON.stringify(sp.top && { ...sp.top, shine: 0, lift: 0 });
    if (part === 'barba') return JSON.stringify(sp.beard);
    const steps = (p.steps || []).filter((s) => s.part === 'acabado' && s.op !== 'mirror').map((s) => [s.op, s.zone, s.label]);
    return steps.length ? JSON.stringify([steps, sp.top?.shine, sp.top?.lift]) : '';
  };
  return MIX_PARTS.filter((part) => sig(prev, part) !== sig(next, part));
}
