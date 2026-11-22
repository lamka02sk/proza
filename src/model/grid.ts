/**
 * The grid of a table (HTML's table model, simplified): which cell covers each
 * slot once row and column spans are applied. Generic over the cell type, so
 * the renderer and the editor's table edits share one reading of the spans.
 */

export interface Span {
  readonly colspan: number
  readonly rowspan: number
}

export interface GridCell<T> {
  readonly item: T
  /** The top row and start column the cell covers. */
  readonly row: number
  readonly col: number
  readonly rowspan: number
  readonly colspan: number
}

export interface Grid<T> {
  readonly rows: number
  readonly cols: number
  readonly cells: readonly GridCell<T>[]
  /** `slots[r][c]`: index into `cells` of the cell covering that slot, or -1 for a hole (a short row). */
  readonly slots: readonly (readonly number[])[]
}

/** Columns a span may reach (a stored table is data from anywhere). */
export const MAX_COLUMNS = 500
/** Slots all spans together may cover; past it a cell takes one slot. */
export const MAX_SPAN_AREA = 1_000_000

/**
 * Cells placed as a browser places them: each in the first free slot of its
 * row, spanning down and across. A row span past the last row stops there.
 * Spans are bounded (MAX_COLUMNS, MAX_SPAN_AREA), so the work grows with the
 * table's size, never with the numbers in its cells.
 */
export function buildGrid<T>(rows: readonly (readonly T[])[], span: (item: T) => Span): Grid<T> {
  const slots: number[][] = rows.map(() => [])
  const cells: GridCell<T>[] = []
  let budget = MAX_SPAN_AREA
  rows.forEach((row, r) => {
    let c = 0
    for (const item of row) {
      while (slots[r]![c] !== undefined) c++
      const s = span(item)
      let rowspan = Math.max(1, Math.min(s.rowspan, rows.length - r))
      let colspan = Math.max(1, Math.min(s.colspan, MAX_COLUMNS - c))
      if (rowspan * colspan > budget) { rowspan = 1; colspan = 1 }
      budget -= rowspan * colspan
      const index = cells.length
      cells.push({ item, row: r, col: c, rowspan, colspan })
      for (let y = r; y < r + rowspan; y++) for (let x = c; x < c + colspan; x++) slots[y]![x] = index
      c += colspan
    }
  })
  const cols = Math.max(0, ...slots.map((s) => s.length))
  for (const s of slots) for (let c = 0; c < cols; c++) if (s[c] === undefined) s[c] = -1
  return { rows: rows.length, cols, cells, slots }
}

export interface Rect {
  readonly top: number
  readonly left: number
  readonly bottom: number
  readonly right: number
}

/** The cells' rectangle grown until no cell lies partly inside it (as spreadsheets select merged cells). */
export function closeRect<T>(grid: Grid<T>, start: Rect): Rect {
  let { top, left, bottom, right } = start
  for (let changed = true; changed;) {
    changed = false
    for (let r = top; r <= bottom; r++) {
      for (let c = left; c <= right; c++) {
        const i = grid.slots[r]?.[c] ?? -1
        if (i < 0) continue
        const cell = grid.cells[i]!
        const t = Math.min(top, cell.row), l = Math.min(left, cell.col)
        const b = Math.max(bottom, cell.row + cell.rowspan - 1), rt = Math.max(right, cell.col + cell.colspan - 1)
        if (t !== top || l !== left || b !== bottom || rt !== right) { top = t; left = l; bottom = b; right = rt; changed = true }
      }
    }
  }
  return { top, left, bottom, right }
}

/** The rectangle a cell covers. */
export function cellRect(cell: Pick<GridCell<unknown>, 'row' | 'col' | 'rowspan' | 'colspan'>): Rect {
  return { top: cell.row, left: cell.col, bottom: cell.row + cell.rowspan - 1, right: cell.col + cell.colspan - 1 }
}

/** The smallest rectangle holding both. */
export function unionRect(a: Rect, b: Rect): Rect {
  return { top: Math.min(a.top, b.top), left: Math.min(a.left, b.left), bottom: Math.max(a.bottom, b.bottom), right: Math.max(a.right, b.right) }
}

/** Cells whose top start slot lies in `rect`, in reading order. With a closed rectangle these are exactly the cells inside. */
export function cellsIn<T>(grid: Grid<T>, rect: Rect): GridCell<T>[] {
  return grid.cells.filter((c) => c.row >= rect.top && c.row <= rect.bottom && c.col >= rect.left && c.col <= rect.right)
}
