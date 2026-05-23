import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ out: 'build' }),
    alias: {
      $lib: 'src/lib'
    },
    // Phase 24 — disable SvelteKit's built-in same-origin CSRF check.
    // We replace it with a smarter guard in hooks.server.ts that lets
    // Bearer-authed requests through (external agents call from
    // arbitrary origins by design) while keeping cookie-session mutations
    // strictly same-origin.
    csrf: {
      checkOrigin: false
    }
  }
};

export default config;
