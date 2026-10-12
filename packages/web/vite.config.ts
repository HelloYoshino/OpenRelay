import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Backend used by the dev server proxy. Override with OPENRELAY_API=http://host:port. */
const target = process.env.OPENRELAY_API ?? 'http://localhost:8080';

// Keys are prefix matches unless they start with "^" (RegExp): "/a" alone would also catch "/assets".
const proxy = {
  '/api': { target, changeOrigin: true },
  '^/a/': { target, changeOrigin: true },
  '/healthz': { target, changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy,
  },
  preview: {
    proxy,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
