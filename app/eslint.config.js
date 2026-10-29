import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules', 'out', '.next', 'drizzle', 'src/schema/migrations.generated.ts', 'e2e/**', 'public/**', 'next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-restricted-syntax': ['error',
        // Money is never a float: toFixed on a JS number is how rounding bugs creep in. Use the engine or Decimal.
        { selector: "CallExpression[callee.property.name='toFixed'][arguments.length=1][callee.object.type='Identifier'][callee.object.name='cents']", message: 'Do not format money with toFixed; use formatMoney.' },
      ],
    },
  },
  {
    // Plan 4b: defaults are seed data. Nothing but the installer (and tests) may import them, so no logic can depend on one.
    files: ['src/**/*.{ts,tsx}', 'server/**/*.ts', 'scripts/**/*.ts'],
    ignores: ['src/seed/**', 'src/installer/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['**/seed', '**/seed/*', '**/seed/**'], message: 'Defaults live in src/seed and may only be imported by the installer (plan 4b).' }] }],
    },
  },
  { files: ['scripts/**/*.{mjs,ts}'], languageOptions: { globals: { console: 'readonly', process: 'readonly' } } },
  // The engine must stay pure: no database, no clock, no settings.
  {
    files: ['src/domain/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['**/db/*', '**/settings/*', '**/services/*', '**/seed/*', 'pg', '@electric-sql/*', 'drizzle-orm*'], message: 'The pricing engine is pure: no database, settings or services.' }] }],
      'no-restricted-syntax': ['error',
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'The engine has no clock; callers pass the time in.' },
        { selector: "MemberExpression[object.name='Date'][property.name='now']", message: 'The engine has no clock; callers pass the time in.' },
        { selector: "MemberExpression[object.name='Math'][property.name='random']", message: 'The engine is deterministic.' },
      ],
    },
  },
);
