import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { validateClipboardFixture } from '../fixtures/clipboard-fixture'

test.skip(({ browserName }) => browserName === 'firefox', 'Firefox drops clipboardData on synthetic paste events')

test('a paste becomes a valid fixture file', async ({ page }) => {
  await page.goto('/tools/clipboard-capture/')
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.setData('text/html', '<p class="MsoNormal">Hello <b>world</b><o:p></o:p></p>')
    dt.setData('text/plain', 'Hello world')
    document.querySelector('#zone')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  await expect(page.locator('#types')).toContainText('text/html')
  await page.locator('#description').fill('one paragraph with a bold word')
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()])
  expect(download.suggestedFilename()).toMatch(/^word-desktop--.+\.json$/)
  const fixture: unknown = JSON.parse(readFileSync(await download.path(), 'utf8'))
  expect(validateClipboardFixture(fixture)).toEqual([])
})
