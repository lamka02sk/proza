/**
 * List markers as word processors write them into pasted HTML ("1.", "a)",
 * "iv.", "·", "o", "§"): bullet or numbered, the numbering style and the
 * number the list starts at. Pure, so Word's list rebuilding is tested in Node.
 */

export type Numbering = '1' | 'a' | 'A' | 'i' | 'I'

export interface MarkerKind {
  readonly ordered: boolean
  readonly numbering: Numbering
  readonly start: number
}

const BULLET: MarkerKind = { ordered: false, numbering: '1', start: 1 }

export function romanValue(s: string): number | null {
  const v: Readonly<Record<string, number>> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 }
  const t = s.toLowerCase()
  if (!/^m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/.test(t) || t === '') return null
  let n = 0
  for (let k = 0; k < t.length; k++) {
    const a = v[t[k]!]!, b = v[t[k + 1] ?? ''] ?? 0
    n += a < b ? -a : a
  }
  return n
}

/**
 * The kind of list a marker belongs to. `previous` is the kind of the marker
 * before it in the same list: after "h." an "i." is a letter, not a roman one.
 */
export function markerKind(marker: string, previous?: MarkerKind): MarkerKind {
  const m = marker.replace(/[\u00a0\s]+/g, ' ').trim()
  // Word writes outline numbers ("1.2.") too; the last part is the item's own number.
  const numeric = /^\(?(?:\d+\.)*(\d{1,9})[.)]?$/.exec(m)
  if (numeric) return { ordered: true, numbering: '1', start: Number(numeric[1]) }
  const letters = /^\(?([a-zA-Z]{1,6})[.)]$/.exec(m)
  if (letters) {
    const s = letters[1]!
    const upper = s === s.toUpperCase()
    const roman = romanValue(s)
    const alphaPrev = previous && previous.ordered && (previous.numbering === 'a' || previous.numbering === 'A')
    if (roman !== null && !(s.length === 1 && alphaPrev) && !(s.length === 1 && s.toLowerCase() !== 'i' && !previous)) {
      return { ordered: true, numbering: upper ? 'I' : 'i', start: roman }
    }
    if (s.length === 1) return { ordered: true, numbering: upper ? 'A' : 'a', start: s.toLowerCase().charCodeAt(0) - 96 }
  }
  return BULLET
}
