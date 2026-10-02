import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import cropcard from 'eslint-plugin-cropcard';

export default tseslint.config(
  {
    ignores: [
      'build/',
      '.svelte-kit/',
      'node_modules/',
      'drizzle/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      // svelte-eslint-parser chokes on this 2642-line file (phantom ')' expected
      // past EOF, likely from a complex inline `{@const … as Type}` cast).
      // svelte-check and tsc both parse it fine. Ignore at the lint layer until
      // the file is split in the InventoryView refactor.
      'src/lib/components/InventoryView.svelte'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  prettier,
  ...svelte.configs['flat/prettier'],
  {
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, ...globals.es2021 }
    },
    plugins: { cropcard },
    rules: {
      // Phase 22 follow-ups: relaxed to warn while legacy / in-progress modules
      // are cleaned up. typecheck still fails CI on genuinely dead code.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      'no-constant-condition': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-control-regex': 'warn',
      'no-useless-escape': 'warn',
      'no-inner-declarations': 'warn',
      'svelte/no-inner-declarations': 'warn',
      'prefer-const': 'warn',
      // Invariant 6: raw Drizzle reads/writes against tenant-scoped tables
      // must go through tenantWhere/withTenant/tenantValues, or the function
      // must call `unscopedQueryNote('reason')` when intentionally global.
      'cropcard/no-raw-tenant-table': 'error'
    }
  },
  {
    // C-35: every write that can affect a hold runs inside the hold guard.
    // Repos in lib/db write hold-fact tables directly; everything else calls
    // them inside guardedHoldWrite, or from a `@holdWriter` helper whose own
    // callers are checked. holdGuard.ts is the guard itself.
    files: ['src/**/*.ts'],
    ignores: [
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/*.fixtures.ts',
      'src/lib/db/**',
      'src/lib/server/holdGuard.ts'
    ],
    rules: {
      'cropcard/no-unguarded-hold-write': 'error'
    }
  },
  {
    // 34B (B34-27): every translated surface. User-facing template text goes
    // through the i18n catalog. English that stays English by rule (safety and
    // regulatory wording, CLAUDE.md invariant 9) sits inside a native element
    // with lang="en" data-english-only="safety|regulatory"; the reasons must
    // match ENGLISH_ONLY_REASONS in src/lib/i18n/englishOnly.ts. No
    // eslint-disable for this rule (englishOnly.test.ts fails on one).
    files: ['src/routes/**/*.svelte', 'src/lib/components/**/*.svelte'],
    ignores: [
      // dev-only, 404 in production
      'src/routes/_dev/**',
      // superadmin operator console, not a farm surface
      'src/routes/admin/**'
    ],
    rules: {
      'cropcard/no-raw-text': [
        'error',
        {
          allow: ['CropCard'],
          allowWords: [
            'CropCard',
            'Claude',
            'CSV',
            'PDF',
            'JSON',
            'OMRI',
            'EPA',
            'USDA',
            'NOAA',
            'NWS',
            'FRAC',
            'IRAC',
            'CFR',
            'REI',
            'PHI',
            'GPA',
            'pH',
            'Brix',
            'N',
            'P',
            'K',
            'ppm',
            'd',
            'h',
            'min',
            'ft',
            'oz',
            'lb',
            'gal',
            'mm',
            'cm',
            'm',
            'mph',
            '°F',
            'v'
          ],
          reasons: ['safety', 'regulatory']
        }
      ]
    }
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte']
      }
    },
    rules: {
      // Svelte 5's `state_referenced_locally` advisory is an intentional
      // pattern for us (initial-value capture into `$state`). svelte-check
      // still surfaces it as a warning.
      'svelte/valid-compile': ['warn', { ignoreWarnings: true }],
      'svelte/no-unused-svelte-ignore': 'warn',
      'svelte/no-inner-declarations': 'warn',
      // resolve() only matters under kit.paths.base, which this app never sets; ~215 plain-string hrefs/gotos would churn for no behavioural change.
      'svelte/no-navigation-without-resolve': 'off',
      // No scope analysis: every hit is a function- or $derived-local temporary, a copy-then-reassign $state update, or imperative Leaflet bookkeeping, where SvelteMap/Set/Date/URLSearchParams adds signals without changing behaviour.
      'svelte/prefer-svelte-reactivity': 'off'
    }
  }
);
