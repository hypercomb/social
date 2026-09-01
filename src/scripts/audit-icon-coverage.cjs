// Audits icon coverage GENEROUSLY, against Google's official name list.
//
//   node scripts/audit-icon-coverage.cjs [codepoints-file]
//
// icon-names.cjs extracts what it can prove is an icon. That is necessarily
// incomplete: icons are also built imperatively
// (`el.className = 'mat-sym'; el.textContent = 'settings'`), assembled in
// template strings, or pulled from data tables. A name it misses renders as the
// NAME itself: the global `.mat-sym` stack ends in system-ui, so the ligature
// arrives as a readable word in the middle of the UI. (Only the icon picker,
// which re-declares `.mat-sym` with no fallback family, blanks instead.)
//
// The cost here is wildly asymmetric: an extra glyph in the subset is a few
// hundred bytes, a missing one is an invisible hole in the UI. So this scans
// EVERY string literal in the UI source, keeps the ones that are real Material
// Symbol names, and reports what the shipped subset lacks. Feed the union back
// into icons.txt rather than trying to make the extractor clever.
const fs = require('fs'), path = require('path')

const REPO = path.resolve(__dirname, '..')
const ROOTS = ['hypercomb-shared', 'hypercomb-web/src', 'hypercomb-dev/src', 'hypercomb-essentials/src']
const EXT = new Set(['.html', '.ts', '.scss'])

const cpFile = process.argv[2] || path.join(REPO, 'scripts', 'material-symbols.codepoints')
if (!fs.existsSync(cpFile)) {
  console.error(`no codepoints file at ${cpFile}`)
  console.error('fetch it from google/material-design-icons (variablefont/*.codepoints)')
  process.exit(2)
}
const official = new Set(
  fs.readFileSync(cpFile, 'utf8').trim().split('\n').map(l => l.split(' ')[0]).filter(Boolean))

const shipped = new Set(
  fs.readFileSync(path.join(REPO, 'hypercomb-web/public/fonts/icons.txt'), 'utf8')
    .trim().split('\n').map(s => s.trim()).filter(Boolean))

function walk(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out) }
    else if (EXT.has(path.extname(e.name)) && !/\.spec\.[tj]s$/.test(e.name)) out.push(p)
  }
  return out
}

const hits = new Map()
for (const root of ROOTS) {
  for (const file of walk(path.join(REPO, root))) {
    const src = fs.readFileSync(file, 'utf8')
    // Every quoted literal, plus bare >word< element text.
    for (const m of src.matchAll(/'([a-z][a-z0-9_]{2,})'|"([a-z][a-z0-9_]{2,})"|>\s*([a-z][a-z0-9_]{2,})\s*</g)) {
      const t = m[1] || m[2] || m[3]
      if (!official.has(t) || shipped.has(t)) continue
      if (!hits.has(t)) hits.set(t, new Set())
      hits.get(t).add(path.relative(REPO, file).split(path.sep).join('/'))
    }
  }
}

const sorted = [...hits.entries()].sort((a, b) => b[1].size - a[1].size)
console.log(`shipped subset: ${shipped.size}`)
console.log(`real icon names found in source but NOT shipped: ${sorted.length}\n`)
for (const [name, files] of sorted) {
  const first = [...files][0]
  console.log(`  ${name.padEnd(26)} ${first}${files.size > 1 ? `  (+${files.size - 1} more)` : ''}`)
}
if (process.env.WRITE_UNION) {
  const union = [...new Set([...shipped, ...hits.keys()])].sort()
  fs.writeFileSync(process.env.WRITE_UNION, union.join('\n') + '\n')
  console.log(`\nwrote union of ${union.size || union.length} names to ${process.env.WRITE_UNION}`)
}
