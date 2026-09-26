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
    // Phase 30F — root-absolute asset URLs. The service worker answers every
    // offline /cards/** navigation with the one precached /cards shell, so
    // its `/_app/…` links must not depend on the depth of the URL it serves.
    paths: { relative: false },
    // SvelteKit's own cross-site form check runs before `handle` and refuses
    // every form-encoded POST without a same-origin Origin header. RFC 8058
    // one-click unsubscribe is exactly that (the mail provider POSTs
    // `List-Unsubscribe=One-Click` from its servers), so the check moves into
    // hooks.server.ts (`formCsrfForbidden`), identical in behaviour except for
    // that one signed-token endpoint. `csrfDecision()` still vets JSON
    // mutations as before (Phase 24).
    csrf: { trustedOrigins: ['*'] }
  }
};

export default config;
