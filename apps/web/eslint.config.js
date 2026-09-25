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
      // New in eslint-plugin-svelte v3's recommended set and already violated
      // by existing components; the v2 config this replaced did not enforce
      // them. Adopt in a dedicated cleanup pass rather than the ESLint 9 bump.
      'svelte/no-navigation-without-resolve': 'off',
      'svelte/prefer-svelte-reactivity': 'off',
      'svelte/require-each-key': 'off'
    }
  }
);
