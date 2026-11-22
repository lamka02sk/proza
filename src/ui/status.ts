/**
 * The status line: what you are
 * on, what just happened with Undo beside it, and the editor's tools.
 *
 * The words of the last change are shown here for 6 s. Screen readers hear
 * them from the editor's live regions; the visible copy is hidden from them,
 * so nothing is spoken twice.
 */
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ImportEvent } from '../editor/editor'
import {
  DropdownMenuContent, DropdownMenuItemIndicator, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuRoot, DropdownMenuTrigger,
  PopoverContent, PopoverRoot, PopoverTrigger, ToolbarButton, ToolbarRoot,
} from 'reka-ui'
import { frozen, lockOf } from '../editor/locks'
import { selectedBlocks } from '../editor/selection'
import { TABLE, enclosing, selectionRect } from '../editor/table'
import { displayKeys } from '../richtext/keys'
import { DEVICES, useUi, track } from './context'
import { type IconName, icon } from './icons'
import { Outline } from './outline'
import { CheckPanel, useFindings } from './checker'
import { MoreMenu } from './tools'

export const StatusLine = defineComponent({
  name: 'ProzaStatusLine',
  setup() {
    const ui = useUi()
    const { editor, t } = ui
    const message = ref<{ text: string; undoable: boolean; details: boolean; problems: boolean } | null>(null)
    let timer: ReturnType<typeof setTimeout> | undefined
    // The words of an import that changed something; the message showing them offers the report.
    let reportText = ''
    const off = editor.on('announce', (text, _p, undoable) => {
      const details = text === reportText
      // A save that found problems offers them.
      const problems = text !== '' && text === editor.checkNotice
      message.value = { text, undoable, details, problems }
      clearTimeout(timer)
      // Long enough to reach the report button by keyboard.
      timer = setTimeout(() => { message.value = null }, details || problems ? 12000 : 6000)
    })
    const onImport = (e: ImportEvent): void => {
      const changes = e.report.entries.filter((x) => x.severity !== 'info').length
      if (changes === 0) return
      reportText = t.imported(e.origin, t.importSources[e.report.source], changes)
      // After the paste's own announcement, so this is the one the status line keeps.
      void nextTick(() => { editor.announce(reportText, 'polite', e.origin !== 'load') })
    }
    const offImport = editor.on('import', onImport)
    // HTML content converted before the interface mounted.
    onMounted(() => { if (editor.lastImport?.origin === 'load') onImport(editor.lastImport) })
    // The checker's problems, counted on the button.
    const checks = useFindings(editor)
    onBeforeUnmount(() => { off(); offImport(); clearTimeout(timer); checks.stop() })
    let goingTo = false

    const canUndo = computed(() => { track(editor.revision.value); return editor.history.done.length > 0 })
    const canRedo = computed(() => { track(editor.revision.value); return editor.history.undone.length > 0 })

    // Joined into one string, so typing that keeps the part leaves it equal and re-renders nothing.
    const tipKey = computed((): string => tip().join('\u0000'))
    const tip = (): [string, string] => {
      track(editor.revision.value)
      if (editor.readOnly.value) return [t.readOnly, t.readOnlyTip]
      const s = editor.selectionRef.value
      if (s.kind === 'none') return [t.nothingSelected, t.nothingSelectedTip]
      if (s.kind === 'blocks') {
        const n = selectedBlocks(editor.tree, s).length
        return [editor.strings.blocksSelected(n), t.blocksSelectedTip]
      }
      if (s.kind === 'cells') {
        const r = selectionRect(editor.tree, s)
        return [r ? editor.strings.table.cellsSelected(r.rect.bottom - r.rect.top + 1, r.rect.right - r.rect.left + 1) : '', t.cellsSelectedTip]
      }
      if (s.kind === 'range') return [editor.strings.selectedAcross(editor.acrossParts()), t.acrossTip]
      const node = editor.tree.nodes.get(s.blockId)
      if (!node) return [t.nothingSelected, t.nothingSelectedTip]
      const def = editor.editingFor(node.type)
      // A locked part says so where the author looks for what a part does.
      const part = ui.part.value
      if (part !== null && frozen(editor.tree, s.blockId)) return [def ? def.title(node, editor.strings) : node.type, t.lockedAll]
      if (part !== null && lockOf(editor.tree, part) !== '') return [def ? def.title(node, editor.strings) : node.type, t.lockedInPlace]
      // In a table the table's tip says what Tab and the cell tools do.
      const where = enclosing(editor.tree, s.blockId, TABLE)
      return [def ? def.title(node, editor.strings) : node.type, (where !== null && where !== s.blockId ? t.tips[TABLE] : undefined) ?? t.tips[node.type] ?? t.tipDefault]
    }

    const button = (name: IconName, label: string, title: string, onClick: () => void, extra: Record<string, unknown> = {}) =>
      h(ToolbarButton, { class: ['btn', 'btn-s', 'btn-icon'], 'aria-label': label, title, onClick, ...extra }, () => icon(name))

    return () => {
      const m = message.value
      const [name = '', hint = ''] = tipKey.value.split('\u0000')
      return h('div', { class: 'status' }, [
        h('div', { class: 'status-l' }, m
          ? h('span', { class: 'msg msg-on' }, [
            h('span', { 'aria-hidden': 'true' }, m.text),
            m.details ? h('button', { type: 'button', class: 'btn btn-s btn-line', 'aria-haspopup': 'dialog', onClick: () => { ui.reportOpen.value = true } }, t.importDetails) : null,
            m.problems ? h('button', { type: 'button', class: 'btn btn-s btn-line', onClick: () => { ui.checkOpen.value = true } }, t.checkShow) : null,
            m.undoable && canUndo.value && !editor.readOnly.value ? h('button', { type: 'button', class: 'btn btn-s btn-line', onClick: () => { editor.undo(); ui.focusText() } }, t.undo) : null,
          ])
          : h('span', { class: 'msg', key: name }, [h('strong', null, name), ' ', hint])),
        h(ToolbarRoot, { class: 'status-r', 'aria-label': t.editorTools, dir: t.dir, loop: true }, () => [
          ...(editor.readOnly.value ? [] : [
            button('undo', t.undo, t.undo, () => { editor.undo(); ui.focusText() }, { disabled: !canUndo.value }),
            button('redo', t.redo, t.redo, () => { editor.redo(); ui.focusText() }, { disabled: !canRedo.value }),
            h('span', { class: 'sep', 'aria-hidden': 'true' }),
          ]),
          h(PopoverRoot, { open: ui.outlineOpen.value, 'onUpdate:open': (v: boolean) => { ui.outlineOpen.value = v } }, () => [
            h(PopoverTrigger, { asChild: true }, () => button('outline', t.outline, t.outlineTitle, () => { /* the trigger toggles */ }, { 'data-pz-outline': '' })),
            h(PopoverContent, { class: 'pop pop-outline', side: 'top', align: 'end', sideOffset: 6, collisionPadding: 8, dir: t.dir }, () => h(Outline)),
          ]),
          h(PopoverRoot, { open: ui.checkOpen.value, 'onUpdate:open': (v: boolean) => { if (v) checks.refresh(); ui.checkOpen.value = v } }, () => {
            const n = checks.findings.value.length
            return [
              h(PopoverTrigger, { asChild: true }, () => h(ToolbarButton, {
                class: ['btn', 'btn-s', 'btn-icon', 'btn-count'], 'aria-label': t.checkCount(n), title: t.checkCount(n), 'data-pz-check': '',
              }, () => [icon('access'), n > 0 ? h('span', { class: 'count', 'aria-hidden': 'true' }, n > 99 ? '99+' : String(n)) : null])),
              h(PopoverContent, {
                class: 'pop pop-outline', side: 'top', align: 'end', sideOffset: 6, collisionPadding: 8, dir: t.dir,
                // Going to a problem leaves the focus in the canvas; closing otherwise returns it to the button.
                onCloseAutoFocus: (e: Event) => { if (goingTo) { e.preventDefault(); goingTo = false } },
              }, () => h(CheckPanel, { findings: checks.findings, refresh: checks.refresh, onGo: () => { goingTo = true; ui.checkOpen.value = false } })),
            ]
          }),
          // Device preview (`preview`): the canvas at a device's width, the content answering it.
          h(DropdownMenuRoot, { modal: false }, () => [
            h(DropdownMenuTrigger, { asChild: true }, () => button(ui.preview.value === 'tablet' ? 'tablet' : 'phone', t.preview, t.previewTitle, () => { /* the trigger toggles */ }, {
              class: ['btn', 'btn-s', 'btn-icon', ui.preview.value !== '' && 'is-on'], 'data-pz-preview': '',
            })),
            h(DropdownMenuContent, {
              class: 'pop pop-menu', side: 'top', align: 'end', sideOffset: 6, collisionPadding: 8,
              onCloseAutoFocus: (e: Event) => { e.preventDefault(); ui.focusText() },
            }, () => h(DropdownMenuRadioGroup, {
              modelValue: ui.preview.value,
              'onUpdate:modelValue': (raw: unknown) => {
                const v = raw === 'tablet' || raw === 'phone' ? raw : ''
                ui.preview.value = v
                editor.announce(v === '' ? t.previewOff : t.previewOn(t.devices[v], DEVICES[v]))
              },
            }, () => (['', 'tablet', 'phone'] as const).map((v) => h(DropdownMenuRadioItem, { value: v, class: 'btn' }, () => [
              icon(v === '' ? 'expand' : v),
              h('span', { class: 'menu-text' }, [v === '' ? t.previewNone : t.devices[v], v === '' ? null : h('span', { class: 'menu-meta' }, `${DEVICES[v]} px`)]),
              h(DropdownMenuItemIndicator, { asChild: true }, () => icon('check')),
            ])))),
          ]),
          ui.report.value ? button('swap', t.importReport, t.importReport, () => { ui.reportOpen.value = true }, { 'aria-haspopup': 'dialog', 'data-pz-report': '' }) : null,
          button('source', t.source, t.sourceTitle, () => { ui.sourceOpen.value = true }, { 'aria-haspopup': 'dialog' }),
          button(ui.full.value ? 'collapse' : 'expand', ui.full.value ? t.collapse : t.expand, ui.full.value ? t.collapse : t.expandTitle, () => { ui.full.value = !ui.full.value }, { 'aria-pressed': ui.full.value ? 'true' : 'false' }),
          h(PopoverRoot, null, () => [
            h(PopoverTrigger, { asChild: true }, () => button('help', t.help, t.help, () => { /* the trigger toggles */ }, { 'data-pz-help': '' })),
            h(PopoverContent, { class: 'pop pop-pad', side: 'top', align: 'end', sideOffset: 6, collisionPadding: 8, dir: t.dir }, () => [
              h('strong', { class: 'pop-title' }, t.helpTitle),
              ...t.helpPoints.map((p) => h('p', { class: 'pop-text' }, p)),
              h('button', { type: 'button', class: 'btn btn-line', onClick: () => { ui.helpOpen.value = true } }, [t.allShortcuts, h('kbd', null, displayKeys(editor.keymap.keysFor('help')[0] ?? '', editor.keymap.mac, editor.strings.keyNames))]),
            ]),
          ]),
          // The parity tools: find and replace, characters, counts, the page as published.
          h(MoreMenu),
        ]),
      ])
    }
  },
})
