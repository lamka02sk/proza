/**
 * The editor on a page: the target of the end-to-end tests and of testing
 * by hand. Everything around the editor here is playground chrome.
 */
import '../shared/playground.css'
import { type BlocksChangeEvent, createEditor, type ProzaEditor, type UploadAdapter, type UploadEvent } from '../../src/index'
import { cs } from '../../src/locales/cs'
import { de } from '../../src/locales/de'
import { es } from '../../src/locales/es'
import { fr } from '../../src/locales/fr'
import { hu } from '../../src/locales/hu'
import { sk } from '../../src/locales/sk'
import { library } from './library'
import { demoPlugin } from './plugin'
import type { Editor } from '../../src/editor/editor'
import type { StoredDoc } from '../../src/model/schema'

declare global {
  interface Window {
    __editor?: {
      proza: ProzaEditor
      editor: Editor
      createEditor: typeof createEditor
      json(): StoredDoc
      announcements: string[]
      /** Text of every block's main field in reading order, with its type, for terse assertions. */
      outline(): string[]
      /** What the host hooks saw (`?hooks`). */
      hooks: { changes: BlocksChangeEvent[]; uploads: UploadEvent[] }
    }
  }
}

const params = new URLSearchParams(location.search)
const preset = params.get('preset')
const count = Number(params.get('blocks') ?? 0)

const p = (text: string): unknown => ({ id: `p${Math.random().toString(36).slice(2, 10)}`, type: 'core/paragraph', attrs: { content: { text, formats: [] } } })
const SAMPLE = {
  version: 1,
  blocks: [
    { id: 'h1', type: 'core/heading', attrs: { level: 2, content: { text: 'Writing in Proza', formats: [] } } },
    { id: 'p1', type: 'core/paragraph', attrs: { content: { text: 'Proza is a block editor. This line has bold, italic and a link.', formats: [{ type: 'bold', start: 39, end: 43 }, { type: 'italic', start: 45, end: 51 }, { type: 'link', start: 58, end: 62, attrs: { href: 'https://example.com' } }] } } },
    { id: 'l1', type: 'core/list', attrs: { style: 'bullet' }, children: [
      { id: 'i1', type: 'core/list-item', attrs: { content: { text: 'First item', formats: [] } } },
      { id: 'i2', type: 'core/list-item', attrs: { content: { text: 'Second item', formats: [] } } },
    ] },
    { id: 's1', type: 'core/separator', attrs: {} },
    { id: 'q1', type: 'core/quote', attrs: { citation: { text: 'Robert Bringhurst', formats: [] } }, children: [
      { id: 'qp', type: 'core/paragraph', attrs: { content: { text: 'Typography exists to honor content.', formats: [] } } },
    ] },
    { id: 'c1', type: 'core/code', attrs: { language: 'js', content: { text: 'const x = 1', formats: [] } } },
    { id: 'p2', type: 'core/paragraph', attrs: { content: { text: 'Príliš žluťoučký kůň úpěl ďábelské ódy.', formats: [] } } },
  ],
}

const t = (text: string) => ({ text, formats: [] })
const cell = (id: string, text: string, header = false): unknown => ({ id, type: 'core/table-cell', attrs: header ? { header: true, scope: 'col' } : {}, children: [{ id: `${id}p`, type: 'core/paragraph', attrs: { content: t(text) } }] })
/** `?sample=layout`: columns, a group, a fold-out, buttons, a space and a table. */
const LAYOUT = {
  version: 1,
  blocks: [
    { id: 'lh', type: 'core/heading', attrs: { level: 2, content: t('Opening hours') } },
    { id: 'cols', type: 'core/columns', attrs: { ratio: '2-1' }, children: [
      { id: 'col1', type: 'core/column', attrs: {}, children: [{ id: 'cp1', type: 'core/paragraph', attrs: { content: t('The shop is open every day except Monday.') } }] },
      { id: 'col2', type: 'core/column', attrs: {}, children: [{ id: 'cp2', type: 'core/paragraph', attrs: { content: t('Call before you come on holidays.') } }] },
    ] },
    { id: 'tbl', type: 'core/table', attrs: { caption: t('Hours by day') }, children: [
      { id: 'r0', type: 'core/table-row', attrs: {}, children: [cell('a0', 'Day', true), cell('b0', 'Opens', true), cell('c0', 'Closes', true)] },
      { id: 'r1', type: 'core/table-row', attrs: {}, children: [cell('a1', 'Tuesday'), cell('b1', '9:00'), cell('c1', '18:00')] },
      { id: 'r2', type: 'core/table-row', attrs: {}, children: [cell('a2', 'Saturday'), cell('b2', '10:00'), cell('c2', '14:00')] },
    ] },
    { id: 'grp', type: 'core/group', attrs: { look: 'panel' }, children: [{ id: 'gp', type: 'core/paragraph', attrs: { content: t('Parking is free after six.') } }] },
    { id: 'det', type: 'core/details', attrs: { summary: t('Do you deliver?') }, children: [{ id: 'dp', type: 'core/paragraph', attrs: { content: t('Within the town, on Fridays.') } }] },
    { id: 'btns', type: 'core/buttons', attrs: {}, children: [
      { id: 'bt1', type: 'core/button', attrs: { text: t('Book a visit'), href: '/book' } },
      { id: 'bt2', type: 'core/button', attrs: { text: t('Prices'), look: 'line' } },
    ] },
    { id: 'sp', type: 'core/spacer', attrs: { height: 's' } },
    { id: 'lp', type: 'core/paragraph', attrs: { content: t('See you soon.') } },
  ],
}

const content = count > 0
  ? { version: 1, blocks: Array.from({ length: count }, (_, i) => p(`Paragraph ${i + 1}. The quick brown fox jumps over the lazy dog, again and again.`)) }
  : params.has('empty') ? { version: 1, blocks: [] } : params.get('sample') === 'layout' ? LAYOUT : SAMPLE

/** The playground's upload adapter: XHR for progress, `?upload=off` for none, `?upload=fail` for a failing host. */
const upload: UploadAdapter = (file, { onProgress, signal }) => new Promise((resolve, reject) => {
  if (params.get('upload') === 'fail') { setTimeout(() => { reject(new Error('Host refused the file')) }, 50); return }
  const xhr = new XMLHttpRequest()
  xhr.open('POST', `/__upload?name=${encodeURIComponent(file.name)}`)
  xhr.setRequestHeader('content-type', file.type || 'application/octet-stream')
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total) }
  xhr.onload = () => { if (xhr.status === 200) resolve(JSON.parse(xhr.responseText) as { url: string }); else reject(new Error(String(xhr.status))) }
  xhr.onerror = () => { reject(new Error('Network error')) }
  signal.addEventListener('abort', () => { xhr.abort(); reject(new Error('Aborted')) })
  // `?upload=slow` holds the request a moment, so progress and Cancel can be seen.
  setTimeout(() => { if (!signal.aborted) xhr.send(file) }, params.get('upload') === 'slow' ? 1500 : 0)
})

const PAGES = [
  { title: 'About us', url: '/about', kind: 'Page' },
  { title: 'Contact', url: '/contact', kind: 'Page' },
  { title: 'Prices', url: '/prices', kind: 'Page' },
  { title: 'Spring opening hours', url: '/blog/spring-hours', kind: 'Article' },
]

const hookLog: { changes: BlocksChangeEvent[]; uploads: UploadEvent[] } = { changes: [], uploads: [] }
const theme = params.get('theme')
const dir = params.get('dir')
const proza = createEditor({
  target: '#editor',
  content,
  locale: params.get('locale') ?? 'en',
  languages: [sk, cs, de, es, fr, hu],
  label: 'Content',
  colorScheme: theme === 'dark' || theme === 'light' ? theme : 'auto',
  ...(dir === 'rtl' || dir === 'ltr' ? { dir } : {}),
  toolbar: params.get('toolbar') === 'docked' ? 'docked' : 'bubble',
  ...(params.get('upload') === 'off' ? {} : { upload }),
  links: async (query) => {
    await new Promise((r) => setTimeout(r, 80))
    return PAGES.filter((p) => p.title.toLowerCase().includes(query.toLowerCase()))
  },
  ...(preset === 'basic' || preset === 'standard' || preset === 'full' ? { preset } : {}),
  ...(params.has('rawhtml') ? { rawHtml: true } : {}),
  ...(params.has('locking') ? { locking: true } : {}),
  ...(params.has('plugin') ? { plugins: [demoPlugin] } : {}),
  ...(params.has('justify') ? { justify: true } : {}),
  // Legacy HTML (decision 0020): styles and classes kept, frames of a map site allowed.
  ...(params.has('legacy') ? { legacy: { frames: ['maps.example.org'] } } : {}),
  // `?onsave=block`: the checker keeps the text from saving while errors remain.
  ...(params.get('onsave') === 'block' ? { a11y: { onSave: 'block' as const } } : {}),
  // `?hooks` records the host hooks; `?library` adds a stand-in attachment manager.
  ...(params.has('hooks') || params.has('library') ? { hooks: {
    ...(params.has('hooks') ? { blocksChange: (e: BlocksChangeEvent) => { hookLog.changes.push(e) }, upload: (e: UploadEvent) => { hookLog.uploads.push(e) } } : {}),
    ...(params.has('library') ? { requestAttachment: library(params.get('library') === 'slow') } : {}),
  } } : {}),
  // `?styles`: host style variants, with the host's stylesheet for them (TinyMCE importcss).
  ...(params.has('styles') ? { theme: {
    styles: { 'core/paragraph': [{ name: 'lead', label: 'Lead' }, { name: 'note', label: 'Note' }], 'core/group': [{ name: 'callout', label: 'Callout' }] },
    css: '.pz-style-lead { font-size: 1.2em; } .pz-style-note { color: #4B4C56; font-style: italic; } .pz-style-callout { padding: 12px; border-radius: 8px; background: #FFF0E8; }',
  } } : {}),
  patterns: [
    {
      id: 'question',
      title: 'Question and answer',
      keywords: ['faq'],
      blocks: [
        { type: 'core/heading', attrs: { level: 3, content: { text: 'Question?', formats: [] } } },
        { type: 'core/paragraph', attrs: { content: { text: 'Answer.', formats: [] } } },
      ],
    },
  ],
})
const { editor } = proza

const announcements: string[] = []
const jsonOut = document.querySelector<HTMLElement>('#json')!
const htmlOut = document.querySelector<HTMLElement>('#html')!
const announceOut = document.querySelector<HTMLElement>('#announce')!
let frame = 0
const update = (): void => {
  if (frame || count > 0) return
  frame = requestAnimationFrame(() => {
    frame = 0
    jsonOut.textContent = JSON.stringify(editor.getJSON(), null, 1)
    htmlOut.textContent = editor.getHTML()
  })
}
editor.on('change', update)
update()
editor.on('announce', (text) => {
  announcements.push(text)
  announceOut.textContent = announcements.slice(-30).join('\n')
})

window.__editor = {
  proza,
  editor,
  createEditor,
  json: () => editor.getJSON(),
  announcements,
  hooks: hookLog,
  outline: () => {
    const out: string[] = []
    const walk = (blocks: StoredDoc['blocks'], depth: number): void => {
      for (const b of blocks) {
        const v = Object.values(b.attrs).find((a): a is { text: string } => typeof a === 'object' && a !== null && 'text' in a)
        out.push(`${'  '.repeat(depth)}${b.type.replace('core/', '')}${b.type === 'core/heading' ? String(b.attrs.level) : ''}${v && (v.text !== '' || !b.children) ? `: ${v.text}` : ''}`)
        if (b.children) walk(b.children, depth + 1)
      }
    }
    walk(editor.getJSON().blocks, 0)
    return out
  },
}
