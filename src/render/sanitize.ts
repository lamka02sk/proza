/**
 * The output allow-list as a sanitiser policy. HTML that
 * comes back from a browser is not trusted: a server re-renders it from the
 * JSON (`render`), or sanitises it with these rules, which are the ones `h()`
 * applies when the renderer builds the HTML.
 *
 * `sanitizeElement` is for JavaScript sanitisers (a DOMPurify hook, a walk
 * over a parsed tree). `sanitizerPolicy()` is the same rules as plain data,
 * for a server in another language (HTML Purifier, Bleach, Ammonia).
 */
import { embedProviders } from '../model/embeds'
import { isPlayerUrl } from '../model/embeds'
import { MAX_URL, SAFE_URL, safeSrcset, safeUrl } from '../model/url'
import { ALLOWED, ATTR_PATTERN, GLOBAL_ATTRS, INPUT_TYPES, URL_ATTRS } from './html'

/** The attributes every embed frame gets, whatever the input said. */
export const EMBED_FRAME: Readonly<Record<string, string>> = {
  sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox',
  allow: 'fullscreen; picture-in-picture; encrypted-media',
  referrerpolicy: 'strict-origin-when-cross-origin',
}

/**
 * The attributes of one element of untrusted HTML that may stay, with their values as they may
 * stay; null when the element itself must go (not on the list, an input that is not a checkbox,
 * a frame that is not an allowed provider's player). What happens to the children of a removed
 * element is the sanitiser's choice; keeping their text is the usual one.
 */
export function sanitizeElement(tag: string, attrs: Readonly<Record<string, string>>): Record<string, string> | null {
  const name = tag.toLowerCase()
  const allowed = ALLOWED.get(name)
  if (!allowed) return null
  const lower = new Map(Object.entries(attrs).map(([k, v]) => [k.toLowerCase(), v]))
  if (name === 'input' && !INPUT_TYPES.has((lower.get('type') ?? '').toLowerCase())) return null
  if (name === 'iframe' && !isPlayerUrl(lower.get('src') ?? '')) return null
  const out: Record<string, string> = {}
  for (const [attr, raw] of lower) {
    if (!allowed.has(attr) && !GLOBAL_ATTRS.has(attr) && !ATTR_PATTERN.test(attr)) continue
    let value: string | null = raw
    if (URL_ATTRS.has(attr)) value = safeUrl(raw)
    else if (attr === 'srcset') value = safeSrcset(raw)
    if (value !== null) out[attr] = value
  }
  if (name === 'iframe') Object.assign(out, EMBED_FRAME)
  if (name === 'a') {
    // Output only opens links in a new window: any other target (a named window) and rel="opener" hand the page to the link's site.
    if (out.target !== undefined) {
      if (out.target.toLowerCase() === '_blank') out.target = '_blank'
      else delete out.target
    }
    const rel = (out.rel ?? '').split(/\s+/).filter((r) => r !== '' && r.toLowerCase() !== 'opener')
    if (out.target === '_blank' && !rel.includes('noopener')) rel.push('noopener')
    if (rel.length > 0) out.rel = rel.join(' ')
    else delete out.rel
  }
  return out
}

/** The rules of `sanitizeElement` as data (JSON). Regular expressions are their source text, ECMAScript flavour. */
export interface SanitizerPolicy {
  /** Allowed elements with their own attributes. */
  readonly elements: Readonly<Record<string, readonly string[]>>
  /** Allowed on every element. */
  readonly globalAttributes: readonly string[]
  /** Attribute names also allowed on every element. */
  readonly attributePattern: string
  /** Attributes whose value must match `url.pattern` and be at most `url.maxLength` long (after trimming). */
  readonly urlAttributes: readonly string[]
  readonly url: { readonly pattern: string; readonly flags: string; readonly maxLength: number }
  /** `srcset`: at most 20 comma-separated `url <n>w` candidates, each url as above. */
  readonly srcset: { readonly maxCandidates: number; readonly candidate: string }
  /** An `input` of another type is removed. */
  readonly inputTypes: readonly string[]
  /** An `iframe` whose `src` matches none of these is removed; one that stays gets `attributes`. */
  readonly iframe: { readonly src: readonly string[]; readonly attributes: Readonly<Record<string, string>> }
  /** `a` with `target="_blank"` gets this in `rel`. `rel` never keeps `opener`. */
  readonly newWindowRel: string
  /** The only `target` an `a` keeps (compared in lower case); any other is removed. */
  readonly linkTarget: string
}

export function sanitizerPolicy(): SanitizerPolicy {
  return {
    elements: Object.fromEntries([...ALLOWED].map(([tag, attrs]) => [tag, [...attrs]])),
    globalAttributes: [...GLOBAL_ATTRS],
    attributePattern: ATTR_PATTERN.source,
    urlAttributes: [...URL_ATTRS],
    url: { pattern: SAFE_URL.source, flags: SAFE_URL.flags, maxLength: MAX_URL },
    srcset: { maxCandidates: 20, candidate: '^(\\S+)\\s+([1-9]\\d{0,4})w$' },
    inputTypes: [...INPUT_TYPES],
    iframe: { src: embedProviders().map((p) => p.src.source), attributes: EMBED_FRAME },
    newWindowRel: 'noopener',
    linkTarget: '_blank',
  }
}
