// Barbería BK (Raval, Barcelona): a design proposal for a real shop, not its
// official site. Every fact carries its source in a 'fuente:' comment. What is not
// public is marked 'confirmar' and must be checked with the shop before launch;
// nothing here is invented. Until the shop approves, PITCH stays on.
// Visible strings come from the copy deck (brief-copy_deck.json).
import { buildCatalog, STANDARD_GUARDS } from '../cuts/catalog.js';

const TREATWELL = 'https://www.treatwell.es/establecimiento/barberia-bk/'; // fuente: Treatwell (ficha de la barbería); confirmar que es la suya

export const BRAND = {
  name: 'Barbería BK', // fuente: fichas de Google Maps y Treatwell
  signLines: ['BARBERÍA BK'], // fuente: el nombre (copy deck hero.sign [BK])
  number: '3', // fuente: Google Maps (dirección)
  street: 'Carrer de Joaquín Costa, 3', // fuente: Google Maps (dirección)
  postalCode: '08001', // fuente: Google Maps (dirección)
  city: 'Barcelona', // fuente: Google Maps (dirección)
  area: 'Raval', // fuente: Google Maps (Joaquín Costa está en el Raval)
  phone: '+34 631 02 33 74', // fuente: ficha de Google Maps
  phoneHref: 'tel:+34631023374', // fuente: el teléfono de arriba
  instagram: null, // fuente: ninguna cuenta pública encontrada; confirmar si tienen
  whatsapp: '34631023374', // fuente: el teléfono de Google; confirmar que atienden WhatsApp en ese número
  treatwell: TREATWELL, // fuente: Treatwell; confirmar
  transit: 'L3 Liceu · 6 min a pie', // fuente: Google Maps, a pie desde el metro Liceu (L3); confirmar
  timezone: 'Europe/Madrid', // fuente: Barcelona
  url: null, // fuente: no tienen web propia conocida
  priceRange: '€', // fuente: tarifa de Treatwell (corte desde 12 €)
};

// copy deck, [BK] slots, verbatim
export const COPY = {
  title: 'Barbería BK · Joaquín Costa, 3 · Raval, Barcelona', // fuente: dirección de Google Maps
  description:
    'Barbería en el Raval, Carrer de Joaquín Costa, 3: degradados, cortes a tijera, barba y mechas. Mira cómo se hace cada corte y pide hora por WhatsApp o en Treatwell.', // fuente: dirección de Google Maps; servicios de Treatwell
  tag: 'Raval · Barcelona',
  question: '¿Qué te hacemos hoy?',
  facts: [
    'Carrer de Joaquín Costa, 3, en el Raval.', // fuente: Google Maps (dirección)
    'Te atendemos en español, inglés, francés y árabe.', // fuente: archivo anterior del cliente, sin fuente pública anotada; confirmar
  ],
  priceNote: 'Precios desde, con IVA. Se paga en la barbería, con tarjeta o en efectivo.', // fuente: Treatwell (precios "desde"); confirmar formas de pago
  bookIntro: 'Elige día y hora y te dejamos el mensaje preparado para WhatsApp. La cita queda confirmada cuando la barbería te contesta.',
  agendaLabel: 'Agenda sin conectar: lo que mandas es una petición.',
  hoursHint: 'Horario de la barbería: de lunes a jueves, de 10:00 a 23:00; de viernes a domingo, consultar. Te confirman por WhatsApp si la hora está libre.', // fuente: Treatwell (lunes a jueves 10:00–23:00); viernes a domingo sin confirmar (ver OPENING)
  // additive: the other client-specific deck strings
  posterAlt: 'Fachada de Barbería BK de noche, con el poste de barbero junto a la puerta.',
  doorAddress: 'Carrer de Joaquín Costa, 3 · 08001 Barcelona', // fuente: Google Maps (dirección)
  doorHours: 'Lunes a jueves 10:00–23:00 · Viernes a domingo: consultar', // fuente: Treatwell (lunes a jueves); viernes a domingo sin confirmar (ver OPENING)
  doorLinks: 'WhatsApp · Treatwell',
  reviewsIntro: 'Reseñas de Google, copiadas tal cual y en el idioma en que se escribieron.',
  bookCta: 'Mandar por WhatsApp',
  bookCtaNote: 'Se abre WhatsApp con el mensaje para Barbería BK (631 02 33 74). Lo envías tú; esta web no guarda nada.', // fuente: teléfono de Google Maps
  treatwellLead: '¿Prefieres Treatwell?',
  treatwellLink: 'Reservar en Treatwell',
  callLink: 'Llamar al 631 02 33 74', // fuente: teléfono de Google Maps
  doneTitle: 'Tienes el mensaje en WhatsApp',
  doneBody: 'Envíalo desde WhatsApp. La cita queda confirmada cuando Barbería BK te conteste; hasta entonces, la hora no está reservada.',
  doneFallback: '¿No se ha abierto WhatsApp? Copia el mensaje o llama.',
  noJsBooking: 'Para pedir hora: Escribir por WhatsApp · Reservar en Treatwell · Llamar al 631 02 33 74', // fuente: teléfono de Google Maps
};

// Colour tokens (creative brief §6). BK: night, galvanised shutter, fluorescent
// tube, green-white tile, pole red CTA with white text, pole blue, felt board,
// L3 green only on the metro tag. Shared: notes, paper, ink, the one gold leaf.
export const THEME = {
  night: '#121314',
  cape: '#111214',
  chrome: '#C8CCD0',
  chromeLine: '#2A2D31',
  cta: '#C1272D',
  ctaInk: '#FFFFFF',
  shutter: '#6D7275',
  tube: '#E6EFEE',
  tile: '#CFE0D6',
  grout: '#262A28',
  window: '#FFB874',
  blue: '#1D4FB0',
  felt: '#151515',
  metro: '#2FA84F',
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
  0: 'consultar', // fuente: no publicado; confirmar
  1: ['10:00', '23:00'], // fuente: Treatwell
  2: ['10:00', '23:00'], // fuente: Treatwell
  3: ['10:00', '23:00'], // fuente: Treatwell
  4: ['10:00', '23:00'], // fuente: Treatwell
  // Friday: Google showed "Cerrado · abre a las 10:00 el sábado" on Fri 16 Oct 2026 at
  // 22:11, so it closes before 22:11; the hour is unknown. Never guess it.
  5: 'consultar', // fuente: perfil de Google (16/10/2026, 22:11: ya cerrado); hora de cierre, confirmar
  6: 'consultar', // fuente: Google ("abre a las 10:00 el sábado"); hora de cierre desconocida, confirmar
};

export const HOURS_TABLE = [
  ['Lunes a jueves', '10:00–23:00'], // fuente: Treatwell
  ['Viernes', 'Consultar'], // fuente: Google (cierra antes de las 22:11); hora de cierre, confirmar
  ['Sábado', 'Desde las 10:00; cierre, consultar'], // fuente: Google (abre a las 10:00); cierre, confirmar
  ['Domingo', 'Consultar'], // fuente: no publicado; confirmar
];

// Services as listed on Treatwell (copy deck: unchanged from the client file).
// includes[] says what each one covers; from: Treatwell shows the price as "desde".
export const SERVICES = [
  // fuente: Treatwell (nombre y precio desde 12 €); 30 min y descripción del archivo anterior, confirmar
  { id: 'corte', name: 'Corte de pelo', desc: 'Máquina y tijera, en seco.', price: 12, from: true, minutes: 30, includes: ['corte', 'seco'] },
  // fuente: Treatwell (nombre y precio desde 17 €); 40 min del archivo anterior, confirmar
  { id: 'corte-lavado', name: 'Corte, lavado y peinado', desc: 'Corte con lavado y peinado con producto.', price: 17, from: true, minutes: 40, includes: ['corte', 'lavado', 'producto'] },
  // fuente: Treatwell (nombre y precio desde 24 €); 45 min del archivo anterior, confirmar
  { id: 'corte-barba', name: 'Corte, lavado y barba', desc: 'Corte con lavado y arreglo de barba con perfilado.', price: 24, from: true, minutes: 45, includes: ['corte', 'lavado', 'barba'] },
  // fuente: fichas de Google y Treatwell (servicio sin precio público); minutos supuestos, confirmar
  { id: 'barba', name: 'Arreglo de barba', desc: 'Rebaje y perfilado de la barba.', price: null, from: true, minutes: 20, includes: ['barba'] },
  // fuente: fichas de Google y Treatwell, reseña de Javier D. (servicio sin precio público); minutos supuestos, confirmar
  { id: 'mechas', name: 'Mechas y color', desc: 'Mechas, reflejos o color, en pelo corto o largo.', price: null, from: true, minutes: 60, includes: ['color'] },
  // fuente: fichas de Google y Treatwell (servicio sin precio público); minutos supuestos, confirmar
  { id: 'facial', name: 'Facial y depilación', desc: 'Tratamientos faciales y depilación.', price: null, from: true, minutes: 30, includes: ['facial'] },
];

// Claims the story and the Carta may make only once the shop confirms them:
// hot towel, talc or balm ('talco' | 'bálsamo'), a new blade per client, afeitado clásico.
export const CLAIMS = {
  hotTowel: null, // fuente: no publicado; confirmar
  talc: null, // fuente: no publicado; confirmar
  newBlade: null, // fuente: no publicado; confirmar
  afeitado: null, // fuente: no está en Treatwell; confirmar
};

// Guard number → mm (standard guards). fuente: medidas estándar de los peines;
// confirmar los peines que usa la barbería.
export const GUARDS = { ...STANDARD_GUARDS };

// Every haircut books 'Corte de pelo'; with a beard 'Corte, lavado y barba'; beard
// only 'Arreglo de barba'. Nº 16 has no service until the shop confirms afeitado.
export const SERVICE_MAP = {
  cuts: { default: 'corte' },
  beards: { default: 'barba', b16: null },
  cutAndBeard: 'corte-barba',
};

const catalog = buildCatalog({ guards: GUARDS, claims: CLAIMS, services: SERVICES, serviceMap: SERVICE_MAP });
export const CUTS = catalog.CUTS;
export const BEARDS = catalog.BEARDS;
export const STORY = catalog.STORY;
export const INGREDIENTS = catalog.INGREDIENTS;

// fuente: propuesta; la barbería tiene que confirmar qué cortes hace (PITCH lo dice).
// Nº 16 only appears once CLAIMS.afeitado is confirmed.
export const CARTA = {
  cuts: CUTS.map((p) => p.id),
  beards: BEARDS.filter((p) => p.id !== 'b16' || CLAIMS.afeitado).map((p) => p.id),
  proposal: true,
};

// The cut on the practice head in the story: Nº 2 Degradado medio + Nº 18 Barba corta.
export const STORY_CUT = { hair: 'n2', beard: 'b18' };

// fuente: el equipo no es público; la sección de sillas queda oculta hasta que lo compartan.
export const BARBERS = [];

// fuente: Google Maps y Treatwell, consultados en la fecha de RATINGS_AS_OF.
export const RATINGS = [
  { source: 'Google', score: '4,7', count: 71, url: null }, // fuente: Google Maps
  { source: 'Treatwell', score: '4,8', count: 11, url: TREATWELL }, // fuente: Treatwell
];
export const RATINGS_AS_OF = '2026-10-16'; // fuente: fecha de consulta del plan; volver a consultar al publicar

// fuente: reseñas públicas de Google, copiadas tal cual, sin traducir ni recortar.
// about: the service each one mentions (placed next to it on the tarifa); null = at the foot.
export const REVIEWS = [
  { name: 'Javier D.', source: 'Google', lang: 'en', about: 'mechas', text: 'Great service. Moaud did an excellent job with highlights and cut the long hair. Worth it. A+++' }, // fuente: Google
  { name: 'Conor M.', source: 'Google', lang: 'en', about: 'corte', text: 'Great haircut, great atmosphere, fair price. Will definitely be coming back and recommending to my friends.' }, // fuente: Google
  { name: 'Tino B.', source: 'Google', lang: 'en', about: null, text: 'Best barber in town!!' }, // fuente: Google
];

// The request goes out as a WhatsApp message the visitor sends; Treatwell and a
// phone call are always offered next to it. No agenda, no invented taken slots.
export const BOOKING = {
  mode: 'whatsapp',
  whatsapp: BRAND.whatsapp,
  treatwell: TREATWELL,
  slotMinutes: 30,
  daysAhead: 14,
  leadMinutes: 30,
};

// copy deck pitch.strip / pitch.close / puerta.pitch [BK]
export const PITCH = {
  strip: 'Propuesta de diseño para Barbería BK, no es su web oficial. Precios y horario sacados de Treatwell y Google; la carta de cortes está por confirmar con la barbería.',
  close: 'Ocultar',
  door: 'Propuesta de diseño para Barbería BK. No es su web oficial.',
};
export const EXAMPLE_NOTICE = null;
