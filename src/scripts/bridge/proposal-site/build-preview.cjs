// Render a proposal site to local files for review before stamping it.
//   node scripts/bridge/proposal-site/build-preview.cjs <proposal>   (e.g. nlnet)
// Output: <repo>/.tmp/proposal-site-<proposal>/  (gitignored scratch)

const fs = require('fs')
const path = require('path')
const { renderPage } = require('./engine.cjs')

const name = process.argv[2]
if (!name) { console.error('usage: build-preview.cjs <proposal>'); process.exit(1) }
const site = require('./load-site.cjs').loadSite(name)

const OUT = path.join(__dirname, '..', '..', '..', '..', '.tmp', `proposal-site-${name}`)
fs.mkdirSync(OUT, { recursive: true })
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.html')) fs.rmSync(path.join(OUT, f))

for (const page of site.pages) {
  const html = renderPage(site, page, 'preview')
  fs.writeFileSync(path.join(OUT, `${page.slug || 'index'}.html`), html)
  console.log(`  ${(page.slug || '(root)').padEnd(14)} ${String(html.length).padStart(6)}b`)
}
console.log(`\n${site.pages.length} pages → ${OUT}`)
