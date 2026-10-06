/**
 * Vitest setup — gives each test file its own database, registers
 * @testing-library/jest-dom matchers (toBeInTheDocument, toHaveAttribute,
 * etc.) and adds the testing-library teardown so component tests don't
 * leak DOM between cases.
 *
 * Only loads in jsdom env (component tests). For node-env logic tests this
 * file runs but the imports are inert without document/window.
 */

import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach } from 'vitest';
import { cloneTemplateDb, removeDb } from './testDb';

// Every test file gets its own clone of the migrated template database, so
// files never see each other's rows or wait on each other's write locks.
// Setup files run before the test file imports `$lib/db/client`, which opens
// DATABASE_URL lazily. Removed after the file's own afterAll hooks.
const fileDb = cloneTemplateDb();
process.env.DATABASE_URL = `file:${fileDb}`;
afterAll(() => removeDb(fileDb));

// Cleanup auto-unmounts components rendered via @testing-library/svelte's
// render() so DOM state doesn't carry between tests. Only meaningful in
// jsdom; harmless in node.
if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/svelte');
  afterEach(() => cleanup());
}
