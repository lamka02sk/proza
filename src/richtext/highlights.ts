/**
 * Non-destructive highlights through the CSS Custom Highlight API:
 * find results, checker markers and the active format boundary
 * are painted without touching the field DOM, so it stays canonical.
 *
 * The registry (`CSS.highlights`) is one per window, while each field owns
 * only its own ranges, so ranges are kept per owner and merged per name.
 */

const owners = new WeakMap<Window, Map<string, Map<object, readonly AbstractRange[]>>>()

export function highlightsSupported(win: Window & typeof globalThis = window): boolean {
  return typeof win.Highlight === 'function' && typeof win.CSS !== 'undefined' && 'highlights' in win.CSS
}

/** Replace the ranges `owner` contributes to the highlight `name`. An empty list removes them. */
export function setHighlightRanges(win: Window & typeof globalThis, owner: object, name: string, ranges: readonly AbstractRange[]): void {
  if (!highlightsSupported(win)) return
  let byName = owners.get(win)
  if (!byName) owners.set(win, (byName = new Map<string, Map<object, readonly AbstractRange[]>>()))
  let byOwner = byName.get(name)
  if (!byOwner) byName.set(name, (byOwner = new Map<object, readonly AbstractRange[]>()))
  if (ranges.length === 0) byOwner.delete(owner)
  else byOwner.set(owner, ranges)
  // Many fields set their part of one name at once (find across 2,000 parts): the registry is rebuilt once, after them.
  let pending = dirty.get(win)
  if (!pending) {
    const names = new Set<string>()
    pending = names
    dirty.set(win, names)
    queueMicrotask(() => {
      dirty.delete(win)
      for (const n of names) {
        const all = [...(byName.get(n)?.values() ?? [])].flat()
        if (all.length === 0) win.CSS.highlights.delete(n)
        else win.CSS.highlights.set(n, new win.Highlight(...all))
      }
    })
  }
  pending.add(name)
}

const dirty = new WeakMap<Window, Set<string>>()

/** Remove everything `owner` contributes, under every name (a field being destroyed). */
export function clearHighlights(win: Window & typeof globalThis, owner: object): void {
  const byName = owners.get(win)
  if (!byName) return
  for (const [name, byOwner] of byName) if (byOwner.has(owner)) setHighlightRanges(win, owner, name, [])
}
