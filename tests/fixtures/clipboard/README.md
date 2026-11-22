# Clipboard fixtures

## Recording

1. `pnpm dev`, open `http://localhost:5199/tools/clipboard-capture/`.
2. Pick the source application and fill in its version and what you will copy.
3. Copy from the application, click the paste target, paste.
4. Check the formats list and the sandboxed preview, then **Download fixture**.
5. Move the file to `tests/fixtures/clipboard/<source>/`. The file name is already `<source>--<os>--<browser>--<timestamp>.json`.

Safari and Firefox expose fewer formats to the paste event than Chrome. **Read clipboard instead** uses the asynchronous clipboard API, which can show more (for example images on macOS). Record both when they differ.

## What to record

Each source on each operating system you can reach, with these contents:

1. Two paragraphs with bold, italic, underline and a link.
2. Headings 1 to 3 and a paragraph.
3. A bulleted list with two levels and a numbered list starting at 3.
4. A table with a header row and a merged cell.
5. An image with a caption.
6. Text in two colours and two sizes.
7. A footnote (Word, Google Docs).
8. Tracked changes and a comment (Word).
9. A block of a spreadsheet with a formula, a date and an empty cell (Excel, Sheets, Calc).

## Format

```json
{
  "schema": 1,
  "source": "word-desktop",
  "sourceVersion": "Microsoft 365, version 2410",
  "os": "Windows 11",
  "browser": "Chrome 131",
  "userAgent": "Mozilla/5.0 ...",
  "captured": "2026-11-20T10:15:00.000Z",
  "description": "two-level bulleted list with a bold word",
  "notes": "",
  "via": "paste-event",
  "types": ["text/plain", "text/html", "text/rtf", "Files"],
  "data": { "text/plain": "...", "text/html": "...", "text/rtf": "..." },
  "files": [{ "name": "image.png", "type": "image/png", "size": 1234, "dataUrl": "data:image/png;base64,..." }]
}
```

`source` is one of: `word-desktop`, `word-web`, `google-docs`, `libreoffice-writer`, `apple-pages`, `outlook`, `excel`, `google-sheets`, `libreoffice-calc`, `tinymce`, `web-page`, `other`. The folder name must match it. Files over 5 MB are listed with an empty `dataUrl`.
