import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    // Read .env from the monorepo root instead of apps/frontend/.
    envDir: '../../',
});
