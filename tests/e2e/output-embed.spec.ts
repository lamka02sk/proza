/**
 * Embeds in published output: the facade keeps the
 * provider's player from loading until the visitor opens it.
 */
import { expect, test } from '@playwright/test'

test('a facade embed requests nothing from the provider until it is opened', async ({ page }) => {
  const hits: string[] = []
  await page.route('https://www.youtube-nocookie.com/**', async (route) => { hits.push(route.request().url()); await route.fulfill({ body: '<!doctype html><title>player</title>', contentType: 'text/html' }) })
  await page.goto('/editor/')
  await page.waitForFunction(() => window.__editor !== undefined)
  const html = await page.evaluate(() => {
    const ed = window.__editor!.editor
    ed.setContent({ version: 1, blocks: [{ id: 'e', type: 'core/embed', attrs: { url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Song', facade: true } }] })
    return ed.getHTML()
  })
  await page.setContent(`<!doctype html><main style="width:640px">${html}</main>`)
  await page.waitForTimeout(1500)
  expect(hits).toEqual([])
  await page.getByText('Play “Song” from YouTube').click()
  await expect.poll(() => hits.length).toBeGreaterThan(0)
})
