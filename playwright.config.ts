import { defineConfig, devices } from '@playwright/test'

// E2E smoke tests for the snapping experience.
// Vitest covers the algorithm; Playwright covers the click-to-snap UI flow:
// "open a fixture, enter Add Text mode, click — does a text annotation
// actually land on a snapped form cell?". Without these, scale conversion or
// hover-positioning regressions can ship with a green vitest run.
//
// Run: npm run test:e2e
// Run with UI: npm run test:e2e -- --ui

export default defineConfig({
  testDir: './tests',
  // The vite dev server is fast on warm starts but needs a moment cold.
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    // Headless chromium only — keeps the install footprint small.
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
