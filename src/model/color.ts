/**
 * Colour contrast (WCAG 2.2, 1.4.3): the palette offered to authors keeps
 * only colours readable on the page (ATAG B.2). Pure.
 */

/** sRGB channels 0 to 255 from `#rgb` or `#rrggbb`, or null. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const v = m[1]!.length === 3 ? m[1]!.split('').map((c) => c + c).join('') : m[1]!
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number]
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number): number => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Contrast ratio of two hex colours, 1 to 21; null when either does not parse. */
export function contrastRatio(a: string, b: string): number | null {
  const x = parseHex(a), y = parseHex(b)
  if (!x || !y) return null
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
