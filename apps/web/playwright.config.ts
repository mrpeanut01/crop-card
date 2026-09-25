import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 5173);
const BASE_URL = `http://localhost:${PORT}`;
const TEST_DB_PATH =
  PORT === 5173 ? './.playwright-data/test.db' : `./.playwright-data/test-${PORT}.db`;

// Only set when the pinned Playwright's bundled chromium isn't installed
// (e.g. a sandbox with a preinstalled browser). CI never sets it.
const CHROMIUM_PATH = process.env.PW_CHROMIUM_PATH;

// The blocking CI e2e job skips visual specs; the separate non-blocking
// `visual` CI job sets E2E_VISUAL=1. Linux baselines are captured with a
// different chromium build than CI's, so pixel parity isn't guaranteed yet.
const SKIP_VISUAL = !!process.env.CI && !process.env.E2E_VISUAL;

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: SKIP_VISUAL ? ['**/visual/**'] : [],
  webServer: {
    // Build + migrate + start, all pinned to a workspace-local SQLite file
    // so the test runner doesn't need write access to /data.
    // ENABLE_DEV_ROUTES=1 unlocks /_dev/primitives for the visual baseline
    // spec (production never sets this flag — the dev page stays gated).
    command:
      `mkdir -p ./.playwright-data && ` +
      `rm -f ${TEST_DB_PATH} && ` +
      `DATABASE_URL=file:${TEST_DB_PATH} pnpm build && ` +
      `DATABASE_URL=file:${TEST_DB_PATH} node ./scripts/migrate.mjs && ` +
      `DATABASE_URL=file:${TEST_DB_PATH} node ./scripts/seed-test-data.mjs && ` +
      `DATABASE_URL=file:${TEST_DB_PATH} ENABLE_DEV_ROUTES=1 pnpm exec vite preview --host 0.0.0.0 --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000
  },
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
