#!/usr/bin/env node
// drive-youtube-embed-referrer — the embed frames must keep their referrer.
//
// WHY THIS EXISTS. YouTube's player validates the embedding page from the HTTP
// `Referer` header. The host serves `Referrer-Policy: same-origin`, which sends
// NO referrer cross-origin — so a frame that inherits the document policy gets
// "error 153 — video player configuration error" instead of a video, every
// time, on every browser. An element-level `referrerpolicy` overrides the
// document's and is the whole fix. The `origin` query term on the src is a
// DIFFERENT mechanism (postMessage addressing) and does not satisfy the check —
// that is why adding it alone left 153 in place.
//
// The refusal renders INSIDE a cross-origin iframe, so the app can never see
// it. This harness can: Playwright reads the frame's text directly.
//
//   node scripts/drive-youtube-embed-referrer.cjs
//
// Two halves:
//   1. SOURCE — every place that frames a provider embed carries the attribute.
//   2. LIVE   — under the host's real header, the attribute earns a Referer and
//               the player configures; without it, 153. Needs the network.
//               Skipped with --offline.

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const REPO = path.join(__dirname, '..')
const VIDEO = 'aqz-KE-bpKQ'          // Big Buck Bunny — Blender, embeddable
const PORT = Number(process.env.HC_EMBED_PROBE_PORT ?? 8931)
const ORIGIN = `http://localhost:${PORT}`
const HOST_POLICY = 'same-origin'    // what hypercomb.io actually sends

// Every surface that frames a provider embed, and the anchor that proves the
// frame is the embed one. Add a row when a new provider frame appears.
const EMBED_SITES = [
  {
    file: 'hypercomb-shared/ui/youtube-viewer/youtube-viewer.component.html',
    what: 'tile tap → full-screen viewer',
    find: /<iframe\b[\s\S]*?>/,
  },
  {
    file: 'hypercomb-essentials/src/diamondcoreprocessor.com/presentation/tiles/slides-view.drone.ts',
    what: 'slides player → embed slide',
    find: /createElement\('iframe'\)[\s\S]*?return frame/,
  },
]

let failures = 0
const ok = (m) => console.log(`  ok   ${m}`)
const bad = (m) => { failures++; console.log(`  FAIL ${m}`) }

function checkSource() {
  console.log('SOURCE — every embed frame carries referrerpolicy')
  for (const site of EMBED_SITES) {
    const full = path.join(REPO, site.file)
    if (!fs.existsSync(full)) { bad(`${site.file} — missing (moved? update EMBED_SITES)`); continue }
    const text = fs.readFileSync(full, 'utf8')
    const block = text.match(site.find)
    if (!block) { bad(`${site.file} — no embed frame found (update the anchor)`); continue }
    if (/referrerpolicy/i.test(block[0])) ok(`${site.what} — ${site.file}`)
    else bad(`${site.what} — ${site.file} frames YouTube with no referrerpolicy → error 153`)
  }
}

const probePage = () => `<!doctype html><meta charset=utf8><body style="margin:0;background:#111">
<iframe id=inherit src="https://www.youtube.com/embed/${VIDEO}?rel=0&origin=${encodeURIComponent(ORIGIN)}"
  style="width:49%;height:300px;border:0" allowfullscreen></iframe>
<iframe id=explicit referrerpolicy="strict-origin-when-cross-origin"
  src="https://www.youtube.com/embed/${VIDEO}?rel=0&origin=${encodeURIComponent(ORIGIN)}"
  style="width:49%;height:300px;border:0" allowfullscreen></iframe>`

async function checkLive() {
  console.log(`\nLIVE — under Referrer-Policy: ${HOST_POLICY} (the header hypercomb.io serves)`)
  const server = http.createServer((_req, res) => {
    res.setHeader('Referrer-Policy', HOST_POLICY)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(probePage())
  })
  await new Promise(r => server.listen(PORT, r))
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 340 } })
    const referers = []
    page.on('request', r => {
      if (r.url().includes('youtube.com/embed/')) referers.push(r.headers()['referer'] ?? null)
    })
    await page.goto(ORIGIN, { waitUntil: 'load' })
    await page.waitForTimeout(6000)

    const textOf = async (sel) => {
      const frame = await (await page.$(sel)).contentFrame()
      return String(await frame.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ')
    }
    const inherit = await textOf('#inherit')
    const explicit = await textOf('#explicit')

    // The control. If this ever STOPS erroring, the host header changed and
    // this harness is no longer describing reality — say so rather than pass.
    if (/153/.test(inherit)) ok('control: a frame inheriting the page policy is refused with 153')
    else bad(`control: expected 153 from the inheriting frame, got "${inherit.slice(0, 90)}" — has the header changed?`)

    if (/153/.test(explicit)) bad(`referrerpolicy frame ALSO refused: "${explicit.slice(0, 90)}"`)
    else if (explicit.length) ok(`referrerpolicy frame configured: "${explicit.slice(0, 60)}…"`)
    else bad('referrerpolicy frame rendered nothing — inconclusive')

    if (referers.some(r => r)) ok(`Referer reached YouTube: ${JSON.stringify(referers.find(r => r))}`)
    else bad('no request carried a Referer — the override did not take')
  } finally {
    await browser.close()
    server.close()
  }
}

;(async () => {
  checkSource()
  if (process.argv.includes('--offline')) console.log('\nLIVE — skipped (--offline)')
  else await checkLive()
  console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
  process.exit(failures ? 1 : 0)
})()
