module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2021: true,
  },
  // Ignorar código de functions e build output para lint local
  ignorePatterns: ['dist/', 'supabase/**'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  settings: { react: { version: 'detect' } },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended'
  ],
  rules: {
    // Projetos legacy: relaxar regras que bloqueiam a verificação inicial
    'react/react-in-jsx-scope': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    'react-hooks/exhaustive-deps': 'off',
    'no-console': 'off',
  },
};
