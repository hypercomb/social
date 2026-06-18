const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'
let c = 0
const send = (req) => new Promise((res, rej) => {
  const ws = new WebSocket(BRIDGE)
  const t = setTimeout(() => { ws.close(); rej(new Error('timeout')) }, 15000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id: `v-${Date.now()}-${++c}` })))
  ws.on('message', r => { clearTimeout(t); try { res(JSON.parse(String(r))) } catch (e) { rej(e) } ws.close() })
  ws.on('error', e => { clearTimeout(t); rej(e) })
})
const CHROME = 'e5f6e656b58dcd13'
;(async () => {
  for (const segs of [['humanity-centres'], ['humanity-centres','places','types','storefronts']]) {
    console.log(`\n=== /${segs.join('/')} ===`)
    const layer = await send({ op: 'layer-at', segments: segs })
    const decs = layer.ok ? (layer.data?.decorations || []) : null
    console.log('decorations slot:', Array.isArray(decs) ? `${decs.length} sig(s)` : `(layer-at: ${layer.error||'no decorations field'})`)
    let decSig = Array.isArray(decs) && decs.length ? decs[decs.length-1] : null
    if (!decSig) { console.log('  no decoration sig found in layer'); continue }
    const dec = await send({ op: 'get-resource', sig: decSig })
    const decJson = JSON.parse(dec.data.text || Buffer.from(dec.data.base64,'base64').toString())
    console.log('  decoration kind:', decJson.kind, '| htmlSig:', String(decJson.payload?.htmlSig).slice(0,16))
    const htmlSig = decJson.payload.htmlSig
    const html = await send({ op: 'get-resource', sig: htmlSig })
    const txt = html.data.text || Buffer.from(html.data.base64,'base64').toString()
    console.log('  html starts:', txt.slice(0,40).replace(/\n/g,' '))
    console.log('  html has hc-site wrapper:', txt.includes('<div class="hc-site">'))
    console.log('  html references chrome resource:', /resource:[0-9a-f]{64}\/chrome\.css/.test(txt))
    console.log('  html hero resource img:', /background-image:url\('resource:[0-9a-f]{64}'\)/.test(txt))
  }
  console.log('\n=== chrome.css resource ===')
  const css = await send({ op: 'get-resource', sig: CHROME })
  const csstxt = css.ok ? (css.data.text || Buffer.from(css.data.base64,'base64').toString()) : null
  console.log('chrome resolves:', css.ok, '| scoped:', csstxt ? csstxt.includes('.hc-site .card') : false, '| bytes:', csstxt?csstxt.length:0)
})().catch(e => { console.error('FATAL', e.message); process.exit(2) })
