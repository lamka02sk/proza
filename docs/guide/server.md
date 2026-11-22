# Server

The editor's JSON is the document. HTML is a rendering of it. What a browser sends is not trusted: anyone can post any JSON or HTML to your endpoint.

## Render from the JSON

```ts
import { render, coreRegistry, validateDoc } from '@lamka02sk/proza/render'

const html = render(storedJson, coreRegistry)              // validates, then renders
const { doc, issues } = validateDoc(storedJson, coreRegistry) // what validation repaired
```

`@lamka02sk/proza/render` runs in Node, a worker or a build step: no DOM, no Vue. Publish its HTML with `@lamka02sk/proza/content.css`, which styles the published page (`.pz-content`):

```html
<link rel="stylesheet" href="/assets/proza/content.css">
<div class="pz-content"><!-- render() output --></div>
```

`render()` is the call for untrusted JSON. It:

- validates the whole document against the block types: unknown types and blocks in the wrong place become placeholders (kept in the JSON, rendered as nothing), bad attributes get their defaults, addresses pass the protocol allow-list (`http`, `https`, `mailto`, `tel`, relative), ids are made unique;
- builds every element through the escaping builder `h()`, whose tag and attribute allow-list is the output's;
- allows a frame only for an embed provider's player address, with a fixed `sandbox`;
- stays cheap for hostile input: nesting past 128 levels, more than 2,000 table rows or 500 cells in a row, table spans past 500 columns, more than 10,000 formats in one text and addresses over 8,192 characters are cut back, so a small document cannot cost a server large time or memory (`tests/unit/limits.test.ts`).

Block types of your own render on the server when you pass their schema half (see [block types](blocks.md)):

```ts
import { blockRegistry, coreSchemas, render } from '@lamka02sk/proza/render'
import { callout } from './blocks/callout'   // the defineSchema half

const registry = blockRegistry([...coreSchemas, callout])
render(storedJson, registry)
```

Options: `formats` (the inline formats, when plugins add some), `labels` (the published page's few words: `renderLabels('sk')` for Slovak; also `cs`, `de`, `es`, `fr`, `hu`; English by default), `idPrefix` (footnote ids, when several documents share a page), `measure` (the text column and wide widths in pixels, for pictures' `sizes`), `highlight` (pass `tokenize` from `@lamka02sk/proza/render` to colour code), `rawHtml` (below).

## Store the JSON, not the HTML

Store `getJSON()`. Render on the server, or cache the rendering. The HTML from `getHTML()` (and the `<name>` field of an enhanced textarea) is for hosts that cannot run JavaScript on the server; it must be sanitised there.

## Sanitise HTML

When the server must accept HTML (a PHP host, a form that posts `getHTML()`), sanitise it with the output allow-list. The rules are the ones `h()` applies:

- elements and attributes from the list, plus `aria-*` and `data-pz-*`;
- `href`, `src`, `cite` and `poster` through the protocol allow-list; `srcset` as at most 20 `url <n>w` candidates;
- `input` only as a checkbox;
- `iframe` only with a provider's player address, and its `sandbox`, `allow` and `referrerpolicy` replaced by Proza's;
- on links, `target` only as `_blank` (any other is removed), `rel` without `opener`, and `rel="noopener"` added with `target="_blank"` (`linkTarget` and `newWindowRel` in the policy);
- no `style` attribute anywhere, and no event handlers.

In JavaScript, call `sanitizeElement(tag, attrs)` from your sanitiser's element hook. It returns the attributes that may stay, or `null` when the element must go:

```ts
import DOMPurify from 'dompurify'
import { sanitizeElement } from '@lamka02sk/proza/render'

DOMPurify.addHook('uponSanitizeElement', (node, data) => { /* drop when sanitizeElement(...) is null */ })
```

In another language, load `@lamka02sk/proza/sanitizer-policy.json` (the same rules as data) into your sanitiser: HTML Purifier, Bleach, Ammonia. Its regular expressions are ECMAScript source; the URL pattern is case-insensitive. Copy the file from the package at deploy time, so it always matches the version that wrote the HTML.

## Raw HTML

The raw HTML part is off by default. With `rawHtml: true` the author writes markup, the editor previews it in a frame that may do nothing (`sandbox` without permissions), and `getHTML()` carries it as written: sanitise it on the server. On the server, `render(doc, registry, { rawHtml: (html) => sanitised })` places it; without that option raw HTML renders as nothing. Raw HTML from another page's clipboard does not paste while the part is off.

## The published page's Content Security Policy

Rendered output has no inline style and no script. A page can serve it with `style-src 'self'` and `script-src 'self'`. Embeds need their providers in `frame-src`.

## Known limits

- **Author ids on the page.** Anchors and heading ids go onto the published page as `id`. A page script that reads a global the page never set can get an element with that id instead (DOM clobbering). Do not rely on unset globals on pages that show authors' content.
- **Word files.** A `.docx` is read in the author's browser, up to 100 MB. A crafted file can still make the author's own tab slow; nothing reaches the server but the result.
- **Tokens in URLs.** Addresses are kept as written. A signed or private address that an author pastes is published as it is.
