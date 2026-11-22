# Security

## Reporting a vulnerability

Please report it privately through GitHub: [Security → Report a vulnerability](https://github.com/lamka02sk/proza/security/advisories/new). Do not open a public issue.

Tell us the version, which entry point is affected (`@lamka02sk/proza`, `@lamka02sk/proza/render`, `@lamka02sk/proza/element` or `@lamka02sk/proza/vue`), and the smallest input that shows the problem: a document's JSON, the HTML on the clipboard, or a `.docx` file. You will get a reply within a week. Fixes ship as a patch release with an advisory that credits you, unless you would rather not be named.

## Supported versions

Security fixes go into the latest release.

## What counts as a vulnerability

Proza treats clipboard data, imported HTML and `.docx` files, stored JSON, and HTML that a browser posts to your server as untrusted. It is a vulnerability if any of them can:

- run script, or load something the output allow-list does not permit, in the editor or in `render()` output;
- get markup past `sanitizeElement()` or `sanitizer-policy.json` that should have been removed;
- take time or memory out of proportion to their size;
- run in the host page through the raw HTML block when the host has not given Proza a sanitiser.

These are not vulnerabilities in Proza: options the host turns on itself (a `rawHtml` sanitiser that lets script through, an upload adapter that accepts any file), and a server that stores HTML from `getHTML()` without re-rendering or sanitising it. See [the server guide](docs/guide/server.md).
