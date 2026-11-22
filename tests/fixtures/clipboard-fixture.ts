/** Shape of a clipboard fixture (tests/fixtures/clipboard/README.md). Returns the problems found. */
export function validateClipboardFixture(f: unknown): string[] {
  const errors: string[] = []
  if (typeof f !== 'object' || f === null) return ['not an object']
  const o = f as Record<string, unknown>
  const str = (k: string, required = true): void => {
    if (typeof o[k] !== 'string' || (required && o[k].length === 0)) errors.push(`${k}: expected ${required ? 'a non-empty ' : 'a '}string`)
  }
  if (o.schema !== 1) errors.push('schema: expected 1')
  str('source'); str('os'); str('browser'); str('userAgent'); str('captured'); str('description')
  str('sourceVersion', false); str('notes', false)
  if (o.via !== 'paste-event' && o.via !== 'async-clipboard') errors.push('via: expected "paste-event" or "async-clipboard"')
  if (!Array.isArray(o.types) || !o.types.every((t) => typeof t === 'string')) errors.push('types: expected string[]')
  if (typeof o.data !== 'object' || o.data === null || !Object.values(o.data).every((v) => typeof v === 'string')) errors.push('data: expected a map of strings')
  if (!Array.isArray(o.files)) errors.push('files: expected an array')
  return errors
}
