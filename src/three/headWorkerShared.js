// Normal builds: the worker runs the very chunk the page already loaded (headWorker.js, hairField.js
// and headAsset.js, kept in their own 'head' chunk by vite.config.js) through a one-line module
// bootstrap, so the head asset and the cut engine are downloaded once, not twice.
import { MODULE_URL } from './headWorker.js';

export function createHeadWorker() {
  const src = `import ${JSON.stringify(MODULE_URL)};`;
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const worker = new Worker(url, { type: 'module' });
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return worker;
}
