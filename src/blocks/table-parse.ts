/**
 * Parse rules of the table block: Proza's
 * own output and foreign tables (Word, Google Docs, spreadsheets, TinyMCE) alike.
 */
import type { ParseRule } from '../import/rules'
import { TABLE, TABLE_CELL, TABLE_ROW } from './table'

export const tableParse: Readonly<Record<string, readonly ParseRule[]>> = {
  [TABLE]: [{ selector: 'table', parse: (el, ctx) => {
    const source = el as HTMLTableElement
    const wrapper = el.parentElement?.classList.contains('pz-table') ? el.parentElement : el
    return {
      attrs: {
        ...ctx.supports(wrapper),
        ...(source.caption ? { caption: ctx.richText(source.caption.childNodes) } : {}),
        ...(wrapper.classList.contains('pz-table-stack') ? { mode: 'stack' } : {}),
      },
      // Header, body and footer sections in order; a caption is read above.
      children: source.rows,
    }
  } }],
  [TABLE_ROW]: [{ selector: 'tr', parse: (el) => ({ attrs: {}, children: (el as HTMLTableRowElement).cells }) }],
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
