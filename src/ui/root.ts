/**
 * The editor as a form field: the
 * canvas, the tools beside the part, the menus, the format bar and the
 * status line, in one bordered control.
 */
import { type PropType, computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import type { Editor } from '../editor/editor'
import { focusBlock } from '../editor/selection'
import { childrenOf, parentOf } from '../model/tree'
import { AddMenu } from './add-menu'
import { ACTIONS_ID, BlockList, EDITOR } from './canvas'
import { type UiOptions, createUi, topLevel, uiKey, track } from './context'
import { HelpDialog, ImportReportDialog, SourceDialog } from './dialogs'
import { FormatBar } from './format-bar'
import { measureParts, playParts } from './motion'
import { PartOptions } from './options'
import { Appender, PartTools } from './parts'
import { StatusLine } from './status'
import { CharactersDialog, CountsDialog, FindBar, PageDialog, useInvisibles } from './tools'
import type { UiStrings } from './strings'

export const EditorRoot = defineComponent({
  name: 'ProzaEditor',
  props: {
    editor: { type: Object as PropType<Editor>, required: true },
    ui: { type: Object as PropType<UiStrings>, required: true },
    label: { type: String, default: '' },
    colorScheme: { type: String as PropType<'light' | 'dark' | 'auto'>, default: 'auto' },
    options: { type: Object as PropType<UiOptions>, default: () => ({}) },
    /** Interface direction; default from the locale. */
    dir: { type: String as PropType<'ltr' | 'rtl' | ''>, default: '' },
  },
  setup(props) {
    const editor = props.editor
    const t = props.dir ? { ...props.ui, dir: props.dir } : props.ui
    const ui = createUi(editor, t, props.options)
    provide(EDITOR, editor)
    provide(uiKey, ui)
    const canvas = ref<HTMLElement>()
    const field = ref<HTMLElement>()
    const offs: (() => void)[] = []

    onMounted(() => {
      editor.attachCanvas(canvas.value!)
      const doc = canvas.value!.ownerDocument
      const up = (): void => { ui.pointerDown.value = false }
      doc.addEventListener('pointerup', up)
      offs.push(() => { doc.removeEventListener('pointerup', up) })
    })
    onBeforeUnmount(() => { for (const off of offs) off(); ui.uploads.destroy(); ui.attachments.destroy() })
    offs.push(useInvisibles(ui))

    // Commands that ask the interface for something (Alt+F10, the outline).
    offs.push(editor.on('ui', (name) => {
      const work = ui.work.value
      if (name === 'toolbar' && work) {
        // The bubble when words are selected, otherwise the tools of the part.
        // A part's own tools (a table's cell tools) come before the part tools.
        const target = work.parentElement?.querySelector<HTMLElement>('.bubble.is-on [tabindex="0"], .bubble.is-on button')
          ?? work.querySelector<HTMLElement>('.part-tools [tabindex="0"], .part-tools button')
          ?? work.querySelector<HTMLElement>('.gut:not(.is-hover) [tabindex="0"], .gut:not(.is-hover) button')
        target?.focus()
      }
      if (name === 'outline') ui.outlineOpen.value = true
      if (name === 'check') ui.checkOpen.value = true
    }))

    // Moved parts glide to their new place.
    let before = new Map<string, number>()
    offs.push(editor.on('willChange', (ops) => {
      if (ops.length === 0 || ops.some((o) => o.type === 'moveBlocks')) before = measureParts(canvas.value ?? null)
    }))
    offs.push(editor.on('change', () => {
      if (before.size === 0) return
      const was = before
      before = new Map()
      void nextTick(() => { playParts(canvas.value ?? null, was) })
    }))

    // Escape from any toolbar or tool goes back to the caret.
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const t = e.target
      if (t instanceof Element && t.closest('.gut, .bubble, .status-r, .part-tools') && !t.closest('[role="menu"], .pop')) {
        e.preventDefault()
        ui.linking.value = false
        ui.focusText()
      }
    }

    const onFocusIn = (): void => { ui.focused.value = true }
    const onFocusOut = (e: FocusEvent): void => {
      const next = e.relatedTarget
      if (next instanceof Node && field.value?.contains(next)) return
      // The paste bin and menus take the focus for a moment; check once it has settled.
      queueMicrotask(() => {
        const root = field.value?.getRootNode() as Document | ShadowRoot | undefined
        const active = root?.activeElement ?? null
        if (active && field.value?.contains(active)) return
        ui.focused.value = false
        ui.linking.value = false
      })
    }

    // The part under the pointer: the row's block at the middle of the text column.
    let frame = 0
    const onPointerMove = (e: PointerEvent): void => {
      if (frame || ui.dragging.value || e.pointerType === 'touch') return
      const y = e.clientY
      frame = requestAnimationFrame(() => {
        frame = 0
        const c = canvas.value
        if (!c) return
        const r = c.getBoundingClientRect()
        if (y < r.top || y > r.bottom) { ui.hover.value = null; return }
        const root = c.getRootNode() as Document | ShadowRoot
        const hit = root.elementFromPoint(r.left + r.width / 2, y)
        const block = hit?.closest<HTMLElement>('[data-block]')?.dataset.block ?? null
        const top = topLevel(editor.tree, block)
        // Over the tools themselves the part stays the same.
        if (top !== null || !hit?.closest('.gut')) ui.hover.value = top
      })
    }

    // Fullscreen: the field goes into the top layer.
    watch(ui.full, (v) => {
      void nextTick(() => {
        const el = field.value
        if (!el || typeof el.showPopover !== 'function') return
        if (v) { el.setAttribute('popover', 'manual'); el.showPopover() } else if (el.hasAttribute('popover')) { el.hidePopover(); el.removeAttribute('popover') }
        ui.focusText()
      })
    })

    const empty = computed(() => {
      track(editor.revision.value)
      const top = childrenOf(editor.tree, null)
      const n = top.length === 1 ? editor.tree.nodes.get(top[0]!) : undefined
      return n?.type === 'core/paragraph' && (n.attrs.content as { text: string }).text === ''
    })
    const starters = computed(() => ui.items.filter((i) => i.id in t.starters))
    const wordInput = ref<HTMLInputElement>()
    const readWord = (file: File): void => {
      editor.announce(t.reading(file.name))
      editor.importDocx(file).then(() => { ui.focusText() }, () => { editor.announce(t.unreadable(file.name), 'assertive') })
    }

    const placement = computed((): 'bubble' | 'docked' | 'touch' => (ui.coarse.value ? 'touch' : ui.toolbar))

    /** The nearest block around the selection with tools of its own (a table), and those tools. */
    const ownTools = computed(() => {
      track(editor.revision.value)
      for (let id = focusBlock(editor.selectionRef.value); id !== null && editor.tree.nodes.has(id); id = parentOf(editor.tree, id)) {
        const tools = editor.editingFor(editor.tree.nodes.get(id)!.type)?.tools
        if (tools) return { id, tools }
      }
      return null
    })

    // Draft recovery: the words of when it was written, in the interface language.
    const draftWhen = (saved: number): string => {
      const d = new Date(saved)
      const today = new Date().toDateString() === d.toDateString()
      const opts: Intl.DateTimeFormatOptions = today ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' }
      return new Intl.DateTimeFormat(editor.strings.lang, opts).format(d)
    }
    const answerDraft = (restore: boolean): void => {
      ui.draftFound.value = false
      if (restore) ui.draft?.restore(t.draftRestored)
      else { ui.draft?.discard(); editor.announce(t.draftDiscarded) }
      ui.focusText()
    }
    onMounted(() => { const found = ui.draft?.found; if (found) editor.announce(t.draftFound(draftWhen(found.saved))) })

    return () => {
      const part = ui.part.value
      const readOnly = editor.readOnly.value
      const showTools = !readOnly && (ui.focused.value || ui.options.value !== null || ui.add.value !== null)
      const found = ui.draftFound.value ? ui.draft?.found : null
      const hover = ui.hover.value
      return h('div', {
        class: ['pz', props.colorScheme !== 'auto' && props.colorScheme, ui.coarse.value && 'is-touch'],
        lang: editor.strings.lang,
        dir: t.dir,
      }, h('div', {
        ref: field,
        class: ['ed', ui.full.value && 'is-full', placement.value === 'docked' && !readOnly && 'has-docked', readOnly && 'is-readonly', ui.height && 'is-fixed'],
        // CSSOM, not a style attribute: allowed under a strict CSP.
        style: ui.height ? { '--pz-height': ui.height } : undefined,
        role: 'group',
        'aria-label': props.label || editor.strings.editor,
        onFocusin: onFocusIn,
        onFocusout: onFocusOut,
        onKeydown,
      }, [
        found ? h('div', { class: 'note', role: 'group', 'aria-label': t.draftFound(draftWhen(found.saved)) }, [
          h('span', { class: 'note-text', 'aria-hidden': 'true' }, t.draftFound(draftWhen(found.saved))),
          h('button', { type: 'button', class: 'btn btn-s btn-line', 'data-pz-draft': 'restore', onClick: () => { answerDraft(true) } }, t.draftRestore),
          h('button', { type: 'button', class: 'btn btn-s btn-line', 'data-pz-draft': 'discard', onClick: () => { answerDraft(false) } }, t.draftDiscard),
        ]) : null,
        placement.value === 'docked' && !readOnly ? h(FormatBar, { placement: 'docked' }) : null,
        h('div', {
          ref: (el: unknown) => { ui.work.value = el instanceof HTMLElement ? el : null },
          class: ['work', ui.preview.value !== '' && ['is-preview', `is-${ui.preview.value}`], ui.dragging.value && 'is-dragging'],
          onPointermove: onPointerMove,
          onPointerleave: () => { if (!ui.dragging.value) ui.hover.value = null },
          onPointerdown: (e: PointerEvent) => { if (e.target instanceof Element && e.target.closest('.pz-canvas')) ui.pointerDown.value = true },
        }, [
          h('div', { ref: canvas, class: ['pz-canvas', 'pz-content', showTools && 'has-tools', ui.invisibles.value && 'is-invisibles', ui.outlines.value && 'is-outlines'] }, [
            h(BlockList, { parent: null }),
            h('p', { id: ACTIONS_ID, hidden: true }, editor.strings.blockActions),
          ]),
          !readOnly && empty.value && starters.value.length > 0 ? h('div', { class: 'starter' }, [
            h('span', { class: 'lab' }, t.startWith),
            ...starters.value.map((item) => h('button', {
              type: 'button', class: 'btn btn-line',
              onClick: () => { ui.insert(item, { kind: 'end' }) },
            }, t.starters[item.id])),
            h('button', { type: 'button', class: 'btn btn-line', 'data-pz-word': '', onClick: () => { wordInput.value?.click() } }, t.fromWord),
          ]) : null,
          // A Word file (`.docx`): chosen here, converted by mammoth.js on first use.
          h('input', {
            ref: wordInput, type: 'file', hidden: true, tabindex: -1, 'aria-hidden': 'true',
            accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            onChange: (e: Event) => { const input = e.target as HTMLInputElement; const file = input.files?.[0]; input.value = ''; if (file) readWord(file) },
          }),
          // Tab order after the text: the part's tools, then Add.
          // Selected parts keep their stems after the focus leaves (state is never colour alone).
          // Read-only: nothing that changes the text is drawn (TinyMCE's read-only mode).
          ...(readOnly ? [] : [
            part !== null && (showTools || editor.selectionRef.value.kind === 'blocks') ? h(PartTools, { id: part, key: 'current' }) : null,
            hover !== null && hover !== part && !ui.coarse.value ? h(PartTools, { id: hover, hover: true, key: 'hover' }) : null,
            ownTools.value && showTools ? h(ownTools.value.tools, { id: ownTools.value.id, key: `tools:${ownTools.value.id}` }) : null,
            h(Appender, { label: t.addSomething }),
            placement.value === 'bubble' ? h(FormatBar, { placement: 'bubble' }) : null,
            h(AddMenu),
            h(PartOptions),
          ]),
        ]),
        h(FindBar),
        h(StatusLine),
        placement.value === 'touch' && !readOnly ? h(FormatBar, { placement: 'touch' }) : null,
        h(HelpDialog),
        h(SourceDialog),
        h(ImportReportDialog),
        h(CountsDialog),
        h(CharactersDialog),
        h(PageDialog),
      ]))
    }
  },
})
