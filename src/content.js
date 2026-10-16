// HTML rendered from the active client file at build time (see vite.config.js),
// so prices, team, reviews and hours are in the page source for search engines.
import { priceLabel } from './price.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CROWN = `
        <svg class="brand__mark" viewBox="0 0 34 24" aria-hidden="true">
          <path d="M4 19h26l2.6-12.5-8.2 5.6L17 3l-7.4 9.1-8.2-5.6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
          <path d="M5 22.2h24" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          <circle cx="17" cy="3" r="1.6" fill="currentColor" />
          <circle cx="1.6" cy="6.4" r="1.4" fill="currentColor" />
          <circle cx="32.4" cy="6.4" r="1.4" fill="currentColor" />
        </svg>`;

const POLE = `
        <svg class="brand__mark brand__mark--pole" viewBox="0 0 14 30" aria-hidden="true">
          <defs><clipPath id="pole-clip"><rect x="3" y="5" width="8" height="20" rx="1" /></clipPath></defs>
          <g clip-path="url(#pole-clip)">
            <rect x="3" y="5" width="8" height="20" fill="#f4efe4" />
            <path d="M-2 9l18-8v4L-2 13zM-2 17l18-8v4L-2 21zM-2 25l18-8v4L-2 29z" fill="#c1272d" />
            <path d="M-2 13l18-8v2L-2 15zM-2 21l18-8v2L-2 23z" fill="#1d4fb0" />
          </g>
          <circle cx="7" cy="2.6" r="2.2" fill="currentColor" />
          <rect x="1.5" y="4" width="11" height="1.6" rx=".8" fill="currentColor" />
          <rect x="1.5" y="24.4" width="11" height="1.6" rx=".8" fill="currentColor" />
          <path d="M5 26h4l-2 3.4z" fill="currentColor" />
        </svg>`;

export function brandMark(c) {
  return c.BRAND.mark === 'pole' ? POLE : CROWN;
}

export function navLinks(c) {
  const links = [
    ['#ritual', 'El ritual'],
    ['#estilos', 'Estilos'],
    ['#servicios', 'Precios'],
    c.REVIEWS.length ? ['#opiniones', 'Opiniones'] : null,
    c.BARBERS.length ? ['#equipo', 'Equipo'] : null,
  ].filter(Boolean);
  return links.map(([href, label]) => `<a href="${href}">${label}</a>`).join('\n        ');
}

export function servicesBoard(c) {
  return c.SERVICES.map(
    (s) => `
        <li class="board__item">
          <div class="board__line">
            <h3 class="board__name">${esc(s.name)}</h3>
            <span class="board__dots" aria-hidden="true"></span>
            <span class="board__price">${priceLabel(s.price, c.PRICES_FROM)}</span>
          </div>
          <p class="board__desc">${esc(s.desc)} <span class="board__time">${s.minutes} min</span></p>
        </li>`,
  ).join('');
}

export function reviewsSection(c) {
  if (!c.REVIEWS.length) return '';
  const ratings = c.RATINGS.map(
    (r) => `
            <li class="rating">
              <span class="rating__score">${esc(r.score)}</span>
              <span class="rating__meta"><b>${esc(r.source)}</b> ${r.count} reseñas</span>
            </li>`,
  ).join('');
  const quotes = c.REVIEWS.map(
    (r) => `
          <li class="quote">
            <blockquote lang="${r.lang || 'es'}">${esc(r.text)}</blockquote>
            <p class="quote__by">${esc(r.name)} · ${esc(r.source)}</p>
          </li>`,
  ).join('');
  return `
      <section id="opiniones" class="reviews" aria-labelledby="reviews-title">
        <div class="wrap">
          <p class="eyebrow">Opiniones</p>
          <h2 id="reviews-title" class="h2">Lo que dicen al levantarse de la silla.</h2>
          <ul class="ratings">${ratings}
          </ul>
          <ul class="quotes">${quotes}
          </ul>
        </div>
      </section>`;
}

export function teamSection(c) {
  if (!c.BARBERS.length) return '';
  const cards = c.BARBERS.map(
    (b) => `
            <li class="barber">
              <span class="barber__mono" aria-hidden="true">${esc(b.name[0])}</span>
              <div>
                <h3 class="barber__name">${esc(b.name)}</h3>
                <p class="barber__spec">${esc(b.specialty)}</p>
              </div>
            </li>`,
  ).join('');
  return `
      <section id="equipo" class="team" aria-labelledby="team-title">
        <div class="wrap">
          <p class="eyebrow">Equipo</p>
          <h2 id="team-title" class="h2">${esc(c.COPY.teamTitle)}</h2>
          <ul class="team__list">${cards}
          </ul>
        </div>
      </section>`;
}

export function hoursRows(c) {
  return c.HOURS_TABLE.map(([d, h]) => `<tr><th scope="row">${esc(d)}</th><td>${esc(h)}</td></tr>`).join('');
}

export function contactLines(c) {
  const lines = [`Teléfono: <span class="selectable">${esc(c.BRAND.phone)}</span>`];
  if (c.BRAND.instagram) lines.push(`Instagram: <span class="selectable">${esc(c.BRAND.instagram)}</span>`);
  return lines.join('<br />');
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

export function bookingServices(c) {
  const lookService = c.HAIR_LOOKS.find((l) => l.id === c.DEFAULT_LOOK.hair)?.service;
  return c.SERVICES.map(
    (s) => `
            <label class="option">
              <input type="radio" name="service" id="service-${s.id}" value="${s.id}"${s.id === lookService ? ' checked' : ''}>
              <span class="option__body">
                <span class="option__name">${esc(s.name)}</span>
                <span class="option__meta">${s.minutes} min · ${priceLabel(s.price, c.PRICES_FROM)}</span>
              </span>
            </label>`,
  ).join('');
}

export function bookingBarberStep(c) {
  if (!c.BARBERS.length) return '';
  const all = [{ id: 'any', name: 'Sin preferencia' }, ...c.BARBERS];
  return `
              <fieldset class="group">
                <legend><span class="n"></span> Barbero</legend>
                <div class="chips">${chips('barber', all, 'any')}
                </div>
              </fieldset>`;
}

export function pitchBadge(c) {
  if (!c.PITCH) return '';
  return `<aside class="pitch" id="pitch" aria-label="Aviso"><b>${esc(c.PITCH.label)}</b><span>${esc(c.PITCH.note)}</span><button type="button" class="pitch__close" id="pitch-close" aria-label="Ocultar aviso">×</button></aside>`;
}

export function pitchFooter(c) {
  return c.PITCH ? `<p class="foot__pitch">${esc(c.PITCH.label)}. ${esc(c.PITCH.note)}</p>` : '';
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function jsonLd(c) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'HairSalon',
    name: c.BRAND.name,
    telephone: c.BRAND.phone,
    priceRange: c.BRAND.priceRange,
    address: {
      '@type': 'PostalAddress',
      streetAddress: c.BRAND.street,
      postalCode: c.BRAND.postalCode,
      addressLocality: c.BRAND.city,
      addressCountry: 'ES',
    },
    openingHoursSpecification: Object.entries(c.OPENING)
      .filter(([, h]) => h)
      .map(([d, [opens, closes]]) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: `https://schema.org/${WEEKDAYS[d]}`, opens, closes })),
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Servicios',
      itemListElement: c.SERVICES.map((s) => ({
        '@type': 'Offer',
        ...(s.price != null ? { price: s.price, priceCurrency: 'EUR' } : {}),
        itemOffered: { '@type': 'Service', name: s.name, description: s.desc },
      })),
    },
  };
  if (c.BRAND.url) data.url = c.BRAND.url;
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

// Replaces <!--@name--> markers and {{brand.*}} / {{copy.*}} tokens in index.html.
export function renderPage(html, c) {
  const blocks = {
    brandMark,
    navLinks,
    services: servicesBoard,
    reviews: reviewsSection,
    team: teamSection,
    hours: hoursRows,
    contact: contactLines,
    hairChips: (cl) => chips('hair', cl.HAIR_LOOKS, cl.DEFAULT_LOOK.hair),
    beardChips: (cl) => chips('beard', cl.BEARD_LOOKS, cl.DEFAULT_LOOK.beard),
    bookingServices,
    bookingBarberStep,
    pitch: pitchBadge,
    pitchFooter,
    jsonld: jsonLd,
  };
  let out = html.replace(/<!--@(\w+)-->/g, (m, name) => (blocks[name] ? blocks[name](c) : m));
  out = out.replace(/\{\{(brand|copy)\.(\w+)\}\}/g, (m, group, k) => {
    const src = group === 'brand' ? c.BRAND : c.COPY;
    return k in src && src[k] != null ? esc(src[k]) : '';
  });
  return out;
}
