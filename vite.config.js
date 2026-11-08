import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { renderPage } from './src/content.js';
import { budgetPlugin } from './scripts/lib/budget.mjs';

// CLIENT picks the shop in src/clients/ (default: the Corte Real example).
// Normal build (dist/): the page boots on a small entry; src/three/stage.js, loaded with import(),
// becomes a lazy chunk and three.js its own cacheable chunk. SINGLE=1 builds one self-contained
// dist-<client>/index.html (dynamic imports, fonts, posters, plates and the head worker inlined)
// that also works from file://. BUDGET=auto|strict|warn|off, see scripts/lib/budget.mjs.
export default defineConfig(async () => {
  const client = process.env.CLIENT || 'corte-real';
  const root = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');
  const clientPath = `${root}/src/clients/${client}.js`;
  const data = await import(clientPath);
  const single = process.env.SINGLE === '1';

  return {
    base: './',
    // Per-worktree dep cache: node_modules may be a symlink shared by several checkouts.
    cacheDir: '.vite',
    resolve: { alias: { '@client': clientPath } },
    plugins: [
      {
        name: 'barbershop-content',
        transformIndexHtml: { order: 'pre', handler: (html) => renderPage(html, data) },
      },
      // Inlines every asset (assetsInlineLimit → always) and sets inlineDynamicImports.
      single && viteSingleFile(),
      budgetPlugin({ root, client, single }),
    ].filter(Boolean),
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 900,
      outDir: single ? `dist-${client}` : 'dist',
      rollupOptions: single
        ? {}
        : {
            output: {
              // three.js changes far less often than the stage: keep it in its own chunk.
              manualChunks: (id) => (id.includes('/node_modules/three/') ? 'three' : undefined),
            },
          },
    },
  };
});
