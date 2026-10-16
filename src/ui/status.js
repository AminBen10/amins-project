import { OPENING } from '../config.js';

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// "Abierto ahora · cierra a las 20:30" / "Cerrado · abre el lunes a las 10:00"
export function openStatus(now = new Date()) {
  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  const today = OPENING[day];
  if (today && mins >= toMinutes(today[0]) && mins < toMinutes(today[1])) {
    return { open: true, text: `Abierto ahora · cierra a las ${today[1]}` };
  }
  if (today && mins < toMinutes(today[0])) {
    return { open: false, text: `Cerrado ahora · abre hoy a las ${today[0]}` };
  }
  for (let i = 1; i <= 7; i++) {
    const d = (day + i) % 7;
    if (OPENING[d]) {
      const when = i === 1 ? 'mañana' : `el ${DAY_NAMES[d]}`;
      return { open: false, text: `Cerrado ahora · abre ${when} a las ${OPENING[d][0]}` };
    }
  }
  return { open: false, text: 'Cerrado' };
}

export function initStatus() {
  const el = document.getElementById('open-status');
  if (!el) return;
  const update = () => {
    const s = openStatus();
    el.classList.toggle('status--open', s.open);
    el.classList.toggle('status--closed', !s.open);
    el.lastElementChild.textContent = s.text;
  };
  update();
  setInterval(update, 60_000);
}
