import { defineConfig } from '@playwright/test';

const TEST_DB_PATH = './.playwright-data/test.db';

export default defineConfig({
  testDir: './tests/e2e',
  webServer: {
    // Build + migrate + start, all pinned to a workspace-local SQLite file
    // so the test runner doesn't need write access to /data.
    // ENABLE_DEV_ROUTES=1 unlocks /_dev/primitives for the visual baseline
    // spec (production never sets this flag — the dev page stays gated).
    command:
      `mkdir -p ./.playwright-data && ` +
      `DATABASE_URL=file:${TEST_DB_PATH} pnpm build && ` +
      `DATABASE_URL=file:${TEST_DB_PATH} node ./scripts/migrate.mjs && ` +
      `DATABASE_URL=file:${TEST_DB_PATH} ENABLE_DEV_ROUTES=1 pnpm preview`,
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000
  },
  use: {
    baseURL: 'http://localhost:5173'
  },
  // Visual specs use 0.5% pixelmatch tolerance to absorb font-rendering
  // jitter between local + CI (system fonts render fractionally
  // differently). Bump if false positives become a problem.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.005
    }
  }
});
