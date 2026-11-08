// The shop's clock and calendar. Pure: no DOM, no storage, testable in node.
// Every date is the shop's wall-clock date in its own time zone (Europe/Madrid),
// whatever the visitor's device says. OPENING maps weekday 0–6 (Sunday = 0) to
// ['HH:MM', 'HH:MM'] (open), null (closed) or 'consultar' (not published: never
// shown as open, never bookable).

export const WEEKDAY_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const WEEKDAY_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const pad = (n) => String(n).padStart(2, '0');
export const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
};
export const hhmm = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

const fmtCache = new Map();
function partsIn(tz, date) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    });
    fmtCache.set(tz, f);
  }
  const o = {};
  for (const p of f.formatToParts(date)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o;
}

/**
 * The shop's wall clock now: {y, m (1–12), d, weekday (0 = Sunday), mins (since
 * midnight), iso 'YYYY-MM-DD'}. Falls back to the device's local time if the
 * time zone is unknown to Intl.
 */
export function shopNow(tz = 'Europe/Madrid', date = new Date()) {
  let y, m, d, mins;
  try {
    const p = partsIn(tz, date);
    if (!(p.year > 0 && p.month > 0 && p.day > 0) || Number.isNaN(p.hour)) throw new Error('parts');
    y = p.year;
    m = p.month;
    d = p.day;
    mins = (p.hour % 24) * 60 + p.minute;
  } catch {
    y = date.getFullYear();
    m = date.getMonth() + 1;
    d = date.getDate();
    mins = date.getHours() * 60 + date.getMinutes();
  }
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, weekday, mins, iso: isoOf(y, m, d) };
}

/** What OPENING says for a weekday: {state: 'open'|'closed'|'consultar', open, close} (minutes). */
export function hoursFor(OPENING, weekday) {
  const h = OPENING?.[weekday];
  if (h === 'consultar') return { state: 'consultar', open: null, close: null };
  if (Array.isArray(h) && h.length >= 2) return { state: 'open', open: toMinutes(h[0]), close: toMinutes(h[1]) };
  return { state: 'closed', open: null, close: null };
}

/** 'jueves 22 de octubre' for a calendar date. */
export function longDay(y, m, d) {
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAY_LONG[wd]} ${d} de ${MONTHS[m - 1]}`;
}

/**
 * The bookable days from today (shop time). Each day: {iso, y, m, d, weekday,
 * index, today, label ('Hoy' | 'Mañana' | 'jue 22'), long ('jueves 22 de
 * octubre'), state ('open'|'closed'|'consultar'), open, close (minutes), note
 * (null | 'Cerrado' | 'Consultar'), disabled}. Today counts as 'Cerrado' when no
 * service of opts.minutes (default 30) still fits after now + lead.
 * opts: {now (a shopNow result), minutes, lead, step}.
 */
export function buildDays(OPENING, tz = 'Europe/Madrid', daysAhead = 14, opts = {}) {
  const now = opts.now || shopNow(tz);
  const minutes = opts.minutes ?? 30;
  const lead = opts.lead ?? 30;
  const step = opts.step ?? 30;
  const days = [];
  for (let i = 0; i < daysAhead; i++) {
    const dt = new Date(Date.UTC(now.y, now.m - 1, now.d + i));
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    const weekday = dt.getUTCDay();
    const h = hoursFor(OPENING, weekday);
    const day = {
      iso: isoOf(y, m, d),
      y,
      m,
      d,
      weekday,
      index: i,
      today: i === 0,
      label: i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : `${WEEKDAY_SHORT[weekday]} ${d}`,
      long: longDay(y, m, d),
      state: h.state,
      open: h.open,
      close: h.close,
      note: null,
      disabled: false,
    };
    if (h.state === 'consultar') day.note = 'Consultar';
    else if (h.state === 'closed') day.note = 'Cerrado';
    else if (i === 0 && slotsFor(day, minutes, lead, now, step).length === 0) day.note = 'Cerrado';
    day.disabled = day.note !== null;
    days.push(day);
  }
  return days;
}

/**
 * The start times on a day for a service of `minutes`: every `step` minutes from
 * opening while the service ends by closing; today only from now + lead.
 * Returns [{mins, label 'HH:MM'}]. Nothing is ever 'taken': the shop confirms.
 * `now` (a shopNow result) defaults to the clock: a day in the past has no slots.
 */
export function slotsFor(day, minutes = 30, lead = 30, now = null, step = 30) {
  if (!day || day.state !== 'open' || day.open == null || day.close == null) return [];
  const n = now || shopNow();
  if (day.iso < n.iso) return [];
  let from = day.open;
  if (day.iso === n.iso) from = Math.max(from, n.mins + lead);
  const out = [];
  for (let t = day.open; t + minutes <= day.close; t += step) {
    if (t >= from) out.push({ mins: t, label: hhmm(t) });
  }
  return out;
}

/**
 * The door sign: {state: 'open'|'closed'|'unknown', text} from the deck strings.
 * A 'consultar' day is unknown (no sign) while it lasts; a closed spell whose
 * next opening falls after a 'consultar' day says only 'Cerrado', never a
 * guessed time.
 */
export function openStatus(OPENING, now) {
  const today = hoursFor(OPENING, now.weekday);
  if (today.state === 'consultar') return { state: 'unknown', text: '' };
  if (today.state === 'open') {
    if (now.mins >= today.open && now.mins < today.close) return { state: 'open', text: `Abierto · hasta las ${hhmm(today.close)}` };
    if (now.mins < today.open) return { state: 'closed', text: `Cerrado · abrimos hoy a las ${hhmm(today.open)}` };
  }
  for (let i = 1; i <= 7; i++) {
    const wd = (now.weekday + i) % 7;
    const h = hoursFor(OPENING, wd);
    if (h.state === 'consultar') return { state: 'closed', text: 'Cerrado' };
    if (h.state === 'open') {
      const when = i === 1 ? 'mañana' : `el ${WEEKDAY_LONG[wd]}`;
      return { state: 'closed', text: `Cerrado · abrimos ${when} a las ${hhmm(h.open)}` };
    }
  }
  return { state: 'closed', text: 'Cerrado' };
}
