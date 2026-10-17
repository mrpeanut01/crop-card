import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    sveltekit({
      preprocess: vitePreprocess(),
      adapter: adapter({ out: 'build' }),
      alias: { $lib: 'src/lib' },
      // SvelteKit's built-in cross-site form check is all-or-nothing, so it is
      // switched off here and re-implemented in hooks.server.ts: cookie-session
      // form POSTs still need a matching Origin, while Bearer-authed API
      // requests can come from any origin (Anthropic SDK, curl, etc.).
      csrf: { trustedOrigins: ['*'] }
    })
  ],
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    watch: {
      usePolling: true
    }
  },
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}', 'tests/**/*.{test,spec}.{js,ts}'],
    environment: 'node'
  }
});
