// window.__qa (only with ?qa=1; loaded by main.js on demand) for engineering's shots, posters
// and plates scripts. Every call resolves once the stage has snapped to its targets and drawn
// two more frames, then sets html[data-qa-ready] (removed when a call starts).
//   ready: Promise<{stage: boolean, tier}>
//   scrollToBeat(name, p)   name: hero|enter|consult|clipper|scissors|razor|mirror|carta|turn
//   showCut(cutId, beardId, 'start'|'bands'|'final'|{step, t})
//   setView('frente'|'perfil'|'nuca'|null), setMirror(deg)
//   poster(name)            hero|maquina-bandas|maquina-difuminado|nuca|carta (+ html.poster-capture)
//   plate(cutId) → PNG data URL from stage.renderPlate
//   film (getter): the Carta film, for timing runs
import * as client from '../config.js';
import { compose, mixOf } from '../cuts/compose.js';

const POSTERS = {
  hero: ['hero', 0],
  'maquina-bandas': ['clipper', 0.75],
  'maquina-difuminado': ['clipper', 0.97],
  nuca: ['mirror', 0.62],
  carta: ['carta', 1],
};

export function initQA({ stageReady, getStage, getFilm, scroll, tier }) {
  const root = document.documentElement;
  let n = 0;
  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));

  // One rendered frame after an invalidation (2.5 s cap: SwiftShader frames are slow, never stuck).
  function rendered(stage) {
    return new Promise((res) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        off?.();
        clearTimeout(timer);
        res();
      };
      const off = stage.onFrame?.(finish);
      const timer = setTimeout(finish, 2500);
      stage.snap?.();
    });
  }

  async function settle() {
    const stage = getStage();
    await raf();
    if (stage) {
      stage.snap?.();
      await rendered(stage);
      await rendered(stage);
    } else await raf();
    root.dataset.qaReady = String(++n);
  }

  async function run(fn) {
    delete root.dataset.qaReady;
    await api.ready;
    const out = await fn(getStage(), getFilm());
    await settle();
    return out;
  }

  // Scroll so that `name` is at progress p (the inverse of scroll.js's beat maths).
  function yFor(name, p) {
    const vh = innerHeight;
    const top = (el) => el.getBoundingClientRect().top + scrollY;
    if (name === 'hero') return p * Math.max(1, document.getElementById('inicio')?.offsetHeight || vh);
    if (name === 'carta') {
      const el = document.getElementById('carta');
      return el ? top(el) - vh + p * 0.85 * vh : 0;
    }
    const el = document.querySelector(name === 'turn' ? '[data-beat="turn"]' : `.visit [data-beat="${name}"]`);
    if (!el) throw new Error(`no beat ${name}`);
    const h = el.getBoundingClientRect().height || 0.5 * vh;
    return top(el) - 0.5 * vh + p * h;
  }

  async function toBeat(stage, film, name, p) {
    if (film?.handle) {
      film.stop();
      await new Promise((r) => setTimeout(r, 260)); // the stage's 200 ms dip back to the story
    }
    scrollTo({ top: Math.max(0, yFor(name, +p || 0)), behavior: 'instant' });
    scroll?.measure?.();
    await raf();
    stage?.snap?.();
  }

  function program(cutId, beardId) {
    const all = [...client.CUTS, ...client.BEARDS];
    if (cutId && !beardId) {
      const p = all.find((x) => x.id === cutId);
      if (p) return p;
    }
    return compose(mixOf(cutId || null, beardId || null, client), client);
  }

  async function cut(stage, film, cutId, beardId, mode = 'final') {
    if (!stage || !film) return null;
    const carta = document.getElementById('carta');
    if (carta && Math.abs(carta.getBoundingClientRect().top) > 0.5 * innerHeight) await toBeat(stage, null, 'carta', 1);
    const prog = program(cutId, beardId);
    await film.load(prog, { autoplay: false, title: false });
    const steps = prog.steps;
    if (mode === 'start') film.pose(-1);
    else if (mode === 'final') film.finish();
    else if (mode === 'bands') {
      const i = steps.findIndex((s) => s.op === 'blend');
      film.pose(i >= 0 ? i : steps.length, 0);
    } else if (mode && typeof mode === 'object') film.pose(mode.step | 0, mode.t ?? 1);
    return { id: prog.id, steps: steps.length };
  }

  const api = {
    /** The Carta film (createFilm) once the stage is ready, for perf scripts. */
    get film() {
      return getFilm();
    },
    ready: stageReady.then((stage) => ({ stage: !!stage, tier })),
    scrollToBeat: (name, p = 0) => run((s, f) => toBeat(s, f, name, p)),
    showCut: (cutId, beardId = null, mode = 'final') => run((s, f) => cut(s, f, cutId, beardId, mode)),
    async setView(v) {
      return run(async (stage, film) => {
        film?.view(v || null);
        if (stage) await rendered(stage);
        // the free view eases between shots; QA wants the shot itself
        if (v) stage?._internals?.rig?.cut?.(v);
      });
    },
    setMirror: (deg) => run((stage) => stage?.setMirrorAngle?.(+deg || 0)),
    poster(name) {
      return run(async (stage, film) => {
        const p = POSTERS[name];
        if (!p) throw new Error(`no poster ${name}`);
        root.classList.add('poster-capture');
        await toBeat(stage, film, p[0], p[1]);
      });
    },
    plate: (cutId) => run((stage) => (stage?.renderPlate ? stage.renderPlate(program(cutId, null)) : null)),
  };
  window.__qa = api;
  return api;
}
