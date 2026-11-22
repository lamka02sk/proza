/**
 * Accessibility tree of each screen-reader variant, per engine, as Playwright
 * computes it. Real screen reader behaviour is tested by hand.
 */
import { expect, test } from '@playwright/test'

for (const variant of ['a', 'b', 'c', 'd'] as const) {
  test(`aria snapshot: variant ${variant}`, async ({ page }) => {
    await page.goto(`/spikes/screen-reader/?variant=${variant}`)
    const snapshot = await page.locator('#canvas').ariaSnapshot()
    test.info().annotations.push({ type: 'aria', description: snapshot })
    if (variant === 'a') expect(snapshot).toContain('textbox "Paragraph"')
    if (variant === 'd') expect(snapshot).toContain('group "Paragraph, block 2 of 5"')
  })
}

test('Tab moves through the editor and out of it', async ({ page, browserName }) => {
  await page.goto('/spikes/screen-reader/?variant=a')
  await page.locator('#before').focus()
  const stops: string[] = []
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab')
    stops.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.id ?? ''))
  }
  test.info().annotations.push({ type: 'tab stops', description: stops.join(' > ') })
  // One Tab stop for the canvas, then out (WCAG 2.1.2).
  expect(stops.slice(0, 2)).toEqual(['Paragraph', 'after'])
})
