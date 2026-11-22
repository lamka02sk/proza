/**
 * The format bar: bold, italic, link and
 * more, for the field with the caret. Three placements, one component:
 *
 * - `bubble` (default): above the selected words, only while words are selected.
 * - `docked`: sticky at the top of the field, whenever a field has the caret.
 * - `touch`: above the on-screen keyboard (visualViewport), in the top layer.
 */
import { type PropType, computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuRoot, DropdownMenuTrigger, ToolbarButton, ToolbarRoot } from 'reka-ui'
import type { FormatTarget } from '../editor/editor'
import { safeUrl } from '../model/url'
import { type LinkSuggestion, useUi, track } from './context'
import { icon } from './icons'
import { keyboardInset } from './search'

const MORE = ['underline', 'strikethrough', 'code', 'superscript', 'subscript'] as const

export const FormatBar = defineComponent({
  name: 'ProzaFormatBar',
  props: { placement: { type: String as PropType<'bubble' | 'docked' | 'touch'>, required: true } },
  setup(props) {
    const ui = useUi()
    const { editor, t } = ui
    const el = ref<HTMLElement>()
    const url = ref('')
    const urlError = ref(false)
    const newWindow = ref(false)
    // Link search (`links`): the host's pages and the parts of this text with an anchor.
    const found = ref<readonly LinkSuggestion[]>([])
    const searching = ref(false)
    const activeLink = ref(-1)
    let searchTimer: ReturnType<typeof setTimeout> | undefined
    let searchAbort: AbortController | null = null
    const anchors = (q: string): LinkSuggestion[] => {
      const out: LinkSuggestion[] = []
      const needle = q.toLowerCase()
      for (const n of editor.tree.nodes.values()) {
        const a = n.attrs.anchor
        if (typeof a !== 'string' || a === '') continue
        const title = editor.labelFor(n)
        if (needle === '' || a.toLowerCase().includes(needle) || title.toLowerCase().includes(needle)) out.push({ title, url: `#${a}`, kind: t.linkAnchor })
      }
      return out.slice(0, 5)
    }
    const search = (q: string): void => {
      clearTimeout(searchTimer)
      searchAbort?.abort()
      activeLink.value = -1
      // An address being typed is not a search.
      if (/^(?:[a-z][a-z0-9+.-]*:|\/|www\.)/i.test(q)) { found.value = []; searching.value = false; return }
      const local = anchors(q)
      found.value = local
      const host = ui.links
      if (!host || q.trim() === '') return
      searching.value = true
      searchTimer = setTimeout(() => {
        const abort = new AbortController()
        searchAbort = abort
        host(q.trim(), { signal: abort.signal }).then((list) => {
          if (abort.signal.aborted) return
          // Only addresses the allow-list accepts are offered.
          found.value = [...local, ...list.filter((s) => typeof s.url === 'string' && safeUrl(s.url) !== null).slice(0, 8)]
          searching.value = false
          editor.announce(found.value.length === 0 ? t.linkNoResults : t.linkResults(found.value.length))
        }, () => { if (!abort.signal.aborted) searching.value = false })
      }, 250)
    }
    onBeforeUnmount(() => { clearTimeout(searchTimer); searchAbort?.abort() })
    const pos = ref<{ x: number; y: number; below: boolean } | null>(null)
    const inset = ref(0)

    // The field with the caret, or text selected across parts.
    const field = computed((): FormatTarget | undefined => {
      track(editor.revision.value, editor.selectionRef.value)
      return editor.formatTarget()
    })
    const hasRange = computed(() => {
      const s = editor.selectionRef.value
      return s.kind === 'range' || (s.kind === 'text' && s.anchor !== s.focus)
    })
    const visible = computed(() => {
      const f = field.value
      if (!f || !ui.focused.value || !(f.allows('bold') || f.allows('link'))) return false
      if (props.placement === 'bubble') return (hasRange.value && !ui.pointerDown.value) || ui.linking.value
      return true
    })
    // Pressed states, read from the field on each selection or document change. A string, so typing
    // that changes no format leaves it equal and re-renders nothing.
    const activeKey = computed(() => {
      track(editor.revision.value, editor.selectionRef.value)
      const f = visible.value ? field.value : undefined
      return f ? f.activeMarks().map((m) => m.type).sort().join(' ') : ''
    })
    const active = computed(() => new Set(activeKey.value.split(' ')))

    // --- Bubble position: above the first selected line, kept inside the field.
    const place = (): void => {
      if (props.placement !== 'bubble' || !visible.value) { pos.value = null; return }
      const f = field.value, work = ui.work.value
      if (!f || !work) return
      const rects = f.selectionRects()
      const first = rects[0] ?? f.element.getBoundingClientRect()
      const lastRect = rects.at(-1) ?? first
      const w = work.getBoundingClientRect()
      const half = (el.value?.offsetWidth ?? 200) / 2
      const x = Math.max(half + 4, Math.min(w.width - half - 4, (first.left + (rects.length > 1 ? Math.max(...rects.map((r) => r.right)) : first.right)) / 2 - w.left))
      // Above the words unless that would leave the viewport; then below them. Never over them (WCAG 2.4.11).
      const below = first.top < 56
      pos.value = { x, y: (below ? lastRect.bottom : first.top) - w.top + work.scrollTop, below }
    }
    watch([visible, editor.selectionRef, editor.revision, ui.linking], () => { void nextTick(place) })

    // --- Touch: dock above the keyboard.
    let vvCleanup: (() => void) | null = null
    const dock = (): void => {
      const view = el.value?.ownerDocument.defaultView
      if (!view) return
      inset.value = keyboardInset(view.innerHeight, view.visualViewport)
    }
    onMounted(() => {
      if (props.placement !== 'touch') return
      const vv = el.value?.ownerDocument.defaultView?.visualViewport
      if (!vv) return
      vv.addEventListener('resize', dock)
      vv.addEventListener('scroll', dock)
      vvCleanup = () => { vv.removeEventListener('resize', dock); vv.removeEventListener('scroll', dock) }
      dock()
    })
    onBeforeUnmount(() => { vvCleanup?.() })
    // The touch bar lives in the top layer so no host stacking context covers it.
    watch(visible, (v) => {
      void nextTick(() => {
        const bar = el.value
        if (props.placement !== 'touch' || !bar || typeof bar.showPopover !== 'function') return
        try { if (v) bar.showPopover(); else bar.hidePopover() } catch { /* already in that state */ }
      })
    })

    // --- Actions
    /** Put the caret back where the editor has it, then act on the field. */
    const withField = (fn: (f: FormatTarget) => void): void => {
      const f = field.value
      const s = editor.selection
      if (!f) return
      if (s.kind === 'text') editor.field(s.blockId, s.field)?.setSelection({ anchor: s.anchor, focus: s.focus })
      else if (s.kind !== 'range') return
      fn(f)
    }
    const toggle = (type: string): void => { withField((f) => { f.toggleFormat({ type }) }) }

    const openLink = (): void => {
      const f = field.value
      const href = f?.formatAt('link')?.attrs?.href
      url.value = typeof href === 'string' ? href : ''
      urlError.value = false
      newWindow.value = f?.formatAt('link')?.attrs?.target === '_blank'
      found.value = []
      activeLink.value = -1
      ui.linking.value = true
      void nextTick(() => { el.value?.querySelector<HTMLInputElement>('input.field')?.focus() })
    }
    const closeLink = (refocus: boolean): void => {
      ui.linking.value = false
      found.value = []
      searchAbort?.abort()
      if (refocus) ui.focusText()
    }
    const applyLink = (chosen?: LinkSuggestion): void => {
      const href = safeUrl(chosen?.url ?? url.value)
      if (!href || href === '') { urlError.value = true; return }
      withField((f) => {
        const sel = editor.selection
        const one = sel.kind === 'text' ? editor.field(sel.blockId, sel.field) : undefined
        const s = one?.selection
        if (one && s && s.anchor === s.focus && !f.formatAt('link')) {
          // Nothing selected and no link here: the page's title (or the address) becomes the linked words.
          const words = chosen?.title ?? href
          const at = s.focus
          one.insertText(words)
          one.setSelection({ anchor: at, focus: at + words.length })
        }
        f.setLink(href, { newWindow: newWindow.value })
      })
      closeLink(true)
    }
    // Mod+K in a field opens the link field here.
    const offLink = editor.on('requestLink', () => { openLink() })
    onBeforeUnmount(offLink)

    // Clicks keep the caret in the text: no button takes the focus from the field by pointer.
    const keep = (e: MouseEvent): void => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault() }

    return () => {
      const f = field.value
      const show = visible.value
      // A bubble that is not showing has nothing to render.
      if (!show && props.placement === 'bubble') return null
      const cls = ['bubble', `fmt-${props.placement}`, show && 'is-on', ui.linking.value && 'is-linking', pos.value?.below && 'is-below']
      const style = props.placement === 'bubble' && pos.value
        ? { insetInlineStart: `${String(pos.value.x)}px`, insetBlockStart: `${String(pos.value.y)}px` }
        : props.placement === 'touch' ? { insetBlockEnd: `${String(inset.value)}px` } : {}
      const common = {
        // The toolbar is a component: its element is $el.
        ref: (r: unknown) => { el.value = r instanceof HTMLElement ? r : r !== null && typeof r === 'object' && '$el' in r && r.$el instanceof HTMLElement ? r.$el : undefined },
        class: cls,
        style,
        onMousedown: keep,
        ...(props.placement === 'touch' ? { popover: 'manual' } : {}),
        ...(show ? {} : { hidden: true }),
      }
      if (ui.linking.value && show) {
        const linked = f?.formatAt('link') !== null && f !== undefined
        const list = found.value
        const optionId = (i: number): string => `pz-link-opt-${String(i)}`
        const open = list.length > 0 || searching.value
        return h('div', { ...common, role: 'group', 'aria-label': t.link }, [
          h('input', {
            class: 'field', type: 'text', inputmode: 'url', 'aria-label': t.linkAddress, placeholder: ui.links ? t.linkSearchPlaceholder : t.linkPlaceholder, value: url.value,
            role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': 'pz-link-list',
            'aria-activedescendant': activeLink.value >= 0 ? optionId(activeLink.value) : undefined,
            'aria-invalid': urlError.value ? 'true' : undefined, 'aria-describedby': urlError.value ? 'pz-link-error' : undefined,
            autocomplete: 'off', spellcheck: 'false',
            onInput: (e: Event) => { url.value = (e.target as HTMLInputElement).value; urlError.value = false; search(url.value) },
            onKeydown: (e: KeyboardEvent) => {
              if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && list.length > 0) {
                e.preventDefault()
                activeLink.value = (activeLink.value + (e.key === 'ArrowDown' ? 1 : -1) + list.length + 1) % (list.length + 1)
                if (activeLink.value === list.length) activeLink.value = -1
              }
              if (e.key === 'Enter') { e.preventDefault(); applyLink(activeLink.value >= 0 ? list[activeLink.value] : undefined) }
              if (e.key === 'Escape') {
                e.preventDefault(); e.stopPropagation()
                if (open) { found.value = []; activeLink.value = -1 } else closeLink(true)
              }
            },
          }),
          h('button', { type: 'button', class: ['btn', 'btn-icon', newWindow.value && 'is-on'], 'aria-pressed': newWindow.value ? 'true' : 'false', 'aria-label': t.newWindow, title: `${t.newWindow}. ${t.newWindowHint}`, onClick: () => { newWindow.value = !newWindow.value } }, icon('external')),
          h('button', { type: 'button', class: 'btn btn-add', onClick: () => { applyLink() } }, linked ? t.saveLink : t.addLink),
          linked ? h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': t.removeLink, title: t.removeLink, onClick: () => { withField((ff) => { ff.setLink(null) }); closeLink(true) } }, icon('trash')) : null,
          h('button', { type: 'button', class: 'btn btn-icon', 'aria-label': t.cancel, title: t.cancel, onClick: () => { closeLink(true) } }, icon('close')),
          urlError.value ? h('p', { class: 'bubble-error', id: 'pz-link-error', role: 'alert' }, t.linkInvalid) : null,
          open && !urlError.value ? h('div', { class: 'link-results' }, [
            h('ul', { id: 'pz-link-list', role: 'listbox', 'aria-label': t.linkSuggestions }, list.map((s, i) => h('li', {
              id: optionId(i), role: 'option', class: ['link-opt', i === activeLink.value && 'is-active'], 'aria-selected': i === activeLink.value ? 'true' : 'false',
              onMousedown: (e: MouseEvent) => { e.preventDefault() },
              onClick: () => { applyLink(s) },
            }, [h('span', { class: 'link-title' }, s.title), h('span', { class: 'link-url' }, s.kind ? `${s.kind} · ${s.url}` : s.url)]))),
            searching.value ? h('p', { class: 'hint link-status' }, t.linkSearching) : null,
          ]) : null,
        ])
      }
      const pressed = (type: string) => ({ 'aria-pressed': active.value.has(type) ? 'true' : 'false', class: ['btn', 'btn-icon', active.value.has(type) && 'is-on'] })
      const can = (type: string): boolean => f?.allows(type) ?? false
      const buttons = [
        can('bold') ? h(ToolbarButton, { ...pressed('bold'), 'aria-label': t.bold, title: t.bold, onClick: () => { toggle('bold') } }, () => h('span', { class: 'glyph', 'aria-hidden': 'true' }, 'B')) : null,
        can('italic') ? h(ToolbarButton, { ...pressed('italic'), 'aria-label': t.italic, title: t.italic, onClick: () => { toggle('italic') } }, () => h('span', { class: 'glyph glyph-i', 'aria-hidden': 'true' }, 'I')) : null,
        can('link') ? h(ToolbarButton, { class: ['btn', active.value.has('link') && 'is-on'], 'aria-pressed': active.value.has('link') ? 'true' : 'false', onClick: openLink }, () => [icon('link'), t.link]) : null,
        h(DropdownMenuRoot, { modal: false }, () => [
          h(DropdownMenuTrigger, { asChild: true }, () => h(ToolbarButton, { class: 'btn btn-icon', 'aria-label': t.moreFormats, title: t.moreFormats }, () => icon('more'))),
          h(DropdownMenuContent, {
            class: 'pop pop-menu', side: props.placement === 'touch' ? 'top' : 'bottom', align: 'end', sideOffset: 6, collisionPadding: 8,
            onCloseAutoFocus: (e: Event) => { e.preventDefault(); ui.focusText() },
          }, () => [
            ...MORE.filter(can).map((type) => h(DropdownMenuItem, {
              class: ['btn', active.value.has(type) && 'is-checked'], onSelect: () => { toggle(type) },
            }, () => [h('span', { class: `fmt-sample fmt-${type}`, 'aria-hidden': 'true' }, 'ab'), t.formats[type] ?? type, active.value.has(type) ? icon('check') : null])),
            // Plugins' buttons: a format of theirs to toggle, or an action on the selected text.
            ...ui.toolbarItems.filter((item) => item.format === undefined || can(item.format)).map((item) => h(DropdownMenuItem, {
              class: ['btn', item.format !== undefined && active.value.has(item.format) && 'is-checked'], 'data-pz-item': item.id,
              onSelect: () => { if (item.format !== undefined) toggle(item.format); else withField((ff) => { item.run?.(ff, editor) }) },
            }, () => [item.title(editor.strings.lang), item.format !== undefined && active.value.has(item.format) ? icon('check') : null])),
            h('div', { class: 'rule', role: 'separator' }),
            h(DropdownMenuItem, { class: 'btn', onSelect: () => { withField((ff) => { ff.clearFormatting() }) } }, () => [icon('close'), t.clearFormatting]),
          ]),
        ]),
      ]
      return h(ToolbarRoot, { ...common, 'aria-label': t.formatBar, dir: t.dir, loop: true }, () => [
        ...buttons,
        props.placement === 'touch' && ui.part.value !== null ? [
          h('span', { class: 'sep', 'aria-hidden': 'true' }),
          h(ToolbarButton, { class: 'btn btn-icon', 'aria-label': t.partSettings, title: t.partSettingsTitle, onClick: () => { ui.options.value = ui.part.value } }, () => icon('sliders')),
          h(ToolbarButton, { class: 'btn btn-icon', 'aria-label': t.addBelow, title: t.addBelowTitle, onClick: () => { const p = ui.part.value; if (p) ui.add.value = { kind: 'part', id: p } } }, () => icon('plus')),
        ] : null,
      ])
    }
  },
})
