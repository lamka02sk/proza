# Fixtures

Real-world input for the import pipeline, and stored documents for the renderer and migrations. `tests/unit/fixtures.test.ts` checks that every file here is well-formed.

**Privacy:** fixtures are committed. Use test documents, or scrub names, e-mail addresses, phone numbers, internal URLs and anything else private before adding a file.

- `clipboard/<source>/*.json`: paste payloads, recorded with the clipboard capture tool. See `clipboard/README.md`.
- `tinymce/*.html`: stored TinyMCE records from the first host. See `tinymce/README.md`.
- `import/<source>/*`: synthetic input for the import pipeline with its expected result (`*.expected.json`). See `import/README.md`.
- `documents/*.json` with `*.html`: stored documents and the exact HTML they render to (`src/blocks/text.test.ts`). Never edit a committed one: when a block type gets a new version, the old file keeps testing its migration. Add a new file for the new shape.
