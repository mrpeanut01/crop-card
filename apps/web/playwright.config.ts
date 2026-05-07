import { defineConfig } from '@playwright/test';

const TEST_DB_PATH = './.playwright-data/test.db';

export default defineConfig({
  testDir: './tests/e2e',
  webServer: {
    // Build + migrate + start, all pinned to a workspace-local SQLite file
    // so the test runner doesn't need write access to /data.
    command:
      `mkdir -p ./.playwright-data && ` +
      `DATABASE_URL=file:${TEST_DB_PATH} pnpm build && ` +
      `DATABASE_URL=file:${TEST_DB_PATH} node ./scripts/migrate.mjs && ` +
      `DATABASE_URL=file:${TEST_DB_PATH} pnpm preview`,
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000
  },
  use: {
    baseURL: 'http://localhost:5173'
  }
});
