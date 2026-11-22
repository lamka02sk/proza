# Proza guide

Proza is a block editor that a page embeds like a form field. It stores a document as JSON and renders that JSON as HTML, in the browser or on a server.

| Read | When you |
|---|---|
| [Integration](integration.md) | put the editor on a page: options, forms, events, uploads, the host's media library |
| [Server](server.md) | render or check what authors saved, set the Content Security Policy, sanitise HTML |
| [Theming and languages](theming.md) | match the editor and the published page to a site |
| [Block types](blocks.md) | write a block type of your own |
| [Plugins](plugins.md) | add formats, commands, toolbar buttons, options, import rules, checker rules or embeds |
| [Accessibility](accessibility.md) | need to know what the editor does for authors and readers, and what is left to the host |
| [Public API](../api/report.md) | need the exact types; generated from the published declarations |

The package has four entry points:

| Import | What it is | Runs on |
|---|---|---|
| `@lamka02sk/proza` | `createEditor()`, the `Editor`, types, the block authoring pieces | browser |
| `@lamka02sk/proza/element` | `defineEditorElement()`: the `<proza-editor>` form field | browser |
| `@lamka02sk/proza/vue` | `ProzaEditor`, a Vue component with `v-model` | browser |
| `@lamka02sk/proza/render` | `render()`, validation, the core block types, the sanitiser policy | anywhere, Node included |

Two files ship beside them: `@lamka02sk/proza/content.css` (the stylesheet of the published page) and `@lamka02sk/proza/sanitizer-policy.json` (the output allow-list as data, for a server in another language).

Proza follows [semantic versioning](https://semver.org). The stored JSON has its own version, and old documents always load.
