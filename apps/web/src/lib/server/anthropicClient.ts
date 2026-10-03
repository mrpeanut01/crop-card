import Anthropic from '@anthropic-ai/sdk';
import { claudeFixtureEnabled, createFixtureClient, E2E_FIXTURE_API_KEY } from './aiFixture/claude';

/** Every server module builds its Claude client here. It is the real SDK
 *  client unless this is the e2e preview server (E2E_CLAUDE_FIXTURE=1 and
 *  ENABLE_DEV_ROUTES=1) and the farm saved the fixture's sentinel key; then
 *  it is the test-only fixture client. Production sets neither variable. */
export function anthropicClient(apiKey: string): Anthropic {
  if (apiKey === E2E_FIXTURE_API_KEY && claudeFixtureEnabled(process.env)) {
    return createFixtureClient() as unknown as Anthropic;
  }
  return new Anthropic({ apiKey });
}
