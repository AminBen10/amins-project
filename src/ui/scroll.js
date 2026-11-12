// The scroll story: one passive listener, one rAF, offsets cached outside the
// handler. Writes --hero/--enter/--turn/--shutter and html[data-scene], feeds the
// stage its beats, measures the mirror window, and turns long anchor jumps into
// instant ones so 'Pedir hora' never scrubs the whole visit.
const BEATS = ['enter', 'consult', 'clipper', 'scissors', 'razor', 'mirror'];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const r3 = (v) => Math.round(v * 1000) / 1000;

export function initScroll({ stage: initialStage = null, canvas = document.getElementById('stage'), reducedMotion = false } = {}) {
  const root = document.documentElement;
  let stage = initialStage;
  const q = (s) => document.querySelector(s);
  const els = {
    hero: q('#inicio'),
    carta: q('#carta'),
    turn: q('[data-beat="turn"]'),
    beats: Object.fromEntries(BEATS.map((b) => [b, q(`.visit [data-beat="${b}"]`)])),
    mirrorWindow: q('#mirror-window'),
  };

  // A stable viewport height: the large viewport (lvh) ignores the URL bar.
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:100vh;height:100lvh;visibility:hidden;pointer-events:none;';
  document.body.append(probe);

  const m = { vh: innerHeight, hero: 1, beats: {}, carta: null, turn: null };
  function measure() {
    m.vh = probe.offsetHeight || innerHeight;
    const y = scrollY;
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top + y, h: r.height };
    };
    m.hero = Math.max(1, els.hero?.offsetHeight || m.vh);
    for (const b of BEATS) m.beats[b] = box(els.beats[b]);
    m.carta = box(els.carta);
    m.turn = box(els.turn);
    measureFrame();
    measureShop();
    schedule();
  }

  const beatP = (b, y) => (b ? clamp01((y - (b.top - 0.5 * m.vh)) / Math.max(1, b.h || 0.5 * m.vh)) : 0);

  let last = {};
  let lastScene = '';
  let lastOpacity = '';
  let lastRunning = null;
  const input = {};
  function frame() {
    ticking = false;
    const y = scrollY;
    const vh = m.vh;
    input.hero = clamp01(y / m.hero);
    for (const b of BEATS) input[b] = beatP(m.beats[b], y);
    input.carta = m.carta ? clamp01((vh - (m.carta.top - y)) / (0.85 * vh)) : 0;
    input.turn = beatP(m.turn, y);

    const vars = { '--hero': input.hero, '--enter': input.enter, '--turn': input.turn, '--shutter': input.hero };
    for (const [k, v] of Object.entries(vars)) {
      const s = r3(v).toFixed(3);
      if (last[k] !== s) {
        last[k] = s;
        root.style.setProperty(k, s);
      }
    }
    const scene = input.turn >= 0.8 ? 'room' : input.enter < 0.7 ? 'shop' : 'mirror';
    if (scene !== lastScene) {
      lastScene = scene;
      root.dataset.scene = scene;
      measureFrame();
    }
    if (stage) {
      stage.setInput({ ...input });
      const running = input.turn < 1 && !document.hidden;
      if (running !== lastRunning) {
        lastRunning = running;
        stage.setRunning(running);
      }
    }
    pinHero(y);
    if (canvas) {
      const o = (1 - clamp01((input.turn - 0.8) / 0.2)).toFixed(3);
      if (o !== lastOpacity) {
        lastOpacity = o;
        canvas.style.opacity = o;
      }
    }
  }

  // With the stage painting the front, the canvas does not scroll: the DOM half of the
  // shopfront (lettering, door, sign) is held in place over it and fades out as one
  // piece, so the two layers never slide apart. Without the stage it scrolls normally.
  let lastPin = '';
  let pinPx = 0;
  function pinHero(y) {
    const hero = els.hero;
    if (!hero) return;
    const on = !!stage && root.dataset.stage === 'ready';
    const p = on ? Math.min(Math.max(y, 0), m.hero) : 0;
    const o = on ? 1 - clamp01(p / (0.45 * m.hero)) : 1;
    const k = `${Math.round(p)},${o.toFixed(3)}`;
    if (k === lastPin) return;
    lastPin = k;
    pinPx = Math.round(p);
    hero.style.transform = p ? `translate3d(0, ${Math.round(p)}px, 0)` : '';
    hero.style.opacity = o < 1 ? o.toFixed(3) : '';
    hero.style.visibility = o <= 0 ? 'hidden' : '';
  }

  let ticking = false;
  function schedule() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(frame);
  }

  // The mirror glass in CSS px, for the stage's render frame.
  let lastFrame = '';
  function measureFrame() {
    if (!stage?.setFrame || !els.mirrorWindow) return;
    const r = els.mirrorWindow.getBoundingClientRect();
    const f = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    const k = `${f.x},${f.y},${f.w},${f.h}`;
    if (k !== lastFrame) {
      lastFrame = k;
      stage.setFrame(f);
    }
  }

  // The shopfront grid at rest (scroll 0), in viewport fractions with y up: the stage puts its
  // facade openings behind the panes and the pole in the pier (stage.setShopfront).
  let lastShop = '';
  function measureShop() {
    if (!stage?.setShopfront) return;
    const glass = document.querySelector('.shop__glass');
    const pier = document.querySelector('.shop__pole');
    const door = document.querySelector('.shop__door');
    if (!glass || !pier) return;
    // at rest: undo the hero pin (pinHero) so the layout is measured as at scroll 0
    const W = innerWidth, H = m.vh, y = scrollY - pinPx;
    const fr = (el) => {
      const r = el.getBoundingClientRect();
      return [r.left / W, 1 - (r.bottom + y) / H, r.right / W, 1 - (r.top + y) / H];
    };
    const g = fr(glass);
    const p = fr(pier);
    // on phones the door is only the card sign hanging inside the window: no opening of its own
    const d = door && getComputedStyle(door).gridArea.startsWith('door') ? fr(door) : null;
    const L = { window: g, door: d, pole: [(p[0] + p[2]) / 2, (g[1] + g[3]) / 2 - 0.03], poleW: p[2] - p[0] };
    const k = JSON.stringify(L, (_, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v));
    if (k === lastShop) return;
    lastShop = k;
    stage.setShopfront(L);
  }

  addEventListener('scroll', schedule, { passive: true });
  document.addEventListener('visibilitychange', () => {
    lastRunning = null;
    schedule();
  });
  if ('ResizeObserver' in window) new ResizeObserver(measure).observe(document.body);
  else addEventListener('resize', measure);
  addEventListener('load', measure);
  document.fonts?.ready.then(measure);
  // Player open/close changes the mirror window.
  let lastPlayer = root.classList.contains('player-open');
  new MutationObserver(() => {
    const p = root.classList.contains('player-open');
    if (p !== lastPlayer) {
      lastPlayer = p;
      measureFrame();
    }
  }).observe(root, { attributes: true, attributeFilter: ['class'] });

  // Anchor jumps: far (or reduced motion) → instant, then the stage snaps; near → native smooth.
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.('a[href^="#"]');
    if (!a) return;
    const id = decodeURIComponent(a.getAttribute('href').slice(1));
    const target = id ? document.getElementById(id) : null;
    if (!target) return;
    const dist = Math.abs(target.getBoundingClientRect().top);
    if (!reducedMotion && dist <= 2.5 * m.vh) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: 'instant', block: 'start' });
    if (location.hash !== `#${id}`) history.pushState(null, '', `#${id}`);
    frame();
    stage?.snap?.();
    if (!target.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) target.tabIndex = -1;
    target.focus({ preventScroll: true });
  });

  // Nav links: aria-current for the section on screen (styling only).
  const links = [...document.querySelectorAll('.nav__links a[href^="#"]')];
  if (links.length && 'IntersectionObserver' in window) {
    const seen = new Map();
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) seen.set(en.target.id, en.isIntersecting);
        const on = links.find((l) => seen.get(l.getAttribute('href').slice(1)));
        for (const l of links) {
          if (l === on) l.setAttribute('aria-current', 'true');
          else l.removeAttribute('aria-current');
        }
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    for (const l of links) {
      const t = document.getElementById(l.getAttribute('href').slice(1));
      if (t) io.observe(t);
    }
  }

  measure();
  return {
    measure,
    update: schedule,
    input,
    /** Attach the stage once it has loaded. */
    setStage(s) {
      stage = s;
      lastRunning = null;
      lastFrame = '';
      lastShop = '';
      measure();
    },
  };
}
