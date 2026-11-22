/**
 * The block library beyond media: checklists, size and colour presets,
 * presets that limit what the interface offers, and the link field's search
 * (`links`).
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { MOD, announcements, caret, item, list, open, para } from './editor-helpers'

const options = (page: Page) => page.getByRole('dialog', { name: /^Options for this part/ })
const json = (page: Page) => page.evaluate(() => window.__editor!.json())

test('a checklist: `[ ] ` starts one, the box and Mod+Enter tick an item, with an announcement', async ({ page }) => {
  await open(page, [para('', 'a')])
  await caret(page, 'a', 0)
  await page.keyboard.type('[ ] Bread')
  const box = page.locator('.pz-canvas li input.pz-check')
  await expect(box).toHaveAccessibleName('Done: Bread')
  await expect(box).toHaveAttribute('tabindex', '-1')
  await box.click()
  expect((await json(page)).blocks[0]!.children![0]!.attrs.checked).toBe(true)
  expect((await announcements(page)).at(-1)).toBe('Ticked')
  await page.locator('.pz-canvas li [data-field]').click()
  await page.keyboard.press(`${MOD}+Enter`)
  expect((await json(page)).blocks[0]!.children![0]!.attrs.checked).toBe(false)
  expect((await announcements(page)).at(-1)).toBe('Not ticked')
  expect(await page.evaluate(() => window.__editor!.editor.getHTML())).toBe('<ul class="pz-checklist"><li><label><input type="checkbox" disabled> Bread</label></li></ul>')
})

test('a list becomes a checklist in its options', async ({ page }) => {
  await open(page, [list([item('One', 'i')], 'bullet', 'l')])
  await caret(page, 'i', 0)
  await page.locator('.gut:not(.is-hover) .cfg').click()
  await options(page).getByRole('group', { name: 'Style' }).getByRole('button', { name: 'Checklist' }).click()
  await expect(page.locator('.pz-canvas li input.pz-check')).toBeVisible()
})

test('size and colour are named presets; the canvas shows them as the page will', async ({ page }) => {
  await open(page, [para('Hello', 'a')])
  await caret(page, 'a', 1)
  await page.locator('.gut:not(.is-hover) .cfg').click()
  await options(page).getByRole('group', { name: 'Size' }).getByRole('button', { name: 'Large' }).click()
  await options(page).getByRole('button', { name: 'Blue' }).click()
  await expect(options(page).getByRole('button', { name: 'Blue' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-block="a"]')).toHaveClass(/pz-size-l/)
  await expect(page.locator('[data-block="a"]')).toHaveClass(/pz-color-blue/)
  expect(await page.evaluate(() => window.__editor!.editor.getHTML())).toBe('<p class="pz-size-l pz-color-blue">Hello</p>')
  await options(page).getByRole('button', { name: 'Default colour' }).click()
  await page.keyboard.press('Escape')
  await page.evaluate(() => { window.__editor!.editor.undo() })
  expect((await json(page)).blocks[0]!.attrs.color).toBe('blue')
})

test('the basic preset offers text, headings, lists and pictures only', async ({ page }) => {
  await open(page, [para('', 'a')], '?preset=basic')
  await caret(page, 'a', 0)
  await page.getByRole('button', { name: 'Add something' }).click()
  const tiles = page.getByRole('listbox', { name: 'Add to your text' }).getByRole('option')
  // The host's ready-made layouts stay: the host chose them.
  await expect(tiles).toHaveText(['Text', 'Heading', 'List', 'Numbered list', 'Picture', 'Question and answer'])
  await page.keyboard.press('Escape')
  // Typing what would make a quote stays text.
  await caret(page, 'a', 0)
  await page.keyboard.type('> Not a quote')
  expect(await page.evaluate(() => window.__editor!.outline())).toEqual(['paragraph: > Not a quote'])
  // The format bar offers only bold, italic and link.
  await caret(page, 'a', 2, 5)
  await page.getByRole('button', { name: 'More formatting' }).click()
  await expect(page.getByRole('menuitem', { name: /Underline/ })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'Clear formatting' })).toBeVisible()
})

test('the link field searches the host’s pages and the parts with an anchor', async ({ page }) => {
  await open(page, [para('See prices', 'a'), { id: 'h', type: 'core/heading', attrs: { level: 2, anchor: 'hours', content: { text: 'Opening hours', formats: [] } } }])
  await caret(page, 'a', 4, 10)
  await page.keyboard.press(`${MOD}+k`)
  const input = page.getByRole('combobox', { name: 'Web address the words should lead to' })
  await input.fill('pri')
  const results = page.getByRole('listbox', { name: 'Pages and parts to link to' })
  await expect(results.getByRole('option')).toHaveText(['PricesPage · /prices', 'Spring opening hoursArticle · /blog/spring-hours'])
  expect(await announcements(page)).toContain('2 pages found')
  await input.press('ArrowDown')
  await expect(input).toHaveAttribute('aria-activedescendant', 'pz-link-opt-0')
  await input.press('Enter')
  const link = (await json(page)).blocks[0]!.attrs.content as { formats: { type: string; attrs: Record<string, string> }[] }
  expect(link.formats).toEqual([{ type: 'link', start: 4, end: 10, attrs: { href: '/prices' } }])

  // An anchor of this text, opened in a new window.
  await caret(page, 'a', 0, 3)
  await page.keyboard.press(`${MOD}+k`)
  await input.fill('hours')
  await expect(results.getByRole('option').first()).toContainText('Heading 2: Opening hours')
  await page.getByRole('button', { name: 'Open in a new window' }).click()
  await results.getByRole('option').first().click()
  const again = (await json(page)).blocks[0]!.attrs.content as { formats: { attrs: Record<string, string> }[] }
  expect(again.formats[0]!.attrs).toEqual({ href: '#hours', target: '_blank' })
})

test.describe('accessibility', () => {
  test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: 'reduce' }) })
  const axe = async (page: Page): Promise<void> => {
    const result = await new AxeBuilder({ page }).include('#editor').analyze()
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  }

  test('axe: empty media parts, a picture with its prompt and options, embed form, link search', async ({ page }) => {
    await open(page, [
      para('Intro', 'a'),
      { id: 'img', type: 'core/image', attrs: { src: '/png/favicon-48.png' } },
      { id: 'e', type: 'core/image', attrs: {} },
      { id: 'v', type: 'core/video', attrs: {} },
      { id: 'm', type: 'core/embed', attrs: {} },
      { id: 'f', type: 'core/file', attrs: { href: '/a.pdf', bytes: 1000 } },
      { id: 'g', type: 'core/gallery', attrs: {}, children: [{ id: 'g1', type: 'core/image', attrs: { src: '/png/favicon-48.png', alt: 'Mark' } }] },
      list([item('Task', 'ci')], 'check', 'cl'),
    ])
    await axe(page)
    await page.locator('[data-block="img"] img').click()
    await page.locator('.gut:not(.is-hover) .cfg').click()
    await axe(page)
    await page.keyboard.press('Escape')
    await caret(page, 'a', 0, 5)
    await page.keyboard.press(`${MOD}+k`)
    await page.getByRole('combobox', { name: 'Web address the words should lead to' }).fill('a')
    await expect(page.getByRole('listbox', { name: 'Pages and parts to link to' }).getByRole('option').first()).toBeVisible()
    await axe(page)
  })

  test('axe: Slovak, dark', async ({ page }) => {
    await open(page, [{ id: 'e', type: 'core/image', attrs: {} }, { id: 'img', type: 'core/image', attrs: { src: '/png/favicon-48.png' } }], '?locale=sk&theme=dark')
    await expect(page.locator('[data-block="e"]').getByRole('button', { name: 'Vybrať obrázok' })).toBeVisible()
    await axe(page)
  })
})
