# Contributing

Bug reports and pull requests are welcome. For anything bigger than a fix, open an issue first so we can agree on the approach before you spend time on it.

## Setup

You need Node 22 or later and pnpm.

```bash
pnpm install
pnpm exec playwright install chromium firefox webkit
pnpm dev      # playground at http://localhost:5199
```

## Before you open a pull request

Run `pnpm check`. It runs the type checker, lint, unit tests, the build, the package and size checks, the API check and the end-to-end tests in Chromium, Firefox and WebKit. CI runs the same thing.

A few things reviewers will look for:

- **Tests in all three engines** for anything that changes typing, selection, the clipboard or the caret. If an engine has to be skipped, the skip says which browser limitation forces it.
- **No new runtime dependencies.** The editor depends on Vue, Reka UI and mammoth.js only. Ask in an issue if you think something else is needed.
- **The public API report stays current.** If your change touches what the package exports, `pnpm build && pnpm api` updates `docs/api/report.md`; commit that file with your change.
- **Accessibility is part of the change.** New controls need a keyboard path, an accessible name and, when they change state, an announcement.
- **Both languages.** New interface text goes into `src/editor/locale-en.ts` and `src/editor/locale-sk.ts`.

A few rules in the code that are easy to break:

- Formatting lives in the document model. The rich-text field reads only plain text back from the DOM.
- Nothing but the field writes inside a field's element, Vue included.
- The editor lives in a shadow root, so use `selectionSourceFor()` and `hasFocusWithin()` from `src/richtext/selection.ts`, not `document.getSelection()` or `document.activeElement`.
- Markup in the output is built with `h()` from `src/render/html.ts`. Its allow-list is also the server sanitiser, so a new element means adding it there.
- No inline styles or `eval`: the editor must keep working under a strict Content Security Policy.
- No Ctrl+Alt shortcuts outside macOS: on Windows that combination is AltGr.

## Security issues

Please report them privately, as described in [SECURITY.md](SECURITY.md), not in a public issue.

## Licence

By contributing, you agree that your work is released under the [MIT licence](LICENSE).
