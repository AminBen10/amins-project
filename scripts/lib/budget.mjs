// Build budgets from plan-common's perf budget. Prints a table after every build and fails it on:
// initial JS > 40 KB gz, the lazily loaded 3D graph (stage.js, three.js, inline worker) > 230 KB gz,
// or any external http(s) resource in the built HTML/CSS (<link>, <script src>, src/srcset,
// @import, url()). <a href>, <meta content> and JSON-LD text are fine.
//
// BUDGET=auto (default) | strict | warn | off.
// auto = strict, except two hand-overs that expire on their own: the initial-JS limit while
// src/main.js still imports three/stage.js statically (motion M1), and the Google Fonts links
// while src/fonts/ has no .woff2 (design D1). They print as PENDING. strict fails on them too.
import { gzipSync } from 'node:zlib';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const KB = 1024;
const LIMITS = { initial: 40 * KB, three: 230 * KB, fonts: 110 * KB, singleImages: 450 * KB };
const EXTERNAL = /^\s*(?:https?:)?\/\//i;
const NON_FETCHING_RELS = /^(?:canonical|alternate|author|license|me|help|bookmark|external|next|prev)$/i;
const GOOGLE_FONTS = /^(?:https?:)?\/\/fonts\.(?:googleapis|gstatic)\.com/i;

export function budgetPlugin({ root, client, single, mode = process.env.BUDGET || 'auto' }) {
  let report = null;
  return {
    name: 'barbershop-budget',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      if (mode === 'off') return;
      const rows = single ? singleRows(bundle) : splitRows.call(this, bundle, root);
      rows.push(externalRow(bundle, root));
      report = { rows, client, single };
      const failed = rows.filter((r) => r.status === 'FAIL' || (mode === 'strict' && r.status === 'PENDING'));
      if (failed.length && mode !== 'warn') {
        print(report);
        report = null;
        this.error(`budget exceeded: ${failed.map((r) => r.name).join(', ')} (BUDGET=warn to build anyway)`);
      }
    },
    closeBundle() {
      if (report) print(report);
      report = null;
    },
  };
}

// --------------------------------------------------------------- split build (dist/)

function splitRows(bundle, root) {
  const chunks = Object.values(bundle).filter((o) => o.type === 'chunk');
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const gz = new Map(chunks.map((c) => [c.fileName, gzipSync(c.code).length]));
  const sum = (files) => [...files].reduce((n, f) => n + gz.get(f), 0);
  const closure = (start, next) => {
    const seen = new Set();
    const walk = (f) => !seen.has(f) && byFile.has(f) && (seen.add(f), next(byFile.get(f)).forEach(walk));
    start.forEach(walk);
    return seen;
  };

  const initial = closure(
    chunks.filter((c) => c.isEntry).map((c) => c.fileName),
    (c) => c.imports,
  );
  const stageId = join(root, 'src/three/stage.js');
  const stage = chunks.find((c) => c.moduleIds.includes(stageId));
  const lazy3d = stage && !initial.has(stage.fileName)
    ? [...closure([stage.fileName], (c) => [...c.imports, ...c.dynamicImports])].filter((f) => !initial.has(f))
    : [];
  const otherLazy = chunks.map((c) => c.fileName).filter((f) => !initial.has(f) && !lazy3d.includes(f));
  const threeInInitial = [...initial].some((f) => byFile.get(f).moduleIds.some((id) => id.includes('/node_modules/three/')));

  // Hand-over: main.js still does `import { createStage } from './three/stage.js'` (pre-M1).
  const mainInfo = this.getModuleInfo(join(root, 'src/main.js'));
  const staticStage = !!mainInfo?.importedIds.includes(stageId);

  const initialGz = sum(initial);
  const rows = [];
  rows.push({
    name: 'initial JS',
    size: initialGz,
    limit: LIMITS.initial,
    status: initialGz <= LIMITS.initial ? 'ok' : staticStage ? 'PENDING' : 'FAIL',
    note:
      initialGz <= LIMITS.initial
        ? list(initial)
        : staticStage
          ? 'main.js imports three/stage.js statically; load it with import() (motion M1)'
          : `${threeInInitial ? 'three.js is in the initial graph. ' : ''}top: ${topModules(initial, byFile, root)}`,
  });
  rows.push({
    name: '3D (lazy)',
    size: stage && !initial.has(stage.fileName) ? sum(lazy3d) : null,
    limit: LIMITS.three,
    status: !stage || initial.has(stage.fileName) ? (staticStage ? 'PENDING' : 'n/a') : sum(lazy3d) <= LIMITS.three ? 'ok' : 'FAIL',
    note: stage && !initial.has(stage.fileName) ? list(lazy3d) : stage ? 'stage.js is in the initial graph' : 'no stage.js',
  });
  if (otherLazy.length) rows.push({ name: 'other lazy JS', size: sum(otherLazy), status: 'info', note: list(otherLazy) });

  const assets = Object.values(bundle).filter((o) => o.type === 'asset');
  const css = assets.filter((a) => a.fileName.endsWith('.css'));
  rows.push({ name: 'CSS', size: css.reduce((n, a) => n + gzipSync(a.source).length, 0), status: 'info', note: list(css.map((a) => a.fileName)) });
  const fonts = assets.filter((a) => /\.(?:woff2?|ttf|otf)$/.test(a.fileName));
  if (fonts.length) {
    const raw = fonts.reduce((n, a) => n + byteLength(a.source), 0);
    rows.push({ name: 'fonts', size: raw, raw: true, limit: LIMITS.fonts, status: raw <= LIMITS.fonts ? 'ok' : 'WARN', note: `${fonts.length} files` });
  }
  return rows;
}

function topModules(files, byFile, root) {
  const mods = [];
  for (const f of files) for (const [id, m] of Object.entries(byFile.get(f).modules)) mods.push([id, m.renderedLength]);
  return mods
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, n]) => `${id.replace(root + '/', '').replace(/^.*node_modules\//, '')} ${kb(n)} raw`)
    .join(', ');
}

// --------------------------------------------------------------- SINGLE=1 (one HTML)

function singleRows(bundle) {
  const html = Object.values(bundle).find((o) => o.type === 'asset' && o.fileName.endsWith('.html'));
  const src = String(html?.source ?? '');
  const dataBytes = (re) => [...src.matchAll(re)].reduce((n, m) => n + m[0].length, 0);
  const images = dataBytes(/data:image\/(?:avif|webp|png|jpe?g)[^"')\s]*/g);
  const fonts = dataBytes(/data:(?:font\/|application\/(?:x-)?font-)[^"')\s]*/g);
  const left = Object.keys(bundle).filter((f) => !f.endsWith('.html'));
  return [
    { name: 'single HTML', size: gzipSync(src).length, status: left.length ? 'WARN' : 'ok', note: `${kb(byteLength(src))} raw${left.length ? `; not inlined: ${left.join(', ')}` : ''}` },
    { name: 'inlined images', size: images, raw: true, limit: LIMITS.singleImages, status: images <= LIMITS.singleImages ? 'ok' : 'WARN', note: 'posters + plates, base64' },
    { name: 'inlined fonts', size: fonts, raw: true, status: 'info', note: 'base64' },
  ];
}

// --------------------------------------------------------------- external resources

function externalRow(bundle, root) {
  const hits = [];
  for (const o of Object.values(bundle)) {
    if (o.type !== 'asset') continue;
    if (o.fileName.endsWith('.html')) scanHtml(String(o.source), o.fileName, hits);
    else if (o.fileName.endsWith('.css')) scanCss(String(o.source), o.fileName, hits);
  }
  const fontsDir = join(root, 'src/fonts');
  const localFonts = existsSync(fontsDir) && readdirSync(fontsDir).some((f) => f.endsWith('.woff2'));
  const pending = hits.filter((h) => !localFonts && GOOGLE_FONTS.test(h.url));
  const fail = hits.filter((h) => !pending.includes(h));
  return {
    name: 'external URLs',
    size: null,
    status: fail.length ? 'FAIL' : pending.length ? 'PENDING' : 'ok',
    note: hits.length
      ? `${fail.concat(pending).map((h) => `${h.file} ${h.where} ${h.url.slice(0, 60)}`).join('; ')}${pending.length && !fail.length ? ' (Google Fonts until src/fonts lands, design D1)' : ''}`
      : 'none',
  };
}

function scanHtml(html, file, hits) {
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, (_, attrs) => `<script${attrs}>`);
  html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => (scanCss(css, file, hits, '<style>'), ''));
  for (const [, tag, attrs] of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
    const t = tag.toLowerCase();
    if (t === 'a' || t === 'area' || t === 'form' || t === 'meta') continue;
    const attr = (name) => attrs.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    const val = (m) => (m ? (m[1] ?? m[2] ?? m[3] ?? '') : null);
    if (t === 'link') {
      const href = val(attr('href'));
      if (href && EXTERNAL.test(href) && !NON_FETCHING_RELS.test(val(attr('rel')) || '')) hits.push({ file, where: '<link>', url: href.trim() });
      continue;
    }
    for (const name of ['src', 'href', 'xlink:href', 'poster', 'data', 'background']) {
      const v = val(attr(name));
      if (v && EXTERNAL.test(v)) hits.push({ file, where: `<${t} ${name}>`, url: v.trim() });
    }
    const srcset = val(attr('srcset'));
    for (const part of srcset ? srcset.split(',') : []) if (EXTERNAL.test(part)) hits.push({ file, where: `<${t} srcset>`, url: part.trim() });
    const style = val(attr('style'));
    if (style) scanCss(style, file, hits, `<${t} style>`);
  }
}

function scanCss(css, file, hits, where = 'css') {
  for (const m of css.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)) if (EXTERNAL.test(m[1])) hits.push({ file, where: `${where} @import`, url: m[1] });
  for (const m of css.matchAll(/url\(\s*["']?([^"')]+)/gi)) if (EXTERNAL.test(m[1])) hits.push({ file, where: `${where} url()`, url: m[1].trim() });
}

// --------------------------------------------------------------- output

const byteLength = (s) => (typeof s === 'string' ? Buffer.byteLength(s) : s.length);
const kb = (n) => `${(n / KB).toFixed(1)} KB`;
const list = (files) => [...files].map((f) => f.replace(/^assets\//, '')).join(' + ') || '-';

function print({ rows, client, single }) {
  const out = [`\nbudget · ${client}${single ? ' · SINGLE' : ''}`];
  for (const r of rows) {
    const size = r.size == null ? '' : `${kb(r.size)}${r.raw ? '' : ' gz'}`;
    const limit = r.limit ? `≤ ${kb(r.limit)}` : '';
    out.push(`  ${r.name.padEnd(15)}${size.padStart(13)}  ${limit.padEnd(11)}${r.status.padEnd(9)}${r.note || ''}`);
  }
  console.log(out.join('\n') + '\n');
}
