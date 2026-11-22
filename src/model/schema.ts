/**
 * Block schemas, document validation and migrations.
 *
 * `validateDoc` is the trust boundary for loaded JSON: it
 * never throws on bad content, repairs what it can, and keeps what it cannot
 * understand as an "unsupported" placeholder that preserves the original JSON.
 */
import {
  type FormatRange, type FormatRegistry, type RichTextValue, FORMAT_TYPE, LANG_PATTERN, MAX_UNKNOWN_TYPES, checkFormatAttrs, defaultFormats,
  dropOrphanObjects, formatTypeGate, normalize,
} from './richtext'
import { type Attrs, type Block, ID_PATTERN, createId } from './tree'
import { safeSrcset, safeUrl } from './url'

// ---------------------------------------------------------------------------
// Attribute specs

export type AttrSpec =
  | { readonly type: 'string'; readonly default?: string; readonly pattern?: RegExp; readonly maxLength?: number }
  | { readonly type: 'number'; readonly default?: number; readonly min?: number; readonly max?: number; readonly integer?: boolean }
  | { readonly type: 'boolean'; readonly default?: boolean }
  | { readonly type: 'enum'; readonly values: readonly (string | number)[]; readonly default?: string | number }
  /** Passes the protocol allow-list. Empty means none. */
  | { readonly type: 'url'; readonly default?: string }
  /** `formats` lists the allowed format types; omitted allows all. */
  | { readonly type: 'richtext'; readonly formats?: readonly string[] }
  /** Image candidates (`url 480w, url 960w`), every URL through the allow-list. Empty means none. */
  | { readonly type: 'srcset' }

/** The value type an attribute has after validation. Every attribute always has a value. */
export type AttrValue<S extends AttrSpec> =
  S extends { type: 'string' | 'url' | 'srcset' } ? string
    : S extends { type: 'number' } ? number
      : S extends { type: 'boolean' } ? boolean
        : S extends { type: 'enum'; values: readonly (infer V)[] } ? V
          : S extends { type: 'richtext' } ? RichTextValue
            : never

export type AttrSpecs = Readonly<Record<string, AttrSpec>>
export type AttrsOf<A extends AttrSpecs> = { readonly [K in keyof A]: AttrValue<A[K]> }

/** Shared features a block switches on. Each adds attributes. */
export interface Supports {
  /** `anchor`: an HTML id. */
  readonly anchor?: boolean
  /** `textAlign`: start, center or end (logical, so right-to-left works). */
  readonly textAlign?: boolean
  /** `lang` (BCP 47) and `dir` for content in another language (WCAG 3.1.2). */
  readonly language?: boolean
  /** `align`: a narrower part (a picture) sits at the start, centre or end of the column. */
  readonly align?: boolean
  /** `size`: small or large text, a named step of the type scale (presets instead of values). */
  readonly size?: boolean
  /** `color`: a text colour from the host palette, rendered as the class `pz-color-<name>`. */
  readonly color?: boolean
  /**
   * `bleed`: a top-level part wider than the text column (`wide`) or as wide as
   * the page (`full`), when the host's content.css tokens give the column a measure.
   */
  readonly bleed?: boolean
}

export interface BlockSchema {
  readonly name: string
  readonly attrs: AttrSpecs
  /**
   * false (or omitted) for a leaf. `allowed` limits child types; omitted allows any. `max`: children
   * past it load as placeholders (kept, not shown), so one stored block cannot grow without limit.
   */
  readonly children?: false | { readonly allowed?: readonly string[]; readonly max?: number }
  /** Parent types this block may live in; omitted allows any, including the root. */
  readonly parent?: readonly string[]
  readonly supports?: Supports
  /** Version of the attribute shape. Starts at 1; bump it with a migration. */
  readonly version?: number
  /** Turns attributes stored at `fromVersion` into the current shape. Plain JSON in, plain JSON out. */
  migrate?(attrs: Readonly<Record<string, unknown>>, fromVersion: number): Record<string, unknown>
}

export type SchemaRegistry = ReadonlyMap<string, BlockSchema>

/** Registry by name. Throws on a repeated name. Keeps the element type, so renderable blocks stay renderable. */
export function blockRegistry<T extends BlockSchema>(schemas: readonly T[]): ReadonlyMap<string, T> {
  const map = new Map<string, T>()
  for (const s of schemas) {
    if (map.has(s.name)) throw new Error(`Block type ${s.name} is registered twice`)
    if (s.name === UNSUPPORTED) throw new Error(`${UNSUPPORTED} is built in`)
    map.set(s.name, s)
  }
  return map
}

const SUPPORT_ATTRS = {
  anchor: { anchor: { type: 'string', pattern: /^[A-Za-z][\w-]*$/, maxLength: 100 } },
  // Justified text is offered only when the host switches it on; it always loads.
  textAlign: { textAlign: { type: 'enum', values: ['', 'start', 'center', 'end', 'justify'] } },
  language: {
    lang: { type: 'string', pattern: LANG_PATTERN, maxLength: 35 },
    dir: { type: 'enum', values: ['', 'ltr', 'rtl'] },
  },
  align: { align: { type: 'enum', values: ['', 'start', 'center', 'end'] } },
  size: { size: { type: 'enum', values: ['', 's', 'l'] } },
  color: { color: { type: 'string', pattern: /^[a-z][a-z0-9-]{0,39}$/, maxLength: 40 } },
  bleed: { bleed: { type: 'enum', values: ['', 'wide', 'full'] } },
} as const satisfies Record<keyof Supports, AttrSpecs>

/**
 * Attributes every block type has, stored only when set, so
 * documents without them stay byte for byte as they were:
 * - `lock`: `move` keeps the part in place (no moving, no removing); `all` also keeps
 *   its content and everything inside from changing (TinyMCE `noneditable`).
 * - `variant`: a style the host defines for the type (TinyMCE `importcss`), the class `pz-style-<name>`.
 */
export const COMMON_ATTRS = {
  lock: { type: 'enum', values: ['', 'move', 'all'] },
  variant: { type: 'string', pattern: /^[a-z][a-z0-9-]{0,39}$/, maxLength: 40 },
} as const satisfies AttrSpecs

/** Every attribute of a block type: the common ones, its own, and those its supports add. */
export function attrSpecs(schema: BlockSchema): AttrSpecs {
  let specs: AttrSpecs = { ...COMMON_ATTRS, ...schema.attrs }
  for (const key of Object.keys(SUPPORT_ATTRS) as (keyof Supports)[]) {
    if (schema.supports?.[key]) specs = { ...specs, ...SUPPORT_ATTRS[key] }
  }
  return specs
}

export function defaultValue(spec: AttrSpec): unknown {
  switch (spec.type) {
    case 'string': case 'url': return spec.default ?? ''
    case 'srcset': return ''
    case 'number': return spec.default ?? spec.min ?? 0
    case 'boolean': return spec.default ?? false
    case 'enum': return spec.default ?? spec.values[0]
    case 'richtext': return EMPTY_RICHTEXT
  }
}

const EMPTY_RICHTEXT: RichTextValue = Object.freeze({ text: '', formats: Object.freeze([]) })

/** Default attributes, for creating a block. */
export function defaultAttrs(schema: BlockSchema): Attrs {
  return Object.fromEntries(Object.entries(attrSpecs(schema)).map(([k, s]) => [k, defaultValue(s)]))
}

// ---------------------------------------------------------------------------
// Documents

/** Version of the document envelope; block attributes are versioned per type. */
export const DOC_VERSION = 1

export interface Doc {
  /** Version of the envelope. Block attributes carry their own version (StoredBlock). */
  readonly version: number
  readonly blocks: readonly Block[]
}

/** A block as stored: `version` is the attribute version of its type, omitted at 1. */
export interface StoredBlock extends Block {
  readonly version?: number
  readonly children?: readonly StoredBlock[]
}

export interface StoredDoc extends Doc {
  readonly blocks: readonly StoredBlock[]
}

/** Placeholder for a block that cannot be loaded. The original JSON travels untouched. */
export const UNSUPPORTED = 'core/unsupported'

export interface UnsupportedAttrs {
  /** The block exactly as stored. */
  readonly original: unknown
  /** Why it could not be loaded, for the placeholder and the console. */
  readonly reason: string
}

export interface ValidationIssue {
  /** JSON path, for example `blocks[2].children[0].attrs.level`. */
  readonly path: string
  readonly message: string
}

export interface ValidateOptions {
  readonly formats?: FormatRegistry
  readonly createId?: () => string
}

export interface Validated {
  readonly doc: Doc
  readonly issues: readonly ValidationIssue[]
}

export class DocumentVersionError extends Error {
  override name = 'DocumentVersionError'
}

/**
 * Check and repair a document from an untrusted source: migrate old block
 * attributes, replace invalid values with defaults, give blocks with missing or
 * repeated ids new ones, and wrap unloadable blocks as placeholders.
 *
 * The input is stored JSON (see serializeDoc). The result is valid and fully
 * defaulted: saving it and loading it again gives the same document, with only
 * the placeholders reported again. Throws DocumentVersionError only for an
 * envelope newer than this code, which must not be loaded and saved back.
 */
export function validateDoc(input: unknown, registry: SchemaRegistry, options: ValidateOptions = {}): Validated {
  const issues: ValidationIssue[] = []
  const ctx: Ctx = {
    registry, issues, ids: new Set(),
    formats: options.formats ?? defaultFormats,
    createId: options.createId ?? createId,
  }
  if (!isObject(input)) {
    issues.push({ path: '', message: 'Document is not an object' })
    return { doc: { version: DOC_VERSION, blocks: [] }, issues }
  }
  if (input.version === undefined) issues.push({ path: 'version', message: `Missing version, assumed ${DOC_VERSION}` })
  else if (typeof input.version !== 'number' || !Number.isInteger(input.version) || input.version < 1) {
    issues.push({ path: 'version', message: `Invalid version, assumed ${DOC_VERSION}` })
  } else if (input.version > DOC_VERSION) {
    throw new DocumentVersionError(`Document version ${input.version} is newer than supported version ${DOC_VERSION}`)
  }
  if (!Array.isArray(input.blocks)) {
    issues.push({ path: 'blocks', message: 'Missing block list' })
    return { doc: { version: DOC_VERSION, blocks: [] }, issues }
  }
  const blocks = validateList(ctx, input.blocks, null, 'blocks', 0)
  return { doc: { version: DOC_VERSION, blocks }, issues }
}

/** The JSON to store: placeholders give back their original blocks; blocks of a versioned type record the version. */
export function serializeDoc(doc: Doc, registry: SchemaRegistry): StoredDoc {
  const out = (blocks: readonly Block[]): StoredBlock[] => blocks.map((b) => {
    if (b.type === UNSUPPORTED) return (b.attrs as unknown as UnsupportedAttrs).original as StoredBlock
    const version = registry.get(b.type)?.version ?? 1
    const attrs = b.attrs.lock === '' || b.attrs.variant === '' ? sparse(b.attrs) : b.attrs
    const stored: StoredBlock = version === 1 ? { id: b.id, type: b.type, attrs } : { id: b.id, type: b.type, version, attrs }
    return b.children ? { ...stored, children: out(b.children) } : stored
  })
  return { version: DOC_VERSION, blocks: out(doc.blocks) }
}

/** Attributes without the common ones that are not set. */
function sparse(attrs: Attrs): Attrs {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(attrs)) if (!(k in COMMON_ATTRS && v === '')) out[k] = v
  return out
}

// ---------------------------------------------------------------------------

interface Ctx {
  readonly registry: SchemaRegistry
  readonly formats: FormatRegistry
  readonly issues: ValidationIssue[]
  readonly ids: Set<string>
  readonly createId: () => string
}

/**
 * Deeper nesting than any layout needs loads as a placeholder: validation, rendering and the
 * editor recurse per level, and a stored document must not be able to exhaust the stack.
 */
export const MAX_DEPTH = 128

/** Formats one rich-text value keeps. */
export const MAX_FORMATS = 10_000

function validateList(ctx: Ctx, list: readonly unknown[], parent: BlockSchema | null, path: string, depth: number): Block[] {
  const max = parent?.children ? parent.children.max : undefined
  return list.map((raw, i) => (max !== undefined && i >= max
    ? placeholder(ctx, raw, `${path}[${i}]`, `More than ${max} parts inside ${parent!.name}`)
    : validateBlock(ctx, raw, parent, `${path}[${i}]`, depth)))
}

function validateBlock(ctx: Ctx, raw: unknown, parent: BlockSchema | null, path: string, depth: number): Block {
  if (!isObject(raw)) return placeholder(ctx, raw, path, 'Not a block object')
  if (depth > MAX_DEPTH) return placeholder(ctx, raw, path, `Nested more than ${MAX_DEPTH} levels deep`)
  const type = raw.type
  if (typeof type !== 'string') return placeholder(ctx, raw, path, 'Missing block type')
  // A stored placeholder (saved without serializeDoc): load what it wraps, which may be supported by now.
  if (type === UNSUPPORTED) {
    return isObject(raw.attrs) && 'original' in raw.attrs
      ? validateBlock(ctx, raw.attrs.original, parent, path, depth + 1)
      : placeholder(ctx, raw, path, 'Placeholder without its original block')
  }
  const schema = ctx.registry.get(type)
  if (!schema) return placeholder(ctx, raw, path, `Unknown block type ${type}`)

  const current = schema.version ?? 1
  const validVersion = typeof raw.version === 'number' && Number.isInteger(raw.version) && raw.version >= 1
  const stored = validVersion ? raw.version as number : 1
  if (stored > current) return placeholder(ctx, raw, path, `${type} version ${stored} is newer than supported version ${current}`)
  if (parent?.children && parent.children.allowed && !parent.children.allowed.includes(type)) {
    return placeholder(ctx, raw, path, `${type} is not allowed inside ${parent.name}`)
  }
  if (schema.parent && (parent === null || !schema.parent.includes(parent.name))) {
    return placeholder(ctx, raw, path, `${type} must be inside ${schema.parent.join(' or ')}`)
  }
  const container = schema.children !== undefined && schema.children !== false
  if (!container && raw.children !== undefined && !(Array.isArray(raw.children) && raw.children.length === 0)) {
    return placeholder(ctx, raw, path, `${type} cannot have children`)
  }
  if (container && raw.children !== undefined && !Array.isArray(raw.children)) {
    return placeholder(ctx, raw, path, 'Children are not a list')
  }

  let attrsIn: Readonly<Record<string, unknown>> = isObject(raw.attrs) ? raw.attrs : {}
  if (stored < current) {
    if (!schema.migrate) return placeholder(ctx, raw, path, `${type} has no migration from version ${stored}`)
    let migrated: unknown
    try {
      migrated = schema.migrate(attrsIn, stored)
    } catch (e) {
      return placeholder(ctx, raw, path, `Migration of ${type} from version ${stored} failed: ${String(e)}`)
    }
    if (!isObject(migrated)) return placeholder(ctx, raw, path, `Migration of ${type} from version ${stored} returned no attributes`)
    attrsIn = migrated
  }
  // From here on the block loads, so its smaller problems are worth reporting.
  if (raw.version !== undefined && !validVersion) ctx.issues.push({ path: `${path}.version`, message: 'Invalid version, assumed 1' })
  if (raw.attrs !== undefined && !isObject(raw.attrs)) ctx.issues.push({ path: `${path}.attrs`, message: 'Not an object, defaults used' })

  const id = blockId(ctx, raw.id, path)
  const attrs = validateAttrs(ctx, schema, attrsIn, `${path}.attrs`)
  if (!container) return { id, type, attrs }
  const children = Array.isArray(raw.children) ? validateList(ctx, raw.children, schema, `${path}.children`, depth + 1) : []
  return { id, type, attrs, children }
}

/** `raw` if usable, otherwise a new id. `report` is off for placeholders, whose stored id stays in the original. */
function blockId(ctx: Ctx, raw: unknown, path: string, report = true): string {
  let id = typeof raw === 'string' && ID_PATTERN.test(raw) && !ctx.ids.has(raw) ? raw : null
  if (id === null) {
    if (report) ctx.issues.push({ path: `${path}.id`, message: raw === undefined ? 'Missing id, new one given' : 'Invalid or repeated id, new one given' })
    do id = ctx.createId(); while (ctx.ids.has(id))
  }
  ctx.ids.add(id)
  return id
}

function placeholder(ctx: Ctx, raw: unknown, path: string, reason: string): Block {
  ctx.issues.push({ path, message: `${reason}; kept as an unsupported block` })
  const id = blockId(ctx, isObject(raw) ? raw.id : undefined, path, false)
  const attrs: UnsupportedAttrs = { original: raw, reason }
  return { id, type: UNSUPPORTED, attrs: attrs as unknown as Attrs }
}

function validateAttrs(ctx: Ctx, schema: BlockSchema, input: Readonly<Record<string, unknown>>, path: string): Attrs {
  const specs = attrSpecs(schema)
  const out: Record<string, unknown> = {}
  for (const [name, spec] of Object.entries(specs)) {
    const raw = input[name]
    if (raw === undefined) { out[name] = defaultValue(spec); continue }
    const value = validateValue(ctx, spec, raw, `${path}.${name}`)
    if (value === INVALID) {
      ctx.issues.push({ path: `${path}.${name}`, message: `Invalid ${spec.type}, default used` })
      out[name] = defaultValue(spec)
    } else out[name] = value
  }
  for (const name of Object.keys(input)) {
    if (!(name in specs)) ctx.issues.push({ path: `${path}.${name}`, message: `Unknown attribute of ${schema.name}, dropped` })
  }
  return out
}

const INVALID = Symbol('invalid')

function validateValue(ctx: Ctx, spec: AttrSpec, raw: unknown, path: string): unknown {
  switch (spec.type) {
    case 'string':
      if (typeof raw !== 'string') return INVALID
      if (spec.maxLength !== undefined && raw.length > spec.maxLength) return INVALID
      if (spec.pattern && raw !== '' && !spec.pattern.test(raw)) return INVALID
      return raw
    case 'number':
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return INVALID
      if (spec.integer && !Number.isInteger(raw)) return INVALID
      if ((spec.min !== undefined && raw < spec.min) || (spec.max !== undefined && raw > spec.max)) return INVALID
      return raw
    case 'boolean':
      return typeof raw === 'boolean' ? raw : INVALID
    case 'enum':
      return (typeof raw === 'string' || typeof raw === 'number') && spec.values.includes(raw) ? raw : INVALID
    case 'url':
      if (typeof raw !== 'string') return INVALID
      return raw.trim() === '' ? '' : safeUrl(raw) ?? INVALID
    case 'richtext':
      return validateRichText(ctx, spec, raw, path)
    case 'srcset':
      if (typeof raw !== 'string') return INVALID
      return raw.trim() === '' ? '' : safeSrcset(raw) ?? INVALID
  }
}

// C0 controls other than tab and line feed, DEL and the C1 range: nothing a text field can show.
// eslint-disable-next-line no-control-regex
const CONTROL = /^[\u0000-\u0008\u000B-\u001F\u007F-\u009F]$/

/**
 * CR LF and lone CR become "\n"; other control characters are removed.
 * `map[i]` is the clean offset of stored offset i, so stored ranges stay on their text.
 */
function cleanText(stored: string): { text: string; map: number[]; removed: boolean } {
  let text = ''
  let removed = false
  const map: number[] = []
  for (let i = 0; i < stored.length; i++) {
    map.push(text.length)
    const c = stored[i]!
    if (c === '\r') { if (stored[i + 1] !== '\n') text += '\n'; continue }
    if (CONTROL.test(c)) { removed = true; continue }
    text += c
  }
  map.push(text.length)
  return { text, map, removed }
}

function validateRichText(ctx: Ctx, spec: Extract<AttrSpec, { type: 'richtext' }>, raw: unknown, path: string): RichTextValue | typeof INVALID {
  if (!isObject(raw) || typeof raw.text !== 'string') return INVALID
  const { text, map, removed } = cleanText(raw.text)
  if (removed) ctx.issues.push({ path: `${path}.text`, message: 'Control characters removed' })
  if (raw.formats !== undefined && !Array.isArray(raw.formats)) ctx.issues.push({ path: `${path}.formats`, message: 'Not a list, dropped' })
  const all: readonly unknown[] = Array.isArray(raw.formats) ? raw.formats : []
  // As many as the clipboard takes; no real paragraph comes near it.
  const list = all.length > MAX_FORMATS ? all.slice(0, MAX_FORMATS) : all
  if (list !== all) ctx.issues.push({ path: `${path}.formats`, message: `More than ${MAX_FORMATS} formats, the rest dropped` })
  const at = (offset: number): number => map[Math.max(0, Math.min(map.length - 1, offset))]!
  const formats: FormatRange[] = []
  const admit = formatTypeGate(ctx.formats)
  list.forEach((f, i) => {
    const range = validateFormat(ctx, spec, f, `${path}.formats[${i}]`, raw.text as string, admit)
    if (range) formats.push({ ...range, start: at(range.start), end: at(range.end) })
  })
  const value = normalize({ text, formats }, ctx.formats)
  const clean = dropOrphanObjects(value, ctx.formats)
  if (clean.text.length !== value.text.length) ctx.issues.push({ path: `${path}.text`, message: 'Object characters without an object removed' })
  return clean
}

function validateFormat(ctx: Ctx, spec: Extract<AttrSpec, { type: 'richtext' }>, raw: unknown, path: string, text: string, admit: (type: string) => boolean): FormatRange | null {
  const drop = (message: string): null => { ctx.issues.push({ path, message: `${message}, dropped` }); return null }
  if (!isObject(raw) || typeof raw.type !== 'string' || !FORMAT_TYPE.test(raw.type)) return drop('Invalid format')
  const { start, end } = raw
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end)) return drop('Invalid format range')
  if (start < 0 || end > text.length || start >= end) return drop('Empty or out-of-range format')
  if (spec.formats && !spec.formats.includes(raw.type)) return drop(`Format ${raw.type} not allowed here`)
  if (raw.attrs !== undefined && (!isObject(raw.attrs) || !Object.values(raw.attrs).every((v) => typeof v === 'string'))) {
    return drop('Invalid format attributes')
  }
  // Only the attributes the format renders, each through its rule: URLs on the allow-list, presets as slugs.
  const attrs = checkFormatAttrs(raw.type, raw.attrs, ctx.formats)
  if (attrs === null) {
    return drop(ctx.formats.has(raw.type) ? `Format ${raw.type} without a valid required attribute` : `Unknown format ${raw.type} with too many or too long attributes`)
  }
  if (!admit(raw.type)) return drop(`More than ${MAX_UNKNOWN_TYPES} unknown format types`)
  const range = { type: raw.type, start, end }
  return Object.keys(attrs).length > 0 ? { ...range, attrs } : range
}

function isObject(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
