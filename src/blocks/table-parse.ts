/**
 * Parse rules of the table block: Proza's
 * own output and foreign tables (Word, Google Docs, spreadsheets, TinyMCE) alike.
 */
import type { ParseRule } from '../import/rules'
import { parseStyle } from '../model/css'
import { COL_WIDTHS, TABLE, TABLE_CELL, TABLE_ROW } from './table'

/** A legacy table's own attributes and the widths of its columns. */
function legacyTable(table: HTMLTableElement): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [attr, key] of [['border', 'border'], ['cellpadding', 'cellPadding'], ['cellspacing', 'cellSpacing']] as const) {
    const v = table.getAttribute(attr)?.trim() ?? ''
    if (/^\d{1,3}$/.test(v)) out[key] = v
  }
  const cols: string[] = []
  for (const group of table.querySelectorAll(':scope > colgroup')) {
    const list = group.querySelectorAll(':scope > col')
    for (const col of list.length > 0 ? list : [group]) {
      const raw = (parseStyle(col.getAttribute('style')).get('width') ?? col.getAttribute('width') ?? '').trim().replace(/\s+/g, '')
      const width = /^\d+$/.test(raw) ? `${raw}px` : raw
      const span = Math.min(1000, Math.max(1, Number.parseInt(col.getAttribute('span') ?? '1', 10) || 1))
      for (let i = 0; i < span && cols.length < 1000; i++) cols.push(width === '' ? 'auto' : width)
    }
  }
  const widths = cols.join(' ')
  if (cols.some((c) => c !== 'auto') && COL_WIDTHS.test(widths)) out.colWidths = widths
  return out
}

export const tableParse: Readonly<Record<string, readonly ParseRule[]>> = {
  [TABLE]: [{ selector: 'table', parse: (el, ctx) => {
    const source = el as HTMLTableElement
    const wrapper = el.parentElement?.classList.contains('pz-table') ? el.parentElement : el
    return {
      attrs: {
        ...ctx.supports(wrapper),
        ...(source.caption ? { caption: ctx.richText(source.caption.childNodes) } : {}),
        ...(wrapper.classList.contains('pz-table-stack') ? { mode: 'stack' } : {}),
        ...(ctx.legacy ? legacyTable(source) : {}),
      },
      // Header, body and footer sections in order; a caption is read above.
      children: source.rows,
    }
  } }],
  [TABLE_ROW]: [{ selector: 'tr', parse: (el, ctx) => ({ attrs: ctx.legacy ? ctx.supports(el) : {}, children: (el as HTMLTableRowElement).cells }) }],
  [TABLE_CELL]: [{ selector: 'td, th', parse: (el, ctx) => {
    const cell = el as HTMLTableCellElement
    const row = cell.parentElement as HTMLTableRowElement
    const rows = (row.parentElement as HTMLTableSectionElement).rows
    const remainingRows = rows.length - row.sectionRowIndex
    return {
      attrs: {
        ...ctx.supports(el), header: el.localName === 'th', colspan: cell.colSpan,
        rowspan: cell.rowSpan === 0 ? remainingRows : Math.min(cell.rowSpan, remainingRows), scope: cell.scope,
      },
      children: el.childNodes,
    }
  } }],
}
