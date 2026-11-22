/**
 * Pictures from Word's `text/rtf` clipboard format (Word
 * desktop). Word's HTML points pictures at `file://` paths the page cannot
 * read; the RTF carries their bytes as hexadecimal `\pict` groups, in the same
 * order. Pure: a small tokenizer, no DOM.
 */

export interface RtfPicture {
  /** `image/png` or `image/jpeg`; null for formats a page cannot show (EMF, WMF), which keep their place in the order. */
  readonly type: 'image/png' | 'image/jpeg' | null
  readonly bytes: Uint8Array
  /** Shown size in CSS pixels, from `\picwgoal` and `\pichgoal` (twips) and the scale. */
  readonly width?: number
  readonly height?: number
}

/** Above this the RTF is not scanned: no clipboard picture set is that large, and the scan is linear but not free. */
const MAX_RTF = 64_000_000

const MAX_GROUPS = 512

interface Frame { kind: string | null; hex: string[]; words: Map<string, number | null>; skip: boolean }

/**
 * Every picture of the document in reading order. Word writes each picture
 * twice, once for Word (`\shppict`) and once for older readers
 * (`\nonshppict`); only the first counts.
 */
export function rtfPictures(rtf: string): RtfPicture[] {
  if (!rtf.startsWith('{\\rtf') || rtf.length > MAX_RTF) return []
  const out: RtfPicture[] = []
  const stack: Frame[] = []
  let fresh = false
  let i = 0
  const n = rtf.length
  while (i < n) {
    const c = rtf[i]!
    if (c === '{') {
      // Word nests a few dozen groups; a clipboard with thousands is not a document, and each group costs a frame.
      if (stack.length >= MAX_GROUPS) return []
      const parent = stack.at(-1)
      stack.push({ kind: null, hex: [], words: new Map(), skip: parent?.skip === true || parent?.kind === 'nonshppict' })
      fresh = true
      i++
      continue
    }
    if (c === '}') {
      const f = stack.pop()
      if (f?.kind === 'pict' && !f.skip) out.push(picture(f))
      fresh = false
      i++
      continue
    }
    const top = stack.at(-1)
    if (c === '\\') {
      const m = /^\\([a-z]{1,32})(-?\d{1,10})? ?|^\\(.)/.exec(rtf.slice(i, i + 48))
      if (!m) { i++; continue }
      i += m[0].length
      if (!top) continue
      if (m[3] !== undefined) {
        // `\*` marks an optional destination; the next word names it. Other symbols are text.
        if (m[3] !== '*') fresh = false
        continue
      }
      const word = m[1]!
      if (fresh) { top.kind = word; fresh = false }
      if (top.kind === 'pict') {
        top.words.set(word, m[2] === undefined ? null : Number(m[2]))
        // Binary data after \binN: not hexadecimal, and Word never puts it on the clipboard. Skip its bytes.
        if (word === 'bin' && m[2] !== undefined) i += Math.max(0, Number(m[2]))
      }
      continue
    }
    fresh = false
    if (top?.kind === 'pict') {
      // Hex digits of the picture run to the group's end; collect them in chunks, not character by character.
      const end = nextSpecial(rtf, i)
      top.hex.push(rtf.slice(i, end))
      i = end
      continue
    }
    i++
  }
  return out
}

function nextSpecial(s: string, from: number): number {
  for (let j = from; j < s.length; j++) {
    const c = s.charCodeAt(j)
    if (c === 123 || c === 125 || c === 92) return j
  }
  return s.length
}

function picture(f: Frame): RtfPicture {
  const type = f.words.has('pngblip') ? 'image/png' : f.words.has('jpegblip') ? 'image/jpeg' : null
  const hex = f.hex.join('').replace(/[^0-9a-f]/gi, '')
  const bytes = type === null ? new Uint8Array(0) : fromHex(hex)
  const twips = (goal: string, scale: string): number | undefined => {
    const g = f.words.get(goal)
    if (typeof g !== 'number' || g <= 0) return undefined
    const s = f.words.get(scale)
    return Math.round(g / 15 * (typeof s === 'number' && s > 0 ? s / 100 : 1))
  }
  const width = twips('picwgoal', 'picscalex'), height = twips('pichgoal', 'picscaley')
  return { type, bytes, ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}) }
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1)
  for (let k = 0; k < out.length; k++) out[k] = parseInt(hex.slice(k * 2, k * 2 + 2), 16)
  return out
}
