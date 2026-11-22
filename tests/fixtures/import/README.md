# Import fixtures

Input for the import pipeline with the result it must give: `<name>.html` (or `.txt`), and `<name>.expected.json` with the source detected, the blocks without ids, the report and the pending pictures. `tests/e2e/import-fixtures.spec.ts` runs every file here in Chromium, Firefox and WebKit, and all three must give the same result.

**These files are synthetic.** They were written by hand after the markup each application produces (Word 365 desktop and web, Google Docs, LibreOffice 7.6, Excel 365, Google Sheets, TinyMCE 5, a web page). They test the pipeline's rules; they are not evidence that real clipboard data imports well. Real captures go to `../clipboard/` and real TinyMCE records to `../tinymce/`; the same spec runs those for invariants (no error, a valid document, no words lost) and against a snapshot once one is committed next to them.

- `<name>.rtf`: Word's RTF of the same content, for the pictures its HTML only points at.
- Update the snapshots after an intended change: `PROZA_UPDATE_FIXTURES=1 pnpm e2e import-fixtures --project=chromium`, read the diff, then run all engines.
