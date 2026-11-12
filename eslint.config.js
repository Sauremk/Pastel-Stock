import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'coverage/', '.pgdata/', 'web/vendor/', 'k6/'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', 'tools/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      complexity: ['warn', 10],            // McCabe > 10 = método difícil de probar (Guía 1)
      'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },
  {
    // Scripts CommonJS de verificación con Playwright (PR #5): CI fallaba porque no se declaraban sus globales.
    files: ['scripts/**/*.cjs', 'tests/**/*.cjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    files: ['web/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser, Chart: 'readonly' } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }], eqeqeq: 'error', 'no-eval': 'error', 'no-restricted-properties': ['error', { property: 'innerHTML', message: 'Prohibido innerHTML con datos (XSS, DT-03). Use h()/textContent.' }] },
  },
];
