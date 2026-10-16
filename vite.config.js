import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { renderPage } from './src/content.js';

// CLIENT picks the shop in src/clients/ (default: the Corte Real example).
// SINGLE=1 inlines everything into one HTML file, handy for sending a demo.
export default defineConfig(async () => {
  const client = process.env.CLIENT || 'corte-real';
  const clientPath = fileURLToPath(new URL(`./src/clients/${client}.js`, import.meta.url));
  const data = await import(clientPath);
  const single = process.env.SINGLE === '1';

  return {
    base: './',
    resolve: { alias: { '@client': clientPath } },
    plugins: [
      {
        name: 'barbershop-content',
        transformIndexHtml: { order: 'pre', handler: (html) => renderPage(html, data) },
      },
      single && viteSingleFile(),
    ].filter(Boolean),
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 900,
      outDir: single ? `dist-${client}` : 'dist',
    },
  };
});
