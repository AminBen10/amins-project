// Design proposal for Barbería BK (Raval, Barcelona).
// Address, phone and ratings come from the shop's public Google and Treatwell
// listings. Prices are Treatwell's "desde" figures, hours are the 10:00–23:00
// shown there; everything marked "confirmar" must be checked with the shop
// before this goes live.
import { HAIR_LOOKS as BASE_LOOKS, BEARD_LOOKS as BASE_BEARDS } from './corte-real.js';

export const BRAND = {
  name: 'Barbería BK',
  tagline: 'Raval · Barcelona',
  city: 'Barcelona',
  area: 'Raval',
  street: 'Carrer de Joaquín Costa, 3',
  postalCode: '08001',
  phone: '+34 631 02 33 74',
  instagram: null,
  priceRange: '€',
  url: null,
  mark: 'pole',
};

export const COPY = {
  title: 'Barbería BK · Raval, Barcelona',
  description:
    'Barbería en el Raval, Barcelona (Carrer de Joaquín Costa, 3): cortes, degradados, barba y mechas. Prueba tu corte en 3D y reserva cita online.',
  heroEyebrow: 'Barbería en el Raval · Barcelona',
  heroLede:
    'Degradados, cortes a tijera, barba y mechas en Joaquín Costa, 3, a seis minutos del metro Liceu. Te atendemos en español, inglés, francés y árabe.',
  priceNote: 'Precios desde, con IVA incluido. Puedes pagar con tarjeta o en efectivo.',
  teamTitle: '',
};

export const PRICES_FROM = true;

// confirmar: Treatwell shows 10:00–23:00 from Monday to Thursday and Google
// "opens 10 am Saturday"; Friday and Sunday are assumed.
export const OPENING = {
  0: null,
  1: ['10:00', '23:00'],
  2: ['10:00', '23:00'],
  3: ['10:00', '23:00'],
  4: ['10:00', '23:00'],
  5: ['10:00', '23:00'],
  6: ['10:00', '23:00'],
};

export const HOURS_TABLE = [
  ['Lunes a sábado', '10:00 – 23:00'],
  ['Domingo', 'Consultar'],
];

// confirmar: prices for beard, colour and facial are not public; durations
// for colour and facial are estimates.
export const SERVICES = [
  { id: 'corte', name: 'Corte de pelo', desc: 'Máquina y tijera, en seco.', price: 12, minutes: 30 },
  { id: 'corte-lavado', name: 'Corte, lavado y peinado', desc: 'Corte con lavado y peinado con producto.', price: 17, minutes: 40 },
  { id: 'corte-barba', name: 'Corte, lavado y barba', desc: 'Corte con lavado y arreglo de barba con perfilado.', price: 24, minutes: 45 },
  { id: 'barba', name: 'Arreglo de barba', desc: 'Rebaje y perfilado de la barba.', price: null, minutes: 20 },
  { id: 'mechas', name: 'Mechas y color', desc: 'Mechas, reflejos o color, en pelo corto o largo.', price: null, minutes: 60 },
  { id: 'facial', name: 'Facial y depilación', desc: 'Tratamientos faciales y depilación.', price: null, minutes: 30 },
];

// The team is not public yet; with no barbers the site hides the team section
// and books the first free chair.
export const BARBERS = [];
export const CHAIRS = 2;

export const HAIR_LOOKS = BASE_LOOKS.map((look) => ({ ...look, service: 'corte' }));
export const BEARD_LOOKS = BASE_BEARDS;
export const DEFAULT_LOOK = { hair: 'fade', beard: 'short' };
export const BEARD_SERVICE = 'corte-barba';

export const RATINGS = [
  { source: 'Google', score: '4,7', count: 71 },
  { source: 'Treatwell', score: '4,8', count: 11 },
];

// Public Google reviews, quoted as written.
export const REVIEWS = [
  { name: 'Javier D.', source: 'Google', lang: 'en', text: 'Great service. Moaud did an excellent job with highlights and cut the long hair. Worth it. A+++' },
  { name: 'Conor M.', source: 'Google', lang: 'en', text: 'Great haircut, great atmosphere, fair price. Will definitely be coming back and recommending to my friends.' },
  { name: 'Tino B.', source: 'Google', lang: 'en', text: 'Best barber in town!!' },
];

export const BOOKING = { mode: 'demo', slotMinutes: 30, daysAhead: 14 };

export const PITCH = {
  label: 'Propuesta de diseño para Barbería BK',
  note: 'Demo no oficial: precios y horario orientativos, la reserva no está conectada.',
};
