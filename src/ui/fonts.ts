/**
 * The interface and heading fonts, self-hosted.
 * Registered on the document, not in the
 * shadow root: `@font-face` inside a shadow root is ignored by Chromium and
 * WebKit. The FontFace API needs no inline style under a strict CSP. Each
 * face downloads only when text needs it (latin, latin-ext for Slovak and others).
 */
import atkinson400 from './fonts/atkinson-hyperlegible-next-latin-400-normal.woff2?url'
import atkinson400ext from './fonts/atkinson-hyperlegible-next-latin-ext-400-normal.woff2?url'
import atkinson400i from './fonts/atkinson-hyperlegible-next-latin-400-italic.woff2?url'
import atkinson400iext from './fonts/atkinson-hyperlegible-next-latin-ext-400-italic.woff2?url'
import atkinson600 from './fonts/atkinson-hyperlegible-next-latin-600-normal.woff2?url'
import atkinson600ext from './fonts/atkinson-hyperlegible-next-latin-ext-600-normal.woff2?url'
import atkinson700 from './fonts/atkinson-hyperlegible-next-latin-700-normal.woff2?url'
import atkinson700ext from './fonts/atkinson-hyperlegible-next-latin-ext-700-normal.woff2?url'
import gloock from './fonts/gloock-latin-400-normal.woff2?url'
import gloockExt from './fonts/gloock-latin-ext-400-normal.woff2?url'

const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'

const FACES: readonly [family: string, url: string, weight: string, style: string, range: string][] = [
  ['Atkinson Hyperlegible Next', atkinson400, '400', 'normal', LATIN],
  ['Atkinson Hyperlegible Next', atkinson400ext, '400', 'normal', LATIN_EXT],
  ['Atkinson Hyperlegible Next', atkinson400i, '400', 'italic', LATIN],
  ['Atkinson Hyperlegible Next', atkinson400iext, '400', 'italic', LATIN_EXT],
  ['Atkinson Hyperlegible Next', atkinson600, '600', 'normal', LATIN],
  ['Atkinson Hyperlegible Next', atkinson600ext, '600', 'normal', LATIN_EXT],
  ['Atkinson Hyperlegible Next', atkinson700, '700', 'normal', LATIN],
  ['Atkinson Hyperlegible Next', atkinson700ext, '700', 'normal', LATIN_EXT],
  ['Gloock', gloock, '400', 'normal', LATIN],
  ['Gloock', gloockExt, '400', 'normal', LATIN_EXT],
]

const done = new WeakSet<Document>()

export function registerFonts(doc: Document): void {
  if (done.has(doc) || typeof FontFace !== 'function') return
  done.add(doc)
  for (const [family, url, weight, style, unicodeRange] of FACES) {
    doc.fonts.add(new FontFace(family, `url(${new URL(url, doc.baseURI).href}) format("woff2")`, { weight, style, unicodeRange, display: 'swap' }))
  }
}
