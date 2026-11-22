/**
 * The table in the canvas: a
 * real table whose cells hold parts, an "Add row" strip under it and an "Add
 * column" strip beside it, and the cell tools, a small inverted bar above the
 * cell with the caret holding the Row and Column menus (and Merge or Split).
 *
 * In the canvas a table always stays a grid, also in stacked mode: cards are
 * how the page shows it on a narrow screen, not how it is edited.
 */
import { checksFor } from './checks'
import { type PropType, computed, defineComponent, h, onBeforeUnmount, reactive, ref, useId, watch } from 'vue'
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuRoot, DropdownMenuTrigger, ToolbarButton, ToolbarRoot } from 'reka-ui'
import type { Operation } from '../model/operations'
import type { BlockNode } from '../model/tree'
import { CELL, TABLE, cellIn, enclosing, hasHeaderColumn, hasHeaderRow, hasMerged, insertColumn, insertRow, mergeCells, removeColumn, removeRow, selectionRect, setHeaderColumn, setHeaderRow, splitCell, tableGrid } from '../editor/table'
import { BlockList, RichTextView, type WrapperProps, useEditor } from '../ui/canvas'
import { track, useUi } from '../ui/context'
import { Seg, checkbox } from '../ui/controls'
import { type IconName, icon } from '../ui/icons'
import { type Box, measure } from '../ui/parts'
import { defineBlock } from './define'
import { table, tableCell, tableRow } from './table'
import { tableCellEditing, tableEditing, tableRowEditing } from './table-behaviour'
import { tableParse } from './table-parse'

const props = {
  id: { type: String, required: true },
  node: { type: Object as PropType<BlockNode>, required: true },
  wrapper: { type: Object as PropType<WrapperProps>, required: true },
} as const

/** Rows and cells are not named groups of their own: a table's cells are announced by the table. */
const unnamed = (w: WrapperProps): Record<string, unknown> => ({ ...w, 'aria-label': undefined, 'aria-describedby': undefined })

const TableEdit = defineComponent({
  name: 'ProzaTable', props,
  setup(p) {
    const ui = useUi()
    const { editor, t } = ui
    const reach = (): 0 | -1 => (editor.isCurrent(p.id) || editor.isSelected(p.id) ? 0 : -1)
    // The grid is read when a button is pressed: a render that read it would follow every edit in the document.
    return () => {
      const w = p.wrapper
      return h('div', { ...w, role: 'group', class: [...w.class, 'pz-table'] }, h('div', { class: 'tb' }, [
        h('div', { class: 'tb-scroll' }, h('table', null, [
          editor.fieldShown(p.node, 'caption') ? h('caption', null, h(RichTextView, { blockId: p.id, attr: 'caption', tag: 'div', key: 'caption', classes: 'pz-tcaption', 'data-placeholder': t.table.captionPlaceholder })) : null,
          h('tbody', null, h(BlockList, { parent: p.id })),
        ])),
        h('button', {
          type: 'button', class: 'tadd tadd-col', tabindex: reach(), 'aria-label': t.table.addColumn, title: t.table.addColumn, 'data-pz-add-column': '',
          onClick: () => { editor.apply(insertColumn(editor.context(), p.id, tableGrid(editor.tree, p.id).cols, 0)) },
        }, icon('plus')),
        h('button', {
          type: 'button', class: 'tadd tadd-row', tabindex: reach(), 'data-pz-add-row': '',
          onClick: () => { editor.apply(insertRow(editor.context(), p.id, tableGrid(editor.tree, p.id).rows, 0)) },
        }, [icon('plus'), t.table.addRow]),
      ]))
    }
  },
})

const RowEdit = defineComponent({
  name: 'ProzaTableRow', props,
  setup: (p) => () => h('tr', unnamed(p.wrapper), h(BlockList, { parent: p.id })),
})

const CellEdit = defineComponent({
  name: 'ProzaTableCell', props,
  setup: (p) => () => {
    const { header, colspan, rowspan, scope } = p.node.attrs
    return h(header === true ? 'th' : 'td', {
      ...unnamed(p.wrapper),
      colspan: colspan === 1 ? undefined : colspan, rowspan: rowspan === 1 ? undefined : rowspan,
      scope: header === true && scope ? scope : undefined,
    }, h(BlockList, { parent: p.id }))
  },
})

// ---------------------------------------------------------------------------
// Cell tools

/** The cell the caret (or a cell selection's end) is in, when it belongs to this table. */
function useActiveCell(tableId: () => string) {
  const editor = useEditor()
  return computed(() => {
    track(editor.revision.value)
    const s = editor.selectionRef.value
    const focus = s.kind === 'text' ? s.blockId : s.kind === 'cells' ? s.focusId : null
    const cell = enclosing(editor.tree, focus, CELL)
    if (cell === null || enclosing(editor.tree, cell, TABLE) !== tableId()) return null
    const grid = tableGrid(editor.tree, tableId())
    const pos = cellIn(grid, cell)
    if (!pos) return null
    const rect = s.kind === 'cells' ? selectionRect(editor.tree, s)?.rect ?? null : null
    const many = rect !== null && (rect.bottom > rect.top || rect.right > rect.left)
    // Words selected in the cell: the format bar is above them, so the cell tools step aside (design: `bar: act && !bub`).
    const words = s.kind === 'text' && s.anchor !== s.focus
    return { cell, grid, pos, rect: many ? rect : null, words }
  })
}

const TableTools = defineComponent({
  name: 'ProzaTableTools',
  props: { id: { type: String, required: true } },
  setup(p) {
    const ui = useUi()
    const { editor, t } = ui
    const active = useActiveCell(() => p.id)
    const box = reactive<Box & { width: number }>({ top: 0, height: 0, start: 0, end: 0, width: 0, visible: false })
    let ro: ResizeObserver | null = null
    const update = (): void => {
      const a = active.value
      const el = a ? editor.blockElement(a.cell) : null, work = ui.work.value
      if (!el || !work) { box.visible = false; return }
      Object.assign(box, measure(el, work), { width: work.clientWidth })
    }
    // Measured by ResizeObserver after the frame's layout, like the part tools.
    watch(() => (active.value ? editor.blockElement(active.value.cell) : null), (el) => {
      ro?.disconnect()
      const work = ui.work.value
      if (!el || !work || typeof ResizeObserver !== 'function') { box.visible = false; return }
      ro = new ResizeObserver(update)
      ro.observe(el)
      ro.observe(work)
    }, { immediate: true, flush: 'post' })
    onBeforeUnmount(() => { ro?.disconnect() })

    // The bar sits over the row above (design). It steps aside while the pointer is over another cell, and when
    // the pointer comes onto it from another cell, so that cell stays clickable; from the active cell, or from
    // outside the table, the pointer reaches the bar.
    const away = ref(false)
    let bar: HTMLElement | null = null
    let armed = true
    const onMove = (e: PointerEvent): void => {
      const a = active.value
      if (!a || !bar) { away.value = false; return }
      const over = e.target instanceof Element ? e.target.closest<HTMLElement>('td[data-block], th[data-block]') : null
      const r = bar.getBoundingClientRect()
      const cell = editor.blockElement(a.cell)?.getBoundingClientRect()
      // The bar and the gap down to the active cell.
      const corridor = e.clientX >= r.left - 8 && e.clientX <= r.right + 8 && e.clientY >= r.top - 8 && e.clientY <= (cell ? cell.top + 2 : r.bottom + 8)
      if (over?.dataset.block === a.cell) armed = true
      else if (over === null && !corridor) armed = true
      else if (over !== null && !corridor) armed = false
      away.value = corridor ? !armed : over !== null && over.dataset.block !== a.cell
    }
    watch(() => ui.work.value, (work, before) => {
      before?.removeEventListener('pointermove', onMove)
      work?.addEventListener('pointermove', onMove)
    }, { immediate: true })
    onBeforeUnmount(() => { ui.work.value?.removeEventListener('pointermove', onMove) })
    const setBar = (el: unknown): void => {
      const node: unknown = el && typeof el === 'object' && '$el' in el ? (el).$el : el
      bar = node instanceof HTMLElement ? node : null
    }

    const run = (change: Parameters<typeof editor.apply>[0]): void => { editor.apply(change) }
    const item = (label: string, name: IconName, onSelect: () => void, disabled = false, extra: Record<string, unknown> = {}) =>
      h(DropdownMenuItem, { class: 'btn', disabled, onSelect, ...extra }, () => [icon(name), label])
    const menu = (label: string, attr: string, items: () => unknown[]) => h(DropdownMenuRoot, { modal: false }, () => [
      h(DropdownMenuTrigger, { asChild: true }, () => h(ToolbarButton, { class: 'btn', [attr]: '' }, () => [label, icon('chevron')])),
      h(DropdownMenuContent, {
        class: 'pop pop-menu', side: 'bottom', align: 'start', sideOffset: 6, collisionPadding: 8, dir: t.dir,
        onCloseAutoFocus: (e: Event) => { e.preventDefault(); ui.focusText() },
      }, items),
    ])

    return () => {
      const a = active.value
      if (!a || a.words || !box.visible) return null
      const { pos, grid } = a
      const ctx = editor.context()
      const rtl = (editor.blockElement(a.cell) && getComputedStyle(editor.blockElement(a.cell)!).direction === 'rtl') ?? false
      const atEnd = pos.col > 0 && pos.col + pos.colspan >= grid.cols
      const align = (v: '' | 'center' | 'end'): void => {
        const ops: Operation[] = grid.cells.filter((c) => c.col === pos.col).map((c) => ({ type: 'setAttrs', id: c.item, patch: { textAlign: v } }))
        editor.apply({ ops, selection: editor.selection, announce: t.table.alignedColumn(t.alignNames[v === '' ? 'start' : v]) })
      }
      const align0 = editor.tree.nodes.get(a.cell)?.attrs.textAlign
      const now = typeof align0 === 'string' ? align0 : ''
      const merged = pos.colspan > 1 || pos.rowspan > 1
      const style = atEnd
        ? { insetBlockStart: `${String(box.top)}px`, insetInlineEnd: `${String(box.width - box.end)}px` }
        : { insetBlockStart: `${String(box.top)}px`, insetInlineStart: `${String(box.start)}px` }
      return h(ToolbarRoot, { ref: setBar, class: ['part-tools', 'cellbar', atEnd && 'at-end', away.value && 'is-away'], style, 'aria-label': t.table.tools, dir: t.dir, loop: true }, () => [
        menu(t.table.row, 'data-pz-row-menu', () => [
          item(t.table.rowAbove, 'up', () => { run(insertRow(ctx, p.id, pos.row, pos.col)) }),
          item(t.table.rowBelow, 'down', () => { run(insertRow(ctx, p.id, pos.row + pos.rowspan, pos.col)) }),
          item(t.table.removeRow, 'trash', () => { run(removeRow(ctx, p.id, pos.row, pos.col)) }, grid.rows <= 1),
        ]),
        menu(t.table.column, 'data-pz-column-menu', () => [
          item(rtl ? t.table.columnRight : t.table.columnLeft, rtl ? 'right' : 'left', () => { run(insertColumn(ctx, p.id, pos.col, pos.row)) }),
          item(rtl ? t.table.columnLeft : t.table.columnRight, rtl ? 'left' : 'right', () => { run(insertColumn(ctx, p.id, pos.col + pos.colspan, pos.row)) }),
          item(t.table.removeColumn, 'trash', () => { run(removeColumn(ctx, p.id, pos.col, pos.row)) }, grid.cols <= 1),
          h('div', { class: 'rule', role: 'separator' }),
          ...(['', 'center', 'end'] as const).map((v) => h(DropdownMenuItem, {
            class: ['btn', now === v && 'is-checked'], onSelect: () => { align(v) },
          }, () => [
            icon(v === '' ? (t.dir === 'rtl' ? 'alignEnd' : 'alignStart') : v === 'center' ? 'alignCenter' : t.dir === 'rtl' ? 'alignStart' : 'alignEnd'),
            t.table.alignColumn(t.alignNames[v === '' ? 'start' : v]),
            now === v ? icon('check') : null,
          ])),
        ]),
        a.rect ? h(ToolbarButton, { class: 'btn', 'data-pz-merge': '', onClick: () => { if (a.rect) run(mergeCells(ctx, p.id, a.rect)) } }, () => [icon('merge'), t.table.merge]) : null,
        !a.rect && merged ? h(ToolbarButton, { class: 'btn', 'data-pz-split': '', onClick: () => { run(splitCell(ctx, p.id, a.cell)) } }, () => [icon('split'), t.table.split]) : null,
      ])
    }
  },
})

// ---------------------------------------------------------------------------
// Options

const TableInspector = defineComponent({
  name: 'ProzaTableInspector',
  props: { id: { type: String, required: true }, node: { type: Object as PropType<BlockNode>, required: true } },
  setup(p) {
    const ui = useUi()
    const { editor, t } = ui
    const hint = useId()
    return () => {
      track(editor.revision.value)
      const tree = editor.tree
      const merged = hasMerged(tree, p.id)
      const mode = p.node.attrs.mode === 'stack' && !merged ? 'stack' : 'scroll'
      return h('div', { class: 'insp' }, [
        checkbox(t.table.headerRow, hasHeaderRow(tree, p.id), (v) => { editor.apply(setHeaderRow(editor.context(), p.id, v), { keepFocus: true }) }, t.table.headerRowHint, `${hint}-row`),
        checkbox(t.table.headerColumn, hasHeaderColumn(tree, p.id), (v) => { editor.apply(setHeaderColumn(editor.context(), p.id, v), { keepFocus: true }) }),
        h('div', { class: 'row row-col' }, [
          h('span', { class: 'lab' }, t.table.narrow),
          h(Seg, {
            label: t.table.narrow,
            value: mode,
            options: [
              { value: 'scroll', label: t.table.scroll },
              { value: 'stack', label: t.table.stack, disabled: merged, ...(merged ? { describedBy: `${hint}-stack` } : {}) },
            ],
            onPick: (v: string | number) => { editor.setAttrs(p.id, { mode: v }) },
          }),
          h('p', { class: 'hint', id: `${hint}-stack` }, merged ? t.table.stackMerged : mode === 'stack' ? t.table.stackHint : t.table.scrollHint),
        ]),
      ])
    }
  },
})

export const tableBlockDefinitions = [
  defineBlock({ ...table, ...tableEditing, a11y: checksFor(table.name), edit: TableEdit, inspector: TableInspector, tools: TableTools, parse: tableParse[table.name] ?? [] }),
  defineBlock({ ...tableRow, ...tableRowEditing, edit: RowEdit, parse: tableParse[tableRow.name] ?? [] }),
  defineBlock({ ...tableCell, ...tableCellEditing, edit: CellEdit, parse: tableParse[tableCell.name] ?? [] }),
]
