/**
 * Transforms: selected parts into
 * a group or into columns, pictures into a gallery, and a gallery back into
 * pictures. Pure: each returns one change, applied as one undo step.
 */
import type { Change, StructureContext, Transform } from '../editor/editing'
import { stopsIn } from '../editor/editing'
import { Draft, canHold, cleanup, newBlock, stopEdge } from '../editor/structure'
import { COLUMN, COLUMNS, GROUP, ratioFor } from './layout'
import { GALLERY, IMAGE } from './media'

/** Siblings in document order, none a fixed part of a structure (a table cell), or null. */
function siblings(d: Draft, ids: readonly string[]): string[] | null {
  if (ids.length === 0 || !ids.every((id) => d.has(id))) return null
  const parent = d.parent(ids[0]!)
  if (!ids.every((id) => d.parent(id) === parent && d.def(id)?.fixed !== true)) return null
  const order = d.kids(parent)
  return [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b))
}

/** The caret at the start of the first text inside `id`, or the part selected whole. */
function into(d: Draft, id: string, ctx: StructureContext): Change['selection'] {
  const stop = stopsIn(d.now(null), id)[0]
  return stop ? stopEdge(d, stop, 'start') : ctx.selection
}

const groupWrap: Transform = {
  id: 'core/group/wrap', type: GROUP,
  title: (s) => s.transformNames['core/group/wrap'] ?? GROUP,
  run: (ctx, ids) => {
    const d = new Draft(ctx)
    const list = siblings(d, ids)
    if (!list) return null
    const parent = d.parent(list[0]!)
    if (!canHold(d, parent, GROUP)) return null
    const group = newBlock(ctx, GROUP, {}, [])
    d.insert(parent, d.index(list[0]!), [group])
    if (!list.every((id) => canHold(d, group.id, d.node(id).type))) return null
    d.move(list, group.id, 0)
    return d.done(into(d, group.id, ctx), { announce: ctx.strings.transformed(groupWrap.title(ctx.strings)) })
  },
}

const columnsWrap: Transform = {
  id: 'core/columns/wrap', type: COLUMNS,
  title: (s) => s.transformNames['core/columns/wrap'] ?? COLUMNS,
  run: (ctx, ids) => {
    const d = new Draft(ctx)
    const list = siblings(d, ids)
    if (!list || list.length > 4) return null
    const parent = d.parent(list[0]!)
    if (!canHold(d, parent, COLUMNS)) return null
    // One part still makes two columns: the second waits, empty, for what goes beside it.
    const count = Math.max(2, list.length)
    const cols = Array.from({ length: count }, (_, i) => newBlock(ctx, COLUMN, {}, i < list.length ? [] : [newBlock(ctx, 'core/paragraph')]))
    const columns = newBlock(ctx, COLUMNS, { ratio: ratioFor(count) }, cols)
    d.insert(parent, d.index(list[0]!), [columns])
    if (!list.every((id, i) => canHold(d, cols[i]!.id, d.node(id).type))) return null
    list.forEach((id, i) => { d.move([id], cols[i]!.id, 0) })
    return d.done(into(d, columns.id, ctx), { announce: ctx.strings.transformed(columnsWrap.title(ctx.strings)) })
  },
}

const galleryFromImages: Transform = {
  id: 'core/gallery/from-images', type: GALLERY,
  title: (s) => s.transformNames['core/gallery/from-images'] ?? GALLERY,
  run: (ctx, ids) => {
    const d = new Draft(ctx)
    const list = siblings(d, ids)
    if (!list || !list.every((id) => d.node(id).type === IMAGE)) return null
    const parent = d.parent(list[0]!)
    if (!canHold(d, parent, GALLERY)) return null
    const gallery = newBlock(ctx, GALLERY, { columns: list.length === 2 ? 2 : list.length === 4 ? 4 : 3 }, [])
    d.insert(parent, d.index(list[0]!), [gallery])
    d.move(list, gallery.id, 0)
    return d.done({ kind: 'blocks', anchorId: gallery.id, focusId: gallery.id }, { announce: ctx.strings.transformed(galleryFromImages.title(ctx.strings)) })
  },
}

const imagesFromGallery: Transform = {
  id: 'core/image/from-gallery', type: IMAGE,
  title: (s) => s.transformNames['core/image/from-gallery'] ?? IMAGE,
  run: (ctx, ids) => {
    const d = new Draft(ctx)
    if (ids.length !== 1 || !d.has(ids[0]!) || d.node(ids[0]!).type !== GALLERY) return null
    const id = ids[0]!
    const parent = d.parent(id)
    const kids = d.kids(id)
    if (kids.length === 0 || !canHold(d, parent, IMAGE)) return null
    d.move(kids, parent, d.index(id))
    d.remove([id])
    cleanup(d, parent)
    return d.done({ kind: 'blocks', anchorId: kids[0]!, focusId: kids.at(-1)! }, { announce: ctx.strings.transformed(imagesFromGallery.title(ctx.strings)) })
  },
}

export const groupTransforms: readonly Transform[] = [groupWrap]
export const columnsTransforms: readonly Transform[] = [columnsWrap]
export const galleryTransforms: readonly Transform[] = [galleryFromImages]
export const imageTransforms: readonly Transform[] = [imagesFromGallery]
