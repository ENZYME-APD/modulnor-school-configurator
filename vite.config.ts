import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  server: {
    host: true,
    port: 5173,
  },
  build: {
    // Inline sourcemaps in dev for easy debugging; omit in production to keep bundle lean
    sourcemap: command === 'serve' ? 'inline' : false,
  },
  css: {
    devSourcemap: false,
  },
  // CRITICAL FIX: Forces Vite to use only ONE master copy of Three.js
  resolve: {
    dedupe: ['three'],
  },
}));