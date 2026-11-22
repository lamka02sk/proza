/**
 * Canvas isolation spike.
 * ?mode=light|hardened|shadow  &host=none|realistic|adversarial
 */
import richtextCss from '../../../src/richtext/richtext.css?inline'
import { RichTextField } from '../../../src/richtext/field'
import { SpikeDoc } from '../../shared/spike-doc'
import { SAMPLE } from '../../shared/spike-page'
import editorCss from './editor.css?inline'
import hardenedCss from './editor-hardened.css?inline'
import shadowCss from './shadow.css?inline'
import realisticCss from './host-realistic.css?inline'
import adversarialCss from './host-adversarial.css?inline'

type Mode = 'light' | 'hardened' | 'shadow'
type Host = 'none' | 'realistic' | 'adversarial'

const params = new URLSearchParams(location.search)
const mode = (params.get('mode') ?? 'light') as Mode
const host = (params.get('host') ?? 'realistic') as Host

const controls = document.querySelector('#controls')!
for (const m of ['light', 'hardened', 'shadow'] as const) for (const h of ['none', 'realistic', 'adversarial'] as const) {
  const a = document.createElement('a')
  a.href = `?mode=${m}&host=${h}`
  a.textContent = `${m} / ${h}`
  if (m === mode && h === host) a.setAttribute('aria-current', 'page')
  controls.append(a, ' · ')
}

const style = (css: string, parent: Node = document.head): void => {
  const s = document.createElement('style')
  s.textContent = css
  parent.appendChild(s)
}
if (host === 'realistic') style(realisticCss)
if (host === 'adversarial') { style(realisticCss); style(adversarialCss) }

const mount = document.querySelector<HTMLElement>('#mount')!
let tree: ParentNode
if (mode === 'shadow') {
  const el = document.createElement('proza-editor')
  mount.appendChild(el)
  const shadow = el.attachShadow({ mode: 'open' })
  const sheets = [shadowCss, editorCss, richtextCss].map((css) => { const s = new CSSStyleSheet(); s.replaceSync(css); return s })
  shadow.adoptedStyleSheets = sheets
  tree = shadow
} else {
  style(mode === 'hardened' ? hardenedCss : editorCss)
  style(richtextCss)
  tree = mount
}

const root = document.createElement('div')
root.className = 'pz-root'
root.dataset.probe = 'root'
const toolbar = document.createElement('div')
toolbar.className = 'pz-toolbar'
toolbar.setAttribute('role', 'toolbar')
toolbar.setAttribute('aria-label', 'Formatting')
const button = document.createElement('button')
button.type = 'button'
button.className = 'pz-button'
button.dataset.probe = 'button'
button.textContent = 'Bold'
toolbar.appendChild(button)
const canvas = document.createElement('div')
canvas.className = 'pz-content'
canvas.dataset.probe = 'canvas'
canvas.setAttribute('role', 'group')
canvas.setAttribute('aria-label', 'Document')
root.append(toolbar, canvas)
tree.appendChild(root)

// Which targets receive selectionchange while editing inside the shadow root.
const selectionEvents = { document: 0, shadowRoot: 0 }
document.addEventListener('selectionchange', () => { selectionEvents.document++ })
if (tree instanceof ShadowRoot) tree.addEventListener('selectionchange', () => { selectionEvents.shadowRoot++ })

const doc = new SpikeDoc(canvas, (el, opts) => new RichTextField(el, opts))
doc.load(SAMPLE)
button.addEventListener('mousedown', (e) => { e.preventDefault() })
button.addEventListener('click', () => doc.focused?.toggleFormat({ type: 'bold' }))

const first = canvas.querySelector<HTMLElement>('p')!
first.dataset.probe = 'paragraph'
const mark = (sel: string, name: string): void => { const n = first.querySelector<HTMLElement>(sel); if (n) n.dataset.probe = name }
mark('strong', 'strong'); mark('a', 'link')
const code = canvas.querySelector<HTMLElement>('code')
if (code) code.dataset.probe = 'code'

const PROPS = [
  'display', 'position', 'visibility', 'box-sizing', 'margin-top', 'margin-bottom', 'padding-top', 'padding-left',
  'border-top-width', 'border-bottom-style', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
  'text-transform', 'text-align', 'text-decoration-line', 'color', 'background-color', 'white-space', 'user-select',
  'outline-style', 'min-height',
]

declare global {
  interface Window { __isolation?: { mode: Mode; host: Host; doc: SpikeDoc; probes(): Record<string, Record<string, string>>; caps(): Record<string, unknown> } }
}

window.__isolation = {
  mode, host, doc,
  probes() {
    const out: Record<string, Record<string, string>> = {}
    for (const el of tree.querySelectorAll<HTMLElement>('[data-probe]')) {
      const cs = getComputedStyle(el)
      out[el.dataset.probe!] = Object.fromEntries(PROPS.map((p) => [p, cs.getPropertyValue(p)]))
    }
    return out
  },
  caps() {
    const sel = document.getSelection()
    const shadow = tree instanceof ShadowRoot ? tree : null
    return {
      getComposedRanges: typeof sel?.getComposedRanges === 'function',
      selectionDirection: sel ? 'direction' in sel : false,
      shadowRootGetSelection: shadow ? typeof (shadow as unknown as { getSelection?: unknown }).getSelection === 'function' : null,
      // After focusing a field: does document.getSelection() point inside the shadow tree?
      anchorInsideShadow: shadow && sel?.anchorNode ? shadow.contains(sel.anchorNode) : null,
      anchorNodeName: sel?.anchorNode?.nodeName ?? null,
      selectionEvents: { ...selectionEvents },
    }
  },
}
