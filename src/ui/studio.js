import { DEFAULT_LOOK } from '../config.js';
import { describeLook } from './looks.js';

export function initStudio({ stage, booking }) {
  const form = document.getElementById('studio-form');
  const name = document.getElementById('look-name');
  const desc = document.getElementById('look-desc');
  const meta = document.getElementById('look-meta');
  const bookBtn = document.getElementById('book-look');
  const drag = document.getElementById('studio-drag');

  let look = { ...DEFAULT_LOOK };

  function render() {
    const d = describeLook(look);
    name.textContent = `${d.name} `;
    const span = document.createElement('span');
    span.textContent = d.beard;
    name.append(span);
    desc.textContent = d.desc;
    meta.textContent = d.meta;
  }

  form.addEventListener('change', () => {
    const data = new FormData(form);
    look = { hair: data.get('hair') || look.hair, beard: data.get('beard') || look.beard };
    render();
    stage?.setLook(look);
  });

  bookBtn.addEventListener('click', () => {
    const d = describeLook(look);
    booking.preset({ serviceId: d.service.id, look: d.short });
  });

  // drag (or swipe) sideways over the head to turn it
  if (stage && drag) {
    let active = null;
    let lastX = 0;
    let lastT = 0;
    drag.addEventListener('pointerdown', (e) => {
      active = e.pointerId;
      lastX = e.clientX;
      lastT = performance.now();
      drag.setPointerCapture(e.pointerId);
    });
    drag.addEventListener('pointermove', (e) => {
      if (e.pointerId !== active) return;
      const now = performance.now();
      stage.drag((e.clientX - lastX) * 0.008, (now - lastT) / 1000);
      lastX = e.clientX;
      lastT = now;
    });
    const end = (e) => {
      if (e.pointerId === active) active = null;
    };
    drag.addEventListener('pointerup', end);
    drag.addEventListener('pointercancel', end);
  }
  document.getElementById('rotate-left').addEventListener('click', () => stage?.nudge(-2.4));
  document.getElementById('rotate-right').addEventListener('click', () => stage?.nudge(2.4));

  render();
}
