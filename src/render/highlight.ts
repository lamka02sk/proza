/**
 * Code highlighting (TinyMCE `codesample`): a small
 * tokenizer for the languages people paste into articles. Pure, no DOM, so
 * the renderer uses it on a server and the canvas paints the same tokens
 * through the Custom Highlight API without touching the field's DOM.
 *
 * Loaded on first use: the renderer takes it as an
 * option, the editor imports it when a code block has a language.
 */

export type TokenType = 'comment' | 'string' | 'number' | 'keyword' | 'literal' | 'tag' | 'attr' | 'property' | 'variable' | 'function' | 'meta'

export interface Token {
  readonly type: TokenType
  readonly start: number
  readonly end: number
}

interface Rule { readonly type: TokenType; readonly re: RegExp }

const words = (list: string): RegExp => new RegExp(`\\b(?:${list.trim().split(/\s+/).join('|')})\\b`, 'y')

const C_COMMENT: Rule[] = [{ type: 'comment', re: /\/\/[^\n]*/y }, { type: 'comment', re: /\/\*[\s\S]*?(?:\*\/|$)/y }]
const HASH_COMMENT: Rule = { type: 'comment', re: /#[^\n]*/y }
const STRINGS: Rule[] = [{ type: 'string', re: /"(?:\\[\s\S]|[^"\\\n])*"?/y }, { type: 'string', re: /'(?:\\[\s\S]|[^'\\\n])*'?/y }]
const NUMBER: Rule = { type: 'number', re: /\b(?:0x[\da-f_]+|0b[01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:e[+-]?\d+)?)n?\b/iy }
const CALL: Rule = { type: 'function', re: /\b[A-Za-z_$][\w$]*(?=\()/y }
const LITERALS = words('true false null undefined None True False nil NaN Infinity')

const JS_KEYWORDS = words(`as async await break case catch class const continue debugger default delete do else enum export extends finally for
  from function get if implements import in instanceof interface let new of package private protected public readonly return set static super switch
  this throw try type typeof var void while with yield declare namespace abstract keyof satisfies`)

const LANGUAGES: Readonly<Record<string, readonly Rule[]>> = {
  js: [...C_COMMENT, ...STRINGS, { type: 'string', re: /`(?:\\[\s\S]|[^`\\])*`?/y }, { type: 'literal', re: LITERALS }, { type: 'keyword', re: JS_KEYWORDS }, NUMBER, CALL],
  json: [{ type: 'property', re: /"(?:\\.|[^"\\\n])*"(?=\s*:)/y }, ...STRINGS, { type: 'literal', re: LITERALS }, NUMBER],
  css: [
    { type: 'comment', re: /\/\*[\s\S]*?(?:\*\/|$)/y }, ...STRINGS, { type: 'meta', re: /@[\w-]+/y },
    { type: 'property', re: /--?[\w-]+(?=\s*:)/y }, { type: 'number', re: /#[\da-f]{3,8}\b|-?\d*\.?\d+(?:[a-z%]+)?/iy },
    { type: 'keyword', re: /!important\b/y },
  ],
  html: [
    { type: 'comment', re: /<!--[\s\S]*?(?:-->|$)/y }, { type: 'meta', re: /<!doctype[^>]*>/iy },
    { type: 'tag', re: /<\/?[A-Za-z][\w:-]*|\/?>/y }, { type: 'attr', re: /\b[\w:-]+(?==)/y }, ...STRINGS,
  ],
  python: [
    HASH_COMMENT, { type: 'string', re: /("""|''')[\s\S]*?(?:\1|$)/y }, ...STRINGS, { type: 'meta', re: /@[\w.]+/y }, { type: 'literal', re: LITERALS },
    { type: 'keyword', re: words('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self') },
    NUMBER, CALL,
  ],
  php: [
    ...C_COMMENT, HASH_COMMENT, ...STRINGS, { type: 'meta', re: /<\?php|\?>/y }, { type: 'variable', re: /\$[A-Za-z_]\w*/y }, { type: 'literal', re: words('true false null TRUE FALSE NULL') },
    { type: 'keyword', re: words('abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield') },
    NUMBER, CALL,
  ],
  sql: [
    { type: 'comment', re: /--[^\n]*/y }, { type: 'comment', re: /\/\*[\s\S]*?(?:\*\/|$)/y }, ...STRINGS, { type: 'literal', re: /\b(?:null|true|false)\b/iy },
    { type: 'keyword', re: /\b(?:select|from|where|and|or|not|insert|into|values|update|set|delete|create|table|alter|drop|index|join|left|right|inner|outer|full|on|as|group|by|order|having|limit|offset|union|all|distinct|case|when|then|else|end|in|is|like|between|exists|primary|key|foreign|references|default|constraint|asc|desc|with|returning)\b/iy },
    NUMBER, CALL,
  ],
  bash: [
    HASH_COMMENT, { type: 'string', re: /"(?:\\[\s\S]|[^"\\])*"?/y }, { type: 'string', re: /'[^']*'?/y }, { type: 'variable', re: /\$(?:\{[^}\n]*\}?|[A-Za-z_]\w*|[@*#?$!0-9-])/y },
    { type: 'keyword', re: words('if then else elif fi case esac for while until do done in function return local export readonly declare select time') },
    NUMBER,
  ],
  c: [
    ...C_COMMENT, ...STRINGS, { type: 'meta', re: /^[ \t]*#\s*\w+/my }, { type: 'literal', re: words('true false null nullptr NULL') },
    { type: 'keyword', re: words(`abstract as async auto await base bool break byte case catch char class const continue default delegate do double else enum
      event explicit extern final finally fixed float for foreach fn func go goto if impl implements import in int interface internal is let long loop match mod
      mut namespace new object operator out override package private protected pub public readonly ref return sbyte sealed short signed sizeof static string
      struct super switch template this throw throws trait try type typedef typename typeof uint ulong union unsafe unsigned use using var virtual void
      volatile where while yield defer select chan map range`) },
    NUMBER, CALL,
  ],
  ruby: [
    HASH_COMMENT, ...STRINGS, { type: 'variable', re: /[@$][A-Za-z_]\w*/y }, { type: 'string', re: /:[A-Za-z_]\w*/y }, { type: 'literal', re: words('true false nil self') },
    { type: 'keyword', re: words('alias and begin break case class def defined do else elsif end ensure for if in module next not or redo rescue retry return super then undef unless until when while yield require') },
    NUMBER,
  ],
  // A key never starts with "-", so the list marker and the key cannot trade characters (that backtracked per line).
  yaml: [HASH_COMMENT, { type: 'property', re: /^[ \t]*(?:-[ \t]+)*[\w.][\w.-]*(?=\s*:)/my }, ...STRINGS, { type: 'literal', re: words('true false null yes no on off') }, NUMBER],
}

/**
 * What one skip passes over when no rule matches. It must cover every character
 * a rule can start a failing match on (CSS properties and HTML attributes run
 * over "-" and ":"), or each of those characters is tried again: quadratic.
 */
const SKIP: Readonly<Record<string, RegExp>> = { css: /[\w$-]+/y, html: /[\w$:-]+/y }
const WORD = /[\w$]+/y

/** Names people write for the same language, as on code fences. */
const ALIASES: Readonly<Record<string, string>> = {
  javascript: 'js', jsx: 'js', mjs: 'js', ts: 'js', typescript: 'js', tsx: 'js',
  xml: 'html', svg: 'html', vue: 'html', htm: 'html',
  py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  scss: 'css', less: 'css', postgres: 'sql', mysql: 'sql', postgresql: 'sql',
  cpp: 'c', 'c++': 'c', h: 'c', cs: 'c', csharp: 'c', 'c#': 'c', java: 'c', kotlin: 'c', go: 'c', golang: 'c', rust: 'c', rs: 'c', swift: 'c', dart: 'c',
  rb: 'ruby', yml: 'yaml', jsonc: 'json',
}

/** Whether `language` (a code block's) has highlighting. */
export function highlights(language: string): boolean {
  const l = language.toLowerCase()
  return l in LANGUAGES || l in ALIASES
}

/** Tokens of `code`, in order, never overlapping. Text between tokens is plain. */
export function tokenize(code: string, language: string): Token[] {
  const l = language.toLowerCase()
  const name = ALIASES[l] ?? l
  const rules = Object.hasOwn(LANGUAGES, name) ? LANGUAGES[name] : undefined
  if (!rules) return []
  const word = SKIP[name] ?? WORD
  const out: Token[] = []
  let i = 0
  // shortcut: one pass of sticky rules, no nested grammars (no CSS in HTML <style>, no template expressions); a real grammar engine if authors need it.
  while (i < code.length) {
    let matched = false
    for (const rule of rules) {
      rule.re.lastIndex = i
      const m = rule.re.exec(code)
      if (m && m[0].length > 0) {
        out.push({ type: rule.type, start: i, end: i + m[0].length })
        i += m[0].length
        matched = true
        break
      }
    }
    if (matched) continue
    // Skip a word or one other character, so a keyword is never matched inside an identifier.
    word.lastIndex = i
    const w = word.exec(code)
    i += w ? w[0].length : 1
  }
  return out
}
