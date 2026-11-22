/** URL protocol allow-list. */

// http, https, mailto, tel, fragment, absolute or relative path, or no scheme at all.
export const SAFE_URL = /^(?:https?:|mailto:|tel:|#|\/|\.{0,2}\/|[^:]*$)/i
const SAFE = SAFE_URL

/** Longer addresses are refused: no real link needs more, and every consumer then works on a bounded string. */
export const MAX_URL = 8192

/** The trimmed URL when its protocol is allowed, otherwise null. */
export function safeUrl(url: string): string | null {
  if (url.length > MAX_URL * 2) return null
  const trimmed = url.trim()
  if (trimmed.length > MAX_URL) return null
  return SAFE.test(trimmed) ? trimmed : null
}

/**
 * A `srcset` value whose every candidate is an allowed URL with a width
 * descriptor (`img.jpg 480w, big.jpg 960w`), normalised; null when any fails.
 */
export function safeSrcset(srcset: string): string | null {
  const parts = srcset.split(',').map((c) => c.trim()).filter((c) => c !== '')
  if (parts.length === 0 || parts.length > 20) return null
  const out: string[] = []
  for (const part of parts) {
    const m = /^(\S+)\s+([1-9]\d{0,4})w$/.exec(part)
    const url = m ? safeUrl(m[1]!) : null
    if (!m || url === null) return null
    out.push(`${url} ${m[2]!}w`)
  }
  return out.join(', ')
}
