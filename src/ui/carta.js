// La Carta (motion M5): the chart of plates, the recipe card and the player on the mirror.
// Pick a cut or a beard → the card follows at once → 400 ms later the film loads and the head is
// cut on screen, step by step. The head is never cut twice for nothing: every film starts from
// what is on the head now (base 'current') and only the parts that look different are grown
// back and cut again (changedParts), so a cut keeps the beard and a beard keeps the hair.
// The composer (composer.js) plays its ingredients through the same `show()`.
// Phone (< 900 px): the player is a full-screen station (html.player-open) with its own history
// entry (#carta/{id}), a focus trap and the Receta / Cambiar sheets.
import { compose, mixOf, changedParts } from '../cuts/compose.js';
import { renderRecipe, programParts } from '../cuts/recipe.js';
import { serviceFor } from '../cuts/ficha.js';
import { TOOL_NAMES } from '../cuts/catalog.js';

const DEBOUNCE_MS = 400;
const HAIR = ['laterales', 'arriba', 'acabado'];
const ALL = ['laterales', 'arriba', 'barba', 'acabado'];
const noBeard = (p) => !p?.spec?.beard || p.spec.beard.style === 'none';
const titleOf = (p) => (p ? (p.n ? `Nº ${p.n} · ${p.name}` : p.name || '') : '');

/**
 * initCarta({client, booking, thumbbar, reducedMotion}) → Carta
 * Carta{setFilm(film, stage), show(program, opts), select(id), current, onShow(cb), back()}.
 */
export function initCarta({ client, booking, thumbbar, reducedMotion = false }) {
  const root = document.documentElement;
  const $ = (id) => document.getElementById(id);
  const form = $('carta-form');
  const recipeEl = $('recipe');
  const player = $('carta-player');
  const titleEl = $('film-title');
  const captionEl = $('film-caption');
  const composerEl = $('composer');
  const phoneQ = matchMedia('(max-width: 899px)');
  const btn = (name) => player?.querySelector(`[data-film="${name}"]`);
  const sheetBtn = (name) => player?.querySelector(`[data-player-sheet="${name}"]`);
  const all = [...client.CUTS, ...client.BEARDS];
  const byId = (id) => all.find((p) => p.id === id) || null;

  // A live region of its own: the caption shows the barber's note, the announcement names the tool.
  captionEl?.setAttribute('aria-live', 'off');
  const live = document.createElement('p');
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');
  player?.append(live);
  const say = (t) => {
    if (live.textContent !== t) live.textContent = t;
  };

  let film = null;
  let stage = null;
  let full = null; // the program on the card (cut + beard, or the composed mix)
  let played = null; // {program (the steps the film plays), map: film index → card index, parts}
  let lastPlate = null; // the plate input the film came from (focus goes back there)
  let timer = 0;
  const subs = new Set();

  // What the head shows once the current film ends: `onHead` everywhere except the `dirty` parts.
  const storyProgram = () => {
    const s = client.STORY_CUT || {};
    return compose(mixOf(s.hair || null, s.beard || null, client), client);
  };
  let onHead = storyProgram();
  let dirty = new Set();

  // ---------------------------------------------------------------- the card

  function renderCard(p) {
    if (!recipeEl) return;
    recipeEl.innerHTML = p?.steps?.length ? renderRecipe(p, client) : '';
    markSteps(-1);
  }

  // Steps of the card: the one playing is [aria-current=step], the ones on the head are .is-done.
  function markSteps(cur) {
    if (!recipeEl || !full) return;
    const inFilm = new Set(played ? played.map : []);
    const curIdx = played && cur >= 0 ? played.map[cur] : -1;
    const ended = played && cur >= played.map.length;
    for (const b of recipeEl.querySelectorAll('.recipe__step[data-step]')) {
      const i = +b.dataset.step;
      const filmed = inFilm.has(i);
      const done = !filmed || ended || (cur >= 0 && played.map.indexOf(i) < cur);
      if (i === curIdx && !ended) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
      b.classList.toggle('is-done', !!played && done && i !== curIdx);
    }
  }

  // ---------------------------------------------------------------- films

  /** The steps of `p` the film plays for these parts (the mirror closes every film). */
  function cutDown(p, parts, titleProgram) {
    const set = new Set(parts);
    const map = [];
    const steps = [];
    p.steps.forEach((s, i) => {
      if (set.has(s.part) || s.op === 'mirror') {
        map.push(i);
        steps.push(s);
      }
    });
    const prog = { ...p, steps, id: `${p.id}~${parts.join('+')}` };
    if (titleProgram) {
      prog.n = titleProgram.n;
      prog.name = titleProgram.name;
    }
    return { program: prog, map, parts };
  }

  /**
   * Show a program: card now, film after `debounce` ms.
   * opts {parts (forced parts to cut again), from ('carta'|'composer'), title (program for the
   * title card), speed, debounce, base ('current'|'overgrown'), withTitle}
   */
  function show(next, opts = {}) {
    clearTimeout(timer);
    const from = opts.from || 'carta';
    full = next && next.steps?.length ? next : null;
    played = null;
    renderCard(full);
    titleEl && (titleEl.textContent = full ? titleOf(opts.title || full) : '');
    if (captionEl) captionEl.textContent = full ? '' : 'Toca un corte para ver cómo se hace.';
    // every film opens on its own shots: the view buttons go back to 'De frente'
    for (const v of player?.querySelectorAll('[data-view]') || []) v.setAttribute('aria-pressed', String(v.dataset.view === 'frente'));
    const parts = programParts(full);
    thumbbar?.setCut(full ? { cutLabel: parts.cutLabel, beardLabel: parts.beardLabel } : null);
    for (const fn of subs) fn(full, from);
    if (!full) return;
    if (phoneQ.matches && root.dataset.stage === 'ready') openPlayer(from === 'carta' ? lastPlate?.value || full.id : full.id);
    // desktop: a pick (plate or composer) brings the player to its sticky place, so the title
    // card sits over the glass and the transport is on screen, not over the head mid-page
    else if (player && root.dataset.stage === 'ready') {
      requestAnimationFrame(() => {
        const r = player.getBoundingClientRect();
        const stick = parseFloat(getComputedStyle(player).top) || 80;
        const down = Math.max(r.bottom - innerHeight + 16, r.top - stick - 8);
        if (down > 0) scrollBy({ top: Math.min(down, Math.max(0, r.top - stick)), behavior: reducedMotion ? 'instant' : 'smooth' });
      });
    }
    if (!film) return;
    // which parts to grow back and cut again
    let reset = opts.parts ? [...opts.parts] : changedParts(onHead, full);
    if (noBeard(full) && !dirty.has('barba')) reset = reset.filter((x) => x !== 'barba'); // 'sin barba' leaves the beard alone
    for (const d of dirty) if (!reset.includes(d)) reset.push(d);
    if (!reset.length) reset = noBeard(full) ? [...HAIR] : [...ALL]; // the same look again: show it whole
    reset = ALL.filter((x) => reset.includes(x));
    played = cutDown(full, reset, opts.title);
    if (!played.program.steps.length) played = null;
    markSteps(-1);
    if (!played) return;
    onHead = full;
    dirty = new Set(reset);
    const load = () => {
      const mine = played;
      film
        .load(mine.program, {
          base: opts.base || 'current',
          parts: reset,
          speed: opts.speed || 1,
          title: opts.withTitle !== false,
          autoplay: true,
        })
        .then((h) => {
          if (h && reducedMotion && played === mine) ended(); // the finished cut, as a still
        })
        .catch((err) => console.error(err));
    };
    if (opts.debounce === 0) load();
    else timer = setTimeout(load, opts.debounce ?? DEBOUNCE_MS);
  }

  function selected() {
    if (!form) return { cut: null, beard: null };
    const cut = form.elements.corte?.value || null;
    const b = form.elements.barba?.value || null;
    return { cut, beard: b && b !== 'none' ? b : null };
  }

  // A plate was picked: the card for the cut with the chosen beard; the film cuts what changed.
  function fromForm(e) {
    const { cut, beard } = selected();
    const target = e?.target?.name ? e.target : null;
    if (target) lastPlate = target;
    const prog = compose(mixOf(cut, beard, client), client);
    const titleP = target?.name === 'barba' && beard ? byId(beard) : cut ? byId(cut) : beard ? byId(beard) : null;
    show(prog, { from: 'carta', title: titleP });
    if (phoneQ.matches && full) history.replaceState(null, '', `#carta/${titleP?.id || full.id}`);
  }
  form?.addEventListener('change', fromForm);

  /** Pick a plate by program id (deep links, prev/next, QA). */
  function select(id) {
    const p = byId(id);
    if (!form || !p) return false;
    const name = p.kind === 'beard' ? 'barba' : 'corte';
    const input = form.querySelector(`input[name="${name}"][value="${CSS.escape(id)}"]`);
    if (!input) return false;
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // ---------------------------------------------------------------- film → screen

  // The film reached the finished cut (or reduced motion loaded it as a still).
  function ended() {
    dirty.clear();
    if (!full) return;
    const t = `Terminado. Así queda: ${full.name}.`;
    if (captionEl) captionEl.textContent = t;
    say(t);
    if (played) markSteps(played.map.length);
  }

  function wire() {
    film.on('step', ({ i, step }) => {
      if (!played) return;
      const text = step.caption || step.label || '';
      if (captionEl) captionEl.textContent = text;
      const tool = TOOL_NAMES[step.tool];
      say(tool ? `${tool}: ${text}` : text);
      markSteps(i);
    });
    film.on('end', ended);
    film.on('state', ({ state }) => {
      const b = (n) => btn(n);
      if (b('play')) b('play').hidden = state === 'playing' || state === 'paused';
      if (b('pause')) b('pause').hidden = state !== 'playing';
      if (b('resume')) b('resume').hidden = state !== 'paused';
      if (state === 'idle') played = null;
    });
  }

  function step(dir) {
    const p = byId(lastPlate?.value);
    const kind = p?.kind || 'cut';
    const name = kind === 'beard' ? 'barba' : 'corte';
    const inputs = [...(form?.querySelectorAll(`input[name="${name}"]`) || [])].filter((x) => byId(x.value));
    inputs.sort((a, b) => byId(a.value).n - byId(b.value).n);
    if (!inputs.length) return;
    const at = inputs.findIndex((x) => x.checked);
    const next = inputs[(at + dir + inputs.length) % inputs.length];
    next.checked = true;
    next.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // The card back to the chart: the film stops (the story's cut comes back on the head).
  function back() {
    clearTimeout(timer);
    film?.stop();
    onHead = storyProgram();
    dirty.clear();
    full = null;
    played = null;
    renderCard(null);
    if (titleEl) titleEl.textContent = '';
    if (captionEl) captionEl.textContent = 'Toca un corte para ver cómo se hace.';
    closePlayer('back');
    const plate = lastPlate || form?.querySelector('input:checked');
    plate?.focus({ preventScroll: phoneQ.matches });
  }

  player?.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const f = b.dataset.film;
    if (b.dataset.playerSheet) return sheet(b.dataset.playerSheet);
    if (f === 'back') return back();
    if (f === 'prev') return step(-1);
    if (f === 'next') return step(1);
    if (b.dataset.view) {
      for (const v of player.querySelectorAll('[data-view]')) v.setAttribute('aria-pressed', String(v === b));
      film?.view(b.dataset.view);
      return;
    }
    if (!film) return;
    if (f === 'play') {
      if (!film.program && full) show(full, { parts: noBeard(full) ? HAIR : ALL, debounce: 0, title: byId(lastPlate?.value) });
      else {
        if (played) dirty = new Set(played.parts);
        film.play();
      }
    } else if (f === 'pause') film.pause();
    else if (f === 'resume') film.resume();
    else if (f === 'repeat') {
      if (played) dirty = new Set(played.parts);
      film.repeat();
    } else if (f === 'finish') film.finish();
  });

  // Recipe steps seek the film; a step the film does not hold replays the whole cut first.
  recipeEl?.addEventListener('click', async (e) => {
    const b = e.target.closest('.recipe__step[data-step]');
    if (!b || !film || !full) return;
    const i = +b.dataset.step;
    let k = played ? played.map.indexOf(i) : -1;
    if (k < 0) {
      show(full, { parts: noBeard(full) ? HAIR : ALL, debounce: 0, from: 'seek', title: byId(lastPlate?.value) });
      await waitLoaded();
      k = played ? played.map.indexOf(i) : -1;
      if (k < 0) return;
    }
    dirty = new Set(played.parts);
    film.seek(k);
    markSteps(k);
  });
  const waitLoaded = () =>
    new Promise((res) => {
      if (film.state !== 'loading') return res();
      const off = film.on('state', ({ state }) => {
        if (state !== 'loading') off(), res();
      });
    });

  // Drag over the player turns the head (yaw wraps in film.drag).
  if (player) {
    let drag = null;
    player.addEventListener('pointerdown', (e) => {
      if (!film?.program || e.target.closest('button, a, input') || e.button !== 0) return;
      drag = { x: e.clientX, id: e.pointerId };
      player.setPointerCapture?.(e.pointerId);
    });
    player.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      drag.x = e.clientX;
      if (dx) film.drag(dx);
    });
    const end = () => (drag = null);
    player.addEventListener('pointerup', end);
    player.addEventListener('pointercancel', end);
  }

  // ---------------------------------------------------------------- booking

  // 'Pedir hora con este corte' on any card: the book with this program's service and ficha.
  document.addEventListener(
    'click',
    (e) => {
      const a = e.target.closest?.('a.recipe__book');
      if (!a) return;
      const d = a.dataset;
      // the phone station's own link carries no program: it books the cut on screen
      const program = (full && (!d.program || full.id === d.program) ? full : null) || byId(d.program);
      const parts = programParts(program);
      booking.preset({
        serviceId: d.service || serviceFor(program, client)?.id,
        cutId: d.cut || parts.cut,
        beardId: d.beard || parts.beard,
        cutLabel: d.cutLabel || parts.cutLabel,
        beardLabel: d.beardLabel || parts.beardLabel,
        ficha: program?.ficha || null,
      });
      if (root.classList.contains('player-open')) {
        // the station closes; the jump to the book is instant (scroll.js handles the anchor)
        film?.pause();
        closePlayer('replace', '#reservar');
        e.preventDefault();
        const book = $('reservar');
        book?.scrollIntoView({ behavior: 'instant', block: 'start' });
        if (book && !book.hasAttribute('tabindex')) book.tabIndex = -1;
        book?.focus({ preventScroll: true });
      } else if (reducedMotion) {
        e.preventDefault();
        $('reservar')?.scrollIntoView({ behavior: 'instant', block: 'start' });
        history.pushState(null, '', '#reservar');
        $('reservar')?.focus?.({ preventScroll: true });
      } else {
        // A far jump is instant (scroll.js); the Carta may shrink just after it (card and sheet
        // swap back), which would leave the page a screen or more below the book: land again.
        const book = $('reservar');
        if (book && Math.abs(book.getBoundingClientRect().top) > 2.5 * innerHeight) {
          const land = () => {
            const top = book.getBoundingClientRect().top;
            const want = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
            if (Math.abs(top - want) > 24) book.scrollIntoView({ behavior: 'instant', block: 'start' });
          };
          requestAnimationFrame(() => requestAnimationFrame(land));
          setTimeout(land, 350);
        }
      }
    },
    true,
  );

  // The thumb bar books the cut on the card when there is one.
  $('thumbbar-cta')?.addEventListener('click', () => {
    if (!full) return;
    const parts = programParts(full);
    booking.preset({ serviceId: serviceFor(full, client)?.id, cutId: parts.cut, beardId: parts.beard, cutLabel: parts.cutLabel, beardLabel: parts.beardLabel, ficha: full.ficha || null });
  });

  // ---------------------------------------------------------------- phone player

  let pushed = false;
  let opener = null;
  function openPlayer(id) {
    if (!player || root.classList.contains('player-open')) return;
    opener = document.activeElement;
    root.classList.add('player-open');
    const more = sheetBtn('composer');
    if (more) more.hidden = false;
    if (!pushed) {
      history.pushState({ player: true }, '', `#carta/${id}`);
      pushed = true;
    }
    requestAnimationFrame(() => (btn('pause')?.hidden ? btn('play') : btn('pause'))?.focus({ preventScroll: true }));
  }

  function closePlayer(how = 'back', hash = '#carta') {
    if (!root.classList.contains('player-open')) return;
    root.classList.remove('player-open');
    sheet(null);
    const more = sheetBtn('composer');
    if (more) more.hidden = true;
    if (pushed) {
      pushed = false;
      // only our own entry is popped (never a step out of the page)
      if (how === 'back' && history.state?.player) history.back();
      else if (how === 'back') history.replaceState(null, '', '#carta');
      else if (how === 'replace') history.replaceState(null, '', hash);
    }
    const carta = $('carta');
    if (how !== 'replace' && carta) carta.scrollIntoView({ behavior: 'instant', block: 'start' });
    if (how !== 'replace') (lastPlate || opener)?.focus?.({ preventScroll: true });
  }

  addEventListener('popstate', () => {
    if (root.classList.contains('player-open') && !history.state?.player) {
      pushed = false;
      back();
    }
  });

  // Scrolling the page past the Carta with the station open: it closes (paused), so the
  // fixed station never sits over the tarifa or the book.
  const cartaSection = $('carta');
  if (cartaSection && 'IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      const en = entries[entries.length - 1];
      if (en.isIntersecting || !root.classList.contains('player-open')) return;
      film?.pause();
      closePlayer('replace', `${location.pathname}${location.search}`);
    }).observe(cartaSection);
  }

  // Leaving phone width with the station open: the desktop player takes over.
  phoneQ.addEventListener?.('change', () => {
    if (!phoneQ.matches && root.classList.contains('player-open')) closePlayer('replace', '#carta');
  });

  function sheet(name) {
    const cur = root.dataset.playerSheet || null;
    const next = name && name !== cur ? name : null;
    if (next) root.dataset.playerSheet = next;
    else delete root.dataset.playerSheet;
    for (const b of player?.querySelectorAll('[data-player-sheet]') || []) b.setAttribute('aria-expanded', String(b.dataset.playerSheet === next));
    if (next === 'composer' && composerEl) {
      composerEl.hidden = false;
      for (const fn of subs) fn(full, 'sheet');
    }
  }

  // Focus stays inside the station (player + open sheet); Esc closes the sheet, then the station.
  document.addEventListener('keydown', (e) => {
    if (!root.classList.contains('player-open')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (root.dataset.playerSheet) sheet(null);
      else back();
      return;
    }
    if (e.key !== 'Tab') return;
    const boxes = [player, root.dataset.playerSheet === 'recipe' ? recipeEl : null, root.dataset.playerSheet === 'composer' ? composerEl : null].filter(Boolean);
    const list = boxes
      .flatMap((b) => [...b.querySelectorAll('button, a[href], input, [tabindex]:not([tabindex="-1"])')])
      .filter((el) => !el.disabled && !el.hidden && el.offsetParent !== null && !el.closest('[hidden], fieldset:disabled'));
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    const inside = boxes.some((b) => b.contains(document.activeElement));
    if (!inside) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // ---------------------------------------------------------------- deep link #carta/{id}

  const deep = /^#carta\/([\w-]+)$/.exec(location.hash)?.[1];
  if (deep && byId(deep)) {
    // the card at once; the film once the stage is ready (setFilm)
    const name = byId(deep).kind === 'beard' ? 'barba' : 'corte';
    const input = form?.querySelector(`input[name="${name}"][value="${CSS.escape(deep)}"]`);
    if (input) {
      input.checked = true;
      lastPlate = input;
      fromForm({ target: input });
      requestAnimationFrame(() => $('carta')?.scrollIntoView({ behavior: 'instant', block: 'start' }));
    }
  }

  return {
    get current() {
      return full;
    },
    get played() {
      return played;
    },
    /** The film arrives with the stage (onReady); a card already open starts playing. */
    setFilm(f, s) {
      film = f;
      stage = s;
      if (!film) return;
      wire();
      if (full) show(full, { parts: noBeard(full) ? HAIR : undefined, title: byId(lastPlate?.value) });
    },
    show,
    select,
    back,
    /** The composer from scratch: no card, the overgrown head, waiting for the first ingredient. */
    async blank(empty) {
      clearTimeout(timer);
      full = null;
      played = null;
      renderCard(null);
      if (titleEl) titleEl.textContent = '';
      if (captionEl) captionEl.textContent = '';
      onHead = empty;
      dirty.clear();
      if (film) await film.load(empty, { base: 'overgrown', autoplay: false, title: false }).catch((err) => console.error(err));
    },
    /** cb(program, from) on every card change: 'carta' | 'composer' | 'sheet' | 'seek'. */
    onShow(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    get stage() {
      return stage;
    },
  };
}
