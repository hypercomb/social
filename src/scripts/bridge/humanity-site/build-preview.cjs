// Build a standalone, browsable preview of the Humanity Centres site for
// visual review BEFORE stamping into the hive.
//   node scripts/bridge/humanity-site/build-preview.cjs
// Output: scripts/bridge/humanity-site/preview/{index.html, <slug>.html, chrome.css, assets/*}

const fs = require('fs')
const path = require('path')
const { CSS, renderPage, slugOf } = require('./engine.cjs')
const { PAGES, LABELS } = require('./pages.cjs')

const OUT = path.join(__dirname, 'preview')
const ASSETS_SRC = path.join(__dirname, '..', '_humanity_assets')

// Clear prior page outputs (tolerant: dir may be a live cwd on Windows).
try {
  for (const f of fs.existsSync(OUT) ? fs.readdirSync(OUT) : []) {
    if (f.endsWith('.html') || f === 'chrome.css') { try { fs.rmSync(path.join(OUT, f)) } catch {} }
  }
} catch {}
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true })

// chrome.css
fs.writeFileSync(path.join(OUT, 'chrome.css'), CSS)

// copy webp assets
for (const f of fs.readdirSync(ASSETS_SRC)) {
  if (f.endsWith('.webp')) fs.copyFileSync(path.join(ASSETS_SRC, f), path.join(OUT, 'assets', f))
}

// render every page
let count = 0
for (const page of PAGES) {
  const html = renderPage(page, 'preview', LABELS)
  const slug = slugOf(page.segments)
  fs.writeFileSync(path.join(OUT, `${slug}.html`), html)
  count++
}

console.log(`Built ${count} pages → ${OUT}`)
console.log('Open preview/index.html')
