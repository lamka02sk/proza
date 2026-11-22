/**
 * The list view: every block as
 * a tree (WAI-ARIA tree pattern) with level and position. It is the keyboard
 * and screen reader path for restructuring: go to a part, move it (also to
 * any place, with Move to), duplicate or remove it.
 */
import { computed, defineComponent, h, nextTick, ref, watch } from 'vue'
import { selectedBlocks } from '../editor/selection'
import { duplicateBlocks, moveBlocks, moveBlocksTo, removeBlocks } from '../editor/structure'
import { stopsIn } from '../editor/editing'
import { caret, blocks as blockSelection } from '../editor/selection'
import { childrenOf, parentOf } from '../model/tree'
import { matchesKeys } from '../richtext/keys'
import { useUi, track } from './context'
import { icon } from './icons'

interface Row { id: string; level: number; size: number; pos: number; parent: string | null; hasKids: boolean }

/** Pseudo row for "At the very start" while moving. */
const START = 'pz:start'

export const Outline = defineComponent({
  name: 'ProzaOutline',
  setup() {
    const ui = useUi()
    const { editor, t } = ui
    const collapsed = ref(new Set<string>())
    const focusId = ref<string | null>(null)
    const moving = ref<string | null>(null)
    const treeEl = ref<HTMLElement>()

    const rows = computed((): Row[] => {
      track(editor.revision.value)
      const tree = editor.tree
      const out: Row[] = []
      const walk = (parent: string | null, level: number): void => {
        const kids = childrenOf(tree, parent)
        kids.forEach((id, i) => {
          const hasKids = (tree.children.get(id)?.length ?? 0) > 0
          out.push({ id, level, size: kids.length, pos: i + 1, parent, hasKids })
          if (hasKids && !collapsed.value.has(id)) walk(id, level + 1)
        })
      }
      walk(null, 1)
      return out
    })
    const ids = computed(() => (moving.value ? [START, ...rows.value.map((r) => r.id)] : rows.value.map((r) => r.id)))

    const focusRow = (): void => {
      const id = focusId.value
      if (id === null) return
      treeEl.value?.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`)?.focus()
    }
    const setFocus = (id: string | undefined): void => {
      if (id === undefined) return
      focusId.value = id
      void nextTick(focusRow)
    }

    // Start on the part with the caret.
    watch(() => ui.outlineOpen.value, (open) => {
      if (!open) { moving.value = null; return }
      const s = editor.selection
      const at = s.kind === 'text' ? s.blockId : s.kind === 'blocks' ? s.focusId : null
      focusId.value = at && rows.value.some((r) => r.id === at) ? at : rows.value[0]?.id ?? null
      void nextTick(focusRow)
    }, { immediate: true })

    /** Close the panel and put the caret in the part (or select it when it has no text). */
    const goTo = (id: string): void => {
      ui.outlineOpen.value = false
      const stop = stopsIn(editor.context(), id).find((s) => s.field !== null)
      void nextTick(() => { editor.select(stop?.field ? caret(stop.blockId, stop.field, 0) : blockSelection(id)) })
    }

    const move = (id: string, dir: -1 | 1): void => {
      editor.apply(moveBlocks(editor.context(), [id], dir, editor.selection))
      setFocus(id)
    }
    const remove = (id: string): void => {
      const list = ids.value
      const next = list[list.indexOf(id) + 1] ?? list[list.indexOf(id) - 1]
      editor.apply(removeBlocks(editor.context(), [id]))
      // Focus is never lost: the neighbour row takes it.
      setFocus(next && editor.tree.nodes.has(next) ? next : rows.value[0]?.id)
    }
    const duplicate = (id: string): void => {
      editor.apply(duplicateBlocks(editor.context(), [id], editor.selection))
      setFocus(id)
    }
    const startMove = (id: string): void => {
      moving.value = id
      editor.announce(t.moving(editor.labelFor(editor.tree.nodes.get(id)!)))
      setFocus(START)
    }
    /** Put the moving part after `target` (START: at the very start of the document). */
    const place = (target: string): void => {
      const id = moving.value
      if (id === null) return
      const tree = editor.tree
      const change = target === START
        ? moveBlocksTo(editor.context(), [id], null, childrenOf(tree, null)[0] ?? null, editor.selection)
        : (() => {
          const parent = parentOf(tree, target)
          const kids = childrenOf(tree, parent)
          const after = kids[kids.indexOf(target) + 1] ?? null
          return moveBlocksTo(editor.context(), [id], parent, after === id ? kids[kids.indexOf(id) + 1] ?? null : after, editor.selection)
        })()
      if (!change) { editor.announce(t.cannotMoveHere, 'assertive'); return }
      moving.value = null
      editor.apply(change)
      setFocus(id)
    }

    const onKey = (e: KeyboardEvent, row: Row | null): void => {
      const list = ids.value
      const id = row?.id ?? START
      const i = list.indexOf(id)
      const mac = editor.keymap.mac
      const isMove = (name: string): boolean => editor.keymap.keysFor(name).some((k) => matchesKeys(k, e, mac))
      if (row && isMove('moveUp')) { e.preventDefault(); move(row.id, -1); return }
      if (row && isMove('moveDown')) { e.preventDefault(); move(row.id, 1); return }
      const plain = !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey
      if (!plain) return
      const rtl = t.dir === 'rtl'
      const key = rtl && e.key === 'ArrowLeft' ? 'ArrowRight' : rtl && e.key === 'ArrowRight' ? 'ArrowLeft' : e.key
      switch (key) {
        case 'ArrowDown': e.preventDefault(); setFocus(list[i + 1]); return
        case 'ArrowUp': e.preventDefault(); setFocus(list[i - 1]); return
        case 'Home': e.preventDefault(); setFocus(list[0]); return
        case 'End': e.preventDefault(); setFocus(list.at(-1)); return
        case 'ArrowRight':
          if (!row?.hasKids) return
          e.preventDefault()
          if (collapsed.value.has(row.id)) { const c = new Set(collapsed.value); c.delete(row.id); collapsed.value = c }
          else setFocus(childrenOf(editor.tree, row.id)[0])
          return
        case 'ArrowLeft':
          if (!row) return
          e.preventDefault()
          if (row.hasKids && !collapsed.value.has(row.id)) { collapsed.value = new Set([...collapsed.value, row.id]) }
          else if (row.parent !== null) setFocus(row.parent)
          return
        case 'Enter':
          e.preventDefault()
          if (moving.value !== null) place(id)
          else if (row) goTo(row.id)
          return
        case 'Escape':
          if (moving.value !== null) {
            e.preventDefault()
            e.stopPropagation()
            const back = moving.value
            moving.value = null
            editor.announce(t.movingCancelled)
            setFocus(back)
          }
          return
        case 'Delete':
          if (row && moving.value === null) { e.preventDefault(); remove(row.id) }
          return
      }
    }

    return () => {
      const list = rows.value
      const selected = new Set(selectedBlocks(editor.tree, editor.selectionRef.value))
      const s = editor.selectionRef.value
      if (s.kind === 'text') selected.add(s.blockId)
      const focus = focusId.value
      const item = (row: Row) => {
        const node = editor.tree.nodes.get(row.id)!
        const isMoving = moving.value === row.id
        return h('div', {
          role: 'treeitem',
          class: ['tree-row', selected.has(row.id) && 'is-on', isMoving && 'is-moving'],
          'data-row': row.id,
          tabindex: row.id === focus ? 0 : -1,
          'aria-level': row.level,
          'aria-setsize': row.size,
          'aria-posinset': row.pos,
          'aria-selected': selected.has(row.id) ? 'true' : 'false',
          ...(row.hasKids ? { 'aria-expanded': collapsed.value.has(row.id) ? 'false' : 'true' } : {}),
          ...(moving.value !== null && !isMoving ? { 'aria-description': t.moveHere } : {}),
          style: { paddingInlineStart: `${String(8 + (row.level - 1) * 16)}px` },
          onKeydown: (e: KeyboardEvent) => { onKey(e, row) },
          onClick: () => { if (moving.value !== null) place(row.id); else goTo(row.id) },
          onFocus: () => { focusId.value = row.id },
        }, [
          row.hasKids ? h('span', { class: ['tree-twist', collapsed.value.has(row.id) && 'is-shut'], 'aria-hidden': 'true' }, icon('chevron')) : h('span', { class: 'tree-twist', 'aria-hidden': 'true' }),
          h('span', { class: 'tree-label' }, editor.labelFor(node)),
        ])
      }
      const focused = focus !== null && focus !== START ? list.find((r) => r.id === focus) : undefined
      const actions = focused && moving.value === null ? h('div', { class: 'tree-actions', role: 'group', 'aria-label': t.rowActions(editor.labelFor(editor.tree.nodes.get(focused.id)!)) }, [
        h('button', { type: 'button', class: 'btn btn-s', disabled: focused.pos === 1, onClick: () => { move(focused.id, -1) } }, [icon('up'), t.moveUp]),
        h('button', { type: 'button', class: 'btn btn-s', disabled: focused.pos === focused.size, onClick: () => { move(focused.id, 1) } }, [icon('down'), t.moveDown]),
        h('button', { type: 'button', class: 'btn btn-s', onClick: () => { startMove(focused.id) } }, [icon('move'), t.moveTo]),
        h('button', { type: 'button', class: 'btn btn-s btn-icon', 'aria-label': t.duplicate, title: t.duplicate, onClick: () => { duplicate(focused.id) } }, icon('copy')),
        h('button', { type: 'button', class: 'btn btn-s btn-icon', 'aria-label': t.remove, title: t.remove, onClick: () => { remove(focused.id) } }, icon('trash')),
      ]) : null
      return h('div', { class: 'outline' }, [
        h('strong', { class: 'pop-title' }, t.outlineTitle),
        h('p', { class: 'hint' }, moving.value !== null ? t.moving(editor.labelFor(editor.tree.nodes.get(moving.value)!)) : t.outlineHint),
        list.length === 0 ? h('p', { class: 'hint' }, t.outlineEmpty) : h('div', { ref: treeEl, role: 'tree', class: 'tree', 'aria-label': t.outlineTitle }, [
          moving.value !== null ? h('div', {
            role: 'treeitem', class: 'tree-row tree-start', 'data-row': START, tabindex: focus === START ? 0 : -1,
            'aria-level': 1, 'aria-setsize': 1, 'aria-posinset': 1, 'aria-selected': 'false',
            onKeydown: (e: KeyboardEvent) => { onKey(e, null) }, onClick: () => { place(START) }, onFocus: () => { focusId.value = START },
          }, [h('span', { class: 'tree-twist', 'aria-hidden': 'true' }), h('span', { class: 'tree-label' }, t.toStart)]) : null,
          ...list.map(item),
        ]),
        actions,
      ])
    }
  },
})
