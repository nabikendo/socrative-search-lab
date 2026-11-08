import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        professor: resolve(import.meta.dirname, 'professor.html'),
        prova: resolve(import.meta.dirname, 'prova.html'),
      },
    },
  },
  server: { proxy: { '/api': 'http://localhost:8080' } },
});
