/**
 * The editor selection. The editor's selection is the
 * source of truth; the DOM selection follows it.
 *
 * Text selections keep anchor and focus (not start and end), because
 * Shift+arrow extends from the anchor and the direction decides which end moves.
 */
import { type ParentId, type Tree, childrenOf, parentOf } from '../model/tree'

export type EditorSelection =
  | { readonly kind: 'none' }
  /** A caret or a range inside one rich-text attribute (`field`) of one block. */
  | { readonly kind: 'text'; readonly blockId: string; readonly field: string; readonly anchor: number; readonly focus: number }
  /** Whole blocks: every sibling from anchor to focus, after both are lifted to a common parent. */
  | { readonly kind: 'blocks'; readonly anchorId: string; readonly focusId: string }
  /** Table cells: the rectangle from the anchor cell to the focus cell, grown over merged cells. */
  | { readonly kind: 'cells'; readonly tableId: string; readonly anchorId: string; readonly focusId: string }
  /** Text across fields: from a place in one field to a place in another. */
  | { readonly kind: 'range'; readonly anchor: TextPoint; readonly focus: TextPoint }

/** A place in the text of one field. */
export interface TextPoint { readonly blockId: string; readonly field: string; readonly offset: number }

export const NO_SELECTION: EditorSelection = { kind: 'none' }

export function caret(blockId: string, field: string, offset: number): EditorSelection {
  return { kind: 'text', blockId, field, anchor: offset, focus: offset }
}

export function blocks(anchorId: string, focusId: string = anchorId): EditorSelection {
  return { kind: 'blocks', anchorId, focusId }
}

export function cells(tableId: string, anchorId: string, focusId: string = anchorId): EditorSelection {
  return { kind: 'cells', tableId, anchorId, focusId }
}

export function range(anchor: TextPoint, focus: TextPoint): EditorSelection {
  return { kind: 'range', anchor, focus }
}

export function pointsEqual(a: TextPoint, b: TextPoint): boolean {
  return a.blockId === b.blockId && a.field === b.field && a.offset === b.offset
}

export function selectionsEqual(a: EditorSelection, b: EditorSelection): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'text' && b.kind === 'text') return a.blockId === b.blockId && a.field === b.field && a.anchor === b.anchor && a.focus === b.focus
  if (a.kind === 'blocks' && b.kind === 'blocks') return a.anchorId === b.anchorId && a.focusId === b.focusId
  if (a.kind === 'cells' && b.kind === 'cells') return a.tableId === b.tableId && a.anchorId === b.anchorId && a.focusId === b.focusId
  if (a.kind === 'range' && b.kind === 'range') return pointsEqual(a.anchor, b.anchor) && pointsEqual(a.focus, b.focus)
  return true
}

/**
 * Anchor and focus lifted to siblings: the ancestors of each that are children
 * of their lowest common container. Selecting from a list item to the paragraph
 * after the list selects the list and the paragraph.
 */
export function liftToSiblings(tree: Tree, anchorId: string, focusId: string): { parent: ParentId; anchor: string; focus: string } {
  const chain = (id: string): string[] => {
    const out = [id]
    for (let p = parentOf(tree, id); p !== null; p = parentOf(tree, p)) out.unshift(p)
    return out
  }
  const a = chain(anchorId), f = chain(focusId)
  let i = 0
  while (i < a.length && i < f.length && a[i] === f[i]) i++
  // One contains the other: select the outer one.
  if (i === a.length || i === f.length) {
    const outer = a[i - 1]!
    return { parent: parentOf(tree, outer), anchor: outer, focus: outer }
  }
  return { parent: i === 0 ? null : a[i - 1]!, anchor: a[i]!, focus: f[i]! }
}

/** The selected block ids, siblings in document order. Empty unless the selection is a block selection. */
export function selectedBlocks(tree: Tree, sel: EditorSelection): string[] {
  if (sel.kind !== 'blocks') return []
  if (!tree.nodes.has(sel.anchorId) || !tree.nodes.has(sel.focusId)) return []
  const { parent, anchor, focus } = liftToSiblings(tree, sel.anchorId, sel.focusId)
  const kids = childrenOf(tree, parent)
  const i = kids.indexOf(anchor), j = kids.indexOf(focus)
  return kids.slice(Math.min(i, j), Math.max(i, j) + 1)
}

/** The block the selection is in or ends on, for the tab stop and for commands on "the current block". */
export function focusBlock(sel: EditorSelection): string | null {
  if (sel.kind === 'range') return sel.focus.blockId
  return sel.kind === 'text' ? sel.blockId : sel.kind === 'blocks' || sel.kind === 'cells' ? sel.focusId : null
}
