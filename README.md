<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/svg/proza-logo-na-tmave.svg">
    <img src="brand/svg/proza-logo-na-svetle.svg" alt="Proza" height="56">
  </picture>
</p>

Proza is a block editor for the web, in the spirit of WordPress's Gutenberg. You put it on a page like a `<textarea>`, authors write in blocks, and you store the result as JSON. The same JSON renders to clean HTML in the browser or on your server.

It is written from scratch in TypeScript, with a Vue 3 interface. There is no ProseMirror, Slate or Lexical underneath.

```bash
npm install @lamka02sk/proza
```

```ts
import { createEditor } from '@lamka02sk/proza'

const proza = createEditor({ target: '#content', content: storedJson })

save(proza.editor.getJSON())
```

```ts
// On the server (Node, no DOM needed)
import { render, coreRegistry } from '@lamka02sk/proza/render'

const html = render(storedJson, coreRegistry)
```

## What you get

- **Blocks**: paragraphs, headings, lists, quotes, code with highlighting, pictures, galleries, video, audio, files, embeds, columns, groups, fold-outs, buttons, tables with merged cells, footnotes, a table of contents.
- **Paste and import that works**: Word, Google Docs, LibreOffice, Excel and old TinyMCE content come in as proper blocks, not as a pile of spans. `.docx` files open directly.
- **Fits into forms**: enhance an existing `<textarea>`, use the `<proza-editor>` custom element, or the Vue component with `v-model`.
- **Accessibility built in**: full keyboard use, screen reader announcements, and a checker that helps authors fix missing alt text, skipped headings, vague links and missing captions.
- **Safe by default**: pasted HTML, imported files and stored JSON are validated, output goes through an allow-list, and it runs under a strict Content Security Policy (no `unsafe-inline`, no `unsafe-eval`). The allow-list also ships as JSON for sanitisers in PHP, Python or Rust.
- **Extensible**: your own block types, formats, commands, toolbar buttons, embed providers and checker rules.
- **English, Slovak, Czech, German, Spanish, French and Hungarian** interface, each language a separate import so you ship only the ones you use, and you can add your own.

It works in the last two versions of Chrome, Edge, Firefox and Safari, and on iOS Safari 17 and later.

## Documentation

- [Guide](docs/guide/README.md): integration, server rendering, theming, writing block types and plugins, accessibility
- [API reference](docs/api/report.md)
- [Changelog](CHANGELOG.md)

## Development

You need Node 22 or later and pnpm.

```bash
pnpm install
pnpm exec playwright install chromium firefox webkit
pnpm dev      # playground at http://localhost:5199
pnpm check    # everything CI runs
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and [SECURITY.md](SECURITY.md) to report a vulnerability.

## Licence

[MIT](LICENSE)
