/**
 * Screen reader spike: the same five paragraphs exposed four ways, to compare
 * by hand in screen readers.
 */
import '../../shared/playground.css'
import '../../../src/richtext/richtext.css'
import { RichTextField } from '../../../src/richtext/field'
import { SpikeDoc } from '../../shared/spike-doc'
import { SAMPLE } from '../../shared/spike-page'
import { createValue } from '../../../src/model/richtext'
import { toDom } from '../../../src/richtext/dom'

const VARIANTS = {
  a: 'A. One field per block, role="textbox" with aria-multiline and the name "Paragraph". The plan\'s default.',
  b: 'B. One field per block with no role or name: native contenteditable semantics.',
  c: 'C. One contenteditable for the whole document (TinyMCE style). Control: no Proza logic, for comparison only.',
  d: 'D. Like A, inside a group per block named "Paragraph, block 2 of 5" (Gutenberg style).',
} as const
type Variant = keyof typeof VARIANTS

const variant = (new URLSearchParams(location.search).get('variant') ?? 'a') as Variant
const list = document.querySelector('#variants')!
for (const [k, text] of Object.entries(VARIANTS)) {
  const li = document.createElement('li')
  const a = document.createElement('a')
  a.href = `?variant=${k}`
  a.textContent = text
  if (k === variant) a.setAttribute('aria-current', 'page')
  li.appendChild(a)
  list.appendChild(li)
}
document.querySelector('#about')!.textContent = `Showing ${VARIANTS[variant]}`

const content = [
  createValue('Writing in Proza', [{ type: 'bold', start: 0, end: 16 }]),
  ...SAMPLE,
  createValue('Last paragraph. Press Escape then Tab to leave the editor.'),
]
const canvas = document.querySelector<HTMLElement>('#canvas')!
canvas.setAttribute('role', 'group')
canvas.setAttribute('aria-label', 'Document')

if (variant === 'c') {
  canvas.removeAttribute('role')
  canvas.contentEditable = 'true'
  canvas.setAttribute('role', 'textbox')
  canvas.setAttribute('aria-multiline', 'true')
  canvas.setAttribute('aria-label', 'Document')
  for (const v of content) {
    const p = document.createElement('p')
    p.appendChild(toDom(v, document))
    canvas.appendChild(p)
  }
} else {
  const total = content.length
  const doc = new SpikeDoc(canvas, (el, opts) => {
    const field = new RichTextField(el, opts)
    if (variant === 'b') { el.removeAttribute('role'); el.removeAttribute('aria-multiline'); el.removeAttribute('aria-label') }
    return field
  }, { label: () => 'Paragraph' })
  doc.load(content)
  if (variant === 'd') {
    doc.blocks.forEach((b, i) => {
      const field = doc.fields.get(b.id)!
      const wrap = document.createElement('div')
      wrap.setAttribute('role', 'group')
      wrap.setAttribute('aria-label', `Paragraph, block ${i + 1} of ${total}`)
      field.element.replaceWith(wrap)
      wrap.appendChild(field.element)
    })
  }
  Object.assign(window, { __sr: { doc } })
}

const style = document.createElement('style')
style.textContent = '.visually-hidden{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}'
document.head.appendChild(style)
