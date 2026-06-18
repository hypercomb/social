// Render Howard pages to PNG for visual verification.
// Fetches each page's HTML from the bridge, inlines `resource:<sig>` image
// refs as data-URIs (Playwright has no /@resource SW), and screenshots via
// system Chrome.   node scripts/bridge/_howard-shoot.cjs howard howard/team howard/team/susan
const WebSocket = require('ws')
const fs = require('fs')
const { chromium } = require('playwright')

let c = 0
const send = (req) => new Promise((res, rej) => {
  const ws = new WebSocket('ws://localhost:2401'); const id = 's' + (++c)
  const t = setTimeout(() => { ws.close(); rej(new Error('timeout')) }, 20000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', r => { clearTimeout(t); res(JSON.parse(String(r))); ws.close() })
  ws.on('error', e => { clearTimeout(t); rej(e) })
})

async function pageHtml(segs) {
  const la = await send({ op: 'layer-at', segments: segs })
  const dsig = (la.data.decorations || [])[0]
  if (!dsig) throw new Error('no decoration at /' + segs.join('/'))
  const drec = JSON.parse((await send({ op: 'get-resource', sig: dsig })).data.text)
  let html = (await send({ op: 'get-resource', sig: drec.payload.htmlSig })).data.text
  // inline resource: refs as data URIs
  const sigs = [...new Set([...html.matchAll(/resource:([0-9a-f]{64})/g)].map(m => m[1]))]
  for (const sig of sigs) {
    const r = await send({ op: 'get-resource', sig, text: 'base64' })
    const b64 = r.data.encoding === 'base64' ? r.data.base64 : Buffer.from(r.data.text).toString('base64')
    // assume svg art (our only resource: refs)
    const dataUri = 'data:image/svg+xml;base64,' + b64
    html = html.split('resource:' + sig + '/art.svg').join(dataUri)
    html = html.split('resource:' + sig).join(dataUri)
  }
  return html
}

;(async () => {
  const paths = process.argv.slice(2)
  const browser = await chromium.launch({ channel: 'chrome' })
  const ctx = await browser.newContext({ viewport: { width: 1240, height: 940 }, deviceScaleFactor: 2 })
  for (const p of paths) {
    const segs = p.split('/').filter(Boolean)
    const html = await pageHtml(segs)
    const page = await ctx.newPage()
    await page.setContent(html, { waitUntil: 'networkidle' })
    await page.waitForTimeout(700)
    const label = segs.join('_')
    const out = 'scripts/bridge/_howard_assets/shot_' + label + '.png'
    await page.screenshot({ path: out })
    console.log('shot', '/' + segs.join('/'), '->', out)
    await page.close()
  }
  await browser.close()
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
