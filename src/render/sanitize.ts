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
import { embedFor, embedProviders } from '../model/embeds'
import { isPlayerUrl } from '../model/embeds'
import { CLASS_TOKEN, FRAME_SANDBOX, LEGACY_STYLES, type LegacyPolicy, PROZA_STYLES, UNSAFE_CHARS, UNSAFE_WORDS, cleanStyle, keepClasses, legacyRules } from '../model/legacy'
import { MAX_URL, SAFE_URL, safeSrcset, safeUrl } from '../model/url'
import { ALLOWED, ATTR_PATTERN, GLOBAL_ATTRS, INPUT_TYPES, LEGACY_ATTRS, LEGACY_ELEMENTS, URL_ATTRS } from './html'

/** A frame legacy HTML keeps: its sandbox from the policy, or the embed sandbox for an address a provider knows. */
function legacyListed(listed: string | null | undefined, src: string): string | null | undefined {
  if (listed !== undefined) return listed
  return embedFor(src) !== null && /^https:/i.test(src.trim()) ? EMBED_FRAME.sandbox! : undefined
}

export interface SanitizeOptions {
  /** The host keeps legacy HTML (decision 0020): its styles, classes and frames are allowed as its policy says. */
  readonly legacy?: LegacyPolicy | true
}

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
export function sanitizeElement(tag: string, attrs: Readonly<Record<string, string>>, options: SanitizeOptions = {}): Record<string, string> | null {
  const name = tag.toLowerCase()
  const rules = options.legacy ? legacyRules(options.legacy) : null
  const allowed = ALLOWED.get(name) ?? (rules ? LEGACY_ELEMENTS.get(name) : undefined)
  if (!allowed) return null
  const lower = new Map(Object.entries(attrs).map(([k, v]) => [k.toLowerCase(), v]))
  if (name === 'input' && !INPUT_TYPES.has((lower.get('type') ?? '').toLowerCase())) return null
  const src = lower.get('src') ?? ''
  const listed = name === 'iframe' && rules && !isPlayerUrl(src) ? legacyListed(rules.frame(src), src) : undefined
  if (name === 'iframe' && !isPlayerUrl(src) && listed === undefined) return null
  const out: Record<string, string> = {}
  for (const [attr, raw] of lower) {
    const extra = rules !== null && (attr === 'style' || LEGACY_ATTRS.get(name)?.has(attr) === true)
    if (!allowed.has(attr) && !GLOBAL_ATTRS.has(attr) && !ATTR_PATTERN.test(attr) && !extra) continue
    let value: string | null = raw
    if (URL_ATTRS.has(attr)) value = safeUrl(raw)
    else if (attr === 'srcset') value = safeSrcset(raw)
    else if (attr === 'style' && rules) value = cleanStyle(raw, rules.published) || null
    // Proza's own classes stay (the page's markup); the host's only as its policy says.
    else if (attr === 'class' && rules) value = keepClasses(raw, (c) => c.startsWith('pz-') || rules.className(c)) || null
    if (value !== null) out[attr] = value
  }
  if (name === 'iframe' && listed !== undefined) {
    if (listed === null) delete out.sandbox
    else out.sandbox = listed
  } else if (name === 'iframe') Object.assign(out, EMBED_FRAME)
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
  /** Only for a host that keeps legacy HTML (`sanitizerPolicy({ legacy })`). */
  readonly legacy?: LegacySanitizerPolicy
}

/** What legacy HTML adds to the policy (decision 0020). */
export interface LegacySanitizerPolicy {
  /** More elements, with their own attributes. */
  readonly elements: Readonly<Record<string, readonly string[]>>
  /** More attributes of elements already allowed. */
  readonly attributes: Readonly<Record<string, readonly string[]>>
  /**
   * `style` is allowed on every element. A declaration stays when its property matches
   * `properties` (an entry ending in `*` is a prefix) and its value matches neither `forbiddenValue`
   * (case-insensitive) nor `forbiddenCharacters` (a character class); at most 500 characters.
   */
  readonly style: { readonly properties: readonly string[]; readonly forbiddenValue: string; readonly forbiddenCharacters: string }
  /** Class tokens that stay besides `pz-*` (an entry ending in `*` is a prefix); `class` tokens must match `classToken`. */
  readonly classes: readonly string[]
  readonly classToken: string
  /** Frames from these hosts stay (`*.` matches subdomains), with this `sandbox`; null means none. */
  readonly frames: readonly { readonly host: string; readonly sandbox: string | null }[]
}

export function sanitizerPolicy(options: SanitizeOptions = {}): SanitizerPolicy {
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
    ...(options.legacy ? { legacy: legacyPolicy(options.legacy) } : {}),
  }
}

function legacyPolicy(policy: LegacyPolicy | true): LegacySanitizerPolicy {
  const p = policy === true ? {} : policy
  return {
    elements: Object.fromEntries([...LEGACY_ELEMENTS].map(([tag, attrs]) => [tag, [...attrs]])),
    attributes: Object.fromEntries([...LEGACY_ATTRS].map(([tag, attrs]) => [tag, [...attrs]])),
    style: {
      properties: [...new Set([...(p.styles ?? LEGACY_STYLES), ...PROZA_STYLES])],
      forbiddenValue: UNSAFE_WORDS.source,
      forbiddenCharacters: UNSAFE_CHARS.source,
    },
    classes: (p.classes ?? ['*']).filter((c) => !/^(?:pz-|mce-|Mso|Apple-)/.test(c)),
    classToken: CLASS_TOKEN.source,
    frames: (p.frames ?? []).map((f) => (typeof f === 'string' ? { host: f, sandbox: FRAME_SANDBOX } : { host: f.host, sandbox: f.sandbox === false ? null : f.sandbox ?? FRAME_SANDBOX })),
  }
}
