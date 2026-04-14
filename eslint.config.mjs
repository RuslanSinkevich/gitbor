import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
    },
  },
  {
    ignores: [
      'dist/',
      'release/',
      'node_modules/',
      'src/renderer/node_modules/',
      'src/renderer/dist/',
      '**/*.js',
      '**/*.mjs',
    ],
  },
);
