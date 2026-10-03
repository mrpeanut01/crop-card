/**
 * TEST ONLY. Shared by the fixture Claude on the e2e preview server and the
 * Playwright specs that drive it, so both sides agree on the triggers.
 * Nothing here is a real key or farm advice.
 */

/** Saving this as a farm's Claude key turns the fixture on for that farm,
 *  and only on a server started with E2E_CLAUDE_FIXTURE=1 and
 *  ENABLE_DEV_ROUTES=1. Anywhere else it is just a bad key. */
export const E2E_FIXTURE_API_KEY = 'sk-ant-e2e-fixture-not-a-real-key';

/** A refine message the fixture answers with a valid change. */
export const FIXTURE_REFINE_VALID = 'Plant half as many beans';

/** A refine message the fixture answers with a plan the validator rejects,
 *  on the first try and on the corrective retry. */
export const FIXTURE_REFINE_INVALID = 'Put every plant you can in the first bed';
