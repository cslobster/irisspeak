import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: __dirname,
  cacheDir: 'node_modules/.vite',
  server: { port: 4200, host: 'localhost' },
  preview: { port: 4300, host: 'localhost' },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    // transformers.js ships ESM with onnx-runtime + sharp deps that confuse pre-bundling.
    exclude: ['@huggingface/transformers'],
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
      process.env.BACKEND_ADDRESS || process.env.VITE_BACKEND_ADDRESS || 'http://localhost:3000'
    ),
  },
});
