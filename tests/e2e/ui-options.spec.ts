/**
 * Part options, the inspector: Show as, heading
 * level with the outline warning (ATAG B.2), list settings, alignment, the
 * rare settings behind More, moving, duplicating and removing.
 */
import { expect, test } from '@playwright/test'
import { announcements, caret, expectCanonical, heading, item, list, open, outline, para, selection } from './editor-helpers'

const options = (page: import('@playwright/test').Page) => page.getByRole('dialog', { name: /^Options for this part/ })

test('the settings button opens the options for the part; Escape closes them and returns focus to it', async ({ page }) => {
  await open(page, [para('one', 'a'), para('two', 'b')])
  await caret(page, 'b', 1)
  const cfg = page.locator('.gut:not(.is-hover) .cfg')
  await expect(cfg).toHaveAccessibleName('Settings for this part')
  await cfg.click()
  await expect(options(page)).toBeVisible()
  await expect(options(page)).toHaveAccessibleName('Options for this part: Text: two')
  await expect(cfg).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(options(page)).toBeHidden()
  await expect(cfg).toBeFocused()
})

test('the stems open the same options', async ({ page }) => {
  await open(page, [para('one', 'a')])
  await caret(page, 'a', 1)
  await page.locator('.gut:not(.is-hover) .legs').click()
  await expect(options(page)).toBeVisible()
})

test('settings for a hovered part activate it and stay anchored to its settings button', async ({ page }) => {
  await open(page, [para('one', 'a'), para('two', 'b')])
  await caret(page, 'a', 1)
  await page.locator('[data-block="b"] [data-field]').hover()
  await page.locator('.gut.is-hover [data-pz-cfg="b"]').click()
  const cfg = page.locator('.stems + .gut [data-pz-cfg="b"]')
  const dialog = options(page)
  await expect(cfg).toBeVisible()
  await expect(dialog).toHaveAccessibleName('Options for this part: Text: two')
  await expect.poll(async () => {
    const button = await cfg.boundingBox()
    const popover = await dialog.boundingBox()
    return button && popover ? Math.abs(popover.x - button.x) : Infinity
  }).toBeLessThan(2)
  await page.keyboard.press('Escape')
  await expect(cfg).toBeFocused()
})

test('Show as changes the part, announces it, and undo brings it back', async ({ page }) => {
  await open(page, [para('one', 'a'), para('two', 'b')])
  await caret(page, 'a', 1)
  await page.locator('.gut:not(.is-hover) .cfg').click()
  const show = options(page).getByRole('group', { name: 'Show as' })
  await expect(show.getByRole('button', { name: 'Text' })).toHaveAttribute('aria-pressed', 'true')
  await show.getByRole('button', { name: 'Heading' }).click()
  expect(await outline(page)).toEqual(['heading2: one', 'paragraph: two'])
  expect((await announcements(page)).at(-1)).toBe('Changed to Heading 2')
  await show.getByRole('button', { name: 'Quote' }).click()
  expect(await outline(page)).toEqual(['quote', '  heading2: one', 'paragraph: two'])
  await page.keyboard.press('Escape')
  await page.evaluate(() => { window.__editor!.editor.undo(); window.__editor!.editor.undo() })
  expect(await outline(page)).toEqual(['paragraph: one', 'paragraph: two'])
  await expectCanonical(page)
})

test('a list shows as paragraphs, every item kept in order', async ({ page }) => {
  await open(page, [list([item('one', 'i1', [list([item('deep', 'i2')], 'bullet', 'l2')]), item('two', 'i3')], 'bullet', 'l')])
  await caret(page, 'i1', 1)
  await page.locator('.gut:not(.is-hover) .cfg').click()
  await expect(options(page).getByRole('group', { name: 'Show as' }).getByRole('button', { name: 'Heading' })).toBeDisabled()
  await options(page).getByRole('group', { name: 'Show as' }).getByRole('button', { name: 'Text' }).click()
  expect(await outline(page)).toEqual(['paragraph: one', 'paragraph: deep', 'paragraph: two'])
  expect(await selection(page)).toMatchObject({ kind: 'text', blockId: 'i1', anchor: 1 })
})

test('heading level: the outline note, and a warning on a level that skips one', async ({ page }) => {
  await open(page, [heading('Top', 2, 'h1'), para('text', 'p'), heading('Next', 3, 'h2')])
  await caret(page, 'h2', 1)
  await page.locator('.gut:not(.is-hover) .cfg').click()
  const dlg = options(page)
  await expect(dlg.getByText('The heading before is level 2: “Top”.')).toBeVisible()
  const levels = dlg.getByRole('group', { name: 'Level' })
  await expect(levels.getByRole('button', { name: '4' })).toHaveAccessibleDescription('Skips a level')
  await expect(levels.getByRole('button', { name: '3' })).not.toHaveAccessibleDescription('Skips a level')
  await levels.getByRole('button', { name: '5' }).click()
  expect(await outline(page)).toEqual(['heading2: Top', 'paragraph: text', 'heading5: Next'])
  await expect(dlg.getByText(/Level 5 skips a level after 2/)).toBeVisible()
})

test('list settings: style, numbering, start and counting down', async ({ page }) => {
  await open(page, [list([item('one', 'i1')], 'bullet', 'l')])
  await caret(page, 'i1', 1)
  await page.locator('.gut:not(.is-hover) .cfg').click()
  const dlg = options(page)
  await dlg.getByRole('group', { name: 'Style' }).getByRole('button', { name: 'Numbers' }).click()
  await dlg.getByLabel('Numbering').selectOption('a')
  await dlg.getByLabel('Start at').fill('3')
  await dlg.getByLabel('Start at').press('Enter')
  await dlg.getByLabel('Count down').check()
  const attrs = await page.evaluate(() => window.__editor!.json().blocks[0]!.attrs)
  expect(attrs).toMatchObject({ style: 'number', numbering: 'a', start: 3, reversed: true })
  expect(await page.evaluate(() => window.__editor!.editor.getHTML())).toBe('<ol start="3" reversed type="a"><li>one</li></ol>')
})

test('align and the rare settings behind More, with validation', async ({ page }) => {
  await open(page, [para('one', 'a')])
  await caret(page, 'a', 1)
  await page.locator('.gut:not(.is-hover) .cfg').click()
  const dlg = options(page)
  await dlg.getByRole('group', { name: 'Align' }).getByRole('button', { name: 'Centre' }).click()
  const more = dlg.getByRole('button', { name: 'More' })
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await more.click()
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  const anchor = dlg.getByLabel('Link name (anchor)')
  await anchor.fill('1 bad')
  await anchor.press('Enter')
  await expect(anchor).toHaveAttribute('aria-invalid', 'true')
  await expect(anchor).toHaveAccessibleDescription(/Start with a letter/)
  await anchor.fill('prices')
  await anchor.press('Enter')
  await dlg.getByLabel('Language of this part').fill('de')
  await dlg.getByLabel('Language of this part').press('Enter')
  await dlg.getByRole('group', { name: 'Writing direction' }).getByRole('button', { name: 'Right to left' }).click()
  expect(await page.evaluate(() => window.__editor!.json().blocks[0]!.attrs)).toMatchObject({ textAlign: 'center', anchor: 'prices', lang: 'de', dir: 'rtl' })
  // The field remounts with the new language and direction.
  await expect(page.locator('[data-block="a"] [data-field]')).toHaveAttribute('lang', 'de')
})

test('move up and down, duplicate and remove from the options', async ({ page }) => {
  await open(page, [para('one', 'a'), para('two', 'b'), para('three', 'c')])
  await caret(page, 'b', 1)
  await page.locator('.gut:not(.is-hover) .cfg').click()
  const dlg = options(page)
  await dlg.getByRole('button', { name: 'Move up' }).click()
  expect(await outline(page)).toEqual(['paragraph: two', 'paragraph: one', 'paragraph: three'])
  await expect(dlg.getByRole('button', { name: 'Move up' })).toBeDisabled()
  expect((await announcements(page)).at(-1)).toBe('Moved to position 1 of 3')
  await dlg.getByRole('button', { name: 'Move down' }).click()
  await dlg.getByRole('button', { name: 'Duplicate' }).click()
  expect(await outline(page)).toEqual(['paragraph: one', 'paragraph: two', 'paragraph: two', 'paragraph: three'])
  await expect(dlg).toBeHidden()
  await page.locator('.gut:not(.is-hover) .cfg').click()
  await options(page).getByRole('button', { name: 'Remove' }).click()
  expect(await outline(page)).toEqual(['paragraph: one', 'paragraph: two', 'paragraph: three'])
  // Focus is never lost: the caret is in the text next to the removed part.
  expect(await selection(page)).toMatchObject({ kind: 'text', blockId: 'b' })
})
