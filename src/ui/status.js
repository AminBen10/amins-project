// The door sign and the pole: open, closed or unknown by the shop's own clock.
// Fills every [data-door-sign], sets html[data-open] and tells the stage, every minute.
import { BRAND, OPENING } from '../config.js';
import { shopNow, openStatus } from './shopTime.js';

export { openStatus };

export function initStatus({ stage = null, now = () => new Date() } = {}) {
  const tz = BRAND.timezone || 'Europe/Madrid';
  const root = document.documentElement;
  let last = '';
  const api = {
    stage,
    current: null,
    update() {
      const s = openStatus(OPENING, shopNow(tz, now()));
      api.current = s;
      const key = `${s.state}|${s.text}`;
      if (key !== last) {
        last = key;
        root.dataset.open = s.state;
        for (const el of document.querySelectorAll('[data-door-sign]')) {
          if (el.textContent !== s.text) el.textContent = s.text;
        }
      }
      api.stage?.setOpen?.(s.state === 'open');
      return s;
    },
    setStage(st) {
      api.stage = st;
      api.update();
    },
  };
  api.update();
  setInterval(api.update, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) api.update();
  });
  return api;
}
