import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  server: {
    host: true,
    port: 5173,
  },
  build: {
    // Inline sourcemaps in dev for easy debugging; omit in production to keep bundle lean
    sourcemap: command === 'serve' ? 'inline' : false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        // OAuth consent page for connecting Claude (Supabase Auth → OAuth Server → /oauth/consent)
        consent: resolve(__dirname, 'oauth/consent.html'),
      },
    },
  },
  css: {
    devSourcemap: false,
  },
  // CRITICAL FIX: Forces Vite to use only ONE master copy of Three.js
  resolve: {
    dedupe: ['three'],
  },
}));
