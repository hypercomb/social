import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ─── Types ──────────────────────────────────────────────

type Layer =
  | 'core'
  | 'essentials'
  | 'shared'
  | 'web'
  | 'dev'
  | 'dcp'
  | 'legacy'
  | 'byte-test'

interface Violation {
  file: string
  line: number
  layer: Layer
  specifier: string
  importText: string
  ruleDescription: string
}

interface LayerRule {
  allowed: (specifier: string) => boolean
  description: string
}

// ─── Layer Classification ───────────────────────────────

const LAYER_MAP: Record<string, Layer> = {
  'hypercomb-core': 'core',
  'hypercomb-essentials': 'essentials',
  'hypercomb-shared': 'shared',
  'hypercomb-web': 'web',
  'hypercomb-dev': 'dev',
  'diamond-core-processor': 'dcp',
  'hypercomb-legacy': 'legacy',
  'hypercomb-byte-test': 'byte-test',
}

const SELF_PREFIX: Partial<Record<Layer, string>> = {
  core: '@hypercomb/core',
  essentials: '@hypercomb/essentials',
  shared: '@hypercomb/shared',
}

function classifyFile(relPath: string): Layer | null {
  const normalized = relPath.split(/[\\/]/)[0]
  return LAYER_MAP[normalized] ?? null
}

function isSelfReference(layer: Layer, specifier: string): boolean {
  const prefix = SELF_PREFIX[layer]
  return prefix != null && (specifier === prefix || specifier.startsWith(prefix + '/'))
}

// ─── Layer Constraint Rules ─────────────────────────────

const rules: Record<Layer, LayerRule> = {
  core: {
    allowed: () => false,
    description: '@hypercomb/core must have zero external imports',
  },
  essentials: {
    allowed: (s) =>
      s === '@hypercomb/core' ||
      s.startsWith('@hypercomb/core/') ||
      s === 'pixi.js' ||
      s.startsWith('pixi.js/') ||
      s === 'nostr-tools' ||
      s.startsWith('nostr-tools/'),
    description:
      '@hypercomb/essentials may only import @hypercomb/core, pixi.js, nostr-tools',
  },
  shared: {
    allowed: (s) =>
      s === '@hypercomb/core' ||
      s.startsWith('@hypercomb/core/') ||
      s.startsWith('@angular/'),
    description: 'hypercomb-shared may only import @hypercomb/core and @angular/*',
  },
  web: {
    allowed: (s) =>
      !s.startsWith('@hypercomb/essentials'),
    description: 'hypercomb-web must NOT import @hypercomb/essentials directly',
  },
  dev: {
    allowed: () => true,
    description: 'hypercomb-dev may import everything (sandbox)',
  },
  dcp: {
    allowed: (s) =>
      !s.startsWith('@hypercomb/essentials') &&
      !s.startsWith('@hypercomb/shared'),
    description:
      'diamond-core-processor must NOT import @hypercomb/essentials or @hypercomb/shared',
  },
  legacy: {
    allowed: (s) => !s.startsWith('@hypercomb/'),
    description: 'hypercomb-legacy must not import @hypercomb/*',
  },
  'byte-test': {
    allowed: (s) =>
      s === '@hypercomb/core' || s.startsWith('@hypercomb/core/'),
    description: 'hypercomb-byte-test may only import @hypercomb/core',
  },
}

// ─── Import Extraction ──────────────────────────────────

interface ExtractedImport {
  specifier: string
  line: number
  text: string
}

// Matches: import ... from 'specifier'  |  import 'specifier'
const STATIC_IMPORT_RE =
  /^\s*import\s+(?:type\s+)?(?:(?:\{[^}]*\}|[\w*]+(?:\s+as\s+\w+)?|\*\s+as\s+\w+)\s+from\s+)?['"]([^'"]+)['"]/gm

// Matches: export ... from 'specifier'
const REEXPORT_RE =
  /^\s*export\s+(?:type\s+)?(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s+from\s+['"]([^'"]+)['"]/gm

// Matches: import('specifier')  — only string literals, not variables
const DYNAMIC_IMPORT_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g

function extractImports(content: string): ExtractedImport[] {
  const results: ExtractedImport[] = []
  const lines = content.split(/\r?\n/)

  for (const regex of [STATIC_IMPORT_RE, REEXPORT_RE, DYNAMIC_IMPORT_RE]) {
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(content)) !== null) {
      const specifier = match[1]
      const lineNum = content.substring(0, match.index).split(/\r?\n/).length
      results.push({
        specifier,
        line: lineNum,
        text: lines[lineNum - 1]?.trim() ?? '',
      })
    }
  }

  return results
}

function isBareSpecifier(s: string): boolean {
  return !s.startsWith('.') && !s.startsWith('/')
}

function isNodeBuiltin(s: string): boolean {
  return s.startsWith('node:')
}

// Build tooling files live alongside source but aren't part of the
// published package. They legitimately import tsup, esbuild, ts-morph, etc.
const TOOLING_PATTERNS = [
  /\/tsup\.config\.ts$/,
  /\/scripts\//,
  /\/eslint\.config\.\w+$/,
]

function isToolingFile(relPath: string): boolean {
  return TOOLING_PATTERNS.some(p => p.test(relPath))
}

// ─── File Walker ────────────────────────────────────────

const EXCLUDE = new Set([
  'node_modules',
  'dist',
  '.angular',
  '.claude',
  'out-tsc',
])

function walkTs(dir: string): string[] {
  const results: string[] = []

  function walk(d: string) {
    for (const entry of readdirSync(d)) {
      if (EXCLUDE.has(entry)) continue
      const full = join(d, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        walk(full)
      } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
        results.push(full)
      }
    }
  }

  walk(dir)
  return results
}

// ─── Report ─────────────────────────────────────────────

function printReport(
  violations: Violation[],
  filesByLayer: Map<Layer, number>,
) {
  const layerOrder: Layer[] = [
    'core',
    'essentials',
    'shared',
    'web',
    'dev',
    'dcp',
    'legacy',
    'byte-test',
  ]

  const byLayer = new Map<Layer, Violation[]>()
  for (const v of violations) {
    const arr = byLayer.get(v.layer) ?? []
    arr.push(v)
    byLayer.set(v.layer, arr)
  }

  console.log('\n=== Import Audit Report ===\n')

  for (const layer of layerOrder) {
    const count = filesByLayer.get(layer) ?? 0
    const layerViolations = byLayer.get(layer) ?? []
    const label = layerViolations.length === 0
      ? `${layer} (${count} files, 0 violations)  ok`
      : `${layer} (${count} files, ${layerViolations.length} violation${layerViolations.length > 1 ? 's' : ''})`

    console.log(label)

    for (const v of layerViolations) {
      console.log(`\n  ${v.file}:${v.line}`)
      console.log(`    ${v.importText}`)
      console.log(`    Rule: ${v.ruleDescription}`)
    }

    if (layerViolations.length > 0) console.log()
  }

  const totalFiles = [...filesByLayer.values()].reduce((a, b) => a + b, 0)
  console.log('\n--- SUMMARY ---')
  console.log(`Total files scanned: ${totalFiles}`)
  console.log(`Total violations: ${violations.length}`)
  console.log(`Status: ${violations.length === 0 ? 'CLEAN' : 'FAILED'}`)
  console.log()
}

// ─── Main ───────────────────────────────────────────────

function main() {
  const srcRoot = resolve(__dirname, '..')
  const violations: Violation[] = []
  const filesByLayer = new Map<Layer, number>()

  const files = walkTs(srcRoot)

  for (const file of files) {
    const relPath = relative(srcRoot, file).replace(/\\/g, '/')
    const layer = classifyFile(relPath)
    if (!layer) continue
    if (isToolingFile(relPath)) continue

    filesByLayer.set(layer, (filesByLayer.get(layer) ?? 0) + 1)

    const content = readFileSync(file, 'utf8')
    const imports = extractImports(content)

    for (const imp of imports) {
      if (!isBareSpecifier(imp.specifier)) continue
      if (isNodeBuiltin(imp.specifier)) continue
      if (isSelfReference(layer, imp.specifier)) continue

      const rule = rules[layer]
      if (!rule.allowed(imp.specifier)) {
        violations.push({
          file: relPath,
          line: imp.line,
          layer,
          specifier: imp.specifier,
          importText: imp.text,
          ruleDescription: rule.description,
        })
      }
    }
  }

  printReport(violations, filesByLayer)
  process.exit(violations.length > 0 ? 1 : 0)
}

main()
