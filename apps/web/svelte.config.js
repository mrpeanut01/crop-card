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
    paths: { relative: false }
    // Phase 24 CSRF posture (verified Phase 25, #94):
    // SvelteKit's built-in `kit.csrf.checkOrigin` check only fires for
    // FORM-encoded cross-origin mutations — JSON-encoded /api/** requests
    // (the Bearer-authed agent surface) sail through by default. We rely
    // on the per-request `csrfDecision()` helper in hooks.server.ts as
    // the additional defensive layer that also vets cookie-session JSON
    // mutations against Origin. Keeping SvelteKit's default ENABLED
    // (no `csrf` block) preserves form-action protection for cookie
    // sessions; removing the deprecated `checkOrigin: false` flag.
    // Reference: kit/src/runtime/server/respond.js — `is_form_content_type`
    // guard around the csrf check confirms the JSON path is unaffected.
  }
};

export default config;
