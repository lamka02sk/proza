/**
 * Utility parts: page break, table of contents, raw
 * HTML (off by default) and code highlighted as it is typed.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { caret, heading, open, outline, para } from './editor-helpers'

/** Through the plus beside the part with the caret, or the appender under the last part (which has no plus). */
async function add(page: Page, query: string, name: string, end = false): Promise<void> {
  await page.locator(end ? '[data-pz-appender]' : '.gut:not(.is-hover) .plus').click()
  const menu = page.getByRole('dialog', { name: end ? 'Add to the end of your text' : 'Add to your text' })
  await menu.getByRole('combobox', { name: 'Search what to add' }).fill(query)
  await menu.getByRole('option', { name }).click()
}
const tiles = async (page: Page, query: string): Promise<string[]> => {
  await page.locator('[data-pz-appender]').click()
  const menu = page.getByRole('dialog', { name: 'Add to the end of your text' })
  await menu.getByRole('combobox', { name: 'Search what to add' }).fill(query)
  const names = await menu.getByRole('option').allTextContents()
  await page.keyboard.press('Escape')
  return names
}

test('a page break: added from the menu, shown as a dashed line, nothing on screen in the page', async ({ page }) => {
  await open(page, [para('Before', 'a'), para('After', 'b')])
  await caret(page, 'a', 6)
  await add(page, 'page', 'Page break')
  expect(await outline(page)).toEqual(['paragraph: Before', 'page-break', 'paragraph: After'])
  await expect(page.locator('#editor [data-type="core/page-break"]')).toHaveAccessibleName(/Page break/)
  expect(await page.evaluate(() => window.__editor!.editor.getHTML())).toContain('<div class="pz-page-break" aria-hidden="true"></div>')
})

test('TinyMCE page breaks and Word page-break lines come in as page breaks', async ({ page }) => {
  await open(page)
  await page.evaluate(() => { window.__editor!.editor.setContent('<p>One</p><!-- pagebreak --><p>Two</p><br style="page-break-before:always" clear="all"><p>Three</p>') })
  expect(await outline(page)).toEqual(['paragraph: One', 'page-break', 'paragraph: Two', 'page-break', 'paragraph: Three'])
})

test('contents list the headings as they are written, down to the depth chosen', async ({ page }) => {
  await open(page, [para('', 'a'), heading('Start', 2, 'h1'), heading('Detail', 3, 'h2'), heading('Deep', 4, 'h3')])
  await caret(page, 'a', 0)
  await add(page, 'contents', 'Contents')
  const toc = page.locator('#editor [data-type="core/toc"]')
  await expect(toc.locator('.pz-toc-entry')).toHaveText(['Start', 'Detail'])
  // A heading typed now joins the list.
  await caret(page, 'h1', 5)
  await page.keyboard.type(' here')
  await expect(toc.locator('.pz-toc-entry').first()).toHaveText('Start here')
  // Deeper, from the part options.
  await toc.click()
  await page.locator('.gut:not(.is-hover) .cfg').click()
  await page.getByRole('button', { name: 'Heading 4' }).click()
  await expect(toc.locator('.pz-toc-entry')).toHaveText(['Start here', 'Detail', 'Deep'])
  expect(await page.evaluate(() => window.__editor!.editor.getHTML())).toContain('<a href="#start-here">Start here</a>')
  expect((await new AxeBuilder({ page }).include('#editor').analyze()).violations).toEqual([])
})

test('raw HTML is not offered until the host switches it on; then it is edited as text and previewed without scripts', async ({ page }) => {
  await open(page, [para('', 'a')])
  await caret(page, 'a', 0)
  expect(await tiles(page, 'html')).toEqual([])
  await open(page, [para('', 'a')], '?rawhtml')
  await caret(page, 'a', 0)
  await add(page, 'html', 'HTML', true)
  const part = page.locator('#editor [data-type="core/html"]')
  const code = part.getByRole('textbox', { name: 'HTML markup' })
  await code.fill('<p class="x">Own <b>markup</b></p><script>window.ran = true</script>')
  await part.getByRole('button', { name: 'Preview' }).click()
  const frame = part.locator('iframe')
  await expect(frame).toHaveAttribute('sandbox', '')
  await expect(page.frameLocator('#editor iframe').locator('b')).toHaveText('markup')
  expect(await page.evaluate(() => (window as unknown as { ran?: boolean }).ran)).toBeUndefined()
  // Saved as one step; switched on, the page HTML carries it for the server to sanitise.
  expect(await page.evaluate(() => window.__editor!.editor.getHTML())).toContain('<div class="pz-html"><p class="x">Own <b>markup</b></p>')
  await page.evaluate(() => { window.__editor!.editor.undo() })
  expect(await page.evaluate(() => (window.__editor!.json().blocks[0]!.attrs as { html: string }).html)).toBe('')
})

test('code is highlighted as it is typed, without touching the text DOM', async ({ page }) => {
  await open(page, [{ id: 'c', type: 'core/code', attrs: { language: 'js', content: { text: 'const a = 1', formats: [] } } }])
  const painted = (name: string) => page.evaluate((n) => [...(CSS.highlights.get(n) ?? [])].map((r) => (r instanceof Range ? r.toString() : '')), name)
  await expect.poll(() => painted('pz-tok-keyword')).toEqual(['const'])
  await caret(page, 'c', 11)
  await page.keyboard.type(' // done')
  await expect.poll(() => painted('pz-tok-comment')).toEqual(['// done'])
  expect(await page.locator('#editor [data-field="content"] span').count()).toBe(0)
  await expect.poll(() => page.evaluate(() => window.__editor!.editor.getHTML())).toContain('<span class="pz-tok-comment">// done</span>')
})

test('raw HTML from another page\'s clipboard JSON does not come in while the part is off', async ({ page }) => {
  test.skip(test.info().project.name === 'firefox', 'Firefox drops clipboardData on synthetic ClipboardEvents')
  await open(page, [para('Text', 'a')])
  await caret(page, 'a', 4)
  await page.evaluate(() => {
    const data = new DataTransfer()
    data.setData('application/x-proza+json', JSON.stringify({ version: 1, blocks: [
      { type: 'core/html', attrs: { html: '<img src=x onerror=alert(1)>' } },
      { type: 'core/paragraph', attrs: { content: { text: 'Kept', formats: [] } } },
    ] }))
    const field = document.querySelector('#editor')!.shadowRoot!.querySelector<HTMLElement>('[data-block="a"] [data-field]')!
    field.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  // What is left is one paragraph, so it joins the text at the caret.
  await expect.poll(() => outline(page)).toEqual(['paragraph: TextKept'])
})
