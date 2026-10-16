// Everything a barbershop would change lives here: brand, address, hours,
// services, team and the looks offered in the 3D style studio.
// The HTML (and the SEO schema) is generated from this file at build time.

export const BRAND = {
  name: 'Corte Real',
  tagline: 'Barber Club',
  city: 'Madrid',
  area: 'Chamberí',
  street: 'Calle de Ejemplo, 12',
  postalCode: '28010',
  phone: '+34 600 000 000',
  instagram: '@cortereal.barber',
  priceRange: '€€',
  url: 'https://example.com',
};

// Weekday index follows Date#getDay(): 0 = domingo … 6 = sábado.
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
  ['Lunes a viernes', '10:00 – 20:30'],
  ['Sábado', '09:30 – 15:00'],
  ['Domingo', 'Cerrado'],
];

export const SERVICES = [
  { id: 'corte', name: 'Corte clásico', desc: 'Tijera y máquina, lavado y peinado con producto.', price: 16, minutes: 30 },
  { id: 'fade', name: 'Degradado', desc: 'Skin, low o mid fade a mano alzada con perfilado a navaja.', price: 18, minutes: 40 },
  { id: 'corte-barba', name: 'Corte y barba', desc: 'Cualquier corte más arreglo de barba con toalla caliente.', price: 26, minutes: 60 },
  { id: 'barba', name: 'Arreglo de barba', desc: 'Rebaje, contornos a navaja y aceite hidratante.', price: 12, minutes: 20 },
  { id: 'afeitado', name: 'Afeitado clásico', desc: 'Toalla caliente, espuma a brocha, navaja y bálsamo.', price: 18, minutes: 30 },
  { id: 'ritual', name: 'Ritual Corte Real', desc: 'Corte, barba, afeitado de contornos y mascarilla facial.', price: 42, minutes: 75 },
];

export const BARBERS = [
  { id: 'karim', name: 'Karim', specialty: 'Degradados y diseños con máquina' },
  { id: 'dani', name: 'Dani', specialty: 'Tijera clásica y cortes con largo' },
  { id: 'marco', name: 'Marco', specialty: 'Barba, navaja y afeitado tradicional' },
];

export const HAIR_LOOKS = [
  { id: 'fade', name: 'Degradado', alias: 'Skin fade', desc: 'Laterales a piel que suben en degradado y textura corta arriba.', service: 'fade', upkeep: 'Repaso cada 2–3 semanas' },
  { id: 'quiff', name: 'Tupé', alias: 'Quiff', desc: 'Laterales cortos y volumen delantero peinado hacia arriba y atrás.', service: 'corte', upkeep: 'Repaso cada 3–4 semanas' },
  { id: 'crew', name: 'Crew cut', alias: 'Militar', desc: 'Corto y limpio: algo más de largo arriba y laterales a máquina.', service: 'corte', upkeep: 'Repaso cada 3 semanas' },
  { id: 'buzz', name: 'Rapado', alias: 'Buzz cut', desc: 'Todo a la misma altura con máquina, contornos marcados.', service: 'corte', upkeep: 'Repaso cada 2 semanas' },
];

export const BEARD_LOOKS = [
  { id: 'none', name: 'Sin barba' },
  { id: 'stubble', name: 'Tres días' },
  { id: 'short', name: 'Corta' },
  { id: 'full', name: 'Completa' },
];

export const DEFAULT_LOOK = { hair: 'fade', beard: 'short' };

// Until the site is wired to a real agenda the booking form runs as a demo
// and says so on the confirmation screen.
export const BOOKING = { mode: 'demo', slotMinutes: 30, daysAhead: 14 };
