import { expect, test } from '@playwright/test'

test('import properties hold in this engine', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/harness/import/')
  await page.waitForFunction(() => window.__import !== undefined)
  const failures = await page.evaluate(() => window.__import!.properties(500))
  expect(failures).toEqual([])
})

test('large and hostile HTML stays cheap and never throws', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/harness/import/')
  await page.waitForFunction(() => window.__import !== undefined)
  const result = await page.evaluate(() => {
    const timed = (html: string): { ms: number; blocks: number; error: string } => {
      const t = performance.now()
      try {
        const r = window.__import!.run(html, {})
        return { ms: performance.now() - t, blocks: (r.blocks as readonly unknown[]).length, error: '' }
      } catch (e) {
        return { ms: performance.now() - t, blocks: 0, error: String(e) }
      }
    }
    // One class rule repeated 400 times over 1,000 elements: each element is styled once, not 400 times.
    const rules = timed(`<style>${'.a{color:#123456;font-weight:700}'.repeat(400)}</style>${'<p><span class="a">x</span></p>'.repeat(1000)}`)
    // More paragraphs in one element than an argument list may hold (Chromium).
    const wide = timed(`<b id="docs-internal-guid-1">${'<p>a</p>'.repeat(130_000)}</b>`)
    return { rules, wide }
  })
  expect(result.rules.error).toBe('')
  expect(result.rules.ms).toBeLessThan(3000)
  expect(result.wide.error).toBe('')
  expect(result.wide.blocks).toBeGreaterThan(100_000)
})
