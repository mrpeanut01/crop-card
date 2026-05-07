import { json } from '@sveltejs/kit';
import { RULES_VERSION } from '$lib/safety/version';

export const GET = () => {
  return json({
    status: 'ok',
    rulesVersion: RULES_VERSION,
    uptime: process.uptime()
  });
};
