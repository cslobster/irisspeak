// ESLint flat config for the web client. Pragmatic: the codebase is dense, long-line, comment-rich
// TypeScript, so no formatting rules — only things that catch real bugs (unused code, hooks misuse, TS foot-guns).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'public'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      // `ort` is the standalone onnxruntime-web script (public/ort/ort.min.js); `__BACKEND_URL__` is a Vite define.
      globals: { ...globals.browser, ...globals.es2021, ort: 'readonly', __BACKEND_URL__: 'readonly' },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      // Only the two classic hooks rules. eslint-plugin-react-hooks v7's "recommended" also ships the React
      // Compiler rules (refs, immutability, set-state-in-effect, preserve-manual-memoization); this app does not
      // use the compiler and those flag ~10 established patterns in SessionScreen, so they stay off.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Warn, not error, until the handful of existing unused imports/params are cleaned up (4 as of 2026-09-20).
      // `_x` names are the accepted way to say "ignored on purpose".
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // tsconfig is not strict; `any` is used deliberately at the ONNX / transformers.js boundary (~50 sites).
      '@typescript-eslint/no-explicit-any': 'warn',
      // Every empty block in src is a best-effort `try { … } catch {}` (localStorage, TTS, fire-and-forget mirrors).
      'no-empty': ['error', { allowEmptyCatch: true }],
      // `cond ? a() : b()` and `x && f()` as statements are idiomatic in this codebase.
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      'no-useless-assignment': 'warn',
    },
  },
  {
    files: ['src/**/*.test.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
);
