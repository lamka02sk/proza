import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAX_DOCX_TEXT, unpackedSizes } from './docx'

/** A zip with only a central directory and its end record: all `unpackedSizes` reads. */
function directory(entries: readonly { name: string; size: number }[]): ArrayBuffer {
  const names = entries.map((e) => new TextEncoder().encode(e.name))
  const dirLength = names.reduce((n, b) => n + 46 + b.length, 0)
  const buf = new ArrayBuffer(dirLength + 22)
  const view = new DataView(buf)
  let at = 0
  entries.forEach((e, i) => {
    view.setUint32(at, 0x02014b50, true)
    view.setUint32(at + 24, e.size, true)
    view.setUint16(at + 28, names[i]!.length, true)
    new Uint8Array(buf, at + 46, names[i]!.length).set(names[i]!)
    at += 46 + names[i]!.length
  })
  view.setUint32(at, 0x06054b50, true)
  view.setUint16(at + 10, entries.length, true)
  view.setUint32(at + 16, 0, true)
  return buf
}

describe('.docx sizes before unpacking', () => {
  it('adds up what the directory declares, pictures apart', () => {
    expect(unpackedSizes(directory([{ name: 'word/document.xml', size: 1000 }, { name: 'word/media/image1.png', size: 5000 }]))).toEqual({ total: 6000, text: 1000 })
  })

  it('sees a small file that unpacks to too much text (a zip bomb)', () => {
    expect(unpackedSizes(directory([{ name: 'word/document.xml', size: 0xfffffffe }]))!.text).toBeGreaterThan(MAX_DOCX_TEXT)
  })

  it('reads a real Word file, and nothing from what is not a zip', () => {
    const file = readFileSync(new URL('../../tests/fixtures/import/docx/report.docx', import.meta.url))
    const sizes = unpackedSizes(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength))
    expect(sizes!.text).toBeGreaterThan(0)
    expect(unpackedSizes(new TextEncoder().encode('not a zip at all, just text that goes on').buffer)).toBeNull()
    expect(unpackedSizes(new ArrayBuffer(3))).toBeNull()
  })
})
