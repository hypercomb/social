// Render susan pages to PNG for verification. Inlines resource: refs as
// data-URIs with correct mime (SVG vs webp/png/jpg) since Playwright has no
// /@resource SW.  node _susan-shoot.cjs susan susan/its-allowed-heavy ...
const WebSocket = require('ws'); const fs = require('fs')
const { chromium } = require('playwright')
let c = 0
const send = (req) => new Promise((res, rej) => {
  const ws = new WebSocket('ws://localhost:2401'); const id = 'z' + (++c)
  const t = setTimeout(() => { ws.close(); rej(new Error('timeout')) }, 20000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', r => { clearTimeout(t); res(JSON.parse(String(r))); ws.close() })
  ws.on('error', e => { clearTimeout(t); rej(e) })
})
function mime(bytes) {
  if (bytes[0] === 0x3c) return 'image/svg+xml'
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp'
  return 'application/octet-stream'
}
async function pageHtml(segs) {
  const la = await send({ op: 'layer-at', segments: segs })
  const dsig = (la.data.decorations || [])[0]
  if (!dsig) throw new Error('no decoration /' + segs.join('/'))
  const drec = JSON.parse((await send({ op: 'get-resource', sig: dsig })).data.text)
  let html = (await send({ op: 'get-resource', sig: drec.payload.htmlSig })).data.text
  const sigs = [...new Set([...html.matchAll(/resource:([0-9a-f]{64})/g)].map(m => m[1]))]
  for (const sig of sigs) {
    const r = await send({ op: 'get-resource', sig, text: 'base64' })
    const bytes = Buffer.from(r.data.base64 || Buffer.from(r.data.text || '').toString('base64'), 'base64')
    const uri = 'data:' + mime(bytes) + ';base64,' + bytes.toString('base64')
    html = html.replace(new RegExp('resource:' + sig + '/[^"\'\\s)]*', 'g'), uri)
  }
  return html
}
;(async () => {
  const paths = process.argv.slice(2)
  const browser = await chromium.launch({ channel: 'chrome' })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 2 })
  fs.mkdirSync('scripts/bridge/_susan_assets', { recursive: true })
  for (const p of paths) {
    const segs = p.split('/').filter(Boolean)
    const html = await pageHtml(segs)
    const page = await ctx.newPage()
    await page.setContent(html, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    const out = 'scripts/bridge/_susan_assets/shot_' + segs.join('_') + '.png'
    await page.screenshot({ path: out })
    console.log('shot /' + segs.join('/'), '->', out)
    await page.close()
  }
  await browser.close()
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
