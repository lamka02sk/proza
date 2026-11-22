/**
 * Records every format of a paste as a fixture for the import pipeline
 * Format: tests/fixtures/clipboard/README.md.
 */
import '../../shared/playground.css'

interface Fixture {
  schema: 1
  source: string
  sourceVersion: string
  os: string
  browser: string
  userAgent: string
  captured: string
  description: string
  notes: string
  via: 'paste-event' | 'async-clipboard'
  types: string[]
  data: Record<string, string>
  files: { name: string; type: string; size: number; dataUrl: string }[]
}

const $ = (sel: string): HTMLElement => document.querySelector<HTMLElement>(sel)!
const value = (sel: string): string => document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(sel)!.value.trim()
const MAX_FILE = 5 * 1024 * 1024

document.querySelector<HTMLInputElement>('#os')!.value = guessOs()
let current: Fixture | null = null

$('#zone').addEventListener('paste', (e) => {
  e.preventDefault()
  const dt = e.clipboardData
  if (!dt) return
  const data: Record<string, string> = {}
  for (const type of dt.types) if (type !== 'Files') data[type] = dt.getData(type)
  void Promise.all([...dt.files].map(readFile)).then((files) => { show({ via: 'paste-event', types: [...dt.types], data, files }) })
})

$('#read').addEventListener('click', () => {
  void (async () => {
    try {
      const items = await navigator.clipboard.read()
      const data: Record<string, string> = {}
      const files: Fixture['files'] = []
      const types: string[] = []
      for (const item of items) {
        for (const type of item.types) {
          types.push(type)
          const blob = await item.getType(type)
          if (type.startsWith('text/') || type.startsWith('web ')) data[type] = await blob.text()
          else files.push(await readFile(new File([blob], `clipboard.${type.split('/')[1] ?? 'bin'}`, { type })))
        }
      }
      show({ via: 'async-clipboard', types, data, files })
    } catch (err) {
      status(`Could not read the clipboard: ${String(err)}`)
    }
  })()
})

$('#download').addEventListener('click', () => {
  if (!current) return
  const meta = document.querySelector<HTMLFormElement>('#meta')!
  if (!meta.reportValidity()) return
  const f: Fixture = {
    ...current,
    source: value('#source'),
    sourceVersion: value('#version'),
    os: value('#os'),
    description: value('#description'),
    notes: value('#notes'),
  }
  const stamp = f.captured.replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')
  const name = `${f.source}--${slug(f.os)}--${slug(f.browser)}--${stamp}.json`
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(f, null, 2) + '\n'], { type: 'application/json' }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
  status(`Saved ${name}. Put it in tests/fixtures/clipboard/${f.source}/.`)
})

function show(part: Pick<Fixture, 'via' | 'types' | 'data' | 'files'>): void {
  current = {
    schema: 1, source: '', sourceVersion: '', os: '', description: '', notes: '',
    browser: guessBrowser(), userAgent: navigator.userAgent, captured: new Date().toISOString(), ...part,
  }
  $('#types').textContent = [
    ...Object.entries(part.data).map(([t, v]) => `${t}: ${v.length} characters`),
    ...part.files.map((f) => `file ${f.name} (${f.type}): ${f.size} bytes${f.dataUrl ? '' : ', too large, not embedded'}`),
  ].join('\n') || 'Nothing captured.'
  document.querySelector<HTMLIFrameElement>('#preview')!.srcdoc = part.data['text/html'] ?? ''
  document.querySelector<HTMLButtonElement>('#download')!.disabled = false
  status(`Captured ${part.types.length} formats. Fill in the description, then download.`)
}

function readFile(file: File): Promise<Fixture['files'][number]> {
  if (file.size > MAX_FILE) return Promise.resolve({ name: file.name, type: file.type, size: file.size, dataUrl: '' })
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => { resolve({ name: file.name, type: file.type, size: file.size, dataUrl: typeof r.result === 'string' ? r.result : '' }) }
    r.onerror = () => { reject(r.error ?? new Error('read failed')) }
    r.readAsDataURL(file)
  })
}

function status(text: string): void { $('#status').textContent = text }
function slug(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown' }

function guessOs(): string {
  const ua = navigator.userAgent
  if (/Android/.test(ua)) return 'Android'
  if (/iPhone|iPad/.test(ua)) return 'iOS'
  if (/Mac OS X/.test(ua)) return 'macOS'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Linux/.test(ua)) return 'Linux'
  return ''
}

function guessBrowser(): string {
  const ua = navigator.userAgent
  const m = /(Edg|Firefox|Chrome|Version)\/(\d+)/.exec(ua)
  if (!m) return 'unknown'
  const name = m[1] === 'Edg' ? 'Edge' : m[1] === 'Version' ? 'Safari' : m[1]!
  return `${name} ${m[2]}`
}
