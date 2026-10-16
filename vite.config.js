import { defineConfig } from 'vite';
import { renderPage } from './src/content.js';

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'barbershop-content',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) => renderPage(html),
      },
    },
  ],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
  },
});
