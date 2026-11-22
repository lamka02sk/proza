/**
 * Layout blocks and table output: exact HTML, responsive
 * modes, `sizes` from the column a picture is in, and the edits at the edges
 * of columns, fold-outs and buttons.
 */
import { describe, expect, it } from 'vitest'
import { applyOperations } from '../model/operations'
import { defaultFormats } from '../model/richtext'
import { DOC_VERSION, serializeDoc, validateDoc } from '../model/schema'
import { type Block, type Tree, blocksFromTree, treeFromBlocks } from '../model/tree'
import { type Change, type StructureContext, editingRegistry, fieldValue } from '../editor/editing'
import { en } from '../editor/locale-en'
import { type EditorSelection, NO_SELECTION, caret } from '../editor/selection'
import { mergeBackward, mergeForward, removeBlocks, splitBlock } from '../editor/structure'
import { render } from '../render/render'
import { coreRegistry } from './core'
import {
  buttonEditing, buttonsEditing, columnEditing, columnsEditing, detailsEditing, groupEditing, setRatio, spacerEditing, ungroup,
} from './layout-behaviour'
import { tableCellEditing, tableEditing, tableRowEditing } from './table-behaviour'
import { textEditing } from './text-behaviour'

const editing = editingRegistry([...textEditing, columnsEditing, columnEditing, groupEditing, detailsEditing, buttonsEditing, buttonEditing, spacerEditing, tableEditing, tableRowEditing, tableCellEditing])
const rich = (text: string) => ({ text, formats: [] })
const p = (id: string, text: string): Block => ({ id, type: 'core/paragraph', attrs: { content: rich(text) } })
const html = (...blocks: unknown[]): string => render({ version: 1, blocks }, coreRegistry)

function tree(...blocks: Block[]): Tree {
  const { doc, issues } = validateDoc({ version: DOC_VERSION, blocks }, coreRegistry)
  expect(issues).toEqual([])
  return treeFromBlocks(doc.blocks)
}

function ctx(t: Tree, selection: EditorSelection = NO_SELECTION): StructureContext {
  let n = 0
  return { tree: t, schemas: coreRegistry, editing, formats: defaultFormats, strings: en, createId: () => `n${++n}`, current: selection.kind === 'text' ? selection.blockId : null, selection }
}

function apply(t: Tree, change: Change | null): Tree {
  expect(change).not.toBeNull()
  const after = applyOperations(t, change!.ops).tree
  const { issues } = validateDoc(serializeDoc({ version: DOC_VERSION, blocks: blocksFromTree(after) }, coreRegistry), coreRegistry)
  expect(issues).toEqual([])
  return after
}

const cols = (ratio: string, ...columns: Block[][]): Block => ({ id: 'cs', type: 'core/columns', attrs: { ratio }, children: columns.map((kids, i) => ({ id: `c${i}`, type: 'core/column', attrs: {}, children: kids })) })

describe('layout output', () => {
  it('columns are a grid from a ratio preset; a picture in a column gets sizes for its share', () => {
    expect(html(cols('2-1', [p('a', 'One')], [{ id: 'i', type: 'core/image', attrs: { src: '/a.jpg', alt: 'A', srcset: '/a.jpg 800w' } }])))
      .toBe('<div class="pz-columns pz-layout-2-1"><div class="pz-column"><p>One</p></div><div class="pz-column"><figure class="pz-image pz-width-l">'
        + '<img src="/a.jpg" alt="A" srcset="/a.jpg 800w" sizes="(max-width: 600px) 100vw, (max-width: 720px) 33vw, 240px" loading="lazy" decoding="async"></figure></div></div>')
  })

  it('group, fold-out, buttons and space', () => {
    expect(html({ id: 'g', type: 'core/group', attrs: { look: 'panel', tag: 'aside' }, children: [p('a', 'Note')] })).toBe('<aside class="pz-group pz-look-panel"><p>Note</p></aside>')
    expect(html({ id: 'd', type: 'core/details', attrs: { summary: rich('Delivery?'), open: true }, children: [p('a', 'Fridays')] }))
      .toBe('<details class="pz-details" open><summary>Delivery?</summary><div class="pz-details-body"><p>Fridays</p></div></details>')
    expect(html({ id: 'b', type: 'core/buttons', attrs: {}, children: [
      { id: 'x', type: 'core/button', attrs: { text: rich('Book'), href: '/book', newWindow: true } },
      { id: 'y', type: 'core/button', attrs: { text: rich('No link'), look: 'line' } },
    ] })).toBe('<div class="pz-buttons"><a class="pz-button pz-button-fill" href="/book" target="_blank" rel="noopener">Book</a></div>')
    expect(html({ id: 's', type: 'core/spacer', attrs: { height: 'l' } })).toBe('<div class="pz-spacer pz-space-l" aria-hidden="true"></div>')
  })

  it('wide and full go on parts of the page only, never inside columns', () => {
    expect(html({ id: 'i', type: 'core/image', attrs: { src: '/a.jpg', bleed: 'wide' } })).toContain('class="pz-image pz-width-l pz-bleed-wide"')
    expect(html({ id: 'g', type: 'core/group', attrs: {}, children: [{ id: 'i', type: 'core/image', attrs: { src: '/a.jpg', bleed: 'full' } }] })).not.toContain('pz-bleed')
  })

  it('a column outside columns, or a button outside buttons, does not load as one', () => {
    const { issues } = validateDoc({ version: 1, blocks: [{ id: 'c', type: 'core/column', attrs: {}, children: [] }, { id: 'b', type: 'core/button', attrs: {} }] }, coreRegistry)
    expect(issues.map((i) => i.message)).toEqual(['core/column must be inside core/columns; kept as an unsupported block', 'core/button must be inside core/buttons; kept as an unsupported block'])
  })
})

describe('table output', () => {
  const cell = (id: string, text: string, attrs: Record<string, unknown> = {}): Block => ({ id, type: 'core/table-cell', attrs, children: [p(`${id}p`, text)] })
  const tbl = (mode: string, rows: Block[][]): unknown => ({ id: 't', type: 'core/table', attrs: { mode, caption: rich('Prices') }, children: rows.map((cells, i) => ({ id: `r${i}`, type: 'core/table-row', attrs: {}, children: cells })) })

  it('stacked: explicit roles keep the table a table, each value carries its header for the card', () => {
    expect(html(tbl('stack', [[cell('a', 'Item', { header: true, scope: 'col' }), cell('b', 'Price', { header: true, scope: 'col' })], [cell('c', 'Tea'), cell('d', '3 €')]])))
      .toBe('<div class="pz-table pz-table-stack" role="region" tabindex="0" aria-label="Prices"><table role="table"><caption>Prices</caption><tbody role="rowgroup">'
        + '<tr role="row"><th scope="col" role="columnheader">Item</th><th scope="col" role="columnheader">Price</th></tr>'
        + '<tr role="row"><td role="cell" data-pz-label="Item">Tea</td><td role="cell" data-pz-label="Price">3 €</td></tr></tbody></table></div>')
  })

  it('a table with merged cells is never stacked', () => {
    const out = html(tbl('stack', [[cell('a', 'Both', { colspan: 2 })], [cell('c', 'x'), cell('d', 'y')]]))
    expect(out).not.toContain('pz-table-stack')
    expect(out).toContain('<td colspan="2">Both</td>')
  })
})

describe('edges of layout parts', () => {
  it('Backspace at the start of a column does not join it to the column before', () => {
    const t = tree(cols('1-1', [p('a', 'One')], [p('b', 'Two')]))
    expect(mergeBackward(ctx(t), 'b', 'content')).toBeNull()
    expect(mergeForward(ctx(t), 'a', 'content')).toBeNull()
  })

  it('Enter after a fold-out title starts its content; Backspace at the content start joins the title', () => {
    let t = tree({ id: 'd', type: 'core/details', attrs: { summary: rich('Title') }, children: [p('a', 'Body')] })
    const enter = splitBlock(ctx(t), 'd', 'summary', rich('Title'), rich(''))
    t = apply(t, enter)
    expect(t.children.get('d')!.map((id) => fieldValue(t.nodes.get(id)!, 'content').text)).toEqual(['', 'Body'])
    t = apply(t, removeBlocks(ctx(t), [t.children.get('d')![0]!]))
    t = apply(t, mergeBackward(ctx(t), 'a', 'content'))
    expect(fieldValue(t.nodes.get('d')!, 'summary').text).toBe('TitleBody')
    // A fold-out is never left without content.
    expect(t.children.get('d')).toHaveLength(1)
  })

  it('Enter in an empty last button leaves the buttons for a text after them', () => {
    let t = tree(
      { id: 'bs', type: 'core/buttons', attrs: {}, children: [{ id: 'x', type: 'core/button', attrs: { text: rich('Go'), href: '/' } }, { id: 'y', type: 'core/button', attrs: {} }] },
    )
    const change = splitBlock(ctx(t, caret('y', 'text', 0)), 'y', 'text', rich(''), rich(''))
    t = apply(t, change)
    expect(blocksFromTree(t).map((b) => b.type)).toEqual(['core/buttons', 'core/paragraph'])
    expect(t.children.get('bs')).toEqual(['x'])
    expect(change!.selection.kind).toBe('text')
  })

  it('a new ratio adds columns, or moves the parts of columns no longer needed into the last one kept', () => {
    let t = tree(cols('1-1-1', [p('a', 'One')], [p('b', 'Two')], [p('c', 'Three')]))
    t = apply(t, setRatio(ctx(t), 'cs', '1-1'))
    expect(t.children.get('cs')).toHaveLength(2)
    expect(t.children.get('c1')!.map((id) => fieldValue(t.nodes.get(id)!, 'content').text)).toEqual(['Two', 'Three'])
    t = apply(t, setRatio(ctx(t), 'cs', '1-1-1-1'))
    expect(t.children.get('cs')).toHaveLength(4)
  })

  it('removing a column: the ratio follows the count, and one column left is unwrapped', () => {
    let t = tree(cols('1-1-1', [p('a', 'One')], [p('b', 'Two')], [p('c', 'Three')]))
    t = apply(t, removeBlocks(ctx(t), ['c2']))
    expect(t.nodes.get('cs')!.attrs.ratio).toBe('1-1')
    t = apply(t, removeBlocks(ctx(t), ['c1']))
    expect(blocksFromTree(t).map((b) => b.id)).toEqual(['a'])
  })

  it('a group taken apart leaves its parts in its place', () => {
    let t = tree(p('x', 'Before'), { id: 'g', type: 'core/group', attrs: {}, children: [p('a', 'One'), p('b', 'Two')] })
    t = apply(t, ungroup(ctx(t), 'g'))
    expect(blocksFromTree(t).map((b) => b.id)).toEqual(['x', 'a', 'b'])
  })
})
