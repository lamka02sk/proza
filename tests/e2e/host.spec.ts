/**
 * Host integration: an enhanced textarea, the
 * `<proza-editor>` element and the Vue component in one form; Mod+S; read-only;
 * draft recovery; a fixed height.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { MOD } from './editor-helpers'

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/forms/${query}`)
  await page.waitForFunction(() => window.__forms?.vue() != null)
}

/** The first text field inside an editor host (its shadow root). */
const field = (page: Page, host: string): Locator => page.locator(`${host} [data-field]`).first()
const textareaHost = '#body + .proza-host'

test('the textarea is enhanced: its HTML loads, the label names the editor, the value follows the text', async ({ page }) => {
  await open(page)
  await expect(page.locator('#body')).toBeHidden()
  await expect(page.locator(textareaHost).getByRole('group', { name: 'Article (textarea)' })).toBeVisible()
  await expect(field(page, textareaHost)).toHaveText('Text that was written in the old editor.')
  await expect(field(page, textareaHost).locator('strong')).toHaveText('old')
  await field(page, textareaHost).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' More.')
  await expect.poll(() => page.locator('#body').inputValue()).toContain('editor. More.</p>')
  expect(await page.evaluate(() => window.__forms!.events)).toContain('input:body')
  // Leaving the field after changes: change, as a textarea does.
  await page.locator('#submit').focus()
  expect(await page.evaluate(() => window.__forms!.events)).toContain('change:body')
})

test('the form submits HTML and JSON of every editor', async ({ page }) => {
  await open(page)
  await field(page, '#summary').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Edited.')
  await page.locator('#submit').click()
  await expect.poll(() => page.evaluate(() => Object.keys(window.__forms!.sent()).length)).toBeGreaterThan(0)
  const sent = await page.evaluate(() => window.__forms!.sent())
  expect(sent.body).toBe('<p>Text that was written in the <strong>old</strong> editor.</p>')
  expect(JSON.parse(sent.body_json!)).toMatchObject({ version: 1, blocks: [{ type: 'core/paragraph' }] })
  expect(sent.summary).toBe('<p>A short summary. Edited.</p>')
  expect(JSON.parse(sent.summary_json!)).toMatchObject({ blocks: [{ attrs: { content: { text: 'A short summary. Edited.' } } }] })
})

test('required: an empty editor stops the form, and the browser points at it', async ({ page }) => {
  await open(page)
  await field(page, '#summary').click()
  await page.keyboard.press(`${MOD}+A`)
  await page.keyboard.press('Backspace')
  expect(await page.evaluate(() => (document.querySelector('#summary') as HTMLElement & { validity: ValidityState }).validity.valueMissing)).toBe(true)
  await page.locator('#submit').click()
  expect(await page.evaluate(() => Object.keys(window.__forms!.sent()).length)).toBe(0)
  await page.keyboard.type('Back')
  expect(await page.evaluate(() => (document.querySelector('#summary') as HTMLElement & { checkValidity(): boolean }).checkValidity())).toBe(true)
})

test('labels focus the editors; a required textarea left empty takes the focus and says why', async ({ page }) => {
  await open(page)
  await page.locator('label[for="summary"]').click()
  await expect(field(page, '#summary')).toBeFocused()
  await page.locator('label[for="body"]').click()
  await expect(field(page, textareaHost)).toBeFocused()
  await page.evaluate(() => {
    const w = window as unknown as { said: string[] }
    w.said = []
    window.__forms!.textarea.editor.announcer.onAnnounce((t) => { w.said.push(t) })
  })
  await page.keyboard.press(`${MOD}+A`)
  await page.keyboard.press('Backspace')
  await page.locator('#submit').click()
  expect(await page.evaluate(() => Object.keys(window.__forms!.sent()).length)).toBe(0)
  await expect(field(page, textareaHost)).toBeFocused()
  expect(await page.evaluate(() => (window as unknown as { said: string[] }).said)).toContain('Write something here.')
})

test('the textarea: input goes out with the value it announces', async ({ page }) => {
  await open(page)
  await page.evaluate(() => {
    const w = window as unknown as { seen: string[] }
    w.seen = []
    document.querySelector('#body')!.addEventListener('input', (e) => { w.seen.push((e.target as HTMLTextAreaElement).value) })
  })
  await field(page, textareaHost).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' More.')
  await expect.poll(() => page.evaluate(() => (window as unknown as { seen: string[] }).seen.at(-1) ?? '')).toContain('editor. More.</p>')
  // Every input carried a value that was current: none from before the typing.
  expect(await page.evaluate(() => (window as unknown as { seen: string[] }).seen.some((v) => !v.includes('More')))).toBe(false)
})

test('<proza-editor>: a value set before it is in the page is its content', async ({ page }) => {
  await open(page)
  const result = await page.evaluate(() => {
    const el = document.createElement('proza-editor') as HTMLElement & { value: string }
    el.setAttribute('name', 'late')
    el.value = '<p>Set before connect</p>'
    const before = el.value
    const form = document.querySelector<HTMLFormElement>('#form')!
    form.append(el)
    return { before, after: el.value, sent: new FormData(form).get('late') }
  })
  expect(result).toEqual({ before: '<p>Set before connect</p>', after: '<p>Set before connect</p>', sent: '<p>Set before connect</p>' })
})

test('<proza-editor>: taken out of the page for a while and put back, it keeps the edits; reset still goes to the start', async ({ page }) => {
  await open(page)
  await field(page, '#summary').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Edited.')
  await page.evaluate(async () => {
    const el = document.querySelector('#summary')!
    const parent = el.parentElement!
    const next = el.nextSibling
    el.remove()
    await new Promise((r) => setTimeout(r, 50))
    parent.insertBefore(el, next)
  })
  await expect(field(page, '#summary')).toHaveText('A short summary. Edited.')
  expect(await page.evaluate(() => (document.querySelector('#summary') as HTMLElement & { value: string }).value)).toBe('<p>A short summary. Edited.</p>')
  await page.locator('#reset').click()
  await expect(field(page, '#summary')).toHaveText('A short summary.')
})

test('reset brings back the content the form started with', async ({ page }) => {
  await open(page)
  await field(page, '#summary').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Gone soon.')
  await field(page, textareaHost).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Also gone.')
  await page.locator('#reset').click()
  await expect(field(page, '#summary')).toHaveText('A short summary.')
  await expect(field(page, textareaHost)).toHaveText('Text that was written in the old editor.')
})

test('Mod+S saves: a cancelable save event, then the form submits', async ({ page }) => {
  await open(page)
  await field(page, '#summary').click()
  await page.keyboard.press(`${MOD}+S`)
  await expect.poll(() => page.evaluate(() => window.__forms!.sent().summary ?? '')).toBe('<p>A short summary.</p>')
  expect(await page.evaluate(() => window.__forms!.events)).toContain('save:summary')
  // A host that saves on its own cancels the event: nothing is submitted.
  await page.evaluate(() => { document.querySelector('#form')!.addEventListener('save', (e) => { e.preventDefault() }) })
  await field(page, textareaHost).click()
  await page.keyboard.press(`${MOD}+S`)
  expect(await page.evaluate(() => window.__forms!.events.filter((e) => e === 'save:body').length)).toBe(1)
})

test('the Vue component keeps its model in step both ways', async ({ page }) => {
  await open(page)
  await field(page, '#vue').click()
  await page.keyboard.press('End')
  await page.keyboard.type('!')
  await expect.poll(() => page.evaluate(() => (window.__forms!.vueModel()?.blocks[0]?.attrs.content as { text: string }).text)).toBe('Notes kept in a Vue ref.!')
  // The host changes the model: the editor shows it.
  await page.evaluate(() => { window.__forms!.vue()!.editor.setContent({ version: 1, blocks: [{ type: 'core/heading', attrs: { level: 2, content: { text: 'From the host', formats: [] } } }] }) })
  await expect(page.locator('#vue [data-type="core/heading"]')).toHaveText('From the host')
})

test('the Vue component with a ref() model: the echo of an edit is not new content, so undo and the caret survive', async ({ page }) => {
  await open(page)
  const generation = (): Promise<number> => page.evaluate(() => window.__forms!.vue()!.editor.generation)
  const before = await generation()
  await field(page, '#vue').click()
  await page.keyboard.press('End')
  await page.keyboard.type('!?')
  await expect.poll(() => page.evaluate(() => (window.__forms!.vueModel()?.blocks[0]?.attrs.content as { text: string }).text)).toBe('Notes kept in a Vue ref.!?')
  // A few frames for the echo to come back through the watcher.
  await page.evaluate(() => new Promise((r) => { requestAnimationFrame(() => { requestAnimationFrame(r) }) }))
  expect(await generation()).toBe(before)
  await page.keyboard.type('.')
  await expect(field(page, '#vue')).toHaveText('Notes kept in a Vue ref.!?.')
  await page.keyboard.press(`${MOD}+Z`)
  await expect(field(page, '#vue')).toHaveText('Notes kept in a Vue ref.')
})

test('read-only: text can be read and selected, nothing changes, no editing tools', async ({ page }) => {
  await open(page, '?readonly')
  const f = field(page, textareaHost)
  await expect(f).toHaveAttribute('contenteditable', 'false')
  await expect(f).toHaveAttribute('aria-readonly', 'true')
  await f.click()
  await page.keyboard.type('typed')
  await page.keyboard.press(`${MOD}+B`)
  await expect(f).toHaveText('Text that was written in the old editor.')
  await expect(page.locator(`${textareaHost} .appender`)).toHaveCount(0)
  await expect(page.locator(`${textareaHost} .status`)).toContainText('Read only')
  await expect(page.locator(`${textareaHost} .status`).getByRole('button', { name: 'Undo' })).toHaveCount(0)
  // Switching it off makes the same fields editable.
  await page.evaluate(() => { window.__forms!.textarea.editor.setReadOnly(false) })
  await expect(f).toHaveAttribute('contenteditable', 'true')
  await f.click()
  await page.keyboard.press('End')
  await page.keyboard.type('!')
  await expect(f).toHaveText('Text that was written in the old editor.!')
  // A disabled custom element is read-only too, and submits nothing.
  await page.evaluate(() => { window.__forms!.textarea.editor.setReadOnly(true) })
  await page.evaluate(() => { document.querySelector('#summary')!.setAttribute('disabled', '') })
  await expect(field(page, '#summary')).toHaveAttribute('contenteditable', 'false')
  await page.locator('#submit').click()
  await expect.poll(() => page.evaluate(() => Object.keys(window.__forms!.sent()))).not.toContain('summary')
  expect((await new AxeBuilder({ page }).include('#body + .proza-host').analyze()).violations).toEqual([])
})

test('draft recovery: unsaved text comes back after a reload, as one undo step', async ({ page }) => {
  await open(page, '?draft')
  await page.evaluate(() => { localStorage.clear() })
  await field(page, textareaHost).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Unsaved words.')
  // Written after a quiet second, or at once when the page goes away.
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith('proza:draft:') && k.endsWith('#body')))
  await open(page, '?draft')
  const note = page.locator(`${textareaHost} .note`)
  await expect(note).toContainText('was not saved')
  await expect(field(page, textareaHost)).toHaveText('Text that was written in the old editor.')
  await note.getByRole('button', { name: 'Bring it back' }).click()
  await expect(field(page, textareaHost)).toHaveText('Text that was written in the old editor. Unsaved words.')
  await expect(note).toHaveCount(0)
  await page.keyboard.press(`${MOD}+Z`)
  await expect(field(page, textareaHost)).toHaveText('Text that was written in the old editor.')
  // Submitting is saving: the draft goes.
  await page.locator('#submit').click()
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.endsWith('#body')))).toEqual([])
})

test('draft recovery: content the host puts in is the new start, not a draft', async ({ page }) => {
  await open(page, '?draft')
  await page.evaluate(() => { localStorage.clear() })
  await field(page, textareaHost).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Typed before the host replaced it.')
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith('proza:draft:') && k.endsWith('#body')))
  await page.evaluate(() => { window.__forms!.textarea.editor.setContent('<p>From the host.</p>') })
  await expect(field(page, textareaHost)).toHaveText('From the host.')
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.endsWith('#body')))).toEqual([])
  // Edits after it are drafts again.
  await field(page, textareaHost).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' More.')
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith('proza:draft:') && k.endsWith('#body')))
})

test('draft recovery: Discard keeps the saved text and forgets the draft', async ({ page }) => {
  await open(page, '?draft')
  await page.evaluate(() => { localStorage.clear() })
  await field(page, '#summary').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Draft.')
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.endsWith('#summary')))
  await open(page, '?draft')
  await page.locator('#summary .note').getByRole('button', { name: 'Discard it' }).click()
  await expect(field(page, '#summary')).toHaveText('A short summary.')
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.endsWith('#summary')))).toEqual([])
})

test('a fixed height: the text scrolls inside and the status line stays in view', async ({ page }) => {
  await open(page, '?height=200px')
  const host = page.locator(textareaHost)
  await page.evaluate(() => {
    const blocks = Array.from({ length: 30 }, (_, i) => ({ type: 'core/paragraph', attrs: { content: { text: `Line ${i + 1}`, formats: [] } } }))
    window.__forms!.textarea.editor.setContent({ version: 1, blocks })
  })
  const box = await host.locator('.ed').boundingBox()
  expect(Math.round(box!.height)).toBe(200)
  const work = host.locator('.work')
  expect(await work.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await expect(host.locator('.status')).toBeInViewport()
})
