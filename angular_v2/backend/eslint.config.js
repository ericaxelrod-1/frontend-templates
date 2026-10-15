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
 *
 * The two `no-restricted-syntax` selectors at the foot are §3's structural rules
 * rather than baseline ones: they do not belong in
 * `eslint-baseline.spec.ts`'s list, because a listed rule is one that must be
 * *active in every project* and these are deliberately scoped to `backend/src`.
 * Both are proven able to fail — see `docs/rebase.md` §9B.12 — and a violation of
 * either is a red `npm run lint` on the first line of the offending file.
 *
 * The third is `NO_NODE_ENV_BRANCH`, likewise scoped to `src/breaker/**` and likewise
 * proven able to fail. §3 asks for an enforcing rule whenever a convention is added;
 * this is the convention the route census introduces ("the breaker has no
 * environment-dependent behaviour"), and the rule is what makes the refused answer —
 * exempting a test route when `NODE_ENV === 'test'` — unrepresentable rather than merely
 * discouraged.
 */
/**
 * §9B.5's contract, enforced rather than reviewed: the abort handle belongs to
 * the gate and to nothing else.
 *
 * An `AbortController` that is constructed and never passed to its consumer is
 * not a timeout, it is a comment — it produces the complete appearance of a
 * recoverable abort and none of the behaviour, it survives review because the
 * surrounding code is correct, and no test stays green against it. That shape
 * is in this repository's history (`privacy.service.ts:209-217`: a controller
 * built, armed, `signal` never passed).
 *
 * The sweeper is STOPPABLE, so an abort has to reach it — and it receives the
 * gate's signal on the dispatch lease rather than building its own, which makes
 * the defect unrepresentable instead of merely untested. `AGENTS.md` §3: a
 * convention that only exists in prose does not survive the next agent.
 */
const ABORT_CONTROLLER_IS_GATE_OWNED = {
  selector: "NewExpression[callee.name='AbortController']",
  message:
    'AbortController is owned by BreakerGate and nowhere else. Take the signal from the dispatch lease a stoppable service is given; a controller constructed here and not passed on is a comment, not a timeout.',
};

/**
 * The cold-start correction, and the invariant it rests on.
 *
 * Every entry point into the state machine takes `nowMs: number`. That is what
 * lets the suite drive the whole machine from a fake clock, and it is what makes
 * the cold-start assertions — `sample === null` is admitted, an aged sample is
 * refused — deterministic rather than dependent on how long the process has been
 * up.
 *
 * A `Date.now()` default anywhere in `breaker-state.ts` silently reinstates the
 * host clock at exactly the decision the correction is about: whether a dispatch
 * arriving 300 ms after boot is admitted depends on the wall clock rather than on
 * the published sample. This repository has already paid for a version of that
 * — a host memory reading that made an assertion race (`7c8eaaa`).
 *
 * Scoped to one file on purpose. Everywhere else in `src/`, calling the clock is
 * correct: the meter and the gate take a real reading at the top of a tick, and
 * the sweeper's `tick(nowMs = Date.now())` is the boundary that converts a real
 * clock into the value this file then consumes. The rule states the invariant
 * where the invariant lives, which is also the only scope in which it would not
 * be noise.
 */
const CLOCK_IS_A_VALUE = {
  selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
  message:
    'The clock is a value in breaker-state.ts, never a call. Every entry point already takes nowMs, which is what lets the state machine be driven from a fake clock; a Date.now() default here silently reinstates the host clock at the one decision the cold-start fix is about.',
};

/**
 * The breaker does not vary by environment, and the route census is the reason.
 *
 * `src/breaker/route-census.ts` refuses a boot in which a mounted route names no
 * dispatch token. The one way to make that gate pass without classifying anything is to
 * skip it when `NODE_ENV === 'test'`, and there is a concrete reason that temptation
 * arrives: `test/e2e/email.e2e-spec.ts` mounts `EmailProbeController` into `AppModule`,
 * so the e2e suite really does boot a graph with an unnamed route in it. That is a fact
 * to record in `NON_DISPATCHABLE_CONTROLLERS`, where the declaration is checked against
 * the file it names — **not** an environment to switch off, because a `NODE_ENV` branch
 * around a resource control is the silent weakening `AGENTS.md` §2.3 names, and it buys
 * nothing: the fixture is mounted in every mode.
 *
 * Both spellings are selectors because this tree is `noPropertyAccessFromIndexSignature`
 * and therefore writes `process.env['NODE_ENV']` (`src/config/load-env-file.ts:29`), and a
 * rule that matched only `process.env.NODE_ENV` would be green against every call site
 * this repository actually writes. A third selector for `const { NODE_ENV } = process.env`
 * was written and deleted: the AST for an object destructuring puts an `Identifier` where
 * that selector reads a `MemberExpression`, so it can never match, and a selector that has
 * never fired proves nothing.
 */
const NO_NODE_ENV_BRANCH = [
  {
    selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='NODE_ENV']",
    message:
      'The breaker has no environment-dependent behaviour, and the route census is why: a NODE_ENV branch here is how a mounted route stops being classified. Record an exemption in NON_DISPATCHABLE_CONTROLLERS (route-census.ts) or name the token in KNOWN_DISPATCH_TOKENS (dispatch-token.ts); do not switch the gate off by mode.',
  },
  {
    selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.value='NODE_ENV']",
    message:
      'The breaker has no environment-dependent behaviour, and the route census is why: a NODE_ENV branch here is how a mounted route stops being classified. Record an exemption in NON_DISPATCHABLE_CONTROLLERS (route-census.ts) or name the token in KNOWN_DISPATCH_TOKENS (dispatch-token.ts); do not switch the gate off by mode.',
  },
];

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
    files: ['src/**/*.ts'],
    ignores: ['src/breaker/breaker-gate.ts'],
    rules: {
      'no-restricted-syntax': ['error', ABORT_CONTROLLER_IS_GATE_OWNED],
    },
  },
{
    // Every breaker file carries the NODE_ENV ban. The two earlier selectors are
    // repeated rather than inherited, for the reason the block below states: a later
    // flat-config object REPLACES `no-restricted-syntax` for the files it matches, so a
    // narrower block listing only its own selector silently drops the others.
    files: ['src/breaker/**/*.ts'],
    ignores: ['src/breaker/breaker-gate.ts', 'src/breaker/breaker-state.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...NO_NODE_ENV_BRANCH, ABORT_CONTROLLER_IS_GATE_OWNED],
    },
  },
  {
    // The gate is excluded from the AbortController ban (it owns the only controller)
    // and so needs its own block for the rule it must still carry.
    files: ['src/breaker/breaker-gate.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...NO_NODE_ENV_BRANCH],
    },
  },
  {
    // Both selectors, not just the new one: a later config object REPLACES
    // `no-restricted-syntax` for the files it matches, so a block carrying only the
    // clock rule would silently drop the AbortController ban from this file.
    // All three, for the same reason plus the NODE_ENV ban above.
    files: ['src/breaker/breaker-state.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...NO_NODE_ENV_BRANCH,
        CLOCK_IS_A_VALUE,
        ABORT_CONTROLLER_IS_GATE_OWNED,
      ],
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
