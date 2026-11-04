// The pages' own check: what has to hold for the presentation to be whole.
//
//   node scripts/bridge/living-presentation/blocks/check.cjs            # the structure
//   node scripts/bridge/living-presentation/blocks/check.cjs --render   # and each page in a browser (Playwright;
//                                                                       # CHROMIUM=<path> picks the browser binary)
//
// It fails (exit 1) on the first kind of break it finds and names every case:
//   - a tour scene placed on no tile, or on two;
//   - a scene's narration said on more than one page (no idea is said twice);
//   - a page that asks another host for anything (a src, a url(), an import) —
//     only a link the reader follows may leave;
//   - a `resource:<sig>` no medium answers, or a medium whose bytes are not its name;
//   - a word link (`./word`) no child page answers, or an ancestor link to no page;
//   - with --render: a script error, a page wider than a phone, or plate text outside its frame.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { buildBlocks } = require('./build.cjs')
const tour = require('./tour.cjs')
const { sentencesOf } = require('../../../presentation/timing.cjs')

const problems = []
const fail = (what) => problems.push(what)

const placed = tour.placed()
for (let n = 1; n <= tour.T.scenes.length; n++) {
  const times = placed.filter(x => x === n).length
  if (times !== 1) fail(`scene ${n} is placed on ${times} tiles, not one`)
}

const { blocks, media } = buildBlocks()
const routes = new Set(blocks.map(b => b.route.join('/')))
const sigs = new Set(media.map(m => m.sig))

for (const m of media) {
  const sig = crypto.createHash('sha256').update(fs.readFileSync(m.path)).digest('hex')
  if (sig !== m.sig) fail(`${m.name}: its bytes are ${sig}, not ${m.sig}`)
}

for (const b of blocks) {
  const at = b.route.join('/')
  const html = b.page
  for (const m of html.matchAll(/resource:([0-9a-f]{64})/g)) if (!sigs.has(m[1])) fail(`${at}: names resource:${m[1].slice(0, 12)}…, which no medium answers`)
  for (const m of html.matchAll(/\b(?:src|data-src)="(https?:|\/\/)[^"]*"/g)) fail(`${at}: loads ${m[0]} from another host`)
  for (const m of html.matchAll(/url\(\s*["']?(https?:|\/\/)[^)]*\)/g)) fail(`${at}: loads ${m[0]} from another host`)
  for (const m of html.matchAll(/@import|<link\b[^>]*rel="stylesheet"/g)) fail(`${at}: imports a stylesheet (${m[0]})`)
  for (const m of html.matchAll(/href="\.\/([^"/]+)"/g)) if (!routes.has(`${at}/${m[1]}`)) fail(`${at}: links ./${m[1]}, which has no page`)
  for (const m of html.matchAll(/href="\/([^"]+)"/g)) if (!routes.has(m[1])) fail(`${at}: links /${m[1]}, which has no page`)
}

// No scene's narration on two pages.
for (const n of placed) {
  // A scene is shown a sentence at a time; its longest sentence is the probe.
  // a page may tell the scene in its own words (figures[n].say, a real hive in
  // place of the tour's demo-hive clip)
  const own = Object.values(require('./content.cjs')).map(bl => bl.figures?.[n]?.say).find(Boolean)
  const said = sentencesOf(tour.T.captionOf(own || tour.T.scenes.find(s => s.n === n).say)).sort((a, b) => b.length - a.length)[0]
  const probe = JSON.stringify(said).slice(1, 80)
  const on = blocks.filter(b => b.page.includes(probe)).map(b => b.route.join('/'))
  if (on.length !== 1) fail(`scene ${n}'s narration is on ${on.length} pages${on.length ? ` (${on.join(', ')})` : ''}`)
}

const report = () => {
  if (problems.length) { console.error(problems.map(p => `✗ ${p}`).join('\n')); console.error(`\n${problems.length} problem(s).`); process.exit(1) }
  console.log(`✓ ${blocks.length} pages, ${media.length} media, ${placed.length} scenes each said once; every link, medium and host holds.`)
}

if (!process.argv.includes('--render')) report()
else {
  const os = require('os')
  const { preview, fileOf } = require('./preview.cjs')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'living-check-'))
  ;(async () => {
    const { chromium } = require('playwright')
    const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
    try {
      preview(dir)
      for (const width of [1280, 390]) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
        const page = await ctx.newPage()
        let errors = []
        page.on('pageerror', e => errors.push(e.message))
        for (const b of blocks) {
          const at = b.route.join('/')
          errors = []
          await page.goto('file://' + path.join(dir, fileOf(b.route)))
          await page.waitForTimeout(150)
          for (const e of errors) fail(`${at} at ${width}px: ${e}`)
          const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
          if (wide > 0) fail(`${at} at ${width}px: the page is ${wide}px wider than the screen`)
          if (width === 1280) {
            const spill = await page.evaluate(() => [...document.querySelectorAll('.fig.plate svg')].flatMap(svg => {
              const v = svg.viewBox.baseVal
              return [...svg.querySelectorAll('text')].filter(t => { const r = t.getBBox(); return r.x < v.x || r.y < v.y || r.x + r.width > v.x + v.width || r.y + r.height > v.y + v.height }).map(t => t.textContent)
            }))
            for (const t of spill) fail(`${at}: plate text "${t}" leaves its frame`)
          }
        }
        await ctx.close()
      }
    } finally {
      await browser.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
    report()
  })().catch(e => { console.error(e); process.exit(1) })
}
