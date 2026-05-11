import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts', 'tests-e2e/**/*.ts', 'playwright.config.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
    },
  },
  // jsx-a11y baseline. Подключаем плагин только для .tsx — гейтим критичные
  // правила как error. Остальные правила (interactive-element ergonomics)
  // отключены: см. polish-2026-05-11-2.md, блок C — массово в коде
  // используются <div onClick> для row/list/menu, миграция на <button>
  // и keyboard-listeners — backlog следующего стрима, не один-сеансовый
  // polish. Главная гарантия: ни одно из «слепых» нарушений (alt-text,
  // aria-props, aria-role) больше не пропустится в CI.
  {
    files: ['src/renderer/src/**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: {
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-role': 'error',
      'jsx-a11y/aria-unsupported-elements': 'error',
      'jsx-a11y/role-has-required-aria-props': 'error',
      'jsx-a11y/role-supports-aria-props': 'error',
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/label-has-associated-control': 'error',
      'jsx-a11y/no-redundant-roles': 'error',
      // backlog (массовый рефактор на <button>/role+tabIndex+keydown):
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/no-static-element-interactions': 'off',
      'jsx-a11y/no-noninteractive-element-interactions': 'off',
      'jsx-a11y/no-autofocus': 'off',
    },
  },
  {
    files: ['tests-e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    ignores: [
      'dist/',
      'release/',
      'node_modules/',
      'src/renderer/node_modules/',
      'src/renderer/dist/',
      'tests-e2e/_report/',
      '**/*.js',
      '**/*.mjs',
    ],
  },
);
