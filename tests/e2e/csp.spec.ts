/**
 * The editor needs neither `unsafe-inline` nor `unsafe-eval`:
 * a page with a strict policy (playground/csp) records every violation while
 * the author types, formats, opens the menus, dialogs and the published page.
 */
import { expect, test } from '@playwright/test'

test('a strict Content Security Policy is never violated', async ({ page }) => {
  await page.goto('/csp/')
  await page.waitForFunction(() => window.__cspEditor !== undefined)
  const root = page.locator('#editor')
  // Typing, a format from the bubble, the inserter, the part options, the More menu with its dialogs.
  await root.locator('[data-block="e"] [data-field]').click()
  await page.keyboard.type('Typed text')
  await page.keyboard.press('Shift+Home')
  await root.locator('.bubble').getByRole('button', { name: /^Bold/ }).click()
  await page.keyboard.press('End')
  await root.getByRole('button', { name: 'Add something' }).first().click()
  await expect(root.getByRole('option', { name: 'Picture' })).toBeVisible()
  await page.keyboard.press('Escape')
  await root.locator('.gut:not(.is-hover) .cfg').click()
  await page.keyboard.press('Escape')
  for (const tool of ['characters', 'counts', 'page']) {
    await root.locator('[data-pz-more]').click()
    await root.locator(`[data-pz-tool="${tool}"]`).click()
    await expect(root.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
  }
  await root.getByRole('button', { name: /^Accessibility check/ }).click()
  await page.keyboard.press('Escape')
  // Fonts and the highlighter load on use: give them a moment to arrive.
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => window.__csp)).toEqual([])
  // The control: the page does see a violation when there is one.
  await page.evaluate(() => { const d = document.createElement('div'); d.innerHTML = '<span style="color:red">x</span>'; document.body.append(d) })
  await expect.poll(() => page.evaluate(() => window.__csp.length)).toBe(1)
  expect(await page.evaluate(() => window.__cspEditor!.editor.getJSON().blocks.at(-1)!.attrs.content)).toEqual({ text: 'Typed text', formats: [{ type: 'bold', start: 0, end: 10 }] })
})
