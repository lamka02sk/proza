/**
 * Access to the browser selection for a field, in the light DOM or inside a
 * shadow root (canvas isolation spike).
 */

/** The part of Selection the field uses. */
export interface SelectionLike {
  readonly rangeCount: number
  readonly anchorNode: Node | null
  readonly anchorOffset: number
  readonly focusNode: Node | null
  readonly focusOffset: number
  setBaseAndExtent(anchorNode: Node, anchorOffset: number, focusNode: Node, focusOffset: number): void
}

export type SelectionSource = () => SelectionLike | null

/** The element that has focus in the tree `node` lives in (document or shadow root). */
export function activeElementFor(node: Node): Element | null {
  const root = node.getRootNode()
  return root instanceof Document || root instanceof ShadowRoot ? root.activeElement : null
}

export function hasFocusWithin(el: Element): boolean {
  const active = activeElementFor(el)
  return active !== null && (active === el || el.contains(active))
}

/**
 * A selection source for `node`. In the light DOM this is document.getSelection().
 * In a shadow root, engines retarget the selection to the host, so the real
 * endpoints come from getComposedRanges() plus Selection.direction.
 */
export function selectionSourceFor(node: Node): SelectionSource {
  const root = node.getRootNode()
  const doc = node.ownerDocument ?? document
  if (!(root instanceof ShadowRoot)) return () => doc.getSelection()
  return () => composedSelection(doc, root)
}

function composedSelection(doc: Document, shadow: ShadowRoot): SelectionLike | null {
  const sel = doc.getSelection()
  if (!sel) return null
  // Engines that already report nodes inside the shadow tree need nothing more.
  if (sel.rangeCount === 0 || (sel.anchorNode && shadow.contains(sel.anchorNode))) return sel
  if (typeof sel.getComposedRanges !== 'function') return sel
  let ranges: StaticRange[]
  try {
    ranges = sel.getComposedRanges({ shadowRoots: [shadow] })
  } catch {
    // Older WebKit takes the shadow roots as arguments.
    ranges = (sel.getComposedRanges as unknown as (...r: ShadowRoot[]) => StaticRange[])(shadow)
  }
  const r = ranges[0]
  if (!r) return sel
  const backward = sel.direction === 'backward'
  return {
    rangeCount: 1,
    anchorNode: backward ? r.endContainer : r.startContainer,
    anchorOffset: backward ? r.endOffset : r.startOffset,
    focusNode: backward ? r.startContainer : r.endContainer,
    focusOffset: backward ? r.startOffset : r.endOffset,
    setBaseAndExtent: (a, ao, f, fo) => { sel.setBaseAndExtent(a, ao, f, fo) },
  }
}
