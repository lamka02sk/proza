/**
 * Legacy HTML (decision 0020): what a host keeps of HTML written by older
 * editors that Proza's own model has no place for: inline styles, the host's
 * classes, frames from sites the host names. Off unless the host passes a
 * policy; the policy is plain data, so a server sanitiser can read the same
 * one. Pure: no DOM.
 */
import { parseStyle } from './css'
import { safeUrl } from './url'

/** A site whose frames stay frames (a map, a form, a calendar). */
export interface LegacyFrame {
  /** `maps.example.com`, or `*.example.com` for every subdomain of it. */
  readonly host: string
  /** The frame's `sandbox`; `false` for none, for a frame that needs the whole browser. Default `FRAME_SANDBOX`. */
  readonly sandbox?: string | false
}

export interface LegacyPolicy {
  /**
   * CSS properties `style` keeps on parts and on text. An entry ending in `*` matches
   * every property it starts (`border*`). Default `LEGACY_STYLES`.
   */
  readonly styles?: readonly string[]
  /**
   * Classes kept on parts and on text: exact names, or prefixes ending in `*`; `*` alone keeps
   * every class. Default `['*']`. Proza's own classes (`pz-*`) and editors' internal ones
   * (`mce-*`, `Mso*`, `Apple-*`) are never kept as the host's.
   */
  readonly classes?: readonly string[]
  /** Sites whose frames stay frames, besides the embed providers' players. Only `https:` addresses. */
  readonly frames?: readonly (string | LegacyFrame)[]
  /**
   * The palette as values: a text colour or highlight chosen from it in the editor renders as
   * `style="color: …"` instead of the class `pz-color-<name>`, so the page needs no stylesheet for it.
   */
  readonly palette?: readonly { readonly name: string; readonly color: string }[]
}

/** CSS properties kept by default: how text and boxes look, nothing that takes an element out of the flow (`position`). */
export const LEGACY_STYLES: readonly string[] = [
  'color', 'background', 'background-color', 'font', 'font-size', 'font-family', 'font-weight', 'font-style', 'font-variant',
  'text-align', 'text-decoration', 'text-transform', 'text-indent', 'line-height', 'letter-spacing', 'word-spacing', 'white-space',
  'vertical-align', 'margin*', 'padding*', 'border*', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'float', 'clear', 'display', 'list-style-type', 'direction',
]

/** Properties Proza itself writes in legacy output for what its own controls set (alignment, size, a palette colour): always published. */
export const PROZA_STYLES: readonly string[] = ['text-align', 'margin-inline', 'margin-inline-start', 'font-size', 'line-height', 'color', 'background-color']

/** The sandbox of a listed site's frame unless the host says otherwise: scripts and forms work, the page stays out of reach. */
export const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation'

/** Classes that belong to an editor, not to the host's design. */
const FOREIGN_CLASS = /^(?:pz-|mce-|Mso|Apple-)/

/** One class name: no space, quote, angle bracket, backtick, backslash or equals sign. */
export const CLASS_TOKEN = /^[^\s"'<>`\\=]+$/
/** A class list: tokens separated by single spaces. Linear: a token cannot contain the separator. */
export const CLASS_LIST = /^[^\s"'<>`\\=]+(?: [^\s"'<>`\\=]+)*$/

/** Characters and constructs a kept declaration may not contain: no way out of the attribute, no loading, no old script hooks. */
// eslint-disable-next-line no-control-regex -- control characters have no place in a declaration
export const UNSAFE_CHARS = /[<>\\{}@;\u0000-\u001f\u007f]/
export const UNSAFE_WORDS = /(?:url|image|image-set|cross-fade|element|expression|paint)\s*\(|javascript:|vbscript:|-moz-binding|behavior|\/\*/i

/**
 * The pattern stored `style` must match (validation): what `cleanStyle` could have produced.
 * Each position looks ahead a bounded distance, so it stays linear on long input.
 */
// eslint-disable-next-line no-control-regex -- control characters have no place in a declaration
export const STYLE_PATTERN = /^(?:(?!(?:url|image|image-set|cross-fade|element|expression|paint)\s{0,8}\(|javascript:|vbscript:|-moz-binding|behavior|\/\*)[^<>\\{}@\u0000-\u001f\u007f])*$/i

export function safeStyleValue(value: string): boolean {
  return value.length <= 500 && !UNSAFE_CHARS.test(value) && !UNSAFE_WORDS.test(value)
}

/**
 * The declarations of `text` that `allow` admits and whose values are safe, written
 * as `prop: value; prop: value` in source order; '' when none are left.
 */
export function cleanStyle(text: string | null | undefined, allow: (prop: string) => boolean = () => true): string {
  if (!text) return ''
  const out: string[] = []
  for (const [prop, value] of parseStyle(text)) if (allow(prop) && safeStyleValue(value)) out.push(`${prop}: ${value}`)
  return out.join('; ')
}

/** `style` text from declarations in order. */
export function joinStyle(decls: Iterable<readonly [string, string]>): string {
  return [...decls].map(([k, v]) => `${k}: ${v}`).join('; ')
}

/** The policy compiled for matching. */
export interface LegacyRules {
  readonly policy: LegacyPolicy
  /** A CSS property is kept from the source. */
  readonly style: (prop: string) => boolean
  /** A CSS property may be published: kept ones and the ones Proza writes itself. */
  readonly published: (prop: string) => boolean
  /** A class is kept as the host's. */
  readonly className: (name: string) => boolean
  /** The sandbox of a frame from `src`: its value, null for none, undefined when the site is not listed. */
  readonly frame: (src: string) => string | null | undefined
  /** The palette colour of a preset name. */
  readonly color: (name: string) => string | undefined
}

function matcher(list: readonly string[]): (name: string) => boolean {
  if (list.includes('*')) return () => true
  const exact = new Set(list.filter((s) => !s.endsWith('*')))
  const prefixes = list.filter((s) => s.endsWith('*')).map((s) => s.slice(0, -1))
  return (name) => exact.has(name) || prefixes.some((p) => name.startsWith(p))
}

const HOST = /^https:\/\/([a-z0-9.-]{1,253})(?::\d{1,5})?(?:[/?#]|$)/i

/** The host of an `https:` address, lowercased; null for any other. */
export function httpsHost(src: string): string | null {
  const safe = safeUrl(src)
  return safe === null ? null : HOST.exec(safe)?.[1]?.toLowerCase() ?? null
}

const compiled = new WeakMap<LegacyPolicy, LegacyRules>()
const DEFAULT_POLICY: LegacyPolicy = {}

/** The rules of a policy (`true` is the default policy), compiled once per policy object. */
export function legacyRules(policy: LegacyPolicy | true): LegacyRules {
  const p = policy === true ? DEFAULT_POLICY : policy
  let rules = compiled.get(p)
  if (rules) return rules
  const style = matcher(p.styles ?? LEGACY_STYLES)
  const cls = matcher(p.classes ?? ['*'])
  const frames = (p.frames ?? []).map((f) => (typeof f === 'string' ? { host: f } : f))
    .map((f) => ({ host: f.host.toLowerCase(), sandbox: f.sandbox === false ? null : f.sandbox ?? FRAME_SANDBOX }))
  const colors = new Map((p.palette ?? []).map((c) => [c.name, c.color]))
  rules = {
    policy: p,
    style: (prop) => style(prop.toLowerCase()),
    published: (prop) => style(prop.toLowerCase()) || PROZA_STYLES.includes(prop.toLowerCase()),
    className: (name) => !FOREIGN_CLASS.test(name) && cls(name),
    frame: (src) => {
      const host = httpsHost(src)
      if (host === null) return undefined
      const found = frames.find((f) => (f.host.startsWith('*.') ? host.endsWith(f.host.slice(1)) : host === f.host))
      return found ? found.sandbox : undefined
    },
    color: (name) => {
      const c = colors.get(name)
      return c !== undefined && safeStyleValue(c) ? c : undefined
    },
  }
  compiled.set(p, rules)
  return rules
}

/** The classes of `list` (space separated) that `keep` admits, as a class attribute value. */
export function keepClasses(list: string | null | undefined, keep: (name: string) => boolean): string {
  if (!list) return ''
  return list.split(/\s+/).filter((c) => c !== '' && CLASS_TOKEN.test(c) && keep(c)).join(' ')
}
