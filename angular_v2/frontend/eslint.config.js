import js from '@eslint/js';
import { configs, processInlineTemplates } from 'angular-eslint';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Flat config. One format only — there is no `.eslintrc.json` in this project
 * and `backend/test/unit/eslint-baseline.spec.ts` fails if one appears.
 *
 * `OnPush` is the Angular 22 default, so `ChangeDetectionStrategy` is never
 * written; the rule below still guards any component that would opt out.
 *
 * The two `@angular-eslint/template` baseline rules live in the HTML block: they
 * belong to the template plugin, and `processInlineTemplates` routes an inline
 * template through a virtual HTML file, so a component with `template:` is
 * covered by exactly the same rules as one with `templateUrl:`.
 *
 * The subscription-teardown rule of `AGENTS.md` §3 is listed in
 * `backend/test/unit/eslint-baseline.spec.ts` as unavailable, with the reason.
 * What runs in its place is `@angular-eslint/no-implicit-take-until-destroyed`,
 * which catches a teardown operator used outside an injection context.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.angular/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...configs.tsRecommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.app.json', './tsconfig.spec.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    processor: processInlineTemplates,
    rules: {
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      '@angular-eslint/prefer-standalone': 'error',
      '@angular-eslint/no-empty-lifecycle-method': 'error',
      '@angular-eslint/no-implicit-take-until-destroyed': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-undef': 'off',
    },
  },
  {
    // Application code reports through an injected service; a console call in a
    // component or service has nowhere to route. The two entrypoints below are
    // exempt because they run before and outside the injector, where no
    // injected logger exists.
    files: ['src/app/**/*.ts'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.html'],
    extends: [...configs.templateRecommended, ...configs.templateAccessibility],
    rules: {
      '@angular-eslint/template/prefer-control-flow': 'error',
      '@angular-eslint/template/conditional-complexity': 'error',
    },
  },
  {
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: globals.node,
    },
  },
);
