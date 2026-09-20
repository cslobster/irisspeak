import { defineConfig } from 'vitest/config';
import path from 'path';

// Unit tests only run pure logic (grammar, board assembly) under node — no jsdom, no ONNX, no network.
// Anything that needs the model, localStorage or the backend is mocked per test file with vi.mock.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
