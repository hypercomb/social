// Verifies that every Material Symbols ligature the UI renders is present in
// the subset shipped to each shell. The icon font is subset to ~151 of ~3000
// glyphs (397K instead of 3.9MB), so an icon added to a template WITHOUT
// rerunning scripts/fetch-fonts.cjs renders as its own NAME, in system-ui —
// which reads as a layout bug rather than as a missing font.
//
//   node scripts/check-icon-subset.cjs        # exits 1 if any shell is stale
const fs = require('fs'), path = require('path')

const REPO = path.resolve(__dirname, '..')
const SHELLS = [
  'hypercomb-web/public/fonts',
  'hypercomb-shim/public/fonts',
  'hypercomb-dev/public/fonts',
]

const wanted = require('./icon-names.cjs')
let bad = false

for (const shell of SHELLS) {
  const listFile = path.join(REPO, shell, 'icons.txt')
  if (!fs.existsSync(listFile)) {
    console.error(`MISSING  ${shell}/icons.txt — run scripts/fetch-fonts.cjs`)
    bad = true
    continue
  }
  const have = new Set(fs.readFileSync(listFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean))
  const missing = wanted.filter(n => !have.has(n))
  if (missing.length) {
    console.error(`STALE    ${shell} — ${missing.length} icon(s) not in the shipped subset:`)
    for (const m of missing) console.error(`           ${m}`)
    bad = true
  } else {
    console.log(`ok       ${shell}  (${have.size} icons)`)
  }
}

if (bad) {
  console.error('\nRegenerate the affected shell, e.g.:')
  console.error('  node scripts/fetch-fonts.cjs hypercomb-web/public/fonts inter material-symbols')
  process.exit(1)
}
