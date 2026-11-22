/**
 * Media blocks: pictures uploaded
 * through the host's adapter or added by address, the description prompt
 * (ATAG B.2.3), galleries, video captions, embeds from the allow-list, files.
 * The playground's adapter stores uploads in the dev server (vite.config.ts).
 */
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { announcements, caret, open, para } from './editor-helpers'

const PICTURE = join(import.meta.dirname, '../fixtures/media/picture.png')
const options = (page: Page) => page.getByRole('dialog', { name: /^Options for this part/ })
const json = (page: Page) => page.evaluate(() => window.__editor!.json())
const attrs = async (page: Page, id: string): Promise<Record<string, unknown>> => {
  const find = (blocks: { id: string; attrs: Record<string, unknown>; children?: unknown[] }[]): Record<string, unknown> | undefined => {
    for (const b of blocks) {
      if (b.id === id) return b.attrs
      const inner = b.children ? find(b.children as typeof blocks) : undefined
      if (inner) return inner
    }
    return undefined
  }
  return find((await json(page)).blocks as never) ?? {}
}
const block = (type: string, id: string, a: Record<string, unknown> = {}, children?: unknown[]) => ({ id, type, attrs: a, ...(children ? { children } : {}) })

test('a picture from the add menu: choose a file, it uploads, and the part asks for a description', async ({ page }) => {
  await open(page, [para('Intro', 'a')])
  await caret(page, 'a', 5)
  await page.getByRole('button', { name: 'Add something' }).click()
  await page.getByRole('option', { name: 'Picture' }).click()
  const pic = page.locator('.pz-canvas [data-type="core/image"]')
  await expect(pic).toHaveAttribute('role', 'group')
  await expect(pic).toHaveAccessibleName('Picture: no description yet')
  await pic.locator('input[type=file]').setInputFiles(PICTURE)
  await expect(pic.locator('img.pz-img')).toBeVisible()
  const id = await pic.getAttribute('data-block')
  const a = await attrs(page, id!)
  expect(a.src).toMatch(/^\/__upload\//)
  // The editor measured the picture: width and height go into the output (no layout shift).
  expect([a.naturalWidth, a.naturalHeight]).toEqual([640, 400])
  expect(a.alt).toBe('')
  expect(await announcements(page)).toEqual(expect.arrayContaining(['Uploading picture.png', 'picture.png uploaded']))

  // The prompt opens the options at the description; the file name is never used.
  await pic.getByRole('button', { name: 'Add a description' }).click()
  const description = options(page).getByRole('textbox', { name: /^Description, read aloud/ })
  await description.fill('An orange card with a dark square')
  await description.press('Enter')
  expect((await attrs(page, id!)).alt).toBe('An orange card with a dark square')
  await page.keyboard.press('Escape')
  await expect(pic.getByRole('button', { name: 'Add a description' })).toHaveCount(0)
  await expect(pic).toHaveAccessibleName('Picture: An orange card with a dark square')
  expect(await page.evaluate(() => window.__editor!.editor.getHTML())).toContain('alt="An orange card with a dark square" width="640" height="400" loading="lazy"')

  // Undo takes back the description, then the upload, then the part.
  await page.evaluate(() => { window.__editor!.editor.undo() })
  expect((await attrs(page, id!)).alt).toBe('')
  await page.evaluate(() => { window.__editor!.editor.undo() })
  expect((await attrs(page, id!)).src).toBe('')
})

test('clicking the file chooser button makes its picture the active part', async ({ page }) => {
  await open(page, [para('Intro', 'a'), block('core/image', 'p')])
  await caret(page, 'a', 1)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Choose a picture' }).click()
  await chooser
  await expect(page.locator('.stems + .gut [data-pz-legs="p"]')).toBeVisible()
})

test('width, alignment, decorative and caption', async ({ page }) => {
  await open(page, [para('Intro', 'a'), block('core/image', 'p', { src: '/png/favicon-48.png', alt: 'Logo' })])
  await page.locator('[data-block="p"] img').click()
  await page.locator('.gut:not(.is-hover) .cfg').click()
  await options(page).getByRole('group', { name: 'Picture width' }).getByRole('button', { name: 'Small' }).click()
  await options(page).getByRole('group', { name: 'Align' }).getByRole('button', { name: 'Centre' }).click()
  await expect(page.locator('[data-block="p"]')).toHaveClass(/pz-width-s/)
  await expect(page.locator('[data-block="p"]')).toHaveClass(/pz-align-center/)
  await options(page).getByRole('checkbox', { name: /^Decorative/ }).check()
  await expect(options(page).getByRole('textbox', { name: /^Description/ })).toBeDisabled()
  expect(await attrs(page, 'p')).toMatchObject({ width: 's', align: 'center', decorative: true, alt: 'Logo' })
  expect(await page.evaluate(() => window.__editor!.editor.getHTML())).toContain('<figure class="pz-image pz-width-s pz-align-center"><img src="/png/favicon-48.png" alt=""')
  await page.keyboard.press('Escape')

  // Enter on the selected picture goes to its caption; Enter at the caption's end starts text after it.
  await page.locator('[data-block="p"] img').click()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-block="p"] [data-field="caption"]')).toBeFocused()
  await page.keyboard.type('Our mark')
  await page.keyboard.press('Enter')
  await page.keyboard.type('After')
  expect(await page.evaluate(() => window.__editor!.outline())).toEqual(['paragraph: Intro', 'image: Our mark', 'paragraph: After'])
})

test('typing on a selected picture adds text after it and never replaces it', async ({ page }) => {
  await open(page, [block('core/image', 'p', { src: '/png/favicon-48.png', alt: 'Logo', caption: { text: 'Cap', formats: [] } })])
  await page.locator('[data-block="p"] img').click()
  await page.keyboard.type('Hi')
  expect(await page.evaluate(() => window.__editor!.outline())).toEqual(['image: Cap', 'paragraph: Hi'])
})

test('without an upload adapter a picture comes from a web address; a bad address is refused', async ({ page }) => {
  await open(page, [para('Intro', 'a'), block('core/image', 'p')], '?upload=off')
  const intro = page.locator('[data-block="a"] [data-field]')
  const position = { x: 1, y: 8 }
  await intro.click({ position })
  const pic = page.locator('[data-block="p"]')
  await expect(pic.getByRole('button', { name: 'Choose a picture' })).toHaveCount(0)
  const address = pic.getByRole('textbox', { name: 'Web address of the picture' })
  await address.click()
  await expect(address).toBeFocused()
  await expect(page.locator('.stems + .gut [data-pz-legs="p"]')).toBeVisible()
  await intro.click({ position })
  await expect(page.locator('.stems + .gut [data-pz-legs="a"]')).toBeVisible()
  await address.fill('javascript:alert(1)')
  await address.press('Enter')
  await expect(pic.getByText('Use a web address that starts with https:// or /.')).toBeVisible()
  await address.fill('/png/favicon-48.png')
  await address.press('Enter')
  await expect(pic.locator('img.pz-img')).toBeVisible()
  expect((await attrs(page, 'p')).src).toBe('/png/favicon-48.png')
})

test('a picture by address still measuring when new content comes never lands in it', async ({ page }) => {
  let served = false
  await page.route('**/slow-picture.png', async (route) => {
    await new Promise((r) => setTimeout(r, 800))
    await route.fulfill({ path: PICTURE, contentType: 'image/png' })
    served = true
  })
  await open(page, [block('core/image', 'p')], '?upload=off')
  const address = page.locator('[data-block="p"]').getByRole('textbox', { name: 'Web address of the picture' })
  await address.fill('/slow-picture.png')
  await address.press('Enter')
  // The same part id in new content: only the generation tells them apart.
  await page.evaluate(() => { window.__editor!.editor.setContent({ version: 1, blocks: [{ id: 'p', type: 'core/image', attrs: {} }] }) })
  await expect.poll(() => served).toBe(true)
  await expect.poll(() => announcements(page)).toContain('The text changed while the file was being chosen, so the file was not added.')
  expect((await attrs(page, 'p')).src).toBe('')
})

test('a failed upload says so and offers Try again', async ({ page }) => {
  await open(page, [block('core/image', 'p')], '?upload=fail')
  await page.locator('[data-block="p"] input[type=file]').setInputFiles(PICTURE)
  await expect(page.locator('[data-block="p"]').getByRole('alert')).toHaveText('picture.png could not be uploaded. Check the connection and try again.')
  await expect(page.locator('[data-block="p"]').getByRole('button', { name: 'Try again' })).toBeVisible()
  expect((await attrs(page, 'p')).src).toBe('')
})

test('a slow upload shows progress and can be cancelled', async ({ page }) => {
  await open(page, [block('core/image', 'p')], '?upload=slow')
  await page.locator('[data-block="p"] input[type=file]').setInputFiles(PICTURE)
  await expect(page.locator('[data-block="p"]').getByRole('progressbar', { name: 'Uploading picture.png' })).toBeVisible()
  await page.locator('[data-block="p"]').getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('[data-block="p"]').getByRole('button', { name: 'Choose a picture' })).toBeVisible()
  expect((await announcements(page)).at(-1)).toBe('Upload cancelled')
  await page.waitForTimeout(1800)
  expect((await attrs(page, 'p')).src).toBe('')
})

test('a file dropped on the text becomes a picture after it', async ({ page, browserName }) => {
  await open(page, [para('Intro', 'a')])
  await caret(page, 'a', 5)
  await page.evaluate(async () => {
    const png = await (await fetch('/png/favicon-48.png')).blob()
    const data = new DataTransfer()
    data.items.add(new File([png], 'mark.png', { type: 'image/png' }))
    const field = document.querySelector('#editor')!.shadowRoot!.querySelector('[data-block="a"] [data-field]')!
    const r = field.getBoundingClientRect()
    field.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, composed: true, clientX: r.right - 2, clientY: r.top + 4 }))
  })
  test.skip(browserName === 'webkit' && (await page.locator('[data-type="core/image"]').count()) === 0, 'WebKit drops the files of a synthetic DragEvent')
  await expect(page.locator('[data-type="core/image"] img.pz-img')).toBeVisible()
  expect(await page.evaluate(() => window.__editor!.outline())).toEqual(['paragraph: Intro', 'image: '])
})

test('a gallery takes several pictures at once; its options describe each one and set the columns', async ({ page }) => {
  await open(page, [block('core/gallery', 'g')])
  await page.locator('[data-block="g"] input[type=file]').setInputFiles([PICTURE, PICTURE])
  await expect(page.locator('[data-block="g"] img.pz-img')).toHaveCount(2)
  await page.locator('[data-block="g"] img.pz-img').first().click()
  await page.locator('.gut:not(.is-hover) .cfg').click()
  await options(page).getByRole('group', { name: 'Columns' }).getByRole('button', { name: '2' }).click()
  const second = options(page).getByRole('textbox', { name: 'Description of picture 2 of 2' })
  await second.fill('Second')
  await second.press('Enter')
  const g = (await json(page)).blocks[0]!
  expect(g.attrs.columns).toBe(2)
  expect(g.children!.map((c) => c.attrs.alt)).toEqual(['', 'Second'])
})

test('a video without captions or transcript says so; a captions address satisfies it', async ({ page }) => {
  await open(page, [block('core/video', 'v', { src: '/clip.mp4' })])
  const notice = page.locator('[data-block="v"]').getByRole('button', { name: 'Add captions or a transcript' })
  await notice.click()
  const captions = options(page).getByRole('textbox', { name: 'Captions file (WebVTT)' })
  await captions.fill('/clip.vtt')
  await captions.press('Enter')
  await expect(notice).toHaveCount(0)
  await expect(page.locator('[data-block="v"] track')).toHaveAttribute('src', '/clip.vtt')
})

test('an embed takes a YouTube address and its title; other addresses are refused', async ({ page }) => {
  await open(page, [block('core/embed', 'e')])
  const part = page.locator('[data-block="e"]')
  await part.click({ position: { x: 5, y: 5 } })
  await part.getByRole('textbox', { name: 'Address of the video' }).fill('https://evil.example/x')
  await part.getByRole('button', { name: 'Embed the video' }).click()
  await expect(part.getByText(/is not a YouTube or Vimeo video/)).toBeVisible()
  await part.getByRole('textbox', { name: 'Address of the video' }).fill('https://youtu.be/dQw4w9WgXcQ')
  await part.getByRole('textbox', { name: 'What the video shows' }).fill('A song')
  await part.getByRole('button', { name: 'Embed the video' }).click()
  await expect(part.getByText('A song')).toBeVisible()
  // Nothing loads from the provider until the author asks.
  await expect(part.locator('iframe')).toHaveCount(0)
  await part.getByRole('button', { name: 'Play here, loads from YouTube' }).click()
  await expect(part.locator('iframe')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
  expect(await attrs(page, 'e')).toMatchObject({ url: 'https://youtu.be/dQw4w9WgXcQ', title: 'A song' })
})

test('a file uploads with its name and size', async ({ page }) => {
  await open(page, [block('core/file', 'f')])
  await page.locator('[data-block="f"] input[type=file]').setInputFiles(PICTURE)
  await expect(page.locator('[data-block="f"] .pz-file-name')).toHaveText('picture.png')
  await expect(page.locator('[data-block="f"] .pz-file-meta')).toHaveText(/^PNG, \d/)
  expect(await attrs(page, 'f')).toMatchObject({ name: 'picture.png' })
})
