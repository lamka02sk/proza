/**
 * The add menu:
 * search, recently used, categories and patterns as tiles. Opened by the
 * plus beside a part, the appender, or `/` typed on an empty line.
 *
 * Keyboard: the search field (or, for `/`, the text field itself) is a
 * combobox over a listbox of tiles: arrows move the active tile
 * (aria-activedescendant), Enter adds it, Escape closes. The number of
 * results is announced.
 */
import { type VNode, computed, defineComponent, h, nextTick, ref, useId, watch } from 'vue'
import { PopoverContent, PopoverRoot } from 'reka-ui'
import type { InserterItem } from '../editor/editing'
import { type AddTarget, useUi } from './context'
import { drawing, icon } from './icons'
import { search } from './search'

const SLASH = /^\/([^\s/]*(?: [^\s/]+)*)$/u

export const AddMenu = defineComponent({
  name: 'ProzaAddMenu',
  setup() {
    const ui = useUi()
    const { editor, t } = ui
    const id = useId()
    const listId = `${id}-list`
    const query = ref('')
    const active = ref(0)
    let inserted = false
    let opener: HTMLElement | null = null

    const title = (i: InserterItem): string => i.title(editor.strings)
    const words = (i: InserterItem): string => [...(i.keywords ?? []), t.keywords[i.id] ?? ''].join(' ')

    const target = computed(() => ui.add.value)
    const results = computed(() => search(ui.items, query.value, words, title))

    /** Groups when there is no query: recently used, then each category; patterns last. */
    const groups = computed((): { id: string; label: string | null; items: InserterItem[] }[] => {
      if (query.value.trim() !== '') return [{ id: 'results', label: null, items: results.value }]
      const out: { id: string; label: string | null; items: InserterItem[] }[] = []
      const recent = ui.recent.value.map((r) => ui.items.find((i) => i.id === r)).filter((i): i is InserterItem => i !== undefined)
      if (recent.length > 0) out.push({ id: 'recent', label: t.recent, items: recent })
      const cats = [...new Set(ui.items.map((i) => i.category))]
      const blockCats = cats.filter((c) => c !== 'patterns')
      for (const c of cats) {
        const items = ui.items.filter((i) => i.category === c)
        const label = c === 'patterns' ? t.patterns : blockCats.length > 1 || out.length > 0 ? t.categories[c] ?? c : null
        out.push({ id: c, label, items })
      }
      return out
    })
    /** Every tile in keyboard order; a recent item appears twice and is two options. */
    const flat = computed(() => groups.value.flatMap((g) => g.items.map((item) => ({ group: g.id, item }))))
    const optionId = (group: string, item: InserterItem): string => `${id}-${group}-${item.id.replace(/[^\w-]/g, '_')}`
    const activeId = computed(() => {
      const a = flat.value[active.value]
      return a ? optionId(a.group, a.item) : ''
    })

    // --- Opening and closing --------------------------------------------
    const anchorEl = (t: AddTarget | null): HTMLElement | null => {
      const work = ui.work.value
      if (!t || !work) return null
      if (t.kind === 'end') return work.querySelector<HTMLElement>('[data-pz-appender]')
      if (t.kind === 'slash') return editor.blockElement(t.id)
      return work.querySelector<HTMLElement>(`.gut:not(.is-hover) [data-pz-plus="${CSS.escape(t.id)}"]`) ?? editor.blockElement(t.id)
    }
    const reference = computed(() => {
      const el = anchorEl(target.value)
      return el ? { getBoundingClientRect: () => el.getBoundingClientRect(), contextElement: el } : undefined
    })

    watch(target, (now, before) => {
      if (now && now !== before) {
        inserted = false
        active.value = 0
        if (now.kind !== 'slash') { query.value = ''; opener = anchorEl(now) }
      }
      if (!now) ui.fieldAria.value = null
    })

    let timer: ReturnType<typeof setTimeout> | undefined
    const close = (): void => { clearTimeout(timer); ui.add.value = null }

    const choose = (item: InserterItem | undefined): void => {
      const tgt = target.value
      if (!item || !tgt) return
      inserted = true
      close()
      ui.insert(item, tgt)
    }

    // Announce how many tiles match, once typing pauses.
    watch(query, () => {
      active.value = 0
      clearTimeout(timer)
      if (!target.value) return
      timer = setTimeout(() => {
        // Closed (or a tile chosen) in the meantime: the count is no longer news.
        if (!target.value) return
        const n = results.value.length
        editor.announce(n === 0 ? t.noResults : t.results(n))
      }, 400)
    })

    // --- `/` on an empty line ---------------------------------------------
    let lastText: { id: string; text: string } | null = null
    watch([editor.revision, editor.selectionRef], () => {
      const s = editor.selection
      const node = s.kind === 'text' ? editor.tree.nodes.get(s.blockId) : undefined
      const text = node?.type === 'core/paragraph' && s.kind === 'text' && s.field === 'content'
        ? (node.attrs.content as { text: string }).text : null
      const prev = lastText
      lastText = node && text !== null ? { id: node.id, text } : null
      const open = target.value
      if (open?.kind === 'slash') {
        const m = text !== null && s.kind === 'text' && s.blockId === open.id && s.anchor === s.focus && s.focus >= 1 ? SLASH.exec(text) : null
        // A space after a word that matches nothing means the writer is typing text, not a command.
        if (!m || (m[1]!.includes(' ') && results.value.length === 0)) { close(); return }
        query.value = m[1]!
        return
      }
      // Typed `/` into an empty paragraph.
      if (text === '/' && node && prev?.id === node.id && prev.text === '' && s.kind === 'text' && s.focus === 1) {
        query.value = ''
        ui.options.value = null
        ui.add.value = { kind: 'slash', id: node.id }
      }
    })

    /** Up and Down step through the tiles in reading order; Left and Right stay with the text. */
    const step = (e: KeyboardEvent, list: HTMLElement | null): boolean => {
      const n = flat.value.length
      const delta = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
      if (n === 0 || delta === 0 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false
      active.value = (active.value + delta + n) % n
      void nextTick(() => { list?.querySelector(`#${CSS.escape(activeId.value)}`)?.scrollIntoView({ block: 'nearest' }) })
      return true
    }

    const listEl = ref<HTMLElement>()
    // In `/` mode the field keeps the focus; its keys come here first.
    editor.onKey((e, where) => {
      const tgt = target.value
      if (tgt?.kind !== 'slash' || !where || where.blockId !== tgt.id) return false
      if (e.isComposing) return false
      if (step(e, listEl.value ?? null)) { e.preventDefault(); return true }
      if (e.key === 'Enter' && !e.shiftKey && flat.value.length > 0) {
        e.preventDefault()
        choose(flat.value[active.value]?.item)
        return true
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return true
      }
      return false
    })
    // The field names the listbox and the active tile while `/` is open.
    watch([target, activeId], () => {
      const tgt = target.value
      ui.fieldAria.value = tgt?.kind === 'slash'
        ? { blockId: tgt.id, attrs: { 'aria-autocomplete': 'list', 'aria-controls': listId, ...(activeId.value ? { 'aria-activedescendant': activeId.value } : {}) } }
        : null
    })

    // --- Rendering ---------------------------------------------------------
    const tile = (group: string, item: InserterItem, index: number): VNode => h('div', {
      id: optionId(group, item),
      role: 'option',
      // Reachable by script only: the text (or the search) keeps the focus and points at the active tile.
      tabindex: -1,
      class: ['tile', index === active.value && 'is-active'],
      'aria-selected': index === active.value ? 'true' : 'false',
      'data-item': item.id,
      // Keep the focus in the search or the text field.
      onMousedown: (e: MouseEvent) => { e.preventDefault() },
      onClick: () => { choose(item) },
    }, [drawing(item.drawing), title(item)])

    const hint = (): string => {
      const tgt = target.value
      if (!tgt) return ''
      if (tgt.kind === 'slash') return t.replacesLine
      if (tgt.kind === 'end') return t.addsAtEnd
      const node = editor.tree.nodes.get(tgt.id)
      return node ? t.addsBelow(editor.labelFor(node)) : ''
    }

    return () => {
      const tgt = target.value
      let index = 0
      const list = h('div', { ref: listEl, id: listId, role: 'listbox', class: 'add-list', 'aria-label': t.addMenu },
        groups.value.map((g) => {
          const tiles = g.items.map((item) => tile(g.id, item, index++))
          if (g.label === null) return h('div', { class: 'tiles', role: 'presentation' }, tiles)
          const labelId = `${id}-g-${g.id}`
          return h('div', { class: 'add-group', role: 'group', 'aria-labelledby': labelId }, [
            h('span', { class: 'lab pop-lab', id: labelId }, g.label),
            h('div', { class: 'tiles', role: 'presentation' }, tiles),
          ])
        }))
      const empty = flat.value.length === 0 ? h('p', { class: 'hint' }, t.noResults) : null
      return h(PopoverRoot, { open: tgt !== null, 'onUpdate:open': (v: boolean) => { if (!v) close() } }, () => tgt ? h(PopoverContent, {
        ...(reference.value ? { reference: reference.value } : {}),
        side: tgt.kind === 'end' ? 'top' : 'bottom',
        align: tgt.kind === 'part' ? 'end' : 'start',
        sideOffset: 6,
        collisionPadding: 8,
        class: 'pop pop-add',
        role: 'dialog',
        'aria-label': tgt.kind === 'end' ? t.addMenuEnd : t.addMenu,
        dir: t.dir,
        // `/` keeps the caret in the text: the menu never takes the focus.
        onOpenAutoFocus: (e: Event) => { if (tgt.kind === 'slash') e.preventDefault() },
        onFocusOutside: (e: Event) => { if (tgt.kind === 'slash') e.preventDefault() },
        onCloseAutoFocus: (e: Event) => {
          e.preventDefault()
          // After adding, the caret is in the new part; otherwise back to what opened the menu.
          if (inserted || tgt.kind === 'slash') return
          if (opener?.isConnected) opener.focus()
          else ui.focusText()
        },
      }, () => [
        tgt.kind === 'slash' ? null : h('div', { class: 'search' }, [
          icon('search'),
          h('input', {
            class: 'field', type: 'search', role: 'combobox',
            'aria-label': t.search, placeholder: t.searchPlaceholder,
            'aria-autocomplete': 'list', 'aria-expanded': 'true', 'aria-controls': listId,
            'aria-activedescendant': activeId.value || undefined,
            value: query.value, autocomplete: 'off', spellcheck: 'false',
            onInput: (e: Event) => { query.value = (e.target as HTMLInputElement).value },
            onKeydown: (e: KeyboardEvent) => {
              if (step(e, listEl.value ?? null)) { e.preventDefault(); return }
              if (e.key === 'Enter') { e.preventDefault(); choose(flat.value[active.value]?.item) }
            },
          }),
        ]),
        list,
        empty,
        h('p', { class: 'hint' }, hint()),
      ]) : null)
    }
  },
})
