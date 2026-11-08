// Corte Real: a fictional barbershop in Chamberí, Madrid, used to show the site.
// Name, address, team, prices and claims are invented for the demo, and the page
// says so (EXAMPLE_NOTICE); it has no ratings or reviews. Every client file
// exports the same names (see the design contract); build with CLIENT=<file name>.
// Visible strings come from the copy deck (brief-copy_deck.json).
import { buildCatalog, STANDARD_GUARDS } from '../cuts/catalog.js';

// ejemplo: every fact in this file is fictional unless a comment says otherwise.
export const BRAND = {
  name: 'Corte Real',
  signLines: ['CORTE REAL', 'BARBERÍA'], // copy deck hero.sign [CR]
  number: '12',
  street: 'Calle de Ejemplo, 12',
  postalCode: '28010',
  city: 'Madrid',
  area: 'Chamberí',
  phone: '+34 600 000 000',
  phoneHref: 'tel:+34600000000',
  instagram: '@cortereal.barber',
  whatsapp: null,
  treatwell: null,
  transit: null,
  timezone: 'Europe/Madrid',
  url: 'https://example.com',
  priceRange: '€€',
};

// copy deck, [CR] slots, verbatim
export const COPY = {
  title: 'Corte Real · Barbería en Chamberí, Madrid',
  description: 'Barbería en Chamberí. Mira cómo se hace cada corte, peine a peine, y pide hora con el tuyo ya apuntado.',
  tag: 'Barbería · Chamberí',
  question: '¿Qué te hacemos hoy?',
  facts: ['Chamberí · tres sillas · de lunes a viernes, de 10:00 a 20:30 · sábados, de 9:30 a 15:00'],
  priceNote: 'Precios con IVA. Tarjeta, efectivo o Bizum.',
  bookIntro: 'Elige día, hora y silla.',
  agendaLabel: 'Agenda de ejemplo, sin conectar.',
  hoursHint: '{n} horas para {servicio} ({min} min).',
  // additive: the other client-specific deck strings
  posterAlt: 'Escaparate de Corte Real de noche, con el poste de barbero junto a la puerta.',
  doorAddress: 'Calle de Ejemplo, 12 · 28010 Madrid',
  doorHours: 'Lunes a viernes 10:00–20:30 · Sábado 9:30–15:00 · Domingo cerrado',
  phonePlaceholder: '600 123 456',
  bookCta: 'Apúntame',
  doneTitle: 'Apuntado, {nombre}: {día} a las {hora} con {barbero}.',
  doneTitleAny: 'Apuntado, {nombre}: {día} a las {hora}.',
  doneBody: '{servicio} · {min} min · {precio}. Se paga en la barbería.',
  doneDemo: 'Es una demostración: esta web no está conectada a ninguna agenda y no se ha guardado ninguna cita.',
  doneAgain: 'Pedir otra hora',
};

// Colour tokens (creative brief §6). Corte Real: cape black, chrome, oxblood
// leather, celadon open sign, cream tile. Shared: notes, paper, ink, the one gold leaf.
export const THEME = {
  night: '#111214',
  cape: '#111214',
  chrome: '#C8CCD0',
  chromeLine: '#2A2D31',
  cta: '#5B1F1D',
  ctaInk: '#F3F1EA',
  signOpen: '#9DB6A2',
  tile: '#D9D3C4',
  grout: '#2A2925',
  window: '#FFB874',
  note: '#F3F1EA',
  paper: '#EFE7D6',
  ink: '#1B1A17',
  leaf: '#C8A04A',
  leafLine: '#1A1206',
  leafShade: '#0B0906',
  brass: '#B08D57',
  poleRed: '#C1272D',
  poleWhite: '#F4EFE4',
  poleBlue: '#1D4FB0',
};

// Weekday index follows Date#getDay(): 0 = domingo … 6 = sábado.
// Value: [open, close] (HH:MM, Europe/Madrid) | null (closed) | 'consultar'.
export const OPENING = {
  0: null,
  1: ['10:00', '20:30'],
  2: ['10:00', '20:30'],
  3: ['10:00', '20:30'],
  4: ['10:00', '20:30'],
  5: ['10:00', '20:30'],
  6: ['09:30', '15:00'],
};

export const HOURS_TABLE = [
  ['Lunes a viernes', '10:00–20:30'],
  ['Sábado', '9:30–15:00'],
  ['Domingo', 'Cerrado'],
];

// Services as printed on the tarifa (copy deck tarifa.services [CR]). includes[]
// says what each one covers: corte, barba, afeitado, lavado, producto, seco,
// toalla, navaja, aceite, bálsamo, mascarilla. from: price is a starting point.
export const SERVICES = [
  { id: 'corte', name: 'Corte clásico', desc: 'Tijera y máquina, lavado y peinado con producto.', price: 16, from: false, minutes: 30, includes: ['corte', 'lavado', 'producto'] },
  { id: 'fade', name: 'Degradado', desc: 'Bajo, medio, alto o a piel, a mano alzada y con perfilado a navaja.', price: 18, from: false, minutes: 40, includes: ['corte', 'seco', 'producto', 'navaja'] },
  { id: 'corte-barba', name: 'Corte y barba', desc: 'Cualquier corte más arreglo de barba con toalla caliente.', price: 26, from: false, minutes: 60, includes: ['corte', 'barba', 'toalla', 'producto'] },
  { id: 'barba', name: 'Arreglo de barba', desc: 'Rebaje, contornos a navaja y aceite hidratante.', price: 12, from: false, minutes: 20, includes: ['barba', 'navaja', 'aceite'] },
  { id: 'afeitado', name: 'Afeitado clásico', desc: 'Toalla caliente, espuma a brocha, navaja y bálsamo.', price: 18, from: false, minutes: 30, includes: ['afeitado', 'toalla', 'navaja', 'balsamo'] },
  // El completo: the renamed 75-minute service (copy deck)
  { id: 'completo', name: 'El completo', desc: 'Corte, barba, contornos a navaja y mascarilla.', price: 42, from: false, minutes: 75, includes: ['corte', 'barba', 'navaja', 'mascarilla', 'producto'] },
];

// What the shop does, as the story and the Carta may claim it (example values).
// talc: 'talco' | 'bálsamo' | null.
export const CLAIMS = { hotTowel: true, talc: 'talco', newBlade: true, afeitado: true };

// Guard number → mm. One table feeds the decal, notes, recipe, guía and ficha.
export const GUARDS = { ...STANDARD_GUARDS };

// Which service each Carta program books (brief mapping): cuts 1–8, 14, 15 are a
// 'Degradado', 9–13 a 'Corte clásico'; beard only 'Arreglo de barba'; Nº 16 'Afeitado clásico'.
export const SERVICE_MAP = {
  cuts: { default: 'fade', n9: 'corte', n10: 'corte', n11: 'corte', n12: 'corte', n13: 'corte' },
  beards: { default: 'barba', b16: 'afeitado' },
  cutAndBeard: 'corte-barba',
};

const catalog = buildCatalog({ guards: GUARDS, claims: CLAIMS, services: SERVICES, serviceMap: SERVICE_MAP });
export const CUTS = catalog.CUTS;
export const BEARDS = catalog.BEARDS;
export const STORY = catalog.STORY;
export const INGREDIENTS = catalog.INGREDIENTS;

// The cuts on this shop's chart (Carta de cortes).
export const CARTA = {
  cuts: CUTS.map((p) => p.id),
  beards: BEARDS.map((p) => p.id),
  proposal: false,
};

// The cut on the practice head in the story: Nº 2 Degradado medio + Nº 18 Barba corta.
export const STORY_CUT = { hair: 'n2', beard: 'b18' };

// copy deck sillas.* [CR, datos de ejemplo]. weekdays as Date#getDay().
export const BARBERS = [
  { id: 'karim', name: 'Karim', chair: 'La silla de la ventana', days: 'de martes a sábado', weekdays: [2, 3, 4, 5, 6], knownFor: 'degradados y diseños a máquina', tool: 'clipper', signatureCut: 'n4', signatureLabel: 'Ver su degradado a piel' },
  { id: 'dani', name: 'Dani', chair: 'La del medio', days: 'de lunes a viernes', weekdays: [1, 2, 3, 4, 5], knownFor: 'tijera y cortes con largo', tool: 'scissors', signatureCut: 'n11', signatureLabel: 'Ver su raya al lado' },
  { id: 'marco', name: 'Marco', chair: 'La del fondo', days: 'de miércoles a sábado', weekdays: [3, 4, 5, 6], knownFor: 'barba, navaja y afeitado', tool: 'razor', signatureCut: 'b20', signatureLabel: 'Ver su barba completa' },
];

// An example shop has no ratings and no reviews.
export const RATINGS = [];
export const RATINGS_AS_OF = null;
export const REVIEWS = [];

// Demo agenda: no real bookings, no invented taken slots.
export const BOOKING = { mode: 'demo', slotMinutes: 30, daysAhead: 14, leadMinutes: 30 };

export const PITCH = null;
export const EXAMPLE_NOTICE = 'Corte Real es una barbería de ejemplo para enseñar esta web: nombre, dirección, equipo y precios no son reales.';
