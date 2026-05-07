/* eslint-env node */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    extraFileExtensions: ['.svelte']
  },
  env: {
    browser: true,
    node: true,
    es2022: true
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:svelte/recommended',
    'prettier'
  ],
  plugins: ['@typescript-eslint'],
  overrides: [
    {
      files: ['*.svelte'],
      parser: 'svelte-eslint-parser',
      parserOptions: { parser: '@typescript-eslint/parser' },
      rules: {
        // Svelte 5's `state_referenced_locally` advisory is an intentional
        // pattern for us (initial-value capture into `$state`). Don't fail CI
        // on it — svelte-check still surfaces it as a warning.
        'svelte/valid-compile': ['warn', { ignoreWarnings: true }]
      }
    },
    {
      files: ['**/*.test.ts', 'tests/**/*.ts'],
      env: { node: true }
    }
  ],
  rules: {
    // Allow underscore-prefixed unused vars (intentional placeholders).
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
    ]
  },
  ignorePatterns: ['build/', '.svelte-kit/', 'node_modules/', 'drizzle/']
};
