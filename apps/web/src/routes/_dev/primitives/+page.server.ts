import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Visible:
//   - In dev mode (anyone) — `pnpm dev` sets dev=true
//   - To a superadmin (any env)
//   - When ENABLE_DEV_ROUTES=1 (used by Playwright visual baseline against
//     `pnpm preview`; production never sets this)
//
// Acts as the Phase 25a visual reference + a11y/Lighthouse baseline.
export const load: PageServerLoad = async ({ locals }) => {
  const enabled = dev || locals.user?.isSuperadmin || env.ENABLE_DEV_ROUTES === '1';
  if (!enabled) {
    throw error(404, 'Not found');
  }
  return {};
};
