// The film timeline (motion M4): pure time, no rendering. It turns a prepared program into one
// FilmState per frame for stage.setFilm (scene contract):
//   200 ms dip from black on the start state → title card 1.2 s → every step, total
//   (0.3 + dur + 0.2)/speed → the hand mirror comes up 2.5 s ('Así queda por detrás.', the
//   program's own 'mirror' step when it has one) → free view (frente/perfil/nuca + drag).
// Reduced motion: nothing plays on its own; load shows the finished cut, seek(i) the still of
// step i with the tool posed, and every FilmState carries still:true.
// The only DOM it touches: an IntersectionObserver on `section` and visibilitychange, to pause.

const DIP_S = 0.2;
const TITLE_S = 1.2;
const END_S = 2.5;
const LOWER_S = 0.5; // the hand mirror goes down as the free view starts
const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (x) => x * x * (3 - 2 * x);
const wrap = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);

/** Seconds a step takes on screen at `speed` (shared timing with the stage). */
export const stepTotal = (step, speed = 1) => (0.3 + (step?.dur || 0) + 0.2) / speed;

/** Whole film length in seconds (dip + title + steps + mirror raise). */
export function filmLength(program, { speed = 1, title = true } = {}) {
  const steps = program?.steps || [];
  const last = steps[steps.length - 1];
  return DIP_S + (title ? TITLE_S : 0) + steps.reduce((t, s) => t + stepTotal(s, speed), 0) + (last?.op === 'mirror' ? 0 : END_S);
}

/**
 * createFilm(stage, {reducedMotion, section}) → Film
 * Film{load(program,{parts,base,speed,autoplay,title}) → Promise<Handle|null> (null if a newer
 * load replaced it), play, pause, resume, toggle, repeat, seek(i), finish, stop, view(name|null),
 * drag(dxPx), pose(step, t) (additive: a still at hair fraction t, for QA), on(event, cb) →
 * unsubscribe; state, program, handle, step, length}.
 * Events: 'title' {program}, 'step' {i, step, program}, 'end' {program}, 'state' {state}
 * with state ∈ idle | loading | ready (loaded, not started) | playing | paused | ended | still.
 */
export function createFilm(stage, { reducedMotion = false, section = null } = {}) {
  const subs = { title: new Set(), step: new Set(), end: new Set(), state: new Set() };
  const emit = (ev, d) => subs[ev].forEach((fn) => fn(d));

  let program = null;
  let handle = null;
  let speed = 1;
  let withTitle = true;
  let starts = []; // timeline start of every step (s)
  let tEnd = 0; // where the free view starts
  let t = 0; // timeline position (s)
  let state = 'idle';
  let raf = 0;
  let last = 0;
  let token = 0;
  let viewOverride = null;
  let yaw = 0;
  let shownStep = null; // last step index announced
  let titled = false;
  let ended = false;
  let rmTimer = 0;
  let autoPaused = false;

  function setState(s) {
    if (s === state) return;
    state = s;
    emit('state', { state });
  }

  function layout() {
    const steps = program.steps;
    let x = DIP_S + (withTitle ? TITLE_S : 0);
    starts = steps.map((s) => {
      const a = x;
      x += stepTotal(s, speed);
      return a;
    });
    const lastOp = steps[steps.length - 1]?.op;
    tEnd = x + (lastOp === 'mirror' ? 0 : END_S);
  }

  // The FilmState at timeline position `at`.
  function stateAt(at) {
    const steps = program.steps;
    const n = steps.length;
    const fs = { handle, step: -1, local: 0, speed, dip: 0, mirror: 0, view: viewOverride, yaw: viewOverride ? yaw : 0, still: false };
    if (at < DIP_S) {
      fs.dip = 1 - at / DIP_S;
      return fs;
    }
    if (n === 0 || at < starts[0]) return fs;
    if (at < tEnd) {
      let i = n;
      for (let k = n - 1; k >= 0; k--) {
        if (at >= starts[k]) {
          i = k;
          break;
        }
      }
      const end = i < n - 1 ? starts[i + 1] : starts[n - 1] + stepTotal(steps[n - 1], speed);
      if (at >= end) {
        // the raise added after a program without its own mirror step
        fs.step = n;
        fs.local = at - end;
        fs.mirror = ease(clamp01((at - end) / 0.8));
        return fs;
      }
      fs.step = i;
      fs.local = at - starts[i];
      if (steps[i].op === 'mirror') fs.mirror = ease(clamp01((fs.local * speed) / 0.8));
      return fs;
    }
    // free view: the finished cut, the hand mirror going down
    fs.step = n;
    fs.local = at - tEnd;
    fs.mirror = 1 - ease(clamp01((at - tEnd) / LOWER_S));
    fs.view = viewOverride || 'frente';
    fs.yaw = yaw;
    return fs;
  }

  function announce(fs) {
    if (!titled && fs.step === -1 && t >= DIP_S && withTitle) {
      titled = true;
      emit('title', { program });
    }
    const idx = fs.step;
    if (idx >= 0 && idx !== shownStep) {
      shownStep = idx;
      if (idx < program.steps.length) emit('step', { i: idx, step: program.steps[idx], program });
      else if (t < tEnd) emit('step', { i: idx, step: { op: 'mirror', caption: 'Así queda por detrás.', label: 'Así queda por detrás' }, program });
    }
    if (!ended && t >= tEnd) {
      ended = true;
      emit('end', { program });
    }
  }

  function send(fs) {
    if (handle) stage.setFilm(fs);
  }

  function loop(now) {
    raf = 0;
    if (state !== 'playing' && state !== 'ended') return;
    // off screen (the observer can lag a frame behind a fast scroll): pause right here
    if (section && state === 'playing' && !reducedMotion) {
      const r = section.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= innerHeight) {
        autoPaused = true;
        halt();
        setState('paused');
        return;
      }
    }
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    t += dt;
    const fs = stateAt(t);
    announce(fs);
    send(fs);
    if (t >= tEnd && state === 'playing') setState('ended');
    // keep running until the mirror is down, then the free view only changes on input
    if (t < tEnd + LOWER_S) raf = requestAnimationFrame(loop);
  }

  function run() {
    cancelAnimationFrame(raf);
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  function halt() {
    cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(rmTimer);
    rmTimer = 0;
  }

  // A still (reduced motion, seek while paused, QA): step i at hair fraction f, tool posed.
  function still(i, f = 0.5) {
    if (!program) return;
    const n = program.steps.length;
    const s = program.steps[i];
    const fs = stateAt(i >= n ? tEnd + LOWER_S : (starts[i] ?? 0));
    fs.step = i < 0 ? -1 : Math.min(i, n);
    fs.local = s ? (0.3 + clamp01(f) * (s.dur || 0)) / speed : 0;
    fs.dip = 0;
    fs.mirror = s?.op === 'mirror' ? 1 : 0;
    if (i >= n) {
      fs.view = viewOverride || 'frente';
      fs.yaw = yaw;
    }
    fs.still = true;
    if (i >= 0 && i !== shownStep) {
      shownStep = i;
      if (s) emit('step', { i, step: s, program });
    }
    send(fs);
  }

  // What the screen holds while nothing plays (paused, ended, still): no motion in it.
  function heldState() {
    const at = Math.min(t, tEnd + LOWER_S);
    const fs = stateAt(at);
    if (at < tEnd) {
      const s = program.steps[fs.step];
      if (s && (reducedMotion || state === 'still')) fs.local = (0.3 + 0.5 * (s.dur || 0)) / speed;
      fs.view = viewOverride;
      fs.yaw = viewOverride ? yaw : 0;
    }
    fs.dip = 0;
    fs.still = true;
    return fs;
  }

  // Reduced motion 'play': a storyboard, one still per step at the step's own pace.
  function storyboard(from) {
    clearTimeout(rmTimer);
    const n = program.steps.length;
    const go = (i) => {
      t = i < n ? starts[i] : tEnd;
      still(i);
      if (i >= n) {
        ended = true;
        emit('end', { program });
        setState('ended');
        return;
      }
      rmTimer = setTimeout(() => go(i + 1), stepTotal(program.steps[i], speed) * 1000);
    };
    setState('playing');
    go(Math.max(0, from));
  }

  const film = {
    get state() {
      return state;
    },
    get program() {
      return program;
    },
    get handle() {
      return handle;
    },
    get step() {
      return shownStep;
    },
    get length() {
      return program ? tEnd : 0;
    },

    async load(next, { parts = null, base = 'overgrown', speed: sp = 1, autoplay = true, title = true } = {}) {
      const my = ++token;
      halt();
      setState('loading');
      const h = await stage.prepare(next, { base, resetParts: parts });
      if (my !== token) return null; // a newer load (or stop) won
      program = next;
      handle = h;
      speed = sp || 1;
      withTitle = !!title;
      viewOverride = null;
      yaw = 0;
      layout();
      t = 0;
      shownStep = null;
      titled = false;
      ended = false;
      if (reducedMotion) {
        // no autoplay: the finished cut, as a still
        if (withTitle) emit('title', { program });
        still(program.steps.length);
        t = tEnd;
        ended = true;
        setState('still');
      } else if (autoplay) {
        setState('playing');
        run();
      } else {
        // the start state, waiting for play
        send({ ...stateAt(DIP_S + (withTitle ? TITLE_S : 0)), still: true });
        setState('ready');
      }
      return h;
    },

    play() {
      if (!program) return;
      if (reducedMotion) return storyboard(shownStep != null && shownStep < program.steps.length ? shownStep : 0);
      if (state === 'ended' || state === 'still' || state === 'ready' || t >= tEnd) return film.repeat();
      setState('playing');
      run();
    },
    pause() {
      if (state !== 'playing') return;
      halt();
      setState('paused');
    },
    resume() {
      if (state === 'paused') film.play();
    },
    toggle() {
      if (state === 'playing') film.pause();
      else film.play();
    },
    repeat() {
      if (!program) return;
      halt();
      t = 0;
      shownStep = null;
      titled = false;
      ended = false;
      if (reducedMotion) return storyboard(0);
      setState('playing');
      run();
    },
    seek(i) {
      if (!program) return;
      const n = program.steps.length;
      i = Math.max(0, Math.min(n - 1, i | 0));
      t = starts[i];
      ended = false;
      if (reducedMotion) {
        halt();
        still(i);
        setState('still');
        return;
      }
      shownStep = null;
      const fs = stateAt(t);
      announce(fs);
      if (state === 'playing') return; // the loop picks up from here
      if (state === 'ended' || state === 'still' || state === 'ready') setState('paused');
      send({ ...fs, still: true });
    },
    finish() {
      if (!program) return;
      halt();
      t = tEnd + LOWER_S;
      shownStep = program.steps.length;
      still(program.steps.length);
      if (!ended) {
        ended = true;
        emit('end', { program });
      }
      setState(reducedMotion ? 'still' : 'ended');
    },
    stop() {
      token++;
      halt();
      program = null;
      handle = null;
      stage.setFilm(null);
      setState('idle');
    },
    /** 'frente' | 'perfil' | 'nuca' | null (null: the steps' own shots). */
    view(name) {
      viewOverride = name || null;
      if (!name) yaw = 0;
      if (program && state !== 'playing' && state !== 'loading') send(heldState());
    },
    /** Turn the head in the free view (and in any chosen view): px of horizontal drag. */
    drag(dx) {
      if (!program) return;
      if (!viewOverride) viewOverride = 'frente';
      yaw = wrap(yaw + dx * 0.008);
      if (state !== 'playing') send(heldState());
    },
    pose(i, f = 0.5) {
      if (!program) return;
      halt();
      t = i < 0 ? DIP_S : i >= program.steps.length ? tEnd + LOWER_S : starts[i];
      still(i, f);
      setState(reducedMotion ? 'still' : 'paused');
    },
    on(ev, cb) {
      subs[ev]?.add(cb);
      return () => subs[ev]?.delete(cb);
    },
  };

  // Leaving the Carta or hiding the tab pauses the film; coming back does not restart it.
  if (section && 'IntersectionObserver' in window) {
    new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting && state === 'playing' && !reducedMotion) {
            autoPaused = true;
            film.pause();
          }
        }
      },
      { threshold: 0 },
    ).observe(section);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'playing') {
      autoPaused = true;
      if (reducedMotion) {
        halt();
        setState('paused');
      } else film.pause();
    }
  });
  film.autoPaused = () => autoPaused;

  return film;
}
