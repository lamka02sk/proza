/**
 * Host integration: textarea enhancement, the custom
 * element and the Vue component in one form. The target of tests/e2e/host.spec.ts.
 */
import '../shared/playground.css'
import { createApp, h, ref } from 'vue'
import { createEditor, type ProzaEditor as Instance } from '../../src/index'
import { defineEditorElement } from '../../src/element'
import { ProzaEditor } from '../../src/vue'
import type { StoredDoc } from '../../src/model/schema'

declare global {
  interface Window {
    __forms?: { textarea: Instance; sent: () => Record<string, string>; events: string[]; vueModel: () => StoredDoc | null; vue: () => Instance | null }
  }
}

const params = new URLSearchParams(location.search)
const height = params.get('height')
const common = {
  ...(params.has('draft') ? { draft: true } : {}),
  ...(params.has('readonly') ? { readOnly: true } : {}),
  ...(height ? { height } : {}),
  ...(params.get('onsave') === 'block' ? { a11y: { onSave: 'block' as const } } : {}),
}

defineEditorElement(common)
const textarea = createEditor({ target: '#body', ...common })

const events: string[] = []
const log = (e: Event): void => {
  const t = e.target as HTMLElement
  events.push(`${e.type}:${t.id || t.localName}`)
  document.querySelector('#events')!.textContent = events.slice(-20).join('\n')
}
for (const type of ['input', 'change', 'save']) document.querySelector('#form')!.addEventListener(type, log)

let sent: Record<string, string> = {}
const form = document.querySelector<HTMLFormElement>('#form')!
form.addEventListener('submit', (e) => {
  e.preventDefault()
  sent = Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]))
  document.querySelector('#sent')!.textContent = JSON.stringify(sent, null, 1)
})

const model = ref<StoredDoc | null>({ version: 1, blocks: [{ id: 'v1', type: 'core/paragraph', attrs: { content: { text: 'Notes kept in a Vue ref.', formats: [] } } }] } as StoredDoc)
let vue: Instance | null = null
createApp({
  setup: () => () => h(ProzaEditor, {
    modelValue: model.value,
    'onUpdate:modelValue': (v: StoredDoc) => { model.value = v },
    onReady: (i: Instance) => { vue = i },
    options: { ...common, label: 'Notes', draft: false },
  }),
}).mount('#vue')

window.__forms = { textarea, sent: () => sent, events, vueModel: () => model.value, vue: () => vue }
