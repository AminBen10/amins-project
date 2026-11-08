// Sanity check of the head asset (S7): node scripts/head/check.mjs
// Prints MM, the landmark heights and their ordering, checks surfaceAt against the anchors and
// times the subdivision for both tiers. Exits non-zero on a failed check.
import { MM, DEDO_MM, LANDMARKS, ANCHORS, ANCHOR_NAMES, AXIS_Z, heightY, surfaceAt } from '../../src/three/hairField.js';
import { HEAD_CAGE } from '../../src/three/headAsset.js';
import { base64Bytes, buildHead } from '../../src/three/headWorker.js';

let ok = true;
const fail = (msg) => {
  ok = false;
  console.log('FAIL', msg);
};
const f3 = (v) => v.toFixed(3);

console.log(`MM ${MM.toFixed(5)} units/mm (crown-chin ${(2.1 / MM).toFixed(0)} mm), DEDO_MM ${DEDO_MM}`);
for (const [k, v] of Object.entries(LANDMARKS)) console.log(`  ${k.padEnd(10)} ${Array.isArray(v) ? v.map(f3).join(' ') : f3(v)}`);

const chain = [
  ['OREJA', { lm: 'OREJA' }],
  ['OREJA+1', { lm: 'OREJA', dedos: 1 }],
  ['SIEN', { lm: 'SIEN' }],
  ['ESQUINA-1', { lm: 'ESQUINA', dedos: -1 }],
  ['ESQUINA', { lm: 'ESQUINA' }],
];
const ys = chain.map(([, h]) => heightY(h));
const gaps = ys.slice(1).map((y, i) => (y - ys[i]) / (DEDO_MM * MM));
console.log('ordering', chain.map(([n], i) => `${n} ${f3(ys[i])}`).join(' < '));
console.log('gaps (dedos)', gaps.map((g) => g.toFixed(2)).join(' '));
if (gaps.some((g) => g < 0.6)) fail('landmark gap under 0.6 dedo');
if (!(LANDMARKS.NUCA < LANDMARKS.PATILLA && LANDMARKS.PATILLA < LANDMARKS.OREJA && LANDMARKS.ESQUINA < LANDMARKS.FLEQUILLO)) fail('landmark order');

// surface anchors must sit on the surface that surfaceAt reports (outermost radius)
for (const k of ['flequillo', 'sien', 'esquina', 'nuca', 'patilla', 'lineaBarba', 'cuello']) {
  const a = ANCHORS[k];
  const phi = Math.atan2(a[0], a[2] - AXIS_Z);
  const s = surfaceAt(phi, a[1]);
  const d = Math.hypot(s.pos[0] - a[0], s.pos[1] - a[1], s.pos[2] - a[2]);
  if (d > 0.01) fail(`anchor ${k} off the surface by ${d.toFixed(3)}`);
}
console.log('anchors', ANCHOR_NAMES.length, 'ok');

for (const levels of [1, 2]) {
  const t = performance.now();
  const d = buildHead(base64Bytes(HEAD_CAGE), { levels });
  console.log(`levels ${levels}: ${(performance.now() - t).toFixed(0)} ms`, JSON.stringify(d.stats));
}
process.exit(ok ? 0 : 1);
