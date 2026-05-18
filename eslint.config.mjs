import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const globalIgnores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/tmp/**',
  '**/.tmp/**',
  '**/output/**',
  'third_party/**',
  '**/.playwright-mcp/**',
  '**/.worktrees/**',
  'log/**',
  'public/**',
  'public/usd/bindings/**',
  'test/usd-viewer/**',
  'src/features/urdf-viewer/runtime/**',
];

export default tseslint.config(
  {
    ignores: globalIgnores,
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      'no-console': 'off',
      'no-cond-assign': 'off',
      'no-empty': 'off',
      'no-loss-of-precision': 'off',
      'no-regex-spaces': 'off',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-useless-escape': 'off',
      'prefer-const': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-case-declarations': 'off',
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
  },
);
