// HTML fragments rendered from config.js at build time (see vite.config.js),
// so prices, team and hours are in the page source for search engines.
import { BRAND, HOURS_TABLE, OPENING, SERVICES, BARBERS, HAIR_LOOKS, BEARD_LOOKS, DEFAULT_LOOK } from './config.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const euro = (n) => `${n} €`;

export function servicesBoard() {
  return SERVICES.map(
    (s) => `
        <li class="board__item">
          <div class="board__line">
            <h3 class="board__name">${esc(s.name)}</h3>
            <span class="board__dots" aria-hidden="true"></span>
            <span class="board__price">${euro(s.price)}</span>
          </div>
          <p class="board__desc">${esc(s.desc)} <span class="board__time">${s.minutes} min</span></p>
        </li>`,
  ).join('');
}

export function teamCards() {
  return BARBERS.map(
    (b) => `
        <li class="barber">
          <span class="barber__mono" aria-hidden="true">${esc(b.name[0])}</span>
          <div>
            <h3 class="barber__name">${esc(b.name)}</h3>
            <p class="barber__spec">${esc(b.specialty)}</p>
          </div>
        </li>`,
  ).join('');
}

export function hoursRows() {
  return HOURS_TABLE.map(([d, h]) => `<tr><th scope="row">${esc(d)}</th><td>${esc(h)}</td></tr>`).join('');
}

function chips(name, items, checkedId) {
  return items
    .map(
      (it) => `
            <label class="chip">
              <input type="radio" name="${name}" id="${name}-${it.id}" value="${it.id}"${it.id === checkedId ? ' checked' : ''}>
              <span>${esc(it.name)}</span>
            </label>`,
    )
    .join('');
}

export const hairChips = () => chips('hair', HAIR_LOOKS, DEFAULT_LOOK.hair);
export const beardChips = () => chips('beard', BEARD_LOOKS, DEFAULT_LOOK.beard);

export function bookingServices() {
  return SERVICES.map(
    (s, i) => `
            <label class="option">
              <input type="radio" name="service" id="service-${s.id}" value="${s.id}"${i === 1 ? ' checked' : ''}>
              <span class="option__body">
                <span class="option__name">${esc(s.name)}</span>
                <span class="option__meta">${s.minutes} min · ${euro(s.price)}</span>
              </span>
            </label>`,
  ).join('');
}

export function bookingBarbers() {
  const all = [{ id: 'any', name: 'Sin preferencia' }, ...BARBERS];
  return all
    .map(
      (b, i) => `
            <label class="chip">
              <input type="radio" name="barber" id="barber-${b.id}" value="${b.id}"${i === 0 ? ' checked' : ''}>
              <span>${esc(b.name)}</span>
            </label>`,
    )
    .join('');
}


export function jsonLd() {
  const opening = Object.entries(OPENING)
    .filter(([, h]) => h)
    .map(([d, [opens, closes]]) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: `https://schema.org/${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]}`,
      opens,
      closes,
    }));
  const data = {
    '@context': 'https://schema.org',
    '@type': 'HairSalon',
    name: `${BRAND.name} ${BRAND.tagline}`,
    url: BRAND.url,
    telephone: BRAND.phone,
    priceRange: BRAND.priceRange,
    address: {
      '@type': 'PostalAddress',
      streetAddress: BRAND.street,
      postalCode: BRAND.postalCode,
      addressLocality: BRAND.city,
      addressCountry: 'ES',
    },
    openingHoursSpecification: opening,
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Servicios',
      itemListElement: SERVICES.map((s) => ({
        '@type': 'Offer',
        price: s.price,
        priceCurrency: 'EUR',
        itemOffered: { '@type': 'Service', name: s.name, description: s.desc },
      })),
    },
  };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

// Replaces <!--@name--> markers and {{brand.*}} tokens in index.html.
export function renderPage(html) {
  const blocks = {
    services: servicesBoard,
    team: teamCards,
    hours: hoursRows,
    hairChips,
    beardChips,
    bookingServices,
    bookingBarbers,
    jsonld: jsonLd,
  };
  let out = html.replace(/<!--@(\w+)-->/g, (m, name) => (blocks[name] ? blocks[name]() : m));
  out = out.replace(/\{\{brand\.(\w+)\}\}/g, (m, k) => (k in BRAND ? esc(BRAND[k]) : m));
  return out;
}

