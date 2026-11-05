// sharing/code-theme.ts
//
// THE CODE THEME — one syntax map for every surface that shows source. (jwize,
// 2026-11-04: "full code theme styling like we had in the dcp installer website.")
//
// The DCP installer carried a single code palette, `--dcp-code-*`, so that viewing
// a file and editing the same file were literally the same surface instead of three
// colour systems (dcp-installer-visual-spec.md §1.5). This is that palette for the
// hive: background, gutter, selection, active line, plain ink, and the seven hues —
// keyword, string, number, function, type, comment, punctuation — plus the one for
// what was taken away. Dark and light are the same hues at a second lightness, and
// the choice is the theme's own (`--md-color-scheme`), never a second switch here.
//
// Two halves, both pure:
//
//   • `tokenizeCode(text)` — a small, forgiving highlighter for the three things a
//     host serves: JavaScript (a bee, a dependency), JSON (a layer, a resource) and
//     plain text. No dependency: highlight.js is a dynamic import in the shared chat,
//     and a module may import nothing from shared. It reads each line once, carries
//     the state a block comment or a template literal leaves behind, and never
//     throws — text it cannot make sense of is simply plain. It returns tokens, not
//     markup, so a caller builds text nodes and nothing is ever parsed as HTML.
//   • `codeThemeCss(scope)` — the palette and the token classes, scoped to a surface.
//
// A dependency (atomic-modules-plan.md): it registers nothing.

export type CodeKind = 'plain' | 'kw' | 'str' | 'num' | 'fn' | 'type' | 'comment' | 'punc' | 'del'
export interface CodeToken { text: string; kind: CodeKind }
export type CodeLanguage = 'js' | 'json' | 'plain'

/** What a source text is: JSON when it opens like JSON and reads as it, JavaScript for
 *  anything else that looks like code, plain for prose. A host serves nothing else. */
export function codeLanguage(text: string): CodeLanguage {
  const head = text.slice(0, 4000).trimStart()
  if (!head) return 'plain'
  if (head[0] === '{' || head[0] === '[') {
    // A bundle can open with `{` too; JSON has a quote or a closer straight after.
    if (/^[{[]\s*(?:["}\]]|-?\d|true|false|null)/.test(head)) return 'json'
  }
  if (/^\s*(?:\/\/|\/\*|import\b|export\b|const\b|let\b|var\b|function\b|class\b|async\b|\(|["']use strict["'])/.test(head)) return 'js'
  // No code word and a lot of punctuation: still more likely a script than prose.
  const marks = (head.match(/[{};=()<>]/g) ?? []).length
  return marks > head.length / 40 ? 'js' : 'plain'
}

// Only words that are never a name: `from`, `as`, `get`, `set` and `type` are all
// ordinary identifiers in the bundles a host serves, so they stay plain.
const KEYWORDS = new Set([
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete',
  'do', 'else', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof',
  'let', 'new', 'null', 'of', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof',
  'undefined', 'var', 'void', 'while', 'with', 'yield',
])
/** After these a `/` begins a regular expression rather than dividing. */
const REGEX_AFTER = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do'])
const REGEX_AFTER_PUNC = '(,=:[!&|?{};+-*%<>~^'
const PUNCTUATION = '{}()[];,.:<>=+-*/%&|^!~?@#'
/** A line this long is a minified bundle: past it the line is plain text, not a thousand spans. */
const LINE_LIMIT = 4000

const isStart = (char: string): boolean => /[A-Za-z_$]/.test(char)
const isPart = (char: string): boolean => /[A-Za-z0-9_$]/.test(char)

interface State {
  /** 'code' | inside a block comment | inside a template literal. */
  mode: 'code' | 'block' | 'template'
  /** One entry per open `${`: how many `{` are still open inside it. */
  holes: number[]
}

const push = (out: CodeToken[], text: string, kind: CodeKind): void => {
  if (!text) return
  const last = out[out.length - 1]
  if (last && last.kind === kind) last.text += text
  else out.push({ text, kind })
}

/** Read one line of JavaScript, carrying what the last line left open. */
function jsLine(line: string, state: State): CodeToken[] {
  const out: CodeToken[] = []
  let i = 0
  // What came last that was not space: decides whether `/` is a regex and what a name is.
  let prev = ''
  let prevWord = ''
  while (i < line.length) {
    if (state.mode === 'block') {
      const end = line.indexOf('*/', i)
      if (end < 0) { push(out, line.slice(i), 'comment'); return out }
      push(out, line.slice(i, end + 2), 'comment')
      i = end + 2
      state.mode = 'code'
      continue
    }
    if (state.mode === 'template') {
      let j = i
      let hole = false
      while (j < line.length) {
        const char = line[j]!
        if (char === '\\') { j += 2; continue }
        if (char === '`') { j++; state.mode = 'code'; prev = 'str'; prevWord = ''; break }
        if (char === '$' && line[j + 1] === '{') {
          // A `${` hands the line back to code until its own `}` returns it here.
          push(out, line.slice(i, j), 'str'); push(out, '${', 'punc')
          state.holes.push(0); state.mode = 'code'; i = j + 2; hole = true
          break
        }
        j++
      }
      if (!hole) { const end = Math.min(j, line.length); push(out, line.slice(i, end), 'str'); i = end }
      continue
    }

    const char = line[i]!
    if (char === ' ' || char === '\t') { push(out, char, 'plain'); i++; continue }

    if (char === '/' && line[i + 1] === '/') { push(out, line.slice(i), 'comment'); return out }
    if (char === '/' && line[i + 1] === '*') { state.mode = 'block'; push(out, '/*', 'comment'); i += 2; continue }

    if (char === '"' || char === "'") {
      let j = i + 1
      while (j < line.length && line[j] !== char) j += line[j] === '\\' ? 2 : 1
      push(out, line.slice(i, Math.min(j + 1, line.length)), 'str')
      i = Math.min(j + 1, line.length); prev = 'str'; prevWord = ''
      continue
    }
    if (char === '`') { push(out, '`', 'str'); state.mode = 'template'; i++; prev = 'str'; prevWord = ''; continue }

    if (char === '/' && (prev === '' || REGEX_AFTER_PUNC.includes(prev) || REGEX_AFTER.has(prevWord))) {
      // A regular expression, when one closes on this line; otherwise it was a division.
      let j = i + 1
      let inClass = false
      while (j < line.length) {
        const c = line[j]!
        if (c === '\\') { j += 2; continue }
        if (c === '[') inClass = true
        else if (c === ']') inClass = false
        else if (c === '/' && !inClass) break
        j++
      }
      if (j < line.length && line[j] === '/') {
        j++
        while (j < line.length && /[a-z]/.test(line[j]!)) j++
        push(out, line.slice(i, j), 'str')
        i = j; prev = 'str'; prevWord = ''
        continue
      }
    }

    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(line[i + 1] ?? ''))) {
      const match = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)n?/.exec(line.slice(i))
      const text = match?.[0] ?? char
      push(out, text, 'num')
      i += text.length; prev = 'num'; prevWord = ''
      continue
    }

    if (isStart(char)) {
      let j = i + 1
      while (j < line.length && isPart(line[j]!)) j++
      const word = line.slice(i, j)
      let k = j
      while (line[k] === ' ') k++
      const call = line[k] === '('
      // A word after `.` is a property, never a keyword (`x.default`, `x.get`).
      const member = prev === '.'
      const kind: CodeKind = !member && KEYWORDS.has(word) ? 'kw' : call ? 'fn' : /^[A-Z]/.test(word) ? 'type' : 'plain'
      push(out, word, kind)
      i = j; prev = 'word'; prevWord = member ? '' : word
      continue
    }

    if (PUNCTUATION.includes(char)) {
      if (char === '{' && state.holes.length) state.holes[state.holes.length - 1]!++
      if (char === '}' && state.holes.length) {
        const open = state.holes[state.holes.length - 1]!
        if (open === 0) {
          state.holes.pop(); push(out, '}', 'punc'); state.mode = 'template'; i++
          continue
        }
        state.holes[state.holes.length - 1] = open - 1
      }
      push(out, char, 'punc')
      i++; prev = char; prevWord = ''
      continue
    }

    push(out, char, 'plain')
    i++; prev = char; prevWord = ''
  }
  return out
}

/** Read one line of JSON: a key is a name (the type hue), a value is a string. */
function jsonLine(line: string): CodeToken[] {
  const out: CodeToken[] = []
  let i = 0
  while (i < line.length) {
    const char = line[i]!
    if (char === '"') {
      let j = i + 1
      while (j < line.length && line[j] !== '"') j += line[j] === '\\' ? 2 : 1
      const end = Math.min(j + 1, line.length)
      let k = end
      while (line[k] === ' ') k++
      push(out, line.slice(i, end), line[k] === ':' ? 'type' : 'str')
      i = end
      continue
    }
    if (/[0-9-]/.test(char)) {
      const match = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(line.slice(i))
      if (match) { push(out, match[0], 'num'); i += match[0].length; continue }
    }
    if (isStart(char)) {
      let j = i + 1
      while (j < line.length && isPart(line[j]!)) j++
      const word = line.slice(i, j)
      push(out, word, word === 'true' || word === 'false' || word === 'null' ? 'kw' : 'plain')
      i = j
      continue
    }
    push(out, char, '{}[],:'.includes(char) ? 'punc' : 'plain')
    i++
  }
  return out
}

/**
 * Every line of `text`, as tokens. Tolerant to the end: a line past the limit, text
 * in no language, an unclosed string or comment — all come back as something to
 * draw, never as an error. Joining a line's tokens gives the line back exactly.
 */
export function tokenizeCode(text: string, language: CodeLanguage = codeLanguage(text)): CodeToken[][] {
  const lines = text.split('\n')
  const state: State = { mode: 'code', holes: [] }
  return lines.map(line => {
    if (language === 'plain' || line.length > LINE_LIMIT) return line ? [{ text: line, kind: 'plain' as const }] : []
    try { return language === 'json' ? jsonLine(line) : jsLine(line, state) } catch { return line ? [{ text: line, kind: 'plain' as const }] : [] }
  })
}

// ── the palette ──────────────────────────────────────────────────────────────

/** The DCP installer's code palette (dcp-installer-visual-spec.md §1.2, §1.3), dark then light. */
export const CODE_PALETTE = {
  bg:      ['#0d1016', '#fbfcfe'],
  gutter:  ['#6b7488', '#8b95a6'],
  sel:     ['rgba(143,180,232,0.20)', 'rgba(47,92,150,0.16)'],
  line:    ['rgba(190,205,230,0.045)', 'rgba(20,30,50,0.035)'],
  plain:   ['#d3dce8', '#1b232e'],
  kw:      ['#b3a4ea', '#5b46a8'],
  str:     ['#a8c98a', '#4f7333'],
  num:     ['#e3c07a', '#8a6218'],
  fn:      ['#8fb4e8', '#2f5c96'],
  type:    ['#6fc9c0', '#1e7a70'],
  comment: ['#6b7488', '#7b8698'],
  punc:    ['#a8b2c4', '#4a5468'],
  del:     ['#ec7365', '#b83a2c'],
} as const

/** The CSS class a token wears. */
export const codeClass = (kind: CodeKind): string => `tk-${kind}`

/**
 * THE THEME, SCOPED TO ONE SURFACE: the tokens as custom properties — each the dark
 * hue and the light hue under `light-dark()`, which the theme's own `color-scheme`
 * picks between — and the classes that wear them. `scope` is the surface's selector
 * and `box` the class of the element that holds the code.
 */
export function codeThemeCss(scope: string, box = '.hd-codebox'): string {
  const pair = (key: keyof typeof CODE_PALETTE): string => `light-dark(${CODE_PALETTE[key][1]},${CODE_PALETTE[key][0]})`
  const tokens = (Object.keys(CODE_PALETTE) as (keyof typeof CODE_PALETTE)[])
    .map(key => `--code-${key}:${pair(key)};`).join('')
  const S = `${scope} ${box}`
  return `
${S}{color-scheme:var(--md-color-scheme,dark);${tokens}background:var(--code-bg);color:var(--code-plain);}
${S} ::selection{background:var(--code-sel);}
${S} .tk-kw{color:var(--code-kw);}
${S} .tk-str{color:var(--code-str);}
${S} .tk-num{color:var(--code-num);}
${S} .tk-fn{color:var(--code-fn);}
${S} .tk-type{color:var(--code-type);}
${S} .tk-comment{color:var(--code-comment);font-style:italic;}
${S} .tk-punc{color:var(--code-punc);}
${S} .tk-del{color:var(--code-del);}`
}
