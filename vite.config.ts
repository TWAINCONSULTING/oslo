import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from any static host or sub-path.
  base: './',
  build: {
    target: 'es2019',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
});
