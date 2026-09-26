import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 5173);
const BASE_URL = `http://localhost:${PORT}`;
const TEST_DB_PATH =
  PORT === 5173 ? './.playwright-data/test.db' : `./.playwright-data/test-${PORT}.db`;

// UC-17 — a second preview of the SAME build runs with AUTH_MODE=magic-link
// so the magic-link spec exercises the production auth mode while every
// other spec keeps the direct/demo sign-in. EMAIL_TRANSPORT=memory +
// E2E_OUTBOX=1 expose sent links at /_dev/outbox on that server only.
const MAGIC_PORT = Number(process.env.E2E_MAGIC_PORT ?? PORT + 1);
const MAGIC_DB_PATH = `./.playwright-data/test-magic-${MAGIC_PORT}.db`;
// Unique per run so the magic server never starts against a stale marker.
const BUILD_MARKER = `./.playwright-data/.build-done-${PORT}-${Date.now()}`;

// Only set when the pinned Playwright's bundled chromium isn't installed
// (e.g. a sandbox with a preinstalled browser). CI never sets it.
const CHROMIUM_PATH = process.env.PW_CHROMIUM_PATH;

// The built server resolves its default plugin dir relative to the bundled
// chunk (which lands outside the repo), so pin it like the Dockerfile does.
// Without it the crop registry is empty and the allocation wizard can't run.
const PLUGINS_DIR = fileURLToPath(new URL('../../plugins', import.meta.url));

// The blocking CI e2e job skips visual specs; the separate non-blocking
// `visual` CI job sets E2E_VISUAL=1. Linux baselines are captured with a
// different chromium build than CI's, so pixel parity isn't guaranteed yet.
const SKIP_VISUAL = !!process.env.CI && !process.env.E2E_VISUAL;

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: SKIP_VISUAL ? ['**/visual/**'] : [],
  webServer: [
    {
      // Build + migrate + start, all pinned to a workspace-local SQLite file
      // so the test runner doesn't need write access to /data.
      // ENABLE_DEV_ROUTES=1 unlocks /_dev/primitives for the visual baseline
      // spec (production never sets this flag — the dev page stays gated).
      command:
        `mkdir -p ./.playwright-data && ` +
        `rm -f ${TEST_DB_PATH} ./.playwright-data/.build-done-${PORT}-* && ` +
        `DATABASE_URL=file:${TEST_DB_PATH} pnpm build && ` +
        `touch ${BUILD_MARKER} && ` +
        `DATABASE_URL=file:${TEST_DB_PATH} node ./scripts/migrate.mjs && ` +
        `DATABASE_URL=file:${TEST_DB_PATH} node ./scripts/seed-test-data.mjs && ` +
        `DATABASE_URL=file:${TEST_DB_PATH} AUTH_MODE=direct AUTH_SECRET=e2e-only-not-secret ENABLE_DEV_ROUTES=1 PLUGINS_DIR=${PLUGINS_DIR} pnpm exec vite preview --host 0.0.0.0 --port ${PORT} --strictPort`,
      port: PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000
    },
    {
      // Waits for the build above (or an already-running reused server),
      // then serves the same build in magic-link mode on its own DB.
      command:
        `until [ -f ${BUILD_MARKER} ] || curl -sf http://localhost:${PORT}/api/health >/dev/null; do sleep 1; done && ` +
        `mkdir -p ./.playwright-data && rm -f ${MAGIC_DB_PATH} && ` +
        `DATABASE_URL=file:${MAGIC_DB_PATH} node ./scripts/migrate.mjs && ` +
        `DATABASE_URL=file:${MAGIC_DB_PATH} node ./scripts/seed-test-data.mjs && ` +
        `DATABASE_URL=file:${MAGIC_DB_PATH} AUTH_MODE=magic-link AUTH_SECRET=e2e-only-not-secret EMAIL_TRANSPORT=memory SMS_TRANSPORT=memory E2E_OUTBOX=1 ` +
        `ORIGIN=http://localhost:${MAGIC_PORT} PLUGINS_DIR=${PLUGINS_DIR} ` +
        `pnpm exec vite preview --host 0.0.0.0 --port ${MAGIC_PORT} --strictPort`,
      port: MAGIC_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000
    }
  ],
  use: {
    baseURL: BASE_URL,
    // Pin DPR so visual baselines are stable across hosts (Retina = 2x).
    deviceScaleFactor: 1,
    // The preview build registers the Workbox SW; keep e2e hitting the
    // server directly so specs never depend on runtime-cache state.
    serviceWorkers: 'block',
    ...(CHROMIUM_PATH ? { launchOptions: { executablePath: CHROMIUM_PATH } } : {})
  },
  // Web fonts are self-hosted, so only anti-aliasing / hinting differs
  // between Linux hosts; 2% absorbs that while still catching layout
  // regressions (baselines are 0-pixel stable run-to-run on one host).
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: process.platform === 'linux' ? 0.02 : 0.01,
      animations: 'disabled',
      caret: 'hide'
    }
  }
});
