/**
 * Inline CSS as foreign HTML carries it (stages 5 and 6):
 * declarations, colours, lengths and font sizes, read by our own parser so
 * every engine sees the same values (CSSOM drops `mso-*` and rewrites colours
 * differently per engine). Pure: no DOM.
 */

export { MAX_VALUE, parseStyle } from '../model/css'

// ---------------------------------------------------------------------------
// Colours

export type Rgb = readonly [number, number, number]

/** Colour keywords that mean "the default text colour": nothing to keep. */
const DEFAULT_COLOR = new Set(['inherit', 'initial', 'unset', 'currentcolor', 'windowtext', 'auto', 'canvastext', 'revert'])

/** Named colours foreign HTML uses in practice (Word, TinyMCE's picker, `<font color>`). */
const NAMED: Readonly<Record<string, string>> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00',
  orange: '#ffa500', purple: '#800080', gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000',
  navy: '#000080', teal: '#008080', olive: '#808000', lime: '#00ff00', aqua: '#00ffff', cyan: '#00ffff',
  fuchsia: '#ff00ff', magenta: '#ff00ff', brown: '#a52a2a', pink: '#ffc0cb', darkred: '#8b0000',
  darkblue: '#00008b', darkgreen: '#006400', darkgray: '#a9a9a9', darkgrey: '#a9a9a9', lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3', dimgray: '#696969', dimgrey: '#696969', gold: '#ffd700', indigo: '#4b0082',
  violet: '#ee82ee', crimson: '#dc143c', tomato: '#ff6347', coral: '#ff7f50', royalblue: '#4169e1',
  steelblue: '#4682b4', slategray: '#708090', slategrey: '#708090', darkorange: '#ff8c00', firebrick: '#b22222',
}

/**
 * A CSS colour as sRGB, `default` for keywords meaning the inherited colour,
 * `transparent` for no colour, or null when it does not parse.
 */
export function parseColor(raw: string): Rgb | 'default' | 'transparent' | null {
  const v = raw.trim().toLowerCase()
  if (DEFAULT_COLOR.has(v)) return 'default'
  if (v === 'transparent' || v === 'none') return 'transparent'
  const named = NAMED[v]
  if (named) return hex(named)
  if (v.startsWith('#')) {
    const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v)
    if (!m) return null
    const h = m[1]!.length <= 4 ? m[1]!.split('').map((c) => c + c).join('') : m[1]!
    if (h.length === 8 && parseInt(h.slice(6), 16) === 0) return 'transparent'
    return hex(`#${h.slice(0, 6)}`)
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(v)
  if (!fn) return null
  const parts = fn[2]!.trim().split(/\s*[,/]\s*|\s+/).filter((p) => p !== '')
  if (parts.length < 3) return null
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
  if (!Number.isFinite(alpha)) return null
  if (alpha === 0) return 'transparent'
  if (fn[1]!.startsWith('rgb')) {
    const ch = parts.slice(0, 3).map((p) => (p.endsWith('%') ? parseFloat(p) * 2.55 : parseFloat(p)))
    if (!ch.every(Number.isFinite)) return null
    return ch.map((c) => Math.round(Math.max(0, Math.min(255, c)))) as unknown as Rgb
  }
  const [hh, s, l] = [parseFloat(parts[0]!), parseFloat(parts[1]!) / 100, parseFloat(parts[2]!) / 100]
  if (![hh, s, l].every(Number.isFinite)) return null
  return hslToRgb(((hh % 360) + 360) % 360, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l)))
}

function hex(h: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as Rgb
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))))
  return [f(0), f(8), f(4)]
}

/** CIE L*a*b* (D65), for distances that match how different two colours look. */
function lab([r, g, b]: Rgb): [number, number, number] {
  const lin = (c: number): number => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

export function colorDistance(a: Rgb, b: Rgb): number {
  const [l1, a1, b1] = lab(a), [l2, a2, b2] = lab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

/** Near black and grey-free: what a page shows as plain text anyway. */
export function isDefaultInk(c: Rgb): boolean {
  const [l, a, b] = lab(c)
  return l < 25 && Math.hypot(a, b) < 12
}

export interface PaletteEntry { readonly name: string; readonly color: string }

/**
 * Distance below which a foreign colour counts as a palette colour. About the
 * difference between two shades of one hue; far enough apart hues never match.
 */
export const COLOR_MATCH = 30

/** The palette entry closest to `c`, when it is close enough to stand for it. */
export function nearestColor(c: Rgb, palette: readonly PaletteEntry[], limit = COLOR_MATCH): string | null {
  let best: string | null = null, bestD = limit
  for (const p of palette) {
    const rgb = parseColor(p.color)
    if (!Array.isArray(rgb)) continue
    const d = colorDistance(c, rgb as Rgb)
    if (d < bestD) { best = p.name; bestD = d }
  }
  return best
}

// ---------------------------------------------------------------------------
// Lengths and font sizes

/** A length in CSS pixels, or a percentage; null for anything else (`auto`, `calc()`). */
export function parseLength(raw: string, emPx = 16): { px: number } | { percent: number } | null {
  // One way to read each number, so a long run of digits cannot backtrack.
  const m = /^(-?(?:\d+(?:\.\d+)?|\.\d+))\s*(px|pt|pc|in|cm|mm|em|rem|ex|ch|%)?$/i.exec(raw.trim())
  if (!m) return null
  const n = parseFloat(m[1]!)
  const unit = (m[2] ?? 'px').toLowerCase()
  if (unit === '%') return { percent: n }
  const px: Readonly<Record<string, number>> = { px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, em: emPx, rem: 16, ex: emPx / 2, ch: emPx / 2 }
  return { px: n * px[unit]! }
}

const SIZE_KEYWORDS: Readonly<Record<string, number>> = {
  'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48,
}

/** `font-size` in pixels given the parent's size, or null when it says nothing usable. */
export function fontSizePx(raw: string, parentPx: number): number | null {
  const v = raw.trim().toLowerCase()
  if (v in SIZE_KEYWORDS) return SIZE_KEYWORDS[v]!
  if (v === 'smaller') return parentPx / 1.2
  if (v === 'larger') return parentPx * 1.2
  const len = parseLength(v, parentPx)
  if (!len) return null
  const px = 'px' in len ? len.px : parentPx * len.percent / 100
  return px > 0 && px < 1000 ? px : null
}

/** `<font size="1">` to `"7"`, and relative `+1`, `-2`. */
export function fontElementSizePx(raw: string): number | null {
  const steps = [10, 13, 16, 18, 24, 32, 48]
  const m = /^([+-]?)([1-7])$/.exec(raw.trim())
  if (!m) return null
  const n = m[1] === '' ? Number(m[2]) : 3 + (m[1] === '+' ? 1 : -1) * Number(m[2])
  return steps[Math.max(1, Math.min(7, n)) - 1]!
}

/**
 * The size preset for text of `px` in a document whose body text is `basePx`:
 * small or large only when the difference is clearly meant (about two steps of a type scale).
 */
export function sizePreset(px: number, basePx: number): '' | 's' | 'l' {
  const ratio = px / basePx
  return ratio <= 0.86 ? 's' : ratio >= 1.15 ? 'l' : ''
}

/** Image width preset from a width relative to a 720 px column (src/blocks/media.ts `imageSizes`). */
export function widthPreset(width: { px: number } | { percent: number }): 's' | 'm' | 'l' {
  const share = 'px' in width ? width.px / 720 : width.percent / 100
  return share <= 0.46 ? 's' : share <= 0.73 ? 'm' : 'l'
}

// ---------------------------------------------------------------------------
// Fonts

const MONOSPACE = /\b(?:monospace|courier|consolas|menlo|monaco|lucida console|source code|fira code|fira mono|roboto mono|jetbrains mono|sf mono|ubuntu mono|dejavu sans mono|liberation mono|cascadia|andale mono|inconsolata)\b/i

export function isMonospace(family: string): boolean {
  return MONOSPACE.test(family)
}

/** The first family named, without quotes: what the report says was not kept. */
export function firstFamily(family: string): string {
  return family.split(',')[0]!.trim().replace(/^["']|["']$/g, '')
}

/** `font-weight` to bold (true), not bold (false), or null when it says nothing. */
export function boldness(raw: string): boolean | null {
  const v = raw.trim().toLowerCase()
  if (v === 'bold' || v === 'bolder') return true
  if (v === 'normal' || v === 'lighter') return false
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n >= 600 : null
}
