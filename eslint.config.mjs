import tsPlugin from '@typescript-eslint/eslint-plugin';
import unusedImports from 'eslint-plugin-unused-imports';
import nextConfig from 'eslint-config-next';

/**
 * ESLint flat config. `eslint-config-next` already exports a flat-config array
 * in Next 16, so it is spread directly. Custom rules register the TypeScript
 * and unused-imports plugins so their rules resolve under flat config.
 */
const config = [
  ...nextConfig,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { '@typescript-eslint': tsPlugin, 'unused-imports': unusedImports },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-unused-vars': 'off',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      // Declaring globals for cross-request singletons requires `var`.
      'no-var': 'off',
      // Reacting to a server-action result inside an effect is an intended pattern.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'src/db/migrations/**',
      'out/**',
      '.data/**',
      'storage/**',
    ],
  },
];

export default config;
