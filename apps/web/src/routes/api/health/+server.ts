import { json } from '@sveltejs/kit';
import { RULES_VERSION } from '$lib/safety/version';

/** `version` is the commit the running image was built from (BUILD_SHA,
 *  baked in by infra/Dockerfile); deploys wait for it to match the SHA
 *  they shipped before calling the build live. */
export const GET = () => {
  return json(
    {
      status: 'ok',
      version: process.env.BUILD_SHA || 'dev',
      rulesVersion: RULES_VERSION,
      uptime: process.uptime()
    },
    { headers: { 'cache-control': 'no-store' } }
  );
};
