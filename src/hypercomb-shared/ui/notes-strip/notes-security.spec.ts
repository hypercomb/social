// notes-security.spec.ts
//
// Regression guard for the notes feature's "no HTML output" stance.
// Notes are stored and rendered as plain text — Angular's `{{ }}`
// interpolation escapes user input, no `innerHTML` is used anywhere,
// and per-note categorisation is a single CSS-drawn shape glyph
// keyed off a literal `.hc-shape-X` class toggled via `[class.X]`
// bindings (never a string-concat into `class="…"`).
//
// This test reads every notes-related source file and asserts the
// ABSENCE of patterns that could re-introduce an HTML rendering
// surface: `innerHTML`, `bypassSecurityTrust`, `execCommand`,
// `contenteditable="true"`, dynamic icon interpolation, dynamic
// class / style attribute construction, and so on. If anyone adds
// one of these back, this test fails with a precise file:line
// pointer and the offending substring.
//
// To extend: add to FORBIDDEN_PATTERNS, NOT to file-by-file allow lists.
// The list of files scanned is the closure — anything new in notes-* is
// covered automatically.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Resolve repo-relative paths from this spec's location. We climb out
// of `hypercomb-shared/ui/notes-strip/` to `src/`, then walk into each
// notes-* dir under hypercomb-shared/ui/ and the notes module under
// hypercomb-essentials/src/diamondcoreprocessor.com/.
const SRC = resolve(__dirname, '..', '..', '..')

const SCAN_ROOTS: readonly string[] = [
  join(SRC, 'hypercomb-shared', 'ui', 'notes-strip'),
  join(SRC, 'hypercomb-shared', 'ui', 'notes-viewer'),
  join(SRC, 'hypercomb-essentials', 'src', 'diamondcoreprocessor.com', 'notes'),
]

/** Patterns that must never appear in any notes source file. */
const FORBIDDEN_PATTERNS: readonly { name: string; re: RegExp; why: string }[] = [
  {
    name: 'angular-innerhtml-binding',
    re: /\[innerHTML\]/,
    why: 'Angular [innerHTML] binding renders user data as HTML.',
  },
  {
    name: 'innerhtml-assignment',
    re: /\binnerHTML\s*=/,
    why: 'Direct innerHTML assignment bypasses Angular escaping.',
  },
  {
    name: 'outerhtml-assignment',
    re: /\bouterHTML\s*=/,
    why: 'outerHTML assignment is equivalent to innerHTML for security.',
  },
  {
    name: 'insertadjacenthtml',
    re: /\binsertAdjacentHTML\b/,
    why: 'insertAdjacentHTML parses its argument as HTML.',
  },
  {
    name: 'bypass-security-trust',
    re: /\bbypassSecurityTrust\w*\s*\(/,
    why: 'DomSanitizer.bypassSecurityTrust* defeats Angular escaping.',
  },
  {
    name: 'exec-command',
    re: /document\.execCommand\b/,
    why: 'execCommand is a legacy rich-text editor surface.',
  },
  {
    name: 'contenteditable-true',
    re: /contenteditable\s*=\s*["']true["']/i,
    why: 'contenteditable="true" enables rich-text input (and HTML paste).',
  },
  {
    name: 'class-attribute-interpolation',
    re: /class\s*=\s*"[^"]*\{\{/,
    why: 'Interpolating into a class attribute lets data invent new class names. Use [class.X] toggles with literal class names instead.',
  },
  {
    name: 'whole-attribute-class-binding',
    re: /\[class\]\s*=/,
    why: '[class]="…" assigns the whole class attribute from data. Use [class.X] literal toggles.',
  },
  {
    name: 'whole-attribute-style-binding',
    re: /\[style\]\s*=/,
    why: '[style]="…" lets data set arbitrary inline styles. Use [style.X] literal toggles.',
  },
  {
    name: 'attr-style-binding',
    re: /\[attr\.style\]\s*=/,
    why: '[attr.style] is the same hole as [style].',
  },
  {
    name: 'dynamic-icon-name-interpolation',
    re: /\{\{\s*[^}]*\.icon[^}]*\}\}/,
    why: 'Dynamic icon name interpolation re-introduces a font-glyph data path. Icons must come from a literal CSS class.',
  },
  {
    name: 'material-symbols-in-typescript',
    re: /Material Symbols/,
    // .scss / .css files are excluded below; this check applies to .ts only.
    why: 'Material Symbols ligature names should not appear in TypeScript notes files (icons are CSS-only).',
  },
]

/** File extensions we scan. */
const SCANNABLE_EXTS: readonly string[] = ['.ts', '.html', '.scss']

/** Files that the material-symbols check should skip — only .ts files
 *  must avoid the string; .scss may legitimately reference it. */
const MATERIAL_SYMBOLS_TS_ONLY = (file: string): boolean => file.endsWith('.ts')

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      out.push(...listFiles(full))
    } else if (
      SCANNABLE_EXTS.some(ext => entry.endsWith(ext))
      // Exclude spec files themselves — they intentionally contain the
      // forbidden substrings as regex literals / docstrings.
      && !entry.endsWith('.spec.ts')
    ) {
      out.push(full)
    }
  }
  return out
}

type Violation = {
  file: string
  line: number
  column: number
  pattern: string
  why: string
  snippet: string
}

function scanFile(file: string): Violation[] {
  const text = readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)
  const violations: Violation[] = []
  for (const { name, re, why } of FORBIDDEN_PATTERNS) {
    // material-symbols rule only applies to .ts files
    if (name === 'material-symbols-in-typescript' && !MATERIAL_SYMBOLS_TS_ONLY(file)) continue
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(lines[i])
      if (m) {
        violations.push({
          file,
          line: i + 1,
          column: (m.index ?? 0) + 1,
          pattern: name,
          why,
          snippet: lines[i].slice(Math.max(0, (m.index ?? 0) - 8), (m.index ?? 0) + m[0].length + 16),
        })
      }
    }
  }
  return violations
}

describe('notes feature — HTML escape safety', () => {
  const scanRoots = SCAN_ROOTS.filter(p => existsSync(p))

  it('finds at least one notes source file (sanity)', () => {
    const files = scanRoots.flatMap(listFiles)
    expect(files.length).toBeGreaterThan(0)
  })

  it('contains no forbidden patterns in any notes source file', () => {
    const files = scanRoots.flatMap(listFiles)
    const violations: Violation[] = []
    for (const f of files) {
      violations.push(...scanFile(f))
    }
    if (violations.length > 0) {
      const lines = violations.map(v =>
        `  ${v.file}:${v.line}:${v.column}  [${v.pattern}]  "${v.snippet.trim()}"\n    why: ${v.why}`
      )
      const message = `\nFound ${violations.length} forbidden pattern(s) in notes source files:\n${lines.join('\n')}\n`
      expect.fail(message)
    }
    expect(violations).toEqual([])
  })
})
