# TinyMCE fixtures

20 to 30 real records from the first host, a Laravel application that uses TinyMCE. They are the import pipeline's most important test input, because they are what existing customers have.

## Choosing records

Pick for variety, not at random:

- Plain text articles, short and long.
- Records with tables, especially pasted from Word or Excel.
- Records with images: floated, resized, with captions, inside links.
- Records with embedded video (`<iframe>`).
- Records with lists nested three levels, and lists restarted or reversed.
- Records with inline styles: colours, font sizes, `<font>`, `text-align`, indentation by padding.
- The oldest records you have, and records edited with an older TinyMCE version.
- Anything that has caused support requests.

## Exporting

From the host application, for example with `php artisan tinker` (replace the model and column):

```php
foreach (App\Models\Article::query()->whereIn('id', [/* chosen ids */])->get() as $a) {
    file_put_contents(base_path("proza-fixtures/{$a->id}.html"), $a->body);
}
```

Then:

1. Scrub personal data in each file. Keep the markup exactly as stored; do not reformat it.
2. Rename to say what the record shows, for example `table-from-word-merged-cells.html`.
3. Optional: next to it, `<name>.meta.json` with `{ "tinymceVersion": "5.10", "notes": "..." }`.
4. Copy into this folder.
