import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: { port: 5173, strictPort: false, host: true },
  optimizeDeps: { exclude: ['better-sqlite3'] },
  ssr: { noExternal: ['drizzle-orm'] }
});
