import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default [
    {
        files: ['**/*.ts', '**/*.tsx'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
            'react-hooks': reactHooksPlugin,
        },
        rules: {
            // ─── No Native Prompts — hard rule ───────────────────────────────
            // Forbids alert(), confirm(), and prompt() across the entire frontend.
            // Use <ConfirmDialog /> from src/components/ui/ConfirmDialog.tsx instead.
            'no-alert': 'error',

            // TypeScript recommended rules
            ...tsPlugin.configs.recommended.rules,

            // React Hooks rules
            ...reactHooksPlugin.configs.recommended.rules,

            // Disable React Compiler hint — we don't run the React Compiler.
            // This rule produces false-positive warnings on valid react-hook-form usage.
            'react-hooks/react-compiler': 'off',
            'react-hooks/incompatible-library': 'off',
        },
    },
    {
        // Ignore build artifacts
        ignores: ['dist/**', 'node_modules/**'],
    },
];
