// The phone thumb bar: 'Pedir hora' under the thumb at every scroll position,
// out of the way while the book itself is on screen.
export function initThumbbar() {
  const bar = document.getElementById('thumbbar');
  const cta = document.getElementById('thumbbar-cta');
  const book = document.getElementById('reservar');
  if (!bar || !cta) return { setCut() {} };
  if (book && 'IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      for (const e of entries) bar.hidden = e.isIntersecting;
    }).observe(book);
  }
  return {
    /** 'Pedir hora · Degradado medio' once a cut is chosen. */
    setCut(cut) {
      const name = cut?.cutLabel || cut?.beardLabel || '';
      const t = name ? `Pedir hora · ${name}` : 'Pedir hora';
      if (cta.textContent !== t) cta.textContent = t;
    },
  };
}
