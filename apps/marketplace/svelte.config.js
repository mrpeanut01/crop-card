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
    // Built-in CSRF is all-or-nothing. We disable it here and re-implement
    // equivalent protection in hooks.server.ts so cookie-session form POSTs
    // still need a matching Origin, while Bearer-authed API requests can
    // come from any origin (Anthropic SDK, curl, etc.).
    csrf: { checkOrigin: false }
  }
};

export default config;
