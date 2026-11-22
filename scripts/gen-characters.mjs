// Generates src/ui/characters-data.ts: the special characters and emoji of the
// character picker (as TinyMCE `charmap` and `emoticons`), with English names
// and search words from Unicode CLDR, and src/ui/characters-<lang>.ts with each
// other interface language's names and words, a lazy chunk of its own.
//
//   node scripts/gen-characters.mjs
//
// Sources (Unicode License v3, https://www.unicode.org/license.txt):
// emoji-test.txt, UnicodeData.txt, CLDR annotations (full and derived).
// Emoji stop at version 15.0, the newest that the supported operating systems
// (iOS 17, current Android and Windows) all draw.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MAX_EMOJI_VERSION = 15.0
const KEYWORDS = 5
const CLDR = 'https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json'

const text = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res.text()
}
const json = async (url) => JSON.parse(await text(url))

const annotations = async (lang) => {
  const full = (await json(`${CLDR}/cldr-annotations-full/annotations/${lang}/annotations.json`)).annotations.annotations
  const derived = (await json(`${CLDR}/cldr-annotations-derived-full/annotationsDerived/${lang}/annotations.json`)).annotationsDerived.annotations
  return { ...derived, ...full }
}

// The interface languages besides English (src/locales/).
const LANGS = ['sk', 'cs', 'de', 'es', 'fr', 'hu']

const [emojiTest, unicodeData, en, ...others] = await Promise.all([
  text('https://unicode.org/Public/emoji/latest/emoji-test.txt'),
  text('https://unicode.org/Public/UCD/latest/ucd/UnicodeData.txt'),
  annotations('en'),
  ...LANGS.map(annotations),
])
const local = Object.fromEntries(LANGS.map((l, i) => [l, others[i]]))

const unicodeNames = new Map()
for (const line of unicodeData.split('\n')) {
  const [cp, name] = line.split(';')
  if (cp && name && !name.startsWith('<')) unicodeNames.set(String.fromCodePoint(parseInt(cp, 16)), name.toLowerCase())
}

// CLDR names no spaces and few typographic marks outside English. In order:
// no-break, narrow no-break, thin, en and em space, zero width space, word joiner,
// soft hyphen, non-breaking hyphen, triangular bullet.
const MARKS = ['\u00A0', '\u202F', '\u2009', '\u2002', '\u2003', '\u200B', '\u2060', '\u00AD', '‑', '‣']
const MARK_NAMES = {
  sk: ['nezlomiteľná medzera', 'úzka nezlomiteľná medzera', 'úzka medzera', 'polovičná medzera', 'široká medzera', 'medzera nulovej šírky', 'spájač slov', 'mäkký spojovník', 'nezlomiteľný spojovník', 'trojuholníková odrážka'],
  cs: ['nezlomitelná mezera', 'úzká nezlomitelná mezera', 'úzká mezera', 'půlčtverčíková mezera', 'čtverčíková mezera', 'mezera nulové šířky', 'spojovač slov', 'měkký spojovník', 'nezlomitelný spojovník', 'trojúhelníková odrážka'],
  de: ['geschütztes Leerzeichen', 'schmales geschütztes Leerzeichen', 'schmales Leerzeichen', 'Halbgeviert-Leerzeichen', 'Geviert-Leerzeichen', 'breitenloses Leerzeichen', 'Wortverbinder', 'weiches Trennzeichen', 'geschützter Bindestrich', 'dreieckiger Aufzählungspunkt'],
  es: ['espacio de no separación', 'espacio estrecho de no separación', 'espacio fino', 'espacio de media eme', 'espacio eme', 'espacio de ancho cero', 'unión de palabras', 'guion blando', 'guion de no separación', 'viñeta triangular'],
  fr: ['espace insécable', 'espace fine insécable', 'espace fine', 'espace demi-cadratin', 'espace cadratin', 'espace sans chasse', 'gluon de mots', 'trait d’union conditionnel', 'trait d’union insécable', 'puce triangulaire'],
  hu: ['nem törhető szóköz', 'keskeny nem törhető szóköz', 'vékony szóköz', 'n-szóköz', 'm-szóköz', 'nulla szélességű szóköz', 'szóösszekötő', 'feltételes elválasztójel', 'nem törhető kötőjel', 'háromszög alakú felsorolásjel'],
}

// CLDR keys drop the emoji presentation selector; look both up.
const note = (ann, ch) => ann[ch] ?? ann[ch.replace(/️/g, '')]
const clean = (s) => s.replace(/[|\n]/g, ' ').trim()
const words = (list, name) => (list ?? []).map(clean).filter((w) => w !== name).slice(0, KEYWORDS).join(' ')
const englishName = (ch, fallback) => clean(note(en, ch)?.tts?.[0] ?? fallback ?? unicodeNames.get(ch) ?? '')
// Each language's names by character: name|words, for every character the picker lists.
const names = Object.fromEntries(LANGS.map((l) => [l, {}]))
function entry(ch, fallback) {
  const enName = englishName(ch, fallback)
  for (const l of LANGS) {
    const a = note(local[l], ch), i = MARKS.indexOf(ch)
    const name = clean(i >= 0 ? MARK_NAMES[l][i] : a?.tts?.[0] ?? '')
    if (name || a?.default) names[l][ch] = `${name}|${words(a?.default, name)}`
  }
  return [ch, enName, words(note(en, ch)?.default, enName)].join('|')
}

// --- Emoji: fully-qualified, no skin tones (one tile per emoji), grouped as Unicode groups them.
const emoji = new Map()
let group = ''
for (const line of emojiTest.split('\n')) {
  const g = /^# group: (.+)$/.exec(line)
  if (g) { group = g[1]; continue }
  const m = /^([0-9A-F ]+?)\s*; fully-qualified\s*# (\S+) E(\d+\.\d+) (.+)$/.exec(line)
  if (!m || group === 'Component') continue
  const [, cps, ch, version, name] = m
  if (Number(version) > MAX_EMOJI_VERSION) continue
  if (/\b1F3F[B-F]\b/.test(cps)) continue
  if (!emoji.has(group)) emoji.set(group, [])
  emoji.get(group).push(entry(ch, name))
}
const EMOJI_GROUPS = {
  'Smileys & Emotion': 'smileys', 'People & Body': 'people', 'Animals & Nature': 'nature', 'Food & Drink': 'food',
  'Travel & Places': 'travel', Activities: 'activities', Objects: 'objects', Symbols: 'symbols', Flags: 'flags',
}

// --- Special characters, in the groups a writer looks for them.
const range = (from, to, skip = []) => Array.from({ length: to - from + 1 }, (_, i) => String.fromCodePoint(from + i)).filter((c) => !skip.includes(c))
const CHARACTERS = {
  spaces: [' ', ' ', ' ', ' ', ' ', '​', '⁠', '­'],
  punctuation: [...'–—‐‑…·•‣′″§¶†‡¡¿‹›«»„“”‚‘’°⁄©®™℗№&@#~¦'],
  currency: [...'€£¥¢$₹₽₩₪₫₴₺₸₿¤ƒ₣₱₦₲₵₡₭₮₼₾฿'],
  math: [...'±×÷−≠≈≡≤≥∞√∑∏∫∂∆∇∈∉∩∪⊂⊃⊆⊇∧∨¬∀∃∅∝∠⊥‖¹²³⁴⁰₀₁₂₃¼½¾⅓⅔⅛‰‱µ℃℉Ωℓ'],
  arrows: [...'←↑→↓↔↕↖↗↘↙⇐⇑⇒⇓⇔↩↪↺↻➔'],
  latin: [...range(0xC0, 0xFF, ['×', '÷']), ...range(0x100, 0x17F), 'ẞ'],
  greek: [...range(0x391, 0x3A9, ['΢']), ...range(0x3B1, 0x3C9)],
  symbols: [...'✓✔✗✘★☆♠♣♥♦♪♫☐☑☒●○■□▲△▼▽◆◇※⌘⌥⇧⌫⏎☎✉✂☀☁☂☃♀♂⚠'],
}

const lines = [
  '// Generated by scripts/gen-characters.mjs: do not edit. Data: Unicode emoji-test.txt, UnicodeData.txt',
  '// and CLDR annotations, under the Unicode License v3 (https://www.unicode.org/license.txt).',
  '// Each entry: character|English name|English words. Other languages: characters-<lang>.ts.',
  '',
  'export const CHARACTERS: Readonly<Record<string, readonly string[]>> = {',
  ...Object.entries(CHARACTERS).map(([id, chars]) => `  ${id}: ${JSON.stringify(chars.map((c) => entry(c)))},`),
  '}',
  '',
  'export const EMOJI: Readonly<Record<string, readonly string[]>> = {',
  ...[...emoji].map(([g, list]) => `  ${EMOJI_GROUPS[g]}: ${JSON.stringify(list)},`),
  '}',
  '',
]
const out = resolve(import.meta.dirname, '../src/ui/characters-data.ts')
writeFileSync(out, lines.join('\n'))
console.log(`${out}: ${Object.values(CHARACTERS).flat().length} characters, ${[...emoji.values()].flat().length} emoji`)
for (const l of LANGS) {
  const file = resolve(import.meta.dirname, `../src/ui/characters-${l}.ts`)
  writeFileSync(file, [
    '// Generated by scripts/gen-characters.mjs: do not edit. Data: CLDR annotations, under the Unicode License v3',
    '// (https://www.unicode.org/license.txt). By character: name|words.',
    '',
    `export const NAMES: Readonly<Record<string, string>> = ${JSON.stringify(names[l])}`,
    '',
  ].join('\n'))
  console.log(`${file}: ${Object.keys(names[l]).length} names`)
}
