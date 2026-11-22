# Integration

## Install

```bash
npm install @lamka02sk/proza
```

Proza needs Vue 3 and Reka UI, which install with it. A bundler (Vite, webpack, Rollup) resolves them. The editor loads its fonts, the code highlighter, the character table and the Word importer (mammoth.js) only when they are needed.

## Put an editor on the page

```ts
import { createEditor } from '@lamka02sk/proza'

const proza = createEditor({
  target: '#content',   // an element, or a selector
  content: storedJson,  // stored JSON, or legacy HTML (it goes through the importer)
  label: 'Article',     // the editor's accessible name; a form label works too
  locale: 'sk',         // 'en' (default), 'sk', or a full set of strings
})

proza.editor.getJSON()  // the document to store
proza.editor.getHTML()  // the page HTML
proza.destroy()
```

The editor lives in a shadow root on the target element, so the host page's CSS does not reach inside it and the editor's CSS does not leak out. The editor sits inline in the page like a `<textarea>`; it never opens as a modal.

### As a form field

Three ways, all of which submit with the form, reset with it, and take `required` and `readonly`:

```html
<!-- 1. Enhance a textarea: the editor takes its place and keeps its value. -->
<label for="body">Article</label>
<textarea id="body" name="body" required><p>Legacy HTML or stored JSON</p></textarea>
<script type="module">
  import { createEditor } from '@lamka02sk/proza'
  createEditor({ target: '#body', output: 'both' })
</script>
```

`output` decides what the form sends: `html`, `json`, or `both` (default: HTML under the field's name and the JSON under `<name>_json`). The textarea fires `input` once its value has caught up with the text (a quarter of a second after typing pauses, so the value it carries is current), `change` when the focus leaves after changes, and a cancelable `save` on Mod+S, which submits the form unless a listener cancels it.

```html
<!-- 2. A custom element, form-associated through ElementInternals. -->
<proza-editor name="body" locale="sk" required>
  <script type="application/json">{"version":1,"blocks":[]}</script>
</proza-editor>
<script type="module">
  import { defineEditorElement } from '@lamka02sk/proza/element'
  defineEditorElement({ upload })   // options that are not text
</script>
```

Attributes: `name`, `required`, `readonly`, `disabled`, `preset`, `locale`, `label`, `color-scheme`, `toolbar`, `output`, `content-source`, `height`, `draft`, `a11y-on-save`. Content comes from a child `<script type="application/json">` or a child `<template>` with HTML.

```vue
<!-- 3. Vue. The model is the stored JSON. -->
<script setup lang="ts">
import { ProzaEditor } from '@lamka02sk/proza/vue'
const doc = ref(stored)
</script>
<template>
  <ProzaEditor v-model="doc" :options="{ locale: 'sk', upload }" @save="store" />
</template>
```

## Options

Everything `createEditor` takes. Only `target` is required.

| Option | Default | What it does |
|---|---|---|
| `content` | empty | Stored JSON (validated) or HTML (imported in memory; nothing is stored until the host saves). |
| `contentSource` | detected | Where HTML content comes from when its markup does not say, for example `tinymce`. |
| `import` | | `classes`: host classes that mean a format or a block. `rehostImages`: store pictures from other sites through `upload`. |
| `output` | `both` | What an enhanced textarea holds: `json`, `html` or `both`. |
| `preset` | `full` | What the interface offers: `basic`, `standard`, `full`, or `{ blocks, formats }`. Content outside the preset still loads and renders. |
| `locale` | `en` | `en`, `sk`, or a full `Locale`. |
| `label` | form label | Accessible name of the editor. |
| `contentLanguage` | the locale's | Language of the content (BCP 47) when it differs from the interface's: the published page's few words (footnotes, table names) and the checker's language. |
| `colorScheme` | `auto` | `light`, `dark` or `auto` (follows the system). |
| `dir` | locale's | Interface direction. |
| `toolbar` | `bubble` | `bubble`: formatting above selected words. `docked`: a bar at the top of the field. |
| `patterns` | none | Ready-made layouts in the inserter. |
| `theme` | | `palette` (named text colours), `styles` (style variants per block type), `css` (the host's stylesheet for those classes). See [theming](theming.md). |
| `upload` | none | The host's upload adapter. Without it, media come from web addresses. |
| `links` | none | Search for pages to link to: `(query, { signal }) => Promise<{ title, url, kind }[]>`. |
| `hooks` | none | `blocksChange`, `upload`, `requestAttachment`. See below. |
| `a11y.onSave` | `warn` | `block`: no save or form submit while the checker finds errors. |
| `plugins`, `blocks`, `commands` | none | Extensions. See [plugins](plugins.md) and [block types](blocks.md). |
| `keys` | | Shortcut overrides by command name; `null` switches a command's keys off. |
| `readOnly` | `false` | Read, select and copy only. `editor.setReadOnly()` switches it later. |
| `draft` | `false` | Keep a draft in the browser while the author writes, offered back after a crash. `true`, a key, or `{ key, storage, delay }`. Off by default: drafts stay on shared computers. |
| `height` | grows | A fixed height (any CSS length); the text scrolls inside. |
| `rawHtml` | `false` | The raw HTML part. `true` offers it and `getHTML()` carries the markup as written, which the server must sanitise. A function sanitises it in the browser too. |
| `locking` | `false` | Authors may lock and unlock parts. Locks in loaded content hold either way. |
| `justify` | `false` | Offer justified text (it harms readability, so it is off). |
| `fonts` | `true` | Register the self-hosted interface fonts. `false` when the host serves them. |

## Reading and changing the document

| Call | Does |
|---|---|
| `getJSON()` | The document as stored JSON. Store this. |
| `getHTML()` | The page HTML. A convenience: a server should render from the JSON. |
| `setContent(jsonOrHtml)` | Replace the document. Clears undo. Returns what validation repaired. |
| `replaceContent(json)` | Replace the document as one undo step. |
| `insert(blocks)` | Insert stored blocks at the selection. |
| `isEmpty()` | Nothing written yet. |
| `validate()` | The checker's problems in words. |
| `undo()`, `redo()`, `run(command)` | As the author would. |
| `setReadOnly(on)` | Switch read-only. |
| `on(event, fn)` | Subscribe; returns the function that unsubscribes. |

Events: `change` (after every change), `blocksChange` (below), `upload` (below), `selection`, `focus`, `blur`, `save` (Mod+S), `import` (foreign content came in, with its report), `announce` (what the editor told a screen reader).

## Hooks

```ts
createEditor({
  target: '#content',
  hooks: {
    blocksChange(e) { /* e.reason, e.revision, e.added, e.removed, e.updated, e.order */ },
    upload(e) { /* e.attempt, e.status, e.blockId, e.kind, e.source, e.progress, e.result, e.reason */ },
    requestAttachment(request) { /* open the host's media library */ },
  },
})
```

Hooks are wired before the interface mounts, so they also see the uploads that start for HTML content given at creation. A hook that throws is reported (`reportError`) and does not stop the edit, undo, form sync or the other listeners. `editor.on('blocksChange')` and `editor.on('upload')` get the same events.

### `blocksChange`

One event per committed transaction, after the editor applied it, in edit order:

- `added` and `removed`: blocks (id, type, validated attributes), children included.
- `updated`: `{ id, before, after }` for blocks that kept their id. A conversion that keeps its id is an update.
- `order`: `{ parent, before, after }` child id lists for each parent whose children changed (`parent` null is the document). An insertion shows here as the new order.
- `reason`: `typing`, `paste`, `command`, `import`, `undo`, `redo`, or `reset` when the host replaced the content with `setContent` (a reset carries no lists: read `getJSON()`). The first content is the baseline and sends nothing.
- `revision`: grows with every change.

Split, merge and paste send one event for everything they did. Nothing is computed while no one listens, and a keystroke looks at the one block it changed.

### Uploads

```ts
const upload: UploadAdapter = async (file, { onProgress, signal, kind, blockId, source }) => {
  const res = await fetch('/media', { method: 'POST', body: file, signal })
  if (!res.ok) throw new Error('refused')
  return await res.json()   // { url, width?, height?, variants?: [{ url, width }] }
}
```

The adapter validates and stores; the editor's own checks (the file type) are a convenience. `kind` is `image`, `video`, `audio`, `captions` or `file`; `source` is `picker`, `drop`, `paste`, `import` or `rehost`. The returned address passes the same URL allow-list as any other. A picture's `variants` become its `srcset`.

The `upload` hook follows each attempt: `started`, then `progress` when the adapter reports it, then exactly one of `succeeded` (the part already holds the file, after its `blocksChange`), `failed` (`reason`: `type`, `adapter` or `result`) or `cancelled` (`author`, `removed`, `replaced`, `reset`, `readOnly`, `destroyed`). A retry is a new attempt. Undo and redo never call the adapter again. Deleting stored files is the host's decision: undo, and other documents, can still refer to them.

### The host's media library

```ts
hooks: {
  async requestAttachment({ requestId, kind, accept, signal, replyTarget }) {
    const attachment = await myLibrary.pick({ kind, accept, signal })   // null when cancelled
    if (signal.aborted) return
    replyTarget.dispatchEvent(new CustomEvent('proza:attachment-result', { detail: { requestId, attachment } }))
  },
}
```

With this hook, Picture and File in the inserter open the host's library instead of inserting an empty part, and an empty picture or file part offers *Choose from the library* beside *Upload from this device* (when there is an adapter) and the web address. The library works without an upload adapter.

`attachment` is `{ url, name, mimeType, bytes?, width?, height?, variants? }`. The editor takes only the first answer with its `requestId`, sent to the editor's own host element; it checks the address, and refuses a non-picture for a picture part. One request is open per editor; it is aborted when the author starts another, the content is replaced, the editor turns read-only, or it is destroyed. If the author changed the text the part was to replace while choosing, the text stays and the answer is dropped. Cancelling leaves no undo step and puts the focus back.

## Content Security Policy

The editor runs under a strict policy: no `unsafe-inline`, no `unsafe-eval`. Its styles are constructed stylesheets, its fonts are files next to the package's modules, and nothing it renders has a `style` attribute.

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; object-src 'none'; base-uri 'none'
```

This is the policy the end-to-end test runs under (`tests/e2e/csp.spec.ts`, all three engines, no violation while the author types, formats, and opens the menus, dialogs and the published-page view). Add the hosts your pictures and uploads come from to `img-src`, the upload endpoint to `connect-src`, and the embed providers you allow to `frame-src`. See [server](server.md) for the published page.
