import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5173,
  },
  build: {
    sourcemap: 'inline'
  },
  css: {
    devSourcemap: false
  },
  // CRITICAL FIX: Forces Vite to use only ONE master copy of Three.js
  resolve: {
    dedupe: ['three']
  }
});