import { defineConfig } from 'vite';
export default defineConfig({ build: { rollupOptions: { input: { arena: 'index.html', effects: 'vfx-review.html' } } } });
