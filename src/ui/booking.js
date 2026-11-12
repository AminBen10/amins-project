// Pide hora: the appointment book on the counter.
// BK (BOOKING.mode 'whatsapp'): the book builds a WhatsApp request to the shop;
// the link is a plain <a target=_blank> whose href is rebuilt on every change.
// Treatwell and the phone stay visible. Nothing is reserved until the shop answers.
// CR (mode 'demo'): 'Apúntame' fills the card, clearly labelled as a demo.
// No storage, no network. Days and hours come from the shop's clock (shopTime).
import { BRAND, BOOKING, OPENING, SERVICES, BARBERS, COPY } from '../config.js';
import { priceLabel } from '../price.js';
import { tarifaLine } from '../cuts/ficha.js';
import { shopNow, buildDays, slotsFor } from './shopTime.js';
import { buildWhatsAppMessage, buildWhatsAppHref } from './whatsapp.js';

const TZ = BRAND.timezone || 'Europe/Madrid';
const LEAD = BOOKING.leadMinutes ?? 30;
const STEP = BOOKING.slotMinutes ?? 30;
const AHEAD = BOOKING.daysAhead ?? 14;
const WA = BOOKING.mode === 'whatsapp';
const MSG = {
  day: 'Elige un día.',
  time: 'Elige una hora.',
  name: 'Escribe tu nombre.',
  phone: 'Escribe un móvil español de 9 cifras.',
};

const $ = (id) => document.getElementById(id);
// Write text only when it changes (no needless mutations for assistive tech).
const setText = (el, t) => {
  if (el && el.textContent !== t) el.textContent = t;
};
const fill = (tpl, vars) => String(tpl || '').replace(/\{([^}]+)\}/g, (_, k) => vars[k] ?? '');

/** A Spanish mobile: 9 digits starting with 6 or 7, with or without +34. */
export function spanishMobile(raw) {
  let d = String(raw || '').replace(/[\s.\-()]/g, '');
  d = d.replace(/^(\+34|0034)/, '');
  return /^[67]\d{8}$/.test(d) ? d : null;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function initBooking({ onCut } = {}) {
  const form = $('book-form');
  if (!form) return { preset() {}, state: {} };
  const daysEl = $('days');
  const slotsEl = $('slots');
  const slotsHint = $('slots-hint');
  const hint = $('book-hint');
  const nameIn = $('book-name');
  const phoneIn = $('book-phone');
  const wa = $('book-wa');
  const submit = $('book-submit');
  const card = $('book-card');
  const cardTitle = $('card-title');
  const cutLabelEl = $('book-cut-label');
  const cutChange = $('book-cut-change');
  const fichaEl = $('book-cut-ficha');
  if (cardTitle && !cardTitle.hasAttribute('tabindex')) cardTitle.tabIndex = -1;

  const state = { day: null, time: null, cut: null, days: [], dayKey: '', slotKey: '' };
  const service = () => SERVICES.find((s) => s.id === form.elements.service?.value) || SERVICES[0];
  const barberId = () => form.elements.barber?.value || 'any';
  const barber = () => BARBERS.find((b) => b.id === barberId()) || null;

  // ---------------------------------------------------------------- days and hours

  function renderDays() {
    const now = shopNow(TZ);
    const svc = service();
    const b = barber();
    state.days = buildDays(OPENING, TZ, AHEAD, { now, minutes: svc.minutes, lead: LEAD, step: STEP }).map((d) =>
      b?.weekdays && !d.disabled && !b.weekdays.includes(d.weekday) ? { ...d, disabled: true } : d,
    );
    // Keep the chosen day if it is still bookable, else the first open one.
    let pick = state.days.find((d) => d.iso === state.day && !d.disabled);
    if (!pick) {
      pick = state.days.find((d) => !d.disabled) || null;
      if (state.day && (!pick || pick.iso !== state.day)) state.time = null;
    }
    state.day = pick?.iso || null;
    const key = state.days.map((d) => `${d.iso}${d.disabled ? 0 : 1}${d.note || ''}`).join('|') + `>${state.day}`;
    if (key !== state.dayKey) {
      state.dayKey = key;
      const frag = document.createDocumentFragment();
      for (const d of state.days) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'day';
        btn.dataset.day = d.iso;
        btn.setAttribute('aria-pressed', String(d.iso === state.day));
        btn.setAttribute('aria-label', d.note ? `${d.long}: ${d.note}` : d.long);
        if (d.disabled) btn.disabled = true;
        const l = document.createElement('span');
        l.className = 'day__name';
        l.textContent = d.label;
        btn.append(l);
        if (d.note) {
          const n = document.createElement('span');
          n.className = 'day__note';
          n.textContent = d.note;
          btn.append(n);
        }
        frag.append(btn);
      }
      daysEl.replaceChildren(frag);
    }
    renderSlots(now);
  }

  function currentDay() {
    return state.days.find((d) => d.iso === state.day) || null;
  }

  function renderSlots(now = shopNow(TZ)) {
    const day = currentDay();
    const svc = service();
    const slots = day ? slotsFor(day, svc.minutes, LEAD, now, STEP) : [];
    if (state.time && !slots.some((s) => s.label === state.time)) state.time = null;
    const key = `${day?.iso}|${slots.map((s) => s.label).join(',')}>${state.time}`;
    if (key !== state.slotKey) {
      state.slotKey = key;
      const frag = document.createDocumentFragment();
      for (const s of slots) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'slot';
        btn.dataset.time = s.label;
        btn.textContent = s.label;
        btn.setAttribute('aria-pressed', String(s.label === state.time));
        frag.append(btn);
      }
      slotsEl.replaceChildren(frag);
    }
    // CR: 'Quedan {n} horarios para {servicio} ({min} min).' BK keeps its fixed line.
    if (COPY.hoursHint?.includes('{')) {
      const hint = slots.length === 1 ? COPY.hoursHint.replace('Quedan', 'Queda').replace('horarios', 'horario') : COPY.hoursHint;
      setText(slotsHint, day ? fill(hint, { n: slots.length, servicio: svc.name, min: svc.minutes }) : '');
    }
    update();
  }

  // ---------------------------------------------------------------- validation

  function missing() {
    if (!state.day) return 'day';
    if (!state.time) return 'time';
    if (!nameIn.value.trim()) return 'name';
    if (!WA && phoneIn && !spanishMobile(phoneIn.value)) return 'phone';
    return null;
  }

  function focusFor(what) {
    if (what === 'day') daysEl.querySelector('button:not(:disabled)')?.focus();
    else if (what === 'time') (slotsEl.querySelector('button') || daysEl.querySelector('[aria-pressed=true]'))?.focus();
    else if (what === 'name') nameIn.focus();
    else if (what === 'phone') phoneIn?.focus();
  }

  function details() {
    const day = currentDay();
    const svc = service();
    const cut = state.cut;
    return {
      nombre: nameIn.value.trim().replace(/\s+/g, ' '),
      diaLargo: day?.long || '',
      hora: state.time || '',
      servicio: svc.name,
      corte: cut?.cutLabel || null,
      barba: cut?.beardLabel || null,
      ficha: cut?.ficha || null,
      svc,
      day,
    };
  }

  function message() {
    return buildWhatsAppMessage(details());
  }

  function update() {
    if (WA && wa) {
      const lack = missing();
      const href = buildWhatsAppHref(BOOKING.whatsapp || BRAND.whatsapp, lack ? '' : message());
      if (wa.getAttribute('href') !== href) wa.setAttribute('href', href);
      if (lack) wa.setAttribute('aria-disabled', 'true');
      else wa.removeAttribute('aria-disabled');
      if (!lack) setText(hint, '');
    }
  }

  // Re-check against the clock at the moment of acting: a tab left open can go stale.
  function revalidate() {
    renderDays();
    return missing();
  }

  // ---------------------------------------------------------------- the card

  // 'Degradado medio, con barba corta' (the book's and the card's cut line).
  const cutLine = (c) =>
    c ? [c.cutLabel, c.beardLabel && (c.cutLabel ? c.beardLabel.charAt(0).toLocaleLowerCase('es') + c.beardLabel.slice(1) : c.beardLabel)].filter(Boolean).join(', con ') : '';

  function fillCard() {
    const d = details();
    setText($('card-day'), d.day ? d.day.long.charAt(0).toUpperCase() + d.day.long.slice(1) : '');
    setText($('card-time'), d.hora);
    setText($('card-service'), tarifaLine(d.svc));
    const cut = cutLine(state.cut);
    setText($('card-cut'), cut);
    $('card-cut')?.closest('.card__row')?.toggleAttribute('hidden', !cut);
    const b = barber();
    setText($('card-with'), b ? b.name : '');
    $('card-with')?.closest('.card__row')?.toggleAttribute('hidden', !b);
    setText($('card-name'), d.nombre);
    setText($('card-ficha'), state.cut?.ficha || '');
    $('card-ficha')?.closest('.card__back')?.toggleAttribute('hidden', !state.cut?.ficha);
    if (!WA) {
      const tpl = b ? COPY.doneTitle : COPY.doneTitleAny || COPY.doneTitle;
      setText(cardTitle, fill(tpl, { nombre: d.nombre, 'día': d.day?.long || '', hora: d.hora, barbero: b?.name || '' }));
      setText(
        $('card-body'),
        fill(COPY.doneBody, { servicio: d.svc.name, min: d.svc.minutes, precio: priceLabel(d.svc.price, d.svc.from) }),
      );
    }
  }

  function showCard() {
    fillCard();
    form.hidden = true;
    card.hidden = false;
    cardTitle?.focus({ preventScroll: false });
  }

  function hideCard(focusEl) {
    card.hidden = true;
    form.hidden = false;
    focusEl?.focus();
  }

  // ---------------------------------------------------------------- events

  // Guided advance on phones: bring the next field into view (never focus it: no keyboard pop-up).
  const phone = matchMedia('(max-width: 699px), (pointer: coarse)');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  function guide(el) {
    if (!el || !phone.matches) return;
    const behavior = still.matches || document.documentElement.dataset.motion === 'off' ? 'instant' : 'smooth';
    requestAnimationFrame(() => el.scrollIntoView({ behavior, block: 'nearest' }));
  }

  daysEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-day]');
    if (!btn || btn.disabled) return;
    state.day = btn.dataset.day;
    state.time = null;
    state.dayKey = '';
    renderDays();
    daysEl.querySelector(`[data-day="${state.day}"]`)?.focus();
    guide(slotsEl);
  });

  slotsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-time]');
    if (!btn) return;
    state.time = btn.dataset.time;
    renderSlots();
    slotsEl.querySelector(`[data-time="${state.time}"]`)?.focus();
    guide(nameIn);
  });

  form.addEventListener('change', (e) => {
    if (e.target.name === 'service' || e.target.name === 'barber') renderDays();
    else update();
  });
  form.addEventListener('input', update);

  if (WA && wa) {
    wa.addEventListener('click', (e) => {
      const lack = revalidate();
      if (lack) {
        e.preventDefault();
        setText(hint, MSG[lack]);
        focusFor(lack);
        return;
      }
      update(); // href is current; let the link open WhatsApp natively
      setText(hint, '');
      setTimeout(showCard, 0);
    });
    const copyBtn = $('card-copy');
    let copyTimer = 0;
    copyBtn?.addEventListener('click', async () => {
      const ok = await copyText(message());
      if (!ok) return;
      setText(copyBtn, 'Copiado');
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => setText(copyBtn, 'Copiar mensaje'), 2500);
    });
    $('card-change')?.addEventListener('click', () => hideCard(wa));
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (WA) return;
    const lack = revalidate();
    if (lack) {
      setText(hint, MSG[lack]);
      focusFor(lack);
      return;
    }
    setText(hint, '');
    showCard();
  });
  $('card-again')?.addEventListener('click', () => {
    state.time = null;
    renderDays();
    hideCard(daysEl.querySelector('[aria-pressed=true]') || nameIn);
  });

  // The calendar follows the shop's clock: on return to the tab and every minute.
  let lastIso = shopNow(TZ).iso;
  const tick = () => {
    const iso = shopNow(TZ).iso;
    if (iso !== lastIso || currentDay()?.today) {
      lastIso = iso;
      renderDays();
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) renderDays();
  });
  setInterval(tick, 60_000);

  // ---------------------------------------------------------------- the cut

  function setCut(cut) {
    state.cut = cut && (cut.cutLabel || cut.beardLabel) ? cut : null;
    const label = cutLine(state.cut) || 'Sin elegir';
    setText(cutLabelEl, label);
    setText(cutChange, state.cut ? 'Cambiar' : 'Elegir en la carta');
    if (fichaEl) {
      setText(fichaEl, state.cut?.ficha || '');
      fichaEl.hidden = !state.cut?.ficha;
    }
    onCut?.(state.cut);
    update();
  }

  /**
   * Fill the book from the Carta, the composer or a chair:
   * {serviceId, cutId, beardId, ficha, cutLabel, beardLabel, barberId}. Any field may be omitted.
   */
  function preset(p = {}) {
    if (p.serviceId) {
      const r = form.querySelector(`input[name=service][value="${CSS.escape(p.serviceId)}"]`);
      if (r) r.checked = true;
    }
    if (p.barberId) {
      const r = form.querySelector(`input[name=barber][value="${CSS.escape(p.barberId)}"]`);
      if (r) r.checked = true;
    }
    if ('cutLabel' in p || 'beardLabel' in p || 'cutId' in p || 'beardId' in p) {
      setCut({ cutId: p.cutId || null, beardId: p.beardId || null, cutLabel: p.cutLabel || null, beardLabel: p.beardLabel || null, ficha: p.ficha || null });
    }
    if (!card.hidden) hideCard();
    renderDays();
  }

  // First service preselected; the first open day is picked by renderDays.
  if (form.elements.service && !form.querySelector('input[name=service]:checked')) {
    const first = form.querySelector('input[name=service]');
    if (first) first.checked = true;
  }
  renderDays();

  return { preset, state, message, get cut() { return state.cut; } };
}
