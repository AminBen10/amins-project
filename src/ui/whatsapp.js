// The WhatsApp request for Barbería BK, in the copy deck's words. Pure: no DOM,
// testable in node. The message asks for a time; it never says the time is booked.

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const lowerFirst = (s) => (s ? s.charAt(0).toLocaleLowerCase('es') + s.slice(1) : s);
const endDot = (s) => (/[.!?…]$/.test(s) ? s : `${s}.`);

/**
 * The lines of the message (deck template):
 *   Hola, soy {nombre}. Quería pedir hora para el {jueves 22 de octubre} a las {hora}.
 *   {Servicio}: {corte}{, con barba …}.   — or '{Servicio}.' with no cut
 *   {ficha}                                — only with a cut
 *   ¿Me la confirmáis? Gracias.
 */
export function buildWhatsAppLines({ nombre, diaLargo, hora, servicio, corte, barba, ficha } = {}) {
  const lines = [`Hola, soy ${clean(nombre)}. Quería pedir hora para el ${clean(diaLargo)} a las ${clean(hora)}.`];
  const s = clean(servicio);
  const c = lowerFirst(clean(corte));
  const b = lowerFirst(clean(barba));
  const what = c && b ? `${c}, con ${b}` : c || b;
  if (what) lines.push(s ? `${s}: ${what}.` : `${what.charAt(0).toLocaleUpperCase('es')}${what.slice(1)}.`);
  else if (s) lines.push(`${s}.`);
  const f = clean(ficha);
  if (what && f) lines.push(endDot(f));
  lines.push('¿Me la confirmáis? Gracias.');
  return lines;
}

export function buildWhatsAppMessage(fields) {
  return buildWhatsAppLines(fields).join('\n');
}

/** 'https://wa.me/34631023374?text=…' (number as digits only, text fully encoded). */
export function buildWhatsAppHref(number, text) {
  const n = String(number ?? '').replace(/\D/g, '');
  return `https://wa.me/${n}` + (text ? `?text=${encodeURIComponent(text)}` : '');
}
