/**
 * The plugin API: an inline format with its format
 * bar button, a command with its shortcut and help entry, a part options
 * panel, an import rule, strings and an embed provider, from one plugin object.
 */
import { expect, test } from '@playwright/test'
import { MOD, caret, open, para } from './editor-helpers'

test('a plugin format: offered in the format bar, rendered with its class, a menu item of its own', async ({ page }) => {
  await open(page, [para('Proza editor', 'a')], '?plugin')
  await caret(page, 'a', 0, 5)
  await page.locator('#editor .bubble').getByRole('button', { name: 'More formatting' }).click()
  await page.locator('#editor [data-pz-item="smallcaps"]').click()
  expect(await page.evaluate(() => window.__editor!.json().blocks[0]!.attrs.content)).toEqual({ text: 'Proza editor', formats: [{ type: 'smallcaps', start: 0, end: 5 }] })
  expect(await page.evaluate(() => window.__editor!.editor.getHTML())).toBe('<p><span class="pz-smallcaps">Proza</span> editor</p>')
  await expect(page.locator('#editor [data-field] .pz-smallcaps')).toHaveText('Proza')
})

test('a plugin command: its shortcut acts and keyboard help lists it in the language of the interface', async ({ page }) => {
  await open(page, [para('Done ', 'a')], '?plugin')
  await caret(page, 'a', 5)
  await page.keyboard.press(`${MOD}+Shift+9`)
  expect(await page.evaluate(() => window.__editor!.outline())).toEqual(['paragraph: Done — Proza'])
  expect(await page.evaluate(() => window.__editor!.editor.keyboardHelp().flatMap((g) => g.entries.map((e) => e.text)))).toContain('Sign the text')
})

test('a plugin panel in the part options, an import rule, an embed provider', async ({ page }) => {
  await open(page, [para('one two three', 'a'), para('', 'b')], '?plugin')
  await caret(page, 'a', 1)
  await page.locator('.gut:not(.is-hover) .cfg').click()
  await expect(page.locator('[data-demo-panel]')).toHaveText('Words in this part: 3')
  await page.keyboard.press('Escape')
  await page.evaluate(() => { window.__editor!.editor.setContent('<div class="legacy-note">Old note</div>') })
  expect(await page.evaluate(() => window.__editor!.json().blocks[0]!.attrs)).toMatchObject({ content: { text: 'Old note' }, variant: 'note' })
  // The provider's player address passes the frame allow-list, in the editor and in the output.
  await page.evaluate(() => { window.__editor!.editor.setContent({ version: 1, blocks: [{ type: 'core/embed', attrs: { url: 'https://video.example.com/watch/42', title: 'Demo' } }] }) })
  expect(await page.evaluate(() => window.__editor!.editor.getHTML())).toContain('src="https://player.example.com/v/42"')
})

test('a plugin checker rule: counted, listed under its own group in its words, its text marked', async ({ page }) => {
  await open(page, [para('Write the intro TODO', 'p')], '?plugin')
  await page.locator('#editor [data-pz-check]').click()
  const panel = page.locator('#editor .ck')
  await expect(panel.locator('.ck-group-name')).toHaveText(['House rules'])
  await expect(panel.getByRole('option')).toHaveText(/A note left for later/)
  expect(await page.evaluate(() => [...(CSS.highlights.get('pz-check-current') ?? [])].map((r) => (r instanceof Range ? r.toString() : '')))).toEqual(['TODO'])
  expect(await page.evaluate(() => window.__editor!.editor.validate().map((i) => i.message))).toEqual(['A note left for later'])
})

test('a plugin block written against the public API: inserted, typed into, rendered, read back from its HTML', async ({ page }) => {
  await open(page, [para('', 'a')], '?plugin')
  await caret(page, 'a', 0)
  await page.keyboard.type('/callout')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Mind the step')
  const json = await page.evaluate(() => window.__editor!.json().blocks)
  expect(json[0]).toMatchObject({ type: 'demo/callout', attrs: { tone: 'info', content: { text: 'Mind the step' } } })
  const html = await page.evaluate(() => window.__editor!.editor.getHTML())
  expect(html).toBe('<aside class="demo-callout demo-callout-info">Mind the step</aside>')
  await page.evaluate((h) => { window.__editor!.editor.setContent(h) }, html)
  expect(await page.evaluate(() => window.__editor!.json().blocks[0])).toMatchObject({ type: 'demo/callout', attrs: { content: { text: 'Mind the step' } } })
})
