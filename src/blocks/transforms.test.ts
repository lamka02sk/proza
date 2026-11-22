/**
 * Transforms: parts into a group or columns, pictures into
 * a gallery and back. Each keeps every part, in reading order, in a document
 * the schema accepts, as one change.
 */
import { describe, expect, it } from 'vitest'
import { applyOperations } from '../model/operations'
import { defaultFormats } from '../model/richtext'
import { DOC_VERSION, serializeDoc, validateDoc } from '../model/schema'
import { type Block, type Tree, blocksFromTree, treeFromBlocks } from '../model/tree'
import { type StructureContext, editingRegistry } from '../editor/editing'
import { en } from '../editor/locale-en'
import { NO_SELECTION } from '../editor/selection'
import { coreRegistry } from './core'
import { coreBlocks } from './index'
import { columnsTransforms, galleryTransforms, groupTransforms, imageTransforms } from './transforms'

const editing = editingRegistry(coreBlocks)
const p = (id: string, text: string): Block => ({ id, type: 'core/paragraph', attrs: { content: { text, formats: [] } } })
const img = (id: string): Block => ({ id, type: 'core/image', attrs: { src: `/${id}.jpg`, alt: id } })

function tree(...blocks: Block[]): Tree {
  return treeFromBlocks(validateDoc({ version: DOC_VERSION, blocks }, coreRegistry).doc.blocks)
}
function ctx(t: Tree): StructureContext {
  let n = 0
  return { tree: t, schemas: coreRegistry, editing, formats: defaultFormats, strings: en, createId: () => `n${++n}`, current: null, selection: NO_SELECTION }
}
/** Types and texts in reading order, nested by indent. */
function shape(t: Tree): string[] {
  const out: string[] = []
  const walk = (list: readonly Block[], depth: number): void => {
    for (const b of list) {
      const v = b.attrs.content as { text: string } | undefined
      out.push(`${'  '.repeat(depth)}${b.type.replace('core/', '')}${v ? `: ${v.text}` : ''}`)
      if (b.children) walk(b.children, depth + 1)
    }
  }
  walk(blocksFromTree(t), 0)
  return out
}
function run(t: Tree, change: ReturnType<typeof groupTransforms[0]['run']>): Tree {
  expect(change).not.toBeNull()
  const after = applyOperations(t, change!.ops).tree
  expect(validateDoc(serializeDoc({ version: DOC_VERSION, blocks: blocksFromTree(after) }, coreRegistry), coreRegistry).issues).toEqual([])
  return after
}

describe('transforms', () => {
  it('parts into a group, in order, where the first was', () => {
    const t = tree(p('a', 'one'), p('b', 'two'), p('c', 'three'))
    expect(shape(run(t, groupTransforms[0]!.run(ctx(t), ['c', 'b'])))).toEqual(['paragraph: one', 'group', '  paragraph: two', '  paragraph: three'])
  })

  it('parts into columns, one per part; a single part gets an empty column beside it', () => {
    const t = tree(p('a', 'one'), p('b', 'two'))
    expect(shape(run(t, columnsTransforms[0]!.run(ctx(t), ['a', 'b'])))).toEqual(['columns', '  column', '    paragraph: one', '  column', '    paragraph: two'])
    expect(shape(run(t, columnsTransforms[0]!.run(ctx(t), ['a'])))).toEqual(['columns', '  column', '    paragraph: one', '  column', '    paragraph: ', 'paragraph: two'])
    expect(columnsTransforms[0]!.run(ctx(tree(p('a', '1'), p('b', '2'), p('c', '3'), p('d', '4'), p('e', '5'))), ['a', 'b', 'c', 'd', 'e'])).toBeNull()
  })

  it('pictures into a gallery and back', () => {
    const t = tree(p('a', 'x'), img('i1'), img('i2'))
    const g = run(t, galleryTransforms[0]!.run(ctx(t), ['i1', 'i2']))
    expect(shape(g)).toEqual(['paragraph: x', 'gallery', '  image', '  image'])
    const galleryId = [...g.nodes.values()].find((n) => n.type === 'core/gallery')!.id
    expect(shape(run(g, imageTransforms[0]!.run(ctx(g), [galleryId])))).toEqual(['paragraph: x', 'image', 'image'])
    // Only pictures make a gallery.
    expect(galleryTransforms[0]!.run(ctx(t), ['a', 'i1'])).toBeNull()
  })

  it('needs siblings: parts at different levels are not wrapped together', () => {
    const t = tree(p('a', 'x'), { id: 'q', type: 'core/quote', attrs: {}, children: [p('qp', 'y')] })
    expect(groupTransforms[0]!.run(ctx(t), ['a', 'qp'])).toBeNull()
  })
})
