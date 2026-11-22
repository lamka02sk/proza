/** Toolbar, JSON panel and event log shared by the field spikes. */
import { createValue, type RichTextValue } from '../../src/model/richtext'
import { SpikeDoc, type FieldFactory } from './spike-doc'

export const SAMPLE: RichTextValue[] = [
  createValue('Proza is a block editor. This line has bold, italic and a link.', [
    { type: 'bold', start: 39, end: 43 },
    { type: 'italic', start: 45, end: 51 },
    { type: 'link', start: 58, end: 62, attrs: { href: 'https://example.com' } },
  ]),
  createValue('Second paragraph with inline code and a soft\nline break.', [{ type: 'code', start: 22, end: 33 }]),
  createValue('Príliš žluťoučký kůň úpěl ďábelské ódy.'),
]

/** The inline formats and objects, shown on the field spikes only (other spikes keep SAMPLE unchanged). */
export const FORMAT_SAMPLE: RichTextValue = createValue('Press Ctrl+S to save the HTML draft, as der Duden says.\uFFFC', [
  { type: 'kbd', start: 6, end: 12 },
  { type: 'abbr', start: 25, end: 29, attrs: { title: 'HyperText Markup Language' } },
  { type: 'highlight', start: 30, end: 35 },
  { type: 'lang', start: 40, end: 49, attrs: { lang: 'de' } },
  { type: 'footnote', start: 55, end: 56, attrs: { note: 'The Duden is the German spelling dictionary.' } },
])

const BUTTONS: { type: string; label: string; text: string }[] = [
  { type: 'bold', label: 'Bold', text: 'B' },
  { type: 'italic', label: 'Italic', text: 'I' },
  { type: 'underline', label: 'Underline', text: 'U' },
  { type: 'strikethrough', label: 'Strikethrough', text: 'S' },
  { type: 'code', label: 'Inline code', text: '</>' },
  { type: 'superscript', label: 'Superscript', text: 'x²' },
  { type: 'subscript', label: 'Subscript', text: 'x₂' },
  { type: 'highlight', label: 'Highlight', text: 'Mark' },
  { type: 'kbd', label: 'Keyboard key', text: 'Kbd' },
]

declare global {
  interface Window { __proza?: { doc: SpikeDoc; json(): RichTextValue[]; types(): string[] } }
}

export function mountSpike(factory: FieldFactory, engine: string): SpikeDoc {
  const toolbar = document.querySelector<HTMLElement>('#toolbar')!
  const canvas = document.querySelector<HTMLElement>('#canvas')!
  const jsonOut = document.querySelector<HTMLElement>('#json')!
  const logOut = document.querySelector<HTMLElement>('#log')!

  let frame = 0
  const update = (): void => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      jsonOut.textContent = JSON.stringify(doc.blocks.map((b) => (b.type === 'paragraph' ? b.value : { type: b.type, ...b.value })), null, 1)
      logOut.textContent = doc.trace.slice(-80).map((e) => `${e.t} ${e.block} ${e.line}`).join('\n')
      logOut.scrollTop = logOut.scrollHeight
      const marks = doc.focused?.activeMarks() ?? []
      toolbar.querySelectorAll<HTMLButtonElement>('button[data-format]').forEach((b) => {
        b.setAttribute('aria-pressed', String(marks.some((m) => m.type === b.dataset.format)))
      })
    })
  }

  const doc = new SpikeDoc(canvas, factory, { onUpdate: update })

  const add = (text: string, label: string, run: () => void, format?: string): void => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = text
    b.setAttribute('aria-label', label)
    b.title = label
    if (format) { b.dataset.format = format; b.setAttribute('aria-pressed', 'false') }
    // Keep focus and selection in the field.
    b.addEventListener('mousedown', (e) => { e.preventDefault() })
    b.addEventListener('click', run)
    toolbar.appendChild(b)
  }
  const sep = (): void => { toolbar.appendChild(Object.assign(document.createElement('span'), { className: 'sep' })) }

  for (const btn of BUTTONS) add(btn.text, btn.label, () => doc.focused?.toggleFormat({ type: btn.type }), btn.type)
  sep()
  add('Link', 'Add link', () => {
    const f = doc.focused
    const href = f && window.prompt('Link address', 'https://')
    if (f && href) f.setLink(href)
  })
  add('Unlink', 'Remove link', () => doc.focused?.setLink(null))
  doc.requestLink = (f) => {
    const href = window.prompt('Link address', 'https://')
    if (href) f.setLink(href)
  }
  sep()
  // Attribute formats and objects: prompts are enough for a spike; the real dialogs are in the interface.
  const ask = (label: string, initial = ''): string | null => {
    const v = window.prompt(label, initial)
    return v === null || v.trim() === '' ? null : v.trim()
  }
  add('Colour', 'Text colour: accent preset', () => doc.focused?.setFormat?.({ type: 'color', attrs: { color: 'accent' } }), 'color')
  add('Lang', 'Language of the selection', () => {
    const lang = ask('Language tag, for example de or sk')
    if (lang) doc.focused?.setFormat?.({ type: 'lang', attrs: { lang } })
  }, 'lang')
  add('Abbr', 'Abbreviation', () => {
    const title = ask('What the abbreviation stands for')
    if (title) doc.focused?.setFormat?.({ type: 'abbr', attrs: { title } })
  }, 'abbr')
  add('Picture', 'Insert inline picture', () => {
    const src = ask('Picture address', '/favicon.svg')
    if (!src) return
    const alt = window.prompt('Text alternative (empty if decorative)', '') ?? ''
    doc.focused?.insertObject?.({ type: 'image', attrs: { src, alt } })
  })
  add('Note', 'Insert footnote', () => {
    const note = ask('Footnote text')
    if (note) doc.focused?.insertObject?.({ type: 'footnote', attrs: { note } })
  })
  add('Clear', 'Clear formatting', () => doc.focused?.clearFormatting?.())
  sep()
  add('↶', 'Undo', () => { doc.undo() })
  add('↷', 'Redo', () => { doc.redo() })

  const report = (): string => JSON.stringify({
    engine,
    userAgent: navigator.userAgent,
    date: new Date().toISOString(),
    doc: doc.blocks.map((b) => b.value),
    trace: doc.trace,
  }, null, 1)
  document.querySelector('#copy-log')?.addEventListener('click', () => { void navigator.clipboard.writeText(report()) })
  document.querySelector('#download-log')?.addEventListener('click', () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([report()], { type: 'application/json' }))
    a.download = `proza-${engine}-trace-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  })
  document.querySelector('#clear-log')?.addEventListener('click', () => { doc.trace.length = 0; update() })

  const empty = new URLSearchParams(location.search).has('empty')
  doc.load(empty ? [] : [...SAMPLE, FORMAT_SAMPLE])
  window.__proza = { doc, json: () => doc.blocks.map((b) => b.value), types: () => doc.blocks.map((b) => b.type) }
  return doc
}
