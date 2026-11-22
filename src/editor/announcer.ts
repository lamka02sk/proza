/**
 * Screen reader announcements: one polite and one
 * assertive live region. Commands declare what they announce; the editor
 * passes it here. The design's status line becomes the visible polite region.
 */

export type Politeness = 'polite' | 'assertive'

export class Announcer {
  readonly polite: HTMLElement
  readonly assertive: HTMLElement
  readonly #listeners = new Set<(text: string, politeness: Politeness) => void>()
  readonly #timers = new Map<Politeness, ReturnType<typeof setTimeout>>()

  /** The regions must be in the document before the first announcement, or some screen readers miss it. */
  constructor(doc: Document) {
    this.polite = region(doc, 'polite')
    this.assertive = region(doc, 'assertive')
  }

  announce(text: string, politeness: Politeness = 'polite'): void {
    if (!text) return
    const el = politeness === 'polite' ? this.polite : this.assertive
    // The same words twice in a row are only spoken again after the region changed.
    // Clearing, then writing in the next task, makes every announcement a change.
    el.textContent = ''
    clearTimeout(this.#timers.get(politeness))
    this.#timers.set(politeness, setTimeout(() => { el.textContent = text; this.#timers.delete(politeness) }, 50))
    for (const fn of this.#listeners) fn(text, politeness)
  }

  /** Every announcement, for the playground log and tests. */
  onAnnounce(fn: (text: string, politeness: Politeness) => void): () => void {
    this.#listeners.add(fn)
    return () => { this.#listeners.delete(fn) }
  }

  destroy(): void {
    for (const t of this.#timers.values()) clearTimeout(t)
    this.#listeners.clear()
  }
}

function region(doc: Document, politeness: Politeness): HTMLElement {
  const el = doc.createElement('div')
  el.className = 'pz-live'
  el.setAttribute('aria-live', politeness)
  el.setAttribute('aria-atomic', 'true')
  if (politeness === 'polite') el.setAttribute('role', 'status')
  return el
}
