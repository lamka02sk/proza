/**
 * The table block: rows of cells, each cell a
 * container of paragraphs, lists and pictures. Schema and rendering only:
 * server-safe, no DOM, no Vue. Editing joins it in `table-edit.ts`.
 *
 * Responsive modes: `scroll` (default) keeps the table and scrolls it inside a
 * focusable region named by its caption; `stack` turns rows into cards on a
 * narrow column, offered only without merged cells, with explicit roles so the
 * table keeps its semantics when CSS changes its display.
 */
import { type Grid, MAX_COLUMNS, buildGrid } from '../model/grid'
import type { RichTextValue } from '../model/richtext'
import type { Block } from '../model/tree'
import { h } from '../render/html'
import type { RenderContext } from '../render/render'
import { defineSchema } from './define'

export const TABLE = 'core/table'
export const TABLE_ROW = 'core/table-row'
export const TABLE_CELL = 'core/table-cell'

/** Rows a table holds; more load as placeholders. With MAX_COLUMNS it bounds the grid every render builds. */
export const MAX_ROWS = 2000

/** Presentational attributes of a legacy table: a small number. */
const SMALL = /^\d{1,3}$/
/** Column widths of a legacy table's `<colgroup>`, space separated; `auto` for a column without one. */
export const COL_WIDTHS = /^(?:auto|\d{1,5}(?:\.\d{1,3})?(?:px|%|em|rem|pt)?)(?: (?:auto|\d{1,5}(?:\.\d{1,3})?(?:px|%|em|rem|pt)?))*$/

const num = (v: unknown, fallback = 1): number => (typeof v === 'number' && v > 0 ? v : fallback)

/** The grid of a stored or validated table block. */
export function blockGrid(table: Block): Grid<Block> {
  // Placeholders (past the limits, or unknown) are no rows or cells.
  const rows = (table.children ?? []).filter((r) => r.type === TABLE_ROW).map((r) => (r.children ?? []).filter((c) => c.type === TABLE_CELL))
  return buildGrid(rows, (c) => ({ colspan: num(c.attrs.colspan), rowspan: num(c.attrs.rowspan) }))
}

/** Words of a cell for a label: its texts, objects left out. */
export function cellText(cell: Block): string {
  const out: string[] = []
  const walk = (b: Block): void => {
    for (const v of Object.values(b.attrs)) {
      const rt = v as RichTextValue | undefined
      if (rt && typeof rt === 'object' && typeof rt.text === 'string' && Array.isArray(rt.formats)) out.push(rt.text.replaceAll('￼', '').trim())
    }
    for (const c of b.children ?? []) walk(c)
  }
  walk(cell)
  return out.filter(Boolean).join(' ')
}

/** Whether any cell spans more than one slot. Stacking is offered only without. */
export function hasMergedCells(table: Block): boolean {
  return (table.children ?? []).some((r) => (r.children ?? []).some((c) => num(c.attrs.colspan) > 1 || num(c.attrs.rowspan) > 1))
}

interface Layout {
  readonly cols: number
  readonly stack: boolean
  /** Column of each cell. */
  readonly col: ReadonlyMap<Block, number>
  /** Header words per column, for the labels of stacked cells. */
  readonly labels: readonly string[]
}

const layouts = new WeakMap<Block, Layout>()

function layout(table: Block): Layout {
  let l = layouts.get(table)
  if (l) return l
  const grid = blockGrid(table)
  const stack = table.attrs.mode === 'stack' && !hasMergedCells(table)
  const first = table.children?.[0]?.children ?? []
  const headed = first.length > 0 && first.every((c) => c.attrs.header === true)
  l = {
    cols: grid.cols,
    stack,
    col: new Map(grid.cells.map((c) => [c.item, c.col])),
    labels: headed ? first.map(cellText) : [],
  }
  layouts.set(table, l)
  return l
}

/** The table a row or cell renders in. */
const tableOf = (ctx: RenderContext, depth: number): Block | undefined => ctx.ancestors.at(-depth)

export const table = defineSchema({
  name: TABLE,
  attrs: {
    caption: { type: 'richtext' },
    /** How it fits a narrow column: scrolls sideways, or each row becomes a card. */
    mode: { type: 'enum', values: ['scroll', 'stack'] },
    /** Legacy HTML (decision 0020): the table's `border`, `cellpadding` and `cellspacing`, and its column widths. */
    border: { type: 'string', pattern: SMALL, maxLength: 3, sparse: true },
    cellPadding: { type: 'string', pattern: SMALL, maxLength: 3, sparse: true },
    cellSpacing: { type: 'string', pattern: SMALL, maxLength: 3, sparse: true },
    colWidths: { type: 'string', pattern: COL_WIDTHS, maxLength: 1000, sparse: true },
  },
  children: { allowed: [TABLE_ROW], max: MAX_ROWS },
  supports: { anchor: true, language: true, bleed: true },
  render: (block, ctx) => {
    const caption = block.attrs.caption
    const stack = layout(block).stack
    if (ctx.legacy && !stack) {
      // The source's table as it was: its own attributes and styles, no scrolling region around it.
      const a = block.attrs
      const cols = a.colWidths === '' ? [] : a.colWidths.split(' ')
      return h('table', ctx.wrapper({ border: a.border || null, cellpadding: a.cellPadding || null, cellspacing: a.cellSpacing || null }),
        caption.text === '' ? null : h('caption', null, ctx.richText(caption)),
        cols.length === 0 ? null : h('colgroup', null, cols.map((w) => h('col', w === 'auto' ? null : { style: `width: ${w}` }))),
        h('tbody', null, ctx.children()))
    }
    // A region named by its caption that takes the focus, so the keyboard can scroll it.
    return h('div', ctx.wrapper({ class: stack ? 'pz-table pz-table-stack' : 'pz-table', role: 'region', tabindex: 0, 'aria-label': caption.text || ctx.labels.table }),
      h('table', stack ? { role: 'table' } : null,
        caption.text === '' ? null : h('caption', null, ctx.richText(caption)),
        h('tbody', stack ? { role: 'rowgroup' } : null, ctx.children())))
  },
})

export const tableRow = defineSchema({
  name: TABLE_ROW,
  attrs: {},
  parent: [TABLE],
  children: { allowed: [TABLE_CELL], max: MAX_COLUMNS },
  childShare: (row, index, parent) => {
    const l = parent ? layout(parent) : null
    const cell = row.children?.[index]
    const share = l && l.cols > 0 && cell ? num(cell.attrs.colspan) / l.cols : 1
    return { wide: share, narrow: l?.stack ? 1 : share }
  },
  render: (_block, ctx) => {
    const t = tableOf(ctx, 1)
    return h('tr', ctx.wrapper(t && layout(t).stack ? { role: 'row' } : {}), ctx.children())
  },
})

export const tableCell = defineSchema({
  name: TABLE_CELL,
  attrs: {
    header: { type: 'boolean' },
    colspan: { type: 'number', integer: true, min: 1, max: 1000, default: 1 },
    rowspan: { type: 'number', integer: true, min: 1, max: 65534, default: 1 },
    scope: { type: 'enum', values: ['', 'row', 'col', 'rowgroup', 'colgroup'] },
  },
  parent: [TABLE_ROW],
  children: { allowed: ['core/paragraph', 'core/list', 'core/image'] },
  supports: { textAlign: true, language: true },
  render: (block, ctx) => {
    const { header, colspan, rowspan, scope } = block.attrs
    const child = block.children?.length === 1 ? block.children[0] : undefined
    // A cell with one plain paragraph renders without the <p>.
    const plainParagraph = child?.type === 'core/paragraph' && Object.entries(child.attrs).every(([key, value]) => key === 'content' || value === '')
    const t = tableOf(ctx, 2)
    const l = t ? layout(t) : null
    const stacked = l?.stack === true
    const label = stacked && !header ? l.labels[l.col.get(block) ?? -1] ?? '' : ''
    return h(header ? 'th' : 'td', ctx.wrapper({
      colspan: colspan > 1 ? colspan : null,
      rowspan: rowspan > 1 ? rowspan : null,
      ...(header && scope !== '' ? { scope } : {}),
      ...(stacked ? { role: header ? (scope === 'row' ? 'rowheader' : 'columnheader') : 'cell' } : {}),
      // The column's header shown before the value on a card (content.css reads it with attr()).
      ...(label !== '' ? { 'data-pz-label': label } : {}),
    }), plainParagraph ? ctx.richText(child.attrs.content as RichTextValue) : ctx.children())
  },
})
