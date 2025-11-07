import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';

export default [
  // ESLintの推奨設定
  eslint.configs.recommended,
  
  {
    // TypeScriptファイルを対象とする
    files: ['**/*.ts'],
    
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        NodeJS: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    
    plugins: {
      '@typescript-eslint': tseslint,
      'import': importPlugin,
      'prettier': prettierPlugin,
    },
    
    rules: {
      // TypeScript推奨ルール
      ...tseslint.configs.recommended.rules,
      
      // Prettierルール
      'prettier/prettier': 'error',
      
      // Import関連ルール
      'import/order': ['error', {
        'groups': ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'always',
        'alphabetize': { 'order': 'asc', 'caseInsensitive': true },
      }],
      
      // TypeScript固有のルール調整
      '@typescript-eslint/no-unused-vars': ['error', { 
        'argsIgnorePattern': '^_',
        'varsIgnorePattern': '^_'
      }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      
      // 一般的なルール
      'no-console': 'off',
      'no-debugger': 'warn',
    },
  },
  
  // Prettier設定（ルールの競合を回避）
  prettierConfig,
  
  {
    // 無視するファイル
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      '*.config.js',
      '*.config.ts',
      'drizzle/**',
      'ops/**',
    ],
  },
];

