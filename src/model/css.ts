/**
 * Inline CSS declarations, read by our own parser so every engine and the
 * server see the same values. Pure: no DOM.
 */

/** Longer declaration values are dropped (data URLs in `background` included: they never import). */
export const MAX_VALUE = 1000

/** Declarations of a `style` attribute, property names lowercased, `!important` removed. Later ones win. */
export function parseStyle(text: string | null): Map<string, string> {
  const out = new Map<string, string>()
  if (!text) return out
  let depth = 0, quote = '', start = 0
  const take = (end: number): void => {
    const decl = text.slice(start, end)
    const colon = decl.indexOf(':')
    if (colon > 0) {
      const name = decl.slice(0, colon).trim().toLowerCase()
      const raw = decl.slice(colon + 1)
      // No real declaration is this long; every rule after this then reads a bounded string.
      const value = raw.length > MAX_VALUE ? '' : raw.replace(/!\s*important\s*$/i, '').trim()
      if (name.length <= 64 && /^-?[a-z][a-z0-9-]*$/.test(name) && value !== '') out.set(name, value)
    }
    start = end + 1
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quote) { if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'") quote = c
    else if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (c === ';' && depth === 0) take(i)
  }
  take(text.length)
  return out
}
