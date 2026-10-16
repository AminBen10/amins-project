import { OPENING, SERVICES, BARBERS, CHAIRS, BOOKING, PRICES_FROM } from '../config.js';
import { priceLabel } from '../price.js';
import { toMinutes } from './status.js';

const WEEKDAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const WEEKDAY_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

// Demo agenda: a stable pseudo-random set of taken slots per barber and day.
// Swap this for a call to the real booking system.
function isTaken(barberId, day, mins) {
  return hash(`${barberId}|${day}|${mins}`) < 0.32;
}

// With no named barbers the shop is booked by chair.
const POOL = BARBERS.length ? BARBERS : Array.from({ length: CHAIRS || 1 }, (_, i) => ({ id: `silla-${i + 1}`, name: '' }));

function freeBarbers(day, start, minutes) {
  const step = BOOKING.slotMinutes;
  return POOL.filter((b) => {
    for (let t = start; t < start + minutes; t += step) if (isTaken(b.id, day, t)) return false;
    return true;
  });
}

export function initBooking() {
  const form = document.getElementById('book-form');
  const daysEl = document.getElementById('days');
  const slotsEl = document.getElementById('slots');
  const slotsHint = document.getElementById('slots-hint');
  const hint = document.getElementById('book-hint');
  const submit = document.getElementById('book-submit');
  const nameInput = document.getElementById('book-name');
  const phoneInput = document.getElementById('book-phone');
  const done = document.getElementById('book-done');
  const out = {
    service: document.getElementById('t-service'),
    barber: document.getElementById('t-barber'),
    day: document.getElementById('t-day'),
    time: document.getElementById('t-time'),
    lookRow: document.getElementById('t-look-row'),
    look: document.getElementById('t-look'),
    barberRow: document.getElementById('t-barber-row'),
    duration: document.getElementById('t-duration'),
    price: document.getElementById('t-price'),
  };

  const state = { day: null, time: null, look: null, touched: false };
  let days = [];

  const service = () => SERVICES.find((s) => s.id === form.elements.service.value) || SERVICES[0];
  const barberId = () => form.elements.barber?.value || 'any';
  const barberName = (id) => (id === 'any' ? 'Sin preferencia' : BARBERS.find((b) => b.id === id)?.name || '');

  function buildDays() {
    const now = new Date();
    days = [];
    for (let i = 0; i < BOOKING.daysAhead; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      days.push({ date: d, iso: isoDay(d), hours: OPENING[d.getDay()], index: i });
    }
    daysEl.textContent = '';
    for (const d of days) {
      const label = document.createElement('label');
      label.className = 'day';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'day';
      input.id = `day-${d.iso}`;
      input.value = d.iso;
      input.disabled = !d.hours;
      const span = document.createElement('span');
      const top = document.createElement('small');
      top.textContent = d.index === 0 ? 'Hoy' : d.index === 1 ? 'Mañ.' : WEEKDAY_SHORT[d.date.getDay()];
      const num = document.createElement('b');
      num.textContent = d.date.getDate();
      const bottom = document.createElement('small');
      bottom.textContent = d.hours ? MONTHS[d.date.getMonth()].slice(0, 3) : 'Cerrado';
      span.append(top, num, bottom);
      label.title = d.hours ? `${WEEKDAY_LONG[d.date.getDay()]} ${d.date.getDate()} de ${MONTHS[d.date.getMonth()]}` : 'Cerrado';
      label.append(input, span);
      daysEl.append(label);
    }
  }

  function slotsFor(day) {
    if (!day?.hours) return [];
    const minutes = service().minutes;
    const open = toMinutes(day.hours[0]);
    const close = toMinutes(day.hours[1]);
    const now = new Date();
    const nowMins = day.index === 0 ? now.getHours() * 60 + now.getMinutes() + 30 : -1;
    const out = [];
    for (let t = open; t + minutes <= close; t += BOOKING.slotMinutes) {
      const id = barberId();
      const free = id === 'any' ? freeBarbers(day.iso, t, minutes).length > 0 : freeBarbers(day.iso, t, minutes).some((b) => b.id === id);
      out.push({ mins: t, label: hhmm(t), available: free && t >= nowMins });
    }
    return out;
  }

  function firstDayWithSlots() {
    return days.find((d) => slotsFor(d).some((s) => s.available)) || days.find((d) => d.hours);
  }

  function renderSlots() {
    const day = days.find((d) => d.iso === state.day);
    const slots = slotsFor(day);
    slotsEl.textContent = '';
    for (const s of slots) {
      const label = document.createElement('label');
      label.className = 'slot';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'time';
      input.id = `time-${s.label.replace(':', '')}`;
      input.value = s.label;
      input.disabled = !s.available;
      input.checked = s.available && state.time === s.label;
      const span = document.createElement('span');
      span.textContent = s.label;
      if (!s.available) label.title = 'Ocupado';
      label.append(input, span);
      slotsEl.append(label);
    }
    if (state.time && !slots.some((s) => s.available && s.label === state.time)) state.time = null;
    const free = slots.filter((s) => s.available).length;
    slotsHint.textContent = !day?.hours
      ? 'Ese día está cerrado.'
      : free
        ? `${free} horas libres para ${service().name.toLowerCase()} (${service().minutes} min).`
        : 'No quedan horas libres este día. Prueba con otro día u otro barbero.';
  }

  function validPhone(v) {
    return /^(\+?34)?[6789]\d{8}$/.test(v.replace(/[\s.-]/g, ''));
  }

  function missing() {
    if (!state.day) return 'Elige un día.';
    if (!state.time) return 'Elige una hora para continuar.';
    if (nameInput.value.trim().length < 2) return 'Escribe tu nombre.';
    if (!validPhone(phoneInput.value)) return 'Escribe un móvil español de 9 cifras.';
    return '';
  }

  function renderTicket() {
    const s = service();
    const day = days.find((d) => d.iso === state.day);
    out.service.textContent = s.name;
    out.barberRow.hidden = !BARBERS.length;
    out.barber.textContent = barberName(barberId());
    out.day.textContent = day ? `${WEEKDAY_LONG[day.date.getDay()]} ${day.date.getDate()} de ${MONTHS[day.date.getMonth()]}` : '—';
    out.time.textContent = state.time || '—';
    out.lookRow.hidden = !state.look;
    out.look.textContent = state.look || '';
    out.duration.textContent = `${s.minutes} min`;
    out.price.textContent = priceLabel(s.price, PRICES_FROM);
    const why = missing();
    submit.setAttribute('aria-disabled', why ? 'true' : 'false');
    hint.textContent = state.touched ? why : why && !state.time ? why : '';
  }

  function update() {
    renderSlots();
    renderTicket();
  }

  form.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'day') {
      state.day = t.value;
      state.time = null;
      renderSlots();
    } else if (t.name === 'time') {
      state.time = t.value;
    } else if (t.name === 'service' || t.name === 'barber') {
      renderSlots();
    }
    renderTicket();
  });
  form.addEventListener('input', (e) => {
    if (e.target === nameInput || e.target === phoneInput) {
      e.target.removeAttribute('aria-invalid');
      renderTicket();
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    state.touched = true;
    const why = missing();
    if (why) {
      renderTicket();
      if (nameInput.value.trim().length < 2) nameInput.setAttribute('aria-invalid', 'true');
      if (!validPhone(phoneInput.value)) phoneInput.setAttribute('aria-invalid', 'true');
      (!state.time ? slotsEl.querySelector('input:not(:disabled)') : nameInput.value.trim().length < 2 ? nameInput : phoneInput)?.focus();
      return;
    }
    const s = service();
    const day = days.find((d) => d.iso === state.day);
    let barber = barberName(barberId());
    if (barberId() === 'any') {
      const free = freeBarbers(day.iso, toMinutes(state.time), s.minutes);
      barber = free[0]?.name || '';
    }
    const withWho = barber ? ` con ${barber}` : '';
    const cost =
      s.price == null
        ? `Son unos ${s.minutes} minutos; el precio te lo confirman en la barbería.`
        : `Son ${s.minutes} minutos y ${priceLabel(s.price, PRICES_FROM)}, se paga en la barbería.`;
    const first = nameInput.value.trim().split(/\s+/)[0];
    document.getElementById('done-title').textContent = `Listo, ${first}.`;
    document.getElementById('done-text').textContent =
      `${s.name}${withWho} el ${WEEKDAY_LONG[day.date.getDay()]} ${day.date.getDate()} de ${MONTHS[day.date.getMonth()]} a las ${state.time}. ${cost}`;
    document.getElementById('done-note').textContent =
      BOOKING.mode === 'demo'
        ? 'Modo demostración: esta web todavía no está conectada a la agenda de la barbería, así que no se ha guardado ninguna cita.'
        : 'Te llegará un SMS de confirmación al móvil que has indicado.';
    form.hidden = true;
    done.hidden = false;
    done.focus();
  });

  document.getElementById('book-again').addEventListener('click', () => {
    done.hidden = true;
    form.hidden = false;
    state.time = null;
    state.touched = false;
    update();
  });

  buildDays();
  const first = firstDayWithSlots();
  if (first) {
    state.day = first.iso;
    const input = document.getElementById(`day-${first.iso}`);
    if (input) input.checked = true;
  }
  update();

  return {
    // called from the style studio: pick the matching service and remember the look
    preset({ serviceId, look }) {
      const input = document.getElementById(`service-${serviceId}`);
      if (input) input.checked = true;
      state.look = look;
      done.hidden = true;
      form.hidden = false;
      update();
    },
  };
}
