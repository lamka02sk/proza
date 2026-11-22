/**
 * Touch: on a coarse pointer the format bar docks
 * above the on-screen keyboard, in the top layer, with part settings and Add.
 * The keyboard itself cannot be emulated: it is checked by hand on devices.
 */
import { expect, test } from '@playwright/test'
import { caret, open, para } from './editor-helpers'

test.use({ hasTouch: true, viewport: { width: 390, height: 700 } })

test('a coarse pointer gets the bar at the bottom, in the top layer, while a field has the caret', async ({ page, browserName }) => {
  test.skip(browserName === 'firefox', 'Firefox reports (pointer: fine) with touch emulation')
  await open(page, [para('one two', 'a'), para('three', 'b')])
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
  const bar = page.locator('.fmt-touch')
  await expect(bar).toBeHidden()
  await caret(page, 'a', 1)
  await expect(bar).toBeVisible()
  expect(await bar.evaluate((el) => el.matches(':popover-open'))).toBe(true)
  const box = (await bar.boundingBox())!
  expect(box.y + box.height).toBeGreaterThan(700 - 20)
  // No bubble on touch; the bar formats at the caret, and opens part settings and Add.
  await caret(page, 'a', 0, 3)
  await expect(page.locator('.fmt-bubble')).toHaveCount(0)
  await bar.getByRole('button', { name: 'Bold' }).tap()
  expect(await page.evaluate(() => window.__editor!.json().blocks[0]!.attrs.content)).toEqual({ text: 'one two', formats: [{ type: 'bold', start: 0, end: 3 }] })
  await bar.getByRole('button', { name: 'Add something below' }).tap()
  await expect(page.getByRole('dialog', { name: 'Add to your text' })).toBeVisible()
})
