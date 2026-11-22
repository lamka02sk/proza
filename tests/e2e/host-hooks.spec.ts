/**
 * Host hooks: `blocksChange` once per transaction,
 * upload attempts from start to their one end, and the host's attachment
 * manager (`requestAttachment`) from the inserter and from an empty part.
 * The playground records the hooks with `?hooks` and offers a stand-in
 * library dialog with `?library` (playground/editor/library.ts).
 */
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { announcements, caret, MOD, open, outline, para } from './editor-helpers'

const PICTURE = join(import.meta.dirname, '../fixtures/media/picture.png')
const changes = (page: Page) => page.evaluate(() => window.__editor!.hooks.changes.map((c) => ({
  reason: c.reason, added: c.added.map((b) => b.type), removed: c.removed.map((b) => b.id), updated: c.updated.map((u) => u.id), order: c.order.map((o) => String(o.parent)),
})))
const uploads = (page: Page) => page.evaluate(() => window.__editor!.hooks.uploads.map((u) => ({ status: u.status, source: u.source, kind: u.kind, reason: u.reason ?? '', blockId: u.blockId, attempt: u.attempt })))
const clearLog = (page: Page) => page.evaluate(() => { window.__editor!.hooks.changes.length = 0; window.__editor!.hooks.uploads.length = 0 })
const image = (id: string) => ({ id, type: 'core/image', attrs: {} })

test('blocksChange: one batch per transaction, with what it added, removed, updated and reordered', async ({ page }) => {
  await open(page, [para('One', 'a'), para('Two', 'b')], '?hooks')
  // setContent after the editor is up: one reset, nothing else.
  expect(await changes(page)).toEqual([{ reason: 'reset', added: [], removed: [], updated: [], order: [] }])
  await clearLog(page)

  await caret(page, 'a', 3)
  await page.keyboard.type('!')
  expect(await changes(page)).toEqual([{ reason: 'typing', added: [], removed: [], updated: ['a'], order: [] }])
  await clearLog(page)

  // Enter splits: the new paragraph is added, the old one updated, the document's order changes, in one batch.
  await page.keyboard.press('Enter')
  const split = await changes(page)
  expect(split).toHaveLength(1)
  expect(split[0]).toMatchObject({ reason: 'command', added: ['core/paragraph'], removed: [], order: ['null'] })
  await clearLog(page)

  // Undo reports what it actually took back, with its own reason.
  await page.evaluate(() => { window.__editor!.editor.undo() })
  const undone = await changes(page)
  expect(undone).toHaveLength(1)
  expect(undone[0]).toMatchObject({ reason: 'undo', added: [], order: ['null'] })
  expect(undone[0]!.removed).toHaveLength(1)
  await page.evaluate(() => { window.__editor!.editor.redo() })
  expect((await changes(page)).at(-1)).toMatchObject({ reason: 'redo', added: ['core/paragraph'] })
  // The revision only grows.
  const revisions = await page.evaluate(() => window.__editor!.hooks.changes.map((c) => c.revision))
  expect(revisions).toEqual([...revisions].sort((x, y) => x - y))
})

test('a listener that throws does not stop the edit or the other listeners', async ({ page }) => {
  await open(page, [para('One', 'a')], '?hooks')
  const errors: string[] = []
  page.on('pageerror', (e) => { errors.push(e.message) })
  await page.evaluate(() => { window.__editor!.editor.on('blocksChange', () => { throw new Error('host bug') }) })
  await clearLog(page)
  await caret(page, 'a', 3)
  await page.keyboard.type('x')
  expect(await outline(page)).toEqual(['paragraph: Onex'])
  expect(await changes(page)).toHaveLength(1)
  await expect.poll(() => errors).toContain('host bug')
  // History still works after the failing listener.
  await page.keyboard.press(`${MOD}+z`)
  expect(await outline(page)).toEqual(['paragraph: One'])
})

test('upload events: started, then succeeded after the part holds the file; the adapter learns the part and the source', async ({ page }) => {
  await open(page, [image('pic')], '?hooks')
  await page.evaluate(() => {
    const ed = window.__editor!.editor
    // The succeeded event must come after the block change that filled the part.
    const order: string[] = []
    ;(window as unknown as { __order: string[] }).__order = order
    ed.on('blocksChange', (e) => { order.push(e.reason) })
    ed.on('upload', (e) => { order.push(e.status) })
  })
  await clearLog(page)
  const pic = page.locator('.pz-canvas [data-block="pic"]')
  await pic.locator('input[type=file]').setInputFiles(PICTURE)
  await expect(pic.locator('img.pz-img')).toBeVisible()
  const ups = await uploads(page)
  expect(ups[0]).toMatchObject({ status: 'started', source: 'picker', kind: 'image', blockId: 'pic' })
  expect(ups.at(-1)).toMatchObject({ status: 'succeeded' })
  expect(new Set(ups.map((u) => u.attempt)).size).toBe(1)
  const order = await page.evaluate(() => (window as unknown as { __order: string[] }).__order.filter((x) => x !== 'progress'))
  expect(order).toEqual(['started', 'command', 'succeeded'])

  // Redo replays the document: the adapter is not called again.
  await page.evaluate(() => { window.__editor!.editor.undo(); window.__editor!.editor.redo() })
  expect((await uploads(page)).filter((u) => u.status === 'started')).toHaveLength(1)
})

test('a file the part does not take fails without the adapter', async ({ page }) => {
  await open(page, [image('pic')], '?hooks')
  await clearLog(page)
  await page.locator('.pz-canvas [data-block="pic"] input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') })
  await expect.poll(() => uploads(page)).toEqual([expect.objectContaining({ status: 'failed', reason: 'type' })])
})

test('an upload ends cancelled when the author cancels, the part goes, or new content arrives; a late result changes nothing', async ({ page }) => {
  await open(page, [image('pic'), para('After', 'z')], '?hooks&upload=slow')
  await clearLog(page)
  const pic = page.locator('.pz-canvas [data-block="pic"]')
  await pic.locator('input[type=file]').setInputFiles(PICTURE)
  await pic.getByRole('button', { name: 'Cancel' }).click()
  await expect.poll(async () => (await uploads(page)).map((u) => u.status + u.reason)).toEqual(['started', 'cancelledauthor'])

  await clearLog(page)
  await pic.locator('input[type=file]').setInputFiles(PICTURE)
  await page.evaluate(() => {
    const ed = window.__editor!.editor
    ed.select({ kind: 'blocks', anchorId: 'pic', focusId: 'pic' })
    ed.run('remove')
  })
  await expect.poll(async () => (await uploads(page)).map((u) => u.status + u.reason)).toEqual(['started', 'cancelledremoved'])

  // New content with the same id: the old upload must not land in it.
  await page.evaluate(() => { window.__editor!.editor.undo() })
  await clearLog(page)
  await pic.locator('input[type=file]').setInputFiles(PICTURE)
  await page.evaluate(() => { window.__editor!.editor.setContent({ version: 1, blocks: [{ id: 'pic', type: 'core/image', attrs: {} }] }) })
  await expect.poll(async () => (await uploads(page)).map((u) => u.status + u.reason)).toEqual(['started', 'cancelledreset'])
  await page.waitForTimeout(2500)
  expect(await page.evaluate(() => window.__editor!.json().blocks[0]!.attrs.src)).toBe('')
})

test('the library from the inserter: a picked picture becomes the part in one undo step', async ({ page }) => {
  await open(page, [para('Intro', 'a')], '?library')
  await caret(page, 'a', 5)
  await page.getByRole('button', { name: 'Add something' }).click()
  await page.getByRole('option', { name: 'Picture' }).click()
  const library = page.getByRole('dialog', { name: 'Media library' })
  await expect(library).toBeVisible()
  // Nothing is inserted while the author chooses.
  expect(await outline(page)).toEqual(['paragraph: Intro'])
  await library.getByRole('button', { name: 'Logo (picture)' }).click()
  const pic = page.locator('.pz-canvas [data-type="core/image"]')
  await expect(pic.locator('img.pz-img')).toHaveAttribute('src', '/png/proza-app-ikona-192.png')
  const attrs = await page.evaluate(() => window.__editor!.json().blocks[1]!.attrs)
  expect([attrs.naturalWidth, attrs.naturalHeight]).toEqual([192, 192])
  await page.evaluate(() => { window.__editor!.editor.undo() })
  expect(await outline(page)).toEqual(['paragraph: Intro'])
})

test('the library: cancel adds nothing and gives the focus back; an unusable answer is refused', async ({ page }) => {
  await open(page, [para('Intro', 'a')], '?library')
  await caret(page, 'a', 5)
  await page.getByRole('button', { name: 'Add something' }).click()
  await page.getByRole('option', { name: 'Picture' }).click()
  await page.getByRole('dialog', { name: 'Media library' }).getByRole('button', { name: 'Cancel' }).click()
  expect(await outline(page)).toEqual(['paragraph: Intro'])
  await expect.poll(() => page.evaluate(() => document.querySelector('#editor')!.shadowRoot!.activeElement?.closest('[data-block]')?.getAttribute('data-block'))).toBe('a')
  // Cancelling made no undo step.
  await page.evaluate(() => { window.__editor!.editor.undo() })
  expect(await announcements(page)).toContain('Nothing to undo')

  await page.getByRole('button', { name: 'Add something' }).click()
  await page.getByRole('option', { name: 'Picture' }).click()
  await page.getByRole('dialog', { name: 'Media library' }).getByRole('button', { name: 'Broken entry' }).click()
  await expect.poll(() => announcements(page)).toContain('The chosen file cannot be used here.')
  expect(await outline(page)).toEqual(['paragraph: Intro'])
})

test('the library: slash text edited while choosing is kept, and the stale answer dropped', async ({ page }) => {
  await open(page, [para('', 'a')], '?library=slow')
  await caret(page, 'a', 0)
  await page.keyboard.type('/pict')
  await page.keyboard.press('Enter')
  await page.getByRole('dialog', { name: 'Media library' }).getByRole('button', { name: 'Logo (picture)' }).click()
  // The answer comes 800 ms later; the author writes in the meantime.
  await page.evaluate(() => {
    const ed = window.__editor!.editor
    ed.setAttrs('a', { content: { text: '/pict and more', formats: [] } })
  })
  await expect.poll(() => announcements(page)).toContain('The text changed while the file was being chosen, so the file was not added.')
  expect(await outline(page)).toEqual(['paragraph: /pict and more'])
})

test('the library on an empty part; a second editor takes only its own answers, once', async ({ page }) => {
  await open(page, [image('pic'), { id: 'f', type: 'core/file', attrs: {} }], '?library')
  await page.locator('.pz-canvas [data-block="f"]').click()
  await page.locator('.pz-canvas [data-block="f"]').getByRole('button', { name: 'Choose from the library' }).click()
  await page.getByRole('dialog', { name: 'Media library' }).getByRole('button', { name: 'Price list (PDF)' }).click()
  await expect.poll(() => page.evaluate(() => window.__editor!.json().blocks[1]!.attrs)).toMatchObject({ href: '/files/price-list.pdf', name: 'Price list.pdf', bytes: 48213 })

  // A second editor whose host answers from the test.
  await page.evaluate(() => {
    const el = document.createElement('div')
    el.id = 'second'
    document.body.append(el)
    const w = window as unknown as { __req?: { requestId: string; replyTarget: EventTarget } }
    window.__editor!.createEditor({
      target: el,
      content: { version: 1, blocks: [{ id: 'pic', type: 'core/image', attrs: {} }] },
      hooks: { requestAttachment: (r) => { w.__req = r } },
    })
  })
  const second = page.locator('#second [data-block="pic"]')
  await second.click()
  await second.getByRole('button', { name: 'Choose from the library' }).click()
  await page.evaluate(() => {
    const w = window as unknown as { __req: { requestId: string; replyTarget: EventTarget } }
    const answer = { url: '/png/proza-app-ikona-192.png', name: 'logo.png', mimeType: 'image/png', width: 192, height: 192 }
    const send = (target: EventTarget, requestId: string): void => { target.dispatchEvent(new CustomEvent('proza:attachment-result', { detail: { requestId, attachment: answer } })) }
    // Sent to the first editor's host: neither editor takes it.
    send(document.querySelector('#editor')!, w.__req.requestId)
    // The wrong request id: ignored. Then the right answer twice: one change.
    send(w.__req.replyTarget, 'other')
    send(w.__req.replyTarget, w.__req.requestId)
    send(w.__req.replyTarget, w.__req.requestId)
  })
  await expect(second.locator('img.pz-img')).toHaveAttribute('src', '/png/proza-app-ikona-192.png')
  expect(await page.evaluate(() => window.__editor!.json().blocks[0]!.attrs.src)).toBe('')
  const secondEditor = () => page.evaluate(() => {
    const ed = (document.querySelector('#second') as HTMLElement & { shadowRoot: ShadowRoot }).shadowRoot
    return ed.querySelectorAll('.pz-canvas [data-type="core/image"] img.pz-img').length
  })
  expect(await secondEditor()).toBe(1)
})
