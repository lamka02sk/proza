import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  // CI measures the 2,000-part budget in a job of its own, with one worker.
  ...(process.env.PZ_SKIP_PERF ? { testIgnore: ['**/editor-performance.spec.ts'] } : {}),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:5199' },
  webServer: {
    command: 'pnpm exec vite --logLevel warn',
    url: 'http://localhost:5199',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})
