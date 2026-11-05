import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ONE CODE THEME, SPELLED TWICE (jwize, 2026-11-04).
//
// The host desk draws source from CODE_PALETTE (essentials/sharing/code-theme.ts) and
// the chat window's code blocks draw it from ui/_code-theme.scss — a stylesheet cannot
// import TypeScript and shared may not import a module, so the palette is written out
// in both. This spec is what keeps them one theme: the SCSS carries every value of the
// palette, dark and light, and every token class of the DCP installer's own map
// (dcp-installer-visual-spec.md §1.5) lands on the same token, so a block in the chat
// and a file on the desk can never drift apart without the suite saying so.
//
// The files are read as text on purpose: this is about what is WRITTEN, and a shared
// spec has no business importing a module.

const SRC = join(__dirname, '..', '..')
const read = (...parts: string[]): string => readFileSync(join(SRC, ...parts), 'utf8')
const SCSS = read('hypercomb-shared', 'ui', '_code-theme.scss')
const CHAT = read('hypercomb-shared', 'ui', 'chat-window', 'chat-markdown.scss')
const DESK = read('hypercomb-essentials', 'src', 'sharing', 'code-theme.ts')
const SPEC = read('documentation', 'dcp-installer-visual-spec.md')

const squeeze = (text: string): string => text.replace(/\s+/g, '')
const uncomment = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** `bg: ['#0d1016', '#fbfcfe']` → bg → [dark, light], from the palette's own source. */
const palette = (): Map<string, [string, string]> => {
  const block = DESK.slice(DESK.indexOf('export const CODE_PALETTE = {'), DESK.indexOf('} as const', DESK.indexOf('export const CODE_PALETTE')))
  const out = new Map<string, [string, string]>()
  for (const match of block.matchAll(/(\w+):\s*\['([^']+)',\s*'([^']+)'\]/g)) out.set(match[1]!, [match[2]!, match[3]!])
  return out
}

/** `selectors { color: var(--X-code-Y) }` → selector → Y, for every rule that colours. */
const tokenRules = (css: string, prefix: string): Map<string, string> => {
  const out = new Map<string, string>()
  for (const rule of uncomment(css).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const token = new RegExp(`color:\\s*var\\(--${prefix}-([a-z]+)\\)`).exec(rule[2]!)?.[1]
    if (!token) continue
    for (const selector of rule[1]!.split(',')) out.set(selector.replace(/\s+/g, ' ').trim(), token)
  }
  return out
}

/** The installer's own highlight.js map: the scss block under "1.5 Code surface". */
const installerMap = (): string => {
  const section = SPEC.slice(SPEC.indexOf('## 1.5 Code surface'), SPEC.indexOf('# 2. THE TYPE SCALE'))
  const open = section.indexOf('```scss') + '```scss'.length
  return section.slice(open, section.indexOf('```', open))
}

describe('the one code theme', () => {
  it('finds the palette and the installer\'s map', () => {
    expect(palette().size).toBe(13)
    expect([...palette().keys()]).toEqual(['bg', 'gutter', 'sel', 'line', 'plain', 'kw', 'str', 'num', 'fn', 'type', 'comment', 'punc', 'del'])
    expect(tokenRules(installerMap(), 'dcp-code').size).toBeGreaterThanOrEqual(20)
  })

  it('writes every value of the palette, dark and light, under light-dark()', () => {
    const scss = squeeze(SCSS)
    for (const [key, [dark, light]] of palette()) {
      expect(scss, key).toContain(squeeze(`--code-${key}: light-dark(${light}, ${dark});`))
    }
    // No hue in the SCSS that the palette does not have.
    const declared = [...SCSS.matchAll(/--code-([a-z]+):/g)].map(match => match[1])
    expect(new Set(declared)).toEqual(new Set(palette().keys()))
  })

  it('lands every class of the installer\'s highlight.js map on the same token', () => {
    // Past the mixin's own opening brace: its rules, not the mixin, are what is read.
    const ours = tokenRules(SCSS.slice(SCSS.indexOf('{', SCSS.indexOf('@mixin hljs')) + 1), 'code')
    const theirs = tokenRules(installerMap(), 'dcp-code')
    for (const [selector, token] of theirs) {
      // `.hljs` itself is the surface: its ground and ink are the mixin's own.
      if (selector === '.hljs') continue
      expect(ours.get(selector), selector).toBe(token)
    }
    expect(theirs.get('.hljs')).toBe('plain')
    expect(SCSS).toMatch(/color: var\(--code-plain\);/)
  })

  it('has the theme pick its lightness, and keeps no switch of its own', () => {
    expect(SCSS).toContain('color-scheme: var(--md-color-scheme, dark);')
    expect(SCSS).not.toMatch(/prefers-color-scheme|data-theme/)
    expect(DESK).toContain('color-scheme:var(--md-color-scheme,dark)')
  })

  it('says a comment is not italic, as the installer\'s map does — here and on the desk', () => {
    expect(SPEC).toMatch(/\.hljs-comment, \.hljs-quote\s+\{ color: var\(--dcp-code-comment\); font-style: normal; \}/)
    expect(SCSS).toMatch(/\.hljs-comment, \.hljs-quote \{ color: var\(--code-comment\); font-style: normal; \}/)
    expect(DESK).toContain('.tk-comment{color:var(--code-comment);font-style:normal;}')
  })

  it('has the chat\'s code blocks wear it, with no palette of their own left', () => {
    expect(CHAT).toMatch(/@use '\.\.\/code-theme' as code;/)
    expect(CHAT).toMatch(/@include code\.surface;/)
    expect(CHAT).toMatch(/@include code\.hljs;/)
    // The block's own ink, gutter and hover come from the theme, not the window's ink.
    expect(CHAT).toMatch(/color: var\(--code-plain\);/)
    expect(CHAT).toMatch(/color: var\(--code-gutter\);/)
    const block = CHAT.slice(CHAT.indexOf(':host ::ng-deep .chat-code {'), CHAT.indexOf('// ── tables'))
    expect(block).not.toMatch(/\.hljs-/)
    expect(block).not.toMatch(/tw\.ink\(#/)
    expect(block).not.toMatch(/var\(--hc-window-ink-(loud|quiet)\)/)
  })
})
