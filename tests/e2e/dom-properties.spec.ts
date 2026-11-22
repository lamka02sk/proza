import { expect, test } from '@playwright/test'

test('DOM mapping properties hold in this engine', async ({ page }) => {
  await page.goto('/harness/')
  await page.waitForFunction(() => window.__harness !== undefined)
  const failures = await page.evaluate(() => window.__harness!.check(300))
  expect(failures).toEqual([])
})
