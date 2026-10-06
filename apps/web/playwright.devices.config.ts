import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

/**
 * Cross-engine device sweep (#572), run by hand, not in CI. It drives an
 * already running hermetic preview server (the same build, migrate, seed and
 * env as the main e2e server in playwright.config.ts) on E2E_PORT (default
 * 5390), and the offline spec also needs `node tests/device/signal-proxy.mjs`
 * (port 5393 in front of 5390, control port 5394). Results and how to read
 * them: docs/research/phase-33-device-results.md.
 *
 *   pnpm exec playwright install webkit firefox
 *   pnpm exec playwright test -c playwright.devices.config.ts device/
 *   pnpm exec playwright test -c playwright.devices.config.ts device/offline.spec.ts --workers=1
 *
 * The demo farm allows six starts per IP in ten minutes, so run the print and
 * tap-target specs a few projects at a time. HEIC decoding depends on the
 * host: WebKit decodes it on macOS only.
 */
export default defineConfig({
  ...base,
  webServer: undefined,
  testDir: './tests',
  testMatch: ['device/**/*.spec.ts', 'e2e/*.spec.ts'],
  retries: 0,
  workers: 3,
  use: { ...base.use, baseURL: `http://localhost:${process.env.E2E_PORT ?? 5390}` },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], deviceScaleFactor: 1 } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], deviceScaleFactor: 1 } },
    { name: 'iphone', use: { ...devices['iPhone 15'] } },
    { name: 'pixel', use: { ...devices['Pixel 7'] } }
  ]
});
