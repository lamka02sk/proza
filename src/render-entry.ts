/**
 * `@lamka02sk/proza/render`: validate and render
 * stored JSON with no browser, in Node, a worker or a build step, and the
 * sanitiser policy for HTML that comes back from a browser.
 * Imports no Vue and touches no browser global.
 */
export { RENDER_LABELS, render, renderBlocks, renderLabels, slug, type RenderLabels, type RenderOptions, type RenderableBlock, type RenderContext, type RenderRegistry, type Share } from './render/render'
export { type Html, type HtmlAttrs, type Child, ALLOWED, GLOBAL_ATTRS, h, fragment, cx, EMPTY_HTML, RenderError } from './render/html'
export { EMBED_FRAME, type SanitizerPolicy, sanitizeElement, sanitizerPolicy } from './render/sanitize'
export { coreRegistry, coreSchemas } from './blocks/core'
export { defineSchema } from './blocks/define'
export {
  type AttrSpec, type AttrSpecs, type AttrsOf, type BlockSchema, type Doc, type SchemaRegistry, type StoredBlock, type StoredDoc,
  type Supports, type ValidateOptions, type Validated, type ValidationIssue,
  DOC_VERSION, DocumentVersionError, MAX_DEPTH, MAX_FORMATS, UNSUPPORTED, blockRegistry, serializeDoc, validateDoc,
} from './model/schema'
export { type Block, type Attrs } from './model/tree'
export { type FormatRange, type FormatSpec, type RichTextValue, defaultFormats } from './model/richtext'
export { MAX_URL, safeSrcset, safeUrl } from './model/url'
export { type EmbedProvider, embedProviders, isPlayerUrl, registerEmbedProvider } from './model/embeds'
export { type Token, tokenize } from './render/highlight'
