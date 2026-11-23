import js from '@eslint/js';

export default [{
  files: ['scripts/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.mjs'],
  languageOptions: {
    ecmaVersion: 2024,
    sourceType: 'module',
    globals: {
      console: 'readonly',
      process: 'readonly',
      URL: 'readonly',
    },
  },
  rules: js.configs.recommended.rules,
}];
