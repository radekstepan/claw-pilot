import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';

function getGitCommit(): string {
    try {
        return execSync('git rev-parse --short HEAD', { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'ignore'] })
            .toString()
            .trim();
    } catch {
        return 'dev';
    }
}

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    // Read .env from the monorepo root instead of apps/frontend/.
    envDir: '../../',
    define: {
        __GIT_COMMIT__: JSON.stringify(getGitCommit()),
    },
});
