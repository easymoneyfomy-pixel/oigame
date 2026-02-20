module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true
  },
  extends: 'eslint:recommended',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-console': 'off',
    'eqeqeq': ['error', 'always'],
    'curly': ['error', 'multi-line'],
    'no-var': 'error',
    'prefer-const': 'error'
  },
  ignorePatterns: ['node_modules/', 'package-lock.json']
};
