/**
 * Modal dialogs: keyboard help, the source
 * view and the import report. Native `<dialog>` in the shadow root: `showModal()` puts it in the top
 * layer, makes the rest inert and restores focus on close, which Reka's focus
 * trap cannot do across a shadow boundary.
 */
import { type Ref, type VNode, defineComponent, h, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useUi } from './context'
import type { Severity } from '../import/report'
import { icon } from './icons'

/**
 * A modal dialog bound to `open`; Escape and the close button set it false.
 * `closeToText` closes it and returns to the caret instead of the opener (after inserting a character).
 */
export function useDialog(open: Ref<boolean>, fallback: () => HTMLElement | null = () => null, toText: () => void = () => undefined) {
  const el = ref<HTMLDialogElement>()
  let opener: Element | null = null
  let backToText = false
  watch(open, (v) => {
    void nextTick(() => {
      const d = el.value
      if (!d) return
      if (v && !d.open) {
        const root = d.getRootNode() as Document | ShadowRoot
        opener = root.activeElement
        d.showModal()
      } else if (!v && d.open) d.close()
    })
  })
  const onClose = (): void => {
    open.value = false
    if (backToText) { backToText = false; toText(); return }
    // Engines restore focus on their own; this covers the ones that lose it inside a shadow root.
    // The opener may be gone (a popover that closed when the dialog took the focus): then the fallback.
    const back = opener instanceof HTMLElement && opener.isConnected ? opener : fallback()
    back?.focus()
  }
  const closeToText = (): void => { backToText = true; el.value?.close() }
  return { el, onClose, closeToText }
}

export function frame(el: Ref<HTMLDialogElement | undefined>, onClose: () => void, titleId: string, title: string, closeLabel: string, body: (VNode | null)[], wide = false): VNode {
  return h('dialog', { ref: el, class: ['dlg', wide && 'dlg-wide'], 'aria-labelledby': titleId, onClose }, [
    h('div', { class: 'dlg-head' }, [
      h('h2', { class: 'dlg-title', id: titleId }, title),
      h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': closeLabel, title: closeLabel, onClick: () => { el.value?.close() } }, icon('close')),
    ]),
    // Focusable, so a keyboard can scroll a long body (axe scrollable-region-focusable).
    h('div', { class: 'dlg-body', tabindex: 0 }, body),
  ])
}

export const HelpDialog = defineComponent({
  name: 'ProzaHelpDialog',
  setup() {
    const ui = useUi()
    const { editor, t } = ui
    const { el, onClose } = useDialog(ui.helpOpen, () => ui.work.value?.parentElement?.querySelector<HTMLElement>('[data-pz-help]') ?? null)
    // Alt+0 (Ctrl+Option+H on a Mac) opens it from anywhere in the editor.
    onBeforeUnmount(editor.on('ui', (name) => { if (name === 'help') ui.helpOpen.value = true }))
    return () => frame(el, onClose, 'pz-keys-title', editor.strings.help.title, t.close, ui.helpOpen.value ? editor.keyboardHelp().map((g) => h('section', { class: 'keys' }, [
      h('h3', null, g.title),
      h('dl', null, g.entries.flatMap((e) => [h('dt', null, h('kbd', null, e.keys)), h('dd', null, e.text)])),
    ])) : [])
  },
})

export const SourceDialog = defineComponent({
  name: 'ProzaSourceDialog',
  setup() {
    const ui = useUi()
    const { editor, t } = ui
    const { el, onClose } = useDialog(ui.sourceOpen)
    const json = ref('')
    const html = ref('')
    const error = ref('')
    const copied = ref(false)
    watch(ui.sourceOpen, (v) => {
      if (!v) return
      json.value = JSON.stringify(editor.getJSON(), null, 2)
      html.value = editor.getHTML()
      error.value = ''
      copied.value = false
    })
    // HTML re-enters through the import pipeline; its report says what did not fit.
    const applyHtml = (): void => {
      editor.replaceHtml(html.value, t.sourceApplied)
      el.value?.close()
    }
    const apply = (): void => {
      let parsed: unknown
      try { parsed = JSON.parse(json.value) } catch (e) { error.value = t.sourceInvalid(e instanceof Error ? e.message : String(e)); return }
      const issues = editor.replaceContent(parsed, t.sourceApplied)
      if (issues.length > 0) {
        editor.announce(t.sourceRepaired(issues.length), 'polite', true)
      }
      el.value?.close()
    }
    const copy = (): void => {
      void navigator.clipboard.writeText(editor.getHTML()).then(() => { copied.value = true }, () => { copied.value = false })
    }
    return () => frame(el, onClose, 'pz-source-title', t.sourceTitle, t.close, ui.sourceOpen.value ? [
      h('label', { class: 'lab', for: 'pz-source-json' }, t.sourceJson),
      h('p', { class: 'hint', id: 'pz-source-json-hint' }, t.sourceJsonHint),
      h('textarea', {
        id: 'pz-source-json', class: 'field code', rows: 12, spellcheck: 'false', value: json.value,
        'aria-describedby': error.value ? 'pz-source-json-hint pz-source-error' : 'pz-source-json-hint',
        'aria-invalid': error.value ? 'true' : undefined,
        onInput: (e: Event) => { json.value = (e.target as HTMLTextAreaElement).value; error.value = '' },
      }),
      error.value ? h('p', { class: 'hint is-error', id: 'pz-source-error', role: 'alert' }, error.value) : null,
      h('div', { class: 'dlg-actions' }, [h('button', { type: 'button', class: 'btn btn-add', onClick: apply }, t.apply)]),
      h('label', { class: 'lab', for: 'pz-source-html' }, t.sourceHtml),
      h('p', { class: 'hint', id: 'pz-source-html-hint' }, t.sourceHtmlHint),
      h('textarea', {
        id: 'pz-source-html', class: 'field code', rows: 8, spellcheck: 'false', value: html.value, 'aria-describedby': 'pz-source-html-hint',
        onInput: (e: Event) => { html.value = (e.target as HTMLTextAreaElement).value },
      }),
      h('div', { class: 'dlg-actions' }, [
        h('button', { type: 'button', class: 'btn btn-line', onClick: copy }, copied.value ? t.copied : t.copy),
        h('button', { type: 'button', class: 'btn btn-add', onClick: applyHtml }, t.applyHtml),
      ]),
    ] : [])
  },
})

/**
 * What an import changed: a summary, then what
 * was not kept, what was changed to fit, and what was done for the author.
 * Groups are headed in words, never told apart by colour alone.
 */
export const ImportReportDialog = defineComponent({
  name: 'ProzaImportReportDialog',
  setup() {
    const ui = useUi()
    const { t } = ui
    const { el, onClose } = useDialog(ui.reportOpen, () => ui.work.value?.parentElement?.querySelector<HTMLElement>('[data-pz-report]') ?? null)
    return () => {
      const e = ui.report.value
      const body: (VNode | null)[] = []
      if (ui.reportOpen.value && e) {
        const count = (s: Severity): number => e.report.entries.filter((x) => x.severity === s).length
        body.push(h('p', { class: 'report-sum' }, t.importSummary(e.origin, t.importSources[e.report.source], count('lost'), count('changed'))))
        for (const severity of ['lost', 'changed', 'info'] as const) {
          const entries = e.report.entries.filter((x) => x.severity === severity)
          if (entries.length === 0) continue
          body.push(h('section', { class: ['report', `is-${severity}`] }, [
            h('h3', null, t.importGroups[severity]),
            h('ul', null, entries.map((x) => h('li', null, t.importEntries[x.code](x.count, x.samples.join(', '))))),
          ]))
        }
        body.push(h('div', { class: 'dlg-actions' }, [h('button', { type: 'button', class: 'btn btn-add', onClick: () => { el.value?.close() } }, t.importKeep)]))
      }
      return frame(el, onClose, 'pz-report-title', t.importReport, t.close, body)
    }
  },
})
