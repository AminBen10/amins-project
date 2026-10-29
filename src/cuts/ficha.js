// The written side of a cut: guard labels, the ficha 'Para el barbero' (the same
// sentence on the recipe card, the appointment card and the WhatsApp message),
// which service on the tarifa a cut books, and the tarifa line.
// Pure ES module (no DOM): node, vite and the browser all load it.
//
// `client` is a client module's exports (src/clients/*.js, or src/config.js):
// CUTS, BEARDS, INGREDIENTS, SERVICES, SERVICE_MAP, GUARDS. Missing fields fall
// back to the shop-neutral catalogue (standard guards, no services).
import {
  CUTS as BASE_CUTS,
  BEARDS as BASE_BEARDS,
  INGREDIENTS as BASE_INGREDIENTS,
  ALL_INGREDIENTS,
  STANDARD_GUARDS,
} from './catalog.js';
import { priceLabel } from '../price.js';

export const MIX_PARTS = ['laterales', 'arriba', 'barba', 'acabado'];

// ---------------------------------------------------------------- client data

export function clientData(client = {}) {
  return {
    CUTS: client.CUTS || BASE_CUTS,
    BEARDS: client.BEARDS || BASE_BEARDS,
    INGREDIENTS: client.INGREDIENTS || BASE_INGREDIENTS,
    SERVICES: client.SERVICES || [],
    SERVICE_MAP: client.SERVICE_MAP || null,
    GUARDS: client.GUARDS || STANDARD_GUARDS,
    CLAIMS: client.CLAIMS || {},
  };
}

// ---------------------------------------------------------------- guards

/** The guard as printed: '0,5', '3', 'piel'. */
export function guardLabel(id) {
  return id == null ? '' : String(id).replace('.', ',');
}

/** Millimetres the guard leaves, from the shop's GUARDS table (null if unknown). */
export function guardMM(id, guards = STANDARD_GUARDS) {
  const mm = guards[guardLabel(id)];
  return mm == null ? null : mm;
}

// ---------------------------------------------------------------- the mix

const str = (v) => (v == null || v === '' ? null : String(v).replace('.', ','));

/**
 * The composer's ingredients in one shape:
 * {laterales: {altura, desde} | null, arriba, barba, acabado}, every value an
 * option id or null. Accepts partial objects ('0.5' and 0 are read as '0,5', '0').
 */
export function normalizeMix(mix) {
  const m = mix || {};
  const lat = m.laterales;
  const altura = str(lat?.altura);
  const desde = str(lat?.desde);
  return {
    laterales: altura || desde ? { altura, desde } : null,
    arriba: str(m.arriba),
    barba: str(m.barba),
    acabado: str(m.acabado),
  };
}

export function sameMix(a, b) {
  const x = normalizeMix(a);
  const y = normalizeMix(b);
  return (
    (x.laterales?.altura ?? null) === (y.laterales?.altura ?? null) &&
    (x.laterales?.desde ?? null) === (y.laterales?.desde ?? null) &&
    x.arriba === y.arriba &&
    x.barba === y.barba &&
    x.acabado === y.acabado
  );
}

/** True when the mix asks for a haircut (complete sides or a top). */
export function mixHasHair(mix) {
  const m = normalizeMix(mix);
  return !!((m.laterales?.altura && m.laterales?.desde) || m.arriba);
}

/** The option behind a field ('altura', 'desde', 'arriba', 'barba', 'acabado'). */
export function optionOf(field, id, ingredients = ALL_INGREDIENTS) {
  if (id == null) return null;
  for (const set of ingredients) {
    for (const f of set.fields) if (f.id === field) return f.options.find((o) => o.id === id) || null;
  }
  return null;
}

/** The Carta program (cut or beard) whose mix is exactly this one. */
export function findPreset(mix, client) {
  const C = clientData(client);
  const m = normalizeMix(mix);
  return [...C.CUTS, ...C.BEARDS].find((p) => sameMix(p.mix, m)) || null;
}

/** The Carta cut with these sides and this top (the finish may differ). */
export function hairBase(mix, client) {
  const C = clientData(client);
  const m = normalizeMix(mix);
  if (!m.laterales?.altura || !m.laterales?.desde || !m.arriba) return null;
  return (
    C.CUTS.find(
      (p) =>
        p.mix.laterales &&
        p.mix.laterales.altura === m.laterales.altura &&
        p.mix.laterales.desde === m.laterales.desde &&
        p.mix.arriba === m.arriba,
    ) || null
  );
}

/** {laterales, arriba, acabado} of a Carta cut plus barba of a Carta beard. */
export function mixOf(cutId, beardId, client) {
  const C = clientData(client);
  const cut = cutId ? C.CUTS.find((p) => p.id === cutId) : null;
  const beard = beardId ? C.BEARDS.find((p) => p.id === beardId) : null;
  return normalizeMix({
    laterales: cut?.mix.laterales ?? null,
    arriba: cut?.mix.arriba ?? null,
    barba: beard?.mix.barba ?? null,
    acabado: cut?.mix.acabado ?? null,
  });
}

// ---------------------------------------------------------------- services

// Finishes any haircut includes.
const FREE_FINISH = new Set(['seco', 'producto']);
const byId = (C, id) => (id == null ? null : C.SERVICES.find((s) => s.id === id) || null);
const covers = (s, need) => !!s && need.every((n) => (s.includes || []).includes(n));
const cheapest = (list) =>
  [...list].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || a.minutes - b.minutes)[0] || null;

function mappedService(C, program) {
  const map = C.SERVICE_MAP;
  if (!program) return null;
  if (program.serviceId !== undefined && program.serviceId !== null) return program.serviceId;
  if (!map) return null;
  const table = program.kind === 'beard' ? map.beards : map.cuts;
  if (!table) return null;
  return program.id in table ? table[program.id] : (table.default ?? null);
}

/**
 * The service id a mix books (brief mapping, both shops):
 * - the cut's own mapping (SERVICE_MAP; for a mix that is not on the Carta, the
 *   Carta cut with the same sides and top, else the one its fade height stands for);
 * - with a beard: SERVICE_MAP.cutAndBeard; a beard alone: the beard's mapping;
 * - a finish the mapped service does not include (lavado, toalla) picks the
 *   cheapest service that includes the cut, the beard and that finish and costs
 *   at least as much as the mapped one: a finish never makes a cut cheaper.
 *   'En seco' and 'con producto' need nothing: the Carta's own cuts end with
 *   product and book the plain haircut (BK 'Corte de pelo').
 */
export function serviceIdForMix(mix, client) {
  const C = clientData(client);
  const m = normalizeMix(mix);
  const preset = findPreset(m, C);
  if (preset) return mappedService(C, preset);

  const hair = mixHasHair(m);
  const barba = m.barba && m.barba !== 'ninguna' ? optionOf('barba', m.barba, ALL_INGREDIENTS) : null;
  const beardPreset = barba?.beard ? C.BEARDS.find((p) => p.id === barba.beard) : null;
  const acabado = optionOf('acabado', m.acabado, ALL_INGREDIENTS);

  let base = null;
  if (hair) {
    const ref =
      hairBase(m, C) ||
      C.CUTS.find((p) => p.id === optionOf('altura', m.laterales?.altura)?.preset) ||
      C.CUTS.find((p) => p.id === optionOf('arriba', m.arriba)?.preset);
    base = ref ? mappedService(C, ref) : (C.SERVICE_MAP?.cuts?.default ?? null);
    if (beardPreset) base = C.SERVICE_MAP?.cutAndBeard ?? base;
  } else if (beardPreset) {
    base = mappedService(C, beardPreset);
  }

  const need = [];
  if (hair) need.push('corte');
  if (beardPreset) need.push(barba.id === 'afeitado' ? 'afeitado' : 'barba');
  if (!need.length) return base;
  const finish = acabado && !FREE_FINISH.has(acabado.includes) ? acabado.includes : null;
  const floor = byId(C, base)?.price ?? 0;
  for (const n of finish ? [[...need, finish], need] : [need]) {
    if (covers(byId(C, base), n)) return base;
    const best = cheapest(C.SERVICES.filter((s) => covers(s, n) && (s.price ?? Infinity) >= floor));
    if (best) return best.id;
  }
  return base;
}

/**
 * The service on the tarifa for a program (its serviceId) or for a mix.
 * Returns the SERVICES row, or null when the shop has none for it (BK Nº 16
 * until the shop confirms afeitado).
 */
export function serviceFor(x, client) {
  if (!x) return null;
  const C = clientData(client);
  if (Array.isArray(x.steps) || 'serviceId' in x) return byId(C, x.serviceId);
  return byId(C, serviceIdForMix(x, C));
}

/** 'Degradado · 40 min · 18 €', 'Corte de pelo · 30 min · desde 12 €'. */
export function tarifaLine(service) {
  if (!service) return '';
  return `${service.name} · ${service.minutes} min · ${priceLabel(service.price, service.from)}`;
}

// ---------------------------------------------------------------- the ficha

/**
 * The ficha 'Para el barbero': the program's own sentence(s). Several programs
 * (a cut and a beard) are joined in order, so formatFicha(Nº 2, Nº 18) is the
 * copy deck's WhatsApp example. Composed programs already carry the joined ficha.
 */
export function formatFicha(...programs) {
  return programs
    .flat()
    .filter((p) => p && p.ficha)
    .map((p) => p.ficha.trim())
    .join(' ');
}
