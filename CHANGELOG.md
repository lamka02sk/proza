# Changelog

Proza follows [semantic versioning](https://semver.org). The public API is what [`docs/api/report.md`](docs/api/report.md) lists. Stored documents carry their own version and always load in later releases.

## 0.1.2 (2026-11-23)

### Legacy HTML

- `legacy` option (`createEditor`, `importHtml`, `render`): a site that stores HTML other editors and its pages read keeps it as written. HTML content keeps inline styles (colours, sizes, fonts, backgrounds, alignment, boxes), the site's classes, boxes with them (`<div class="note">`, `<section>`), named anchors, icon elements, link titles and classes, empty lines, table borders and column widths, and frames of the sites the policy lists, each with its own sandbox. Output is plain HTML without Proza's classes where an inline style says the same. Pasted content is still converted to clean parts.
- With `rawHtml` on, what no part can hold (a form, an SVG) stays as raw HTML.
- The Embedded page part (`core/frame`) for those frames, with its address and title on the part, a preview on request and a checker rule for a missing title.
- `htmlLosses(before, after)`: what an HTML round trip lost, for checking stored records before switching.
- `sanitizeElement` and `sanitizerPolicy` take the same policy; `legacyFormats()`, `LEGACY_STYLES`, `FRAME_SANDBOX` and `cleanStyle` are exported.
- Without the option nothing changes. Stored JSON gains attributes only where legacy markup sets them.

### Fixes

- A named anchor (`<a name>`) inside text is no longer lost by its own link hole.
- A stray U+FFFC in imported text no longer leaves an empty paragraph or a trailing space.
- A language span around a block in the same language no longer repeats inside it.

## 0.1.1 (2026-11-22)

### Languages

- Czech, German, Spanish, French and Hungarian interfaces, beside English and Slovak: the editor, the published page's words (`renderLabels`), the checker's vague-link and new-window words, and the character picker's names.
- **Breaking:** only English is built in. Every other language is its own entry, `@lamka02sk/proza/locales/<lang>`, so a host bundles only what it imports. Replace `locale: 'sk'` with `import { sk } from '@lamka02sk/proza/locales/sk'` and `locale: sk`. For `<proza-editor locale="sk">`, list it: `defineEditorElement({ languages: [sk] })`. An unknown locale name now throws instead of falling back to English.
- `languages` option: the locales `locale` can name.

### Fixes

- The README logo shows on GitHub's dark theme.

## 0.1.0 (2026-11-22)

First public release.

### The package

- `@lamka02sk/proza`: `createEditor()`, the `Editor`, and what you need to write block types (`defineBlock`, `defineSchema`, `RichTextView`, `BlockList`, `useEditor`, `newBlock`, `h`).
- `@lamka02sk/proza/element`: the `<proza-editor>` form field.
- `@lamka02sk/proza/vue`: the `ProzaEditor` component with `v-model`.
- `@lamka02sk/proza/render`: rendering, validation and the sanitiser policy. Runs in Node without a DOM.
- `@lamka02sk/proza/content.css` for the published page and `@lamka02sk/proza/sanitizer-policy.json` for sanitisers in other languages.
- A host bundle with `createEditor`, Vue and Reka UI included, loads about 209 kB of gzipped JavaScript up front. Code highlighting, the character table and the Word importer load when first used.

### Editing

- Text, media, layout, table and utility blocks, with a `/` menu, an inserter, block options, an outline and a status line.
- Selection across blocks, with copy, cut, paste and formatting over the whole range.
- Import from Word, Google Docs, LibreOffice, Excel, TinyMCE and `.docx` files.
- Find and replace, special characters and emoji, word count, a preview of the published page, read-only mode, draft recovery, block locking, style variants and block transforms.
- An accessibility checker with repairs that undo in one step, and an optional rule that blocks saving while errors remain.

### Integration

- Enhance a `<textarea>`, use the custom element or the Vue component; all three submit with the form and respect `required` and `readonly`.
- Hooks for block changes, upload progress and the host's own media library.
- A plugin API for blocks, formats, commands, toolbar buttons, block options, import rules, checker rules, locales and embed providers.
- English and Slovak interface; the published page's labels follow the content's language.

### Security

- Pasted HTML, imported files and stored JSON are validated, and the work they cost grows with their size, never with numbers inside them.
- Output goes through one tag and attribute allow-list, which `sanitizeElement()` and `sanitizer-policy.json` export for your server.
- Raw HTML is off by default. When on, the editor previews it in a sandboxed frame.
- Runs under a strict Content Security Policy: no `unsafe-inline`, no `unsafe-eval`.
