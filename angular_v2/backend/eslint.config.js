import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Flat config. One format only — there is no `.eslintrc.json` in this project
 * and `test/unit/eslint-baseline.spec.ts` fails if one appears.
 *
 * The five `@angular-eslint/*` rules of `AGENTS.md` §3 are enforced in
 * `frontend/eslint.config.js`; the backend has no Angular templates.
 * `@typescript-eslint/no-explicit-any` is enforced in both projects.
 *
 * The subscription-teardown rule of `AGENTS.md` §3 is recorded as unavailable in
 * `test/unit/eslint-baseline.spec.ts`, with the reason and the evidence. It is
 * not enabled here: `rxjs-angular/prefer-takeuntil` aborts the whole ESLint run
 * on every file, because the plugin reaches type information through
 * `context.parserServices`, which ESLint removed in v9.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      // `no-undef` is TypeScript's problem, not ESLint's: the compiler already
      // rejects an undefined identifier, and the rule misfires on types.
      'no-undef': 'off',
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: globals.node,
    },
  },
);
