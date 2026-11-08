// Mirror notes (motion M3). The notes are server-rendered in each beat and read in order
// without JS or 3D. With a stage: html.callouts-on, and on every rendered frame each active
// note (beat p inside its data-at) is placed on the empty side of the glass, beside its
// anchor, with a grease-pencil leader (svg#leaders) that draws in with the note's progress,
// goes round the face and hides when its anchor is out of sight. Phones (coarse pointer or
// < 700 px): no leaders; the one active note is copied into #note-strip with a tick
// pointing at its zone.
const NS = 'http://www.w3.org/2000/svg';
const GAP = 28; // px between the head and a note
const PAD = 12; // px kept clear round the face rect
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => clamp(v, 0, 1);
const px = (v) => `${Math.round(v)}px`;

export function initCallouts({ scroll } = {}) {
  const root = document.documentElement;
  const notes = [...document.querySelectorAll('.visit .beat .note')].map((el) => {
    const at = (el.dataset.at || '0,1').split(',').map(Number);
    return {
      el,
      beat: el.closest('[data-beat]')?.dataset.beat,
      anchor: el.dataset.anchor || null,
      a: Number.isFinite(at[0]) ? at[0] : 0,
      b: Number.isFinite(at[1]) ? at[1] : 1,
      active: false,
      size: null,
      x: '',
      y: '',
      side: '',
      line: null,
      dot: null,
    };
  });
  const strip = document.getElementById('note-strip');
  const narrowQ = matchMedia('(pointer: coarse), (max-width: 699px)');
  let stage = null;
  let unsub = null;
  let svg = null;
  let stripKey = '';
  let tick = null;

  function ensureSvg() {
    if (svg) return svg;
    svg = document.createElementNS(NS, 'svg');
    svg.id = 'leaders';
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:1;pointer-events:none;overflow:visible;';
    document.body.append(svg);
    for (const n of notes) {
      const line = document.createElementNS(NS, 'path');
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', 'var(--note, #E8E2D4)');
      line.setAttribute('stroke-width', '1.25');
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('stroke-linejoin', 'round');
      line.setAttribute('pathLength', '1');
      line.setAttribute('stroke-dasharray', '1 1');
      line.style.display = 'none';
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('r', '2.5');
      dot.setAttribute('fill', 'var(--note, #E8E2D4)');
      dot.style.display = 'none';
      svg.append(line, dot);
      n.line = line;
      n.dot = dot;
    }
    return svg;
  }

  const localP = (n, p) => clamp01((p - n.a) / Math.max(1e-3, n.b - n.a));
  const isOn = (n, input) => {
    const p = input?.[n.beat] ?? 0;
    return p > 0 && p < 1 && p >= n.a && p <= n.b;
  };

  function setActive(n, on) {
    if (n.active === on) return;
    n.active = on;
    n.el.classList.toggle('is-active', on);
    if (on && !n.size) n.size = { w: n.el.offsetWidth, h: n.el.offsetHeight };
    if (!on && n.line) {
      n.line.style.display = 'none';
      n.dot.style.display = 'none';
    }
  }

  function hideAll() {
    for (const n of notes) setActive(n, false);
    if (strip && stripKey) {
      strip.textContent = '';
      stripKey = '';
    }
  }

  // Does segment p→q cross rect r?
  function crosses(p, q, r) {
    if (!r) return false;
    const x0 = r.x - PAD, y0 = r.y - PAD, x1 = r.x + r.w + PAD, y1 = r.y + r.h + PAD;
    let t0 = 0, t1 = 1;
    const dx = q.x - p.x, dy = q.y - p.y;
    for (const [pp, qq] of [[-dx, p.x - x0], [dx, x1 - p.x], [-dy, p.y - y0], [dy, y1 - p.y]]) {
      if (pp === 0) {
        if (qq < 0) return false;
      } else {
        const t = qq / pp;
        if (pp < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
        if (t0 > t1) return false;
      }
    }
    return true;
  }
  const inside = (p, r) => r && p.x > r.x - PAD && p.x < r.x + r.w + PAD && p.y > r.y - PAD && p.y < r.y + r.h + PAD;

  // Leader from the note's edge S to anchor A, kept off the face.
  function route(S, A, face, side) {
    if (!face) return [S, A];
    if (inside(A, face)) {
      // a point on the face (moustache, chin): stop at the face's edge, level with it
      const ex = side === 'right' ? face.x + face.w + PAD : face.x - PAD;
      return [S, { x: ex, y: A.y }];
    }
    if (!crosses(S, A, face)) return [S, A];
    const near = side === 'right' ? face.x + face.w + PAD : face.x - PAD;
    const top = face.y - PAD, bot = face.y + face.h + PAD;
    const len = (y) => Math.hypot(S.x - near, S.y - y) + Math.abs(near - A.x) + Math.abs(y - A.y);
    const y = len(top) <= len(bot) ? top : bot;
    return [S, { x: near, y }, { x: A.x, y }, A];
  }

  function placeWide(anchors, input) {
    ensureSvg();
    const vw = innerWidth, vh = innerHeight;
    const head = anchors.head;
    const face = anchors.face?.visible && anchors.face.w > 0 ? anchors.face : null;
    const top = (document.querySelector('.nav')?.offsetHeight || 64) + 16;
    const active = notes.filter((n) => n.active);
    // empty side: away from the face; with no face in view, the roomier side
    const hc = head.x + head.w / 2;
    let side;
    if (face && Math.abs(face.x + face.w / 2 - hc) > 0.08 * head.w) side = face.x + face.w / 2 < hc ? 'right' : 'left';
    else side = vw - (head.x + head.w) >= head.x ? 'right' : 'left';
    // a side without room for the widest active note gives way to the other one
    const need = Math.max(0, ...active.map((n) => (n.size?.w || 300))) + GAP + 16;
    const room = { right: vw - (head.x + head.w), left: head.x };
    if (room[side] < need && room[side === 'right' ? 'left' : 'right'] > room[side]) side = side === 'right' ? 'left' : 'right';
    const placed = [];
    for (const n of active) {
      const a = n.anchor && anchors[n.anchor];
      const { w, h } = n.size || { w: 300, h: 60 };
      let x = side === 'right' ? head.x + head.w + GAP : head.x - GAP;
      x = side === 'right' ? clamp(x, 16, vw - w - 16) : clamp(x, w + 16, vw - 16);
      let y = clamp((a ? a.y : head.y + head.h / 2) - h * 0.35, top, vh - h - 24);
      for (const p of placed) if (y < p.y + p.h + 14 && y + h > p.y - 14) y = p.y + p.h + 14;
      placed.push({ y, h });
      const xs = px(x), ys = px(y);
      if (n.x !== xs) n.el.style.setProperty('--x', (n.x = xs));
      if (n.y !== ys) n.el.style.setProperty('--y', (n.y = ys));
      if (n.side !== side) n.el.dataset.side = n.side = side;

      // the leader
      if (a && a.visible) {
        const S = { x: side === 'right' ? x - 8 : x + 8, y: y + Math.min(h, 34) * 0.5 };
        const pts = route(S, { x: a.x, y: a.y }, face, side);
        const d = 'M' + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L');
        if (n.line.getAttribute('d') !== d) n.line.setAttribute('d', d);
        const k = clamp01(localP(n, input[n.beat]) * 2.5);
        n.line.setAttribute('stroke-dashoffset', (1 - k).toFixed(3));
        n.line.style.display = '';
        const end = pts[pts.length - 1];
        n.dot.setAttribute('cx', end.x.toFixed(1));
        n.dot.setAttribute('cy', end.y.toFixed(1));
        n.dot.style.display = k > 0.98 ? '' : 'none';
      } else {
        n.line.style.display = 'none';
        n.dot.style.display = 'none';
      }
    }
  }

  function placeStrip(anchors) {
    if (!strip) return;
    // one note at a time: the one that started last
    const n = notes.filter((m) => m.active).sort((p, q) => q.a - p.a)[0];
    if (!n) {
      if (stripKey) {
        strip.textContent = '';
        stripKey = '';
      }
      return;
    }
    const key = n.el.dataset.at + n.beat;
    if (key !== stripKey) {
      stripKey = key;
      strip.innerHTML = n.el.innerHTML;
      tick = document.createElement('span');
      tick.style.cssText = 'position:absolute;top:-12px;left:0;width:2px;height:12px;background:currentColor;display:none;';
      strip.append(tick);
    }
    const a = n.anchor && anchors[n.anchor];
    if (tick) {
      if (a && a.visible) {
        tick.style.left = px(clamp(a.x, 16, innerWidth - 16));
        tick.style.display = '';
      } else tick.style.display = 'none';
    }
  }

  function onFrame(anchors) {
    const input = scroll?.input || {};
    const on = root.dataset.scene === 'mirror' && !root.classList.contains('player-open');
    if (!on) return hideAll();
    for (const n of notes) setActive(n, isOn(n, input));
    if (narrowQ.matches) {
      if (svg) for (const n of notes) if (n.line) (n.line.style.display = 'none'), (n.dot.style.display = 'none');
      placeStrip(anchors);
    } else {
      if (stripKey) {
        strip.textContent = '';
        stripKey = '';
      }
      placeWide(anchors, input);
    }
  }

  // The stage may stop rendering once the story is past: clear the notes from scroll too.
  addEventListener(
    'scroll',
    () => {
      if (root.dataset.scene !== 'mirror' && notes.some((n) => n.active)) hideAll();
    },
    { passive: true },
  );
  addEventListener('resize', () => {
    for (const n of notes) n.size = null;
    for (const n of notes) if (n.active) n.size = { w: n.el.offsetWidth, h: n.el.offsetHeight };
  });

  return {
    /** Attach (or detach with null) the stage; html.callouts-on while one is attached. */
    setStage(s) {
      unsub?.();
      unsub = null;
      stage = s;
      if (stage?.onFrame && notes.length) {
        root.classList.add('callouts-on');
        for (const n of notes) n.size = null;
        unsub = stage.onFrame(onFrame);
      } else {
        root.classList.remove('callouts-on');
        hideAll();
        if (svg) for (const n of notes) (n.line.style.display = 'none'), (n.dot.style.display = 'none');
      }
    },
  };
}
