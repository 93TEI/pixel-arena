import { defineConfig } from 'vite';
export default defineConfig({
  // Capturing a review HTML must not reset a live match or a browser acceptance run.
  server: { watch: { ignored: ['**/docs/**', '**/test-results/**'] } },
  build: { rollupOptions: { input: { arena: 'index.html', effects: 'vfx-review.html' } } },
});
