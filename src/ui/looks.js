import { HAIR_LOOKS, BEARD_LOOKS, SERVICES, BEARD_SERVICE, PRICES_FROM } from '../config.js';
import { priceLabel } from '../price.js';

const BEARD_PHRASE = {
  none: 'sin barba',
  stubble: 'con barba de tres días',
  short: 'con barba corta',
  full: 'con barba completa',
};

export const hairLook = (id) => HAIR_LOOKS.find((l) => l.id === id) || HAIR_LOOKS[0];
export const beardLook = (id) => BEARD_LOOKS.find((l) => l.id === id) || BEARD_LOOKS[0];
export const beardPhrase = (id) => BEARD_PHRASE[id] || '';

// Which service on the price list covers a look.
export function serviceForLook(look) {
  const hair = hairLook(look.hair);
  const id = look.beard === 'short' || look.beard === 'full' ? BEARD_SERVICE : hair.service;
  return SERVICES.find((s) => s.id === id) || SERVICES[0];
}

export function describeLook(look) {
  const hair = hairLook(look.hair);
  const service = serviceForLook(look);
  return {
    name: hair.name,
    beard: beardPhrase(look.beard),
    desc: hair.desc,
    meta: `${service.minutes} min · ${priceLabel(service.price, PRICES_FROM)} · ${hair.upkeep}`,
    short: `${hair.name} ${beardPhrase(look.beard)}`,
    service,
  };
}
