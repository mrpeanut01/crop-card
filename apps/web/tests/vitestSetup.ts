/**
 * Vitest setup — registers @testing-library/jest-dom matchers
 * (toBeInTheDocument, toHaveAttribute, etc.) and adds the testing-library
 * teardown so component tests don't leak DOM between cases.
 *
 * Only loads in jsdom env (component tests). For node-env logic tests this
 * file runs but the imports are inert without document/window.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

// Cleanup auto-unmounts components rendered via @testing-library/svelte's
// render() so DOM state doesn't carry between tests. Only meaningful in
// jsdom; harmless in node.
if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/svelte');
  afterEach(() => cleanup());
}
