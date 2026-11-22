/**
 * Pure helpers of the interface, testable without a DOM: inserter search
 * (every word of the query starts a word of the title or keywords, without
 * regard to case or diacritics) and the on-screen keyboard's height.
 */
import type { InserterItem } from '../editor/editing'

/** Lower case without diacritics: "obrázok" matches "obrazok". */
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Items whose words start with every word of the query, title matches first. */
export function search(items: readonly InserterItem[], query: string, words: (item: InserterItem) => string, title: (item: InserterItem) => string): InserterItem[] {
  const q = fold(query).split(/\s+/).filter(Boolean)
  if (q.length === 0) return [...items]
  const scored: { item: InserterItem; score: number }[] = []
  for (const item of items) {
    const t = fold(title(item))
    const all = `${t} ${fold(words(item))}`.split(/[\s/-]+/)
    if (!q.every((w) => all.some((a) => a.startsWith(w)))) continue
    scored.push({ item, score: t.startsWith(q.join(' ')) ? 0 : t.split(/\s+/).some((a) => a.startsWith(q[0]!)) ? 1 : 2 })
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.item)
}

/**
 * Distance from the bottom of the layout viewport to the bottom of the
 * visual viewport: the height of the on-screen keyboard, roughly.
 */
export function keyboardInset(layoutHeight: number, vv: { readonly height: number; readonly offsetTop: number } | null): number {
  if (!vv) return 0
  return Math.max(0, Math.round(layoutHeight - (vv.offsetTop + vv.height)))
}
