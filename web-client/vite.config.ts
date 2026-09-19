import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

export default defineConfig({
  root: __dirname,
  cacheDir: 'node_modules/.vite',
  server: {
    port: 4200,
    host: true,
    https: fs.existsSync(path.resolve(__dirname, '.certs/key.pem')) ? {
      key: fs.readFileSync(path.resolve(__dirname, '.certs/key.pem')),
      cert: fs.readFileSync(path.resolve(__dirname, '.certs/cert.pem')),
    } : undefined,
    // Proxy all API calls through Vite so the browser never sees an HTTP→HTTPS
    // mixed-content issue when loading from a LAN IP on iPad Safari.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // model.irisspeak.org's R2 CORS policy only allows the production origin (irisspeak.com), so a
      // browser fetch from localhost is blocked outright ("Failed to fetch", model never loads). Proxying
      // it through Vite makes the request same-origin from the browser's point of view — no CORS involved,
      // since the browser only ever talks to the dev server. Dev only; see CDN_BASE in engine/model.ts.
      '/model-cdn': {
        target: 'https://model.irisspeak.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/model-cdn/, ''),
      },
    },
  },
  preview: { port: 4300, host: true },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    // transformers.js and onnxruntime-web ship their own workers/wasm; pre-bundling breaks them
    exclude: ['@huggingface/transformers', 'onnxruntime-web'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
  },
  worker: {
    format: 'es',
  },
  define: {
    __BACKEND_URL__: JSON.stringify(
      process.env.BACKEND_ADDRESS || process.env.VITE_BACKEND_ADDRESS || ''
    ),
  },
});
