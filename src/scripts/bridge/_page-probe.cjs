// For each path: report whether the cell has a website page (decoration
// `visual:website:page` → htmlSig that resolves), or a legacy context page,
// or nothing. Tells us if dolphin/susan pages are intact vs my render change.
//   node scripts/bridge/_page-probe.cjs howard dolphin dolphin/model susan susan/family-support
const WebSocket = require('ws')
let c = 0
const send = (req) => new Promise((res, rej) => {
  const ws = new WebSocket('ws://localhost:2401'); const id = 'p' + (++c)
  const t = setTimeout(() => { ws.close(); rej(new Error('timeout')) }, 15000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', r => { clearTimeout(t); res(JSON.parse(String(r))); ws.close() })
  ws.on('error', e => { clearTimeout(t); rej(e) })
})
;(async () => {
  for (const p of process.argv.slice(2)) {
    const segs = p.split('/').filter(Boolean)
    const la = await send({ op: 'layer-at', segments: segs })
    if (!la.ok) { console.log(`/${p}: layer ERR ${la.error}`); continue }
    const slots = Object.keys(la.data || {})
    const decs = Array.isArray(la.data.decorations) ? la.data.decorations : []
    const ctx = Array.isArray(la.data.context) ? la.data.context : []
    let pageVia = 'NONE'
    let htmlOk = '-'
    // check decorations for visual:website:page
    for (const d of decs) {
      try {
        const rec = JSON.parse((await send({ op: 'get-resource', sig: d })).data.text)
        if (rec.kind === 'visual:website:page') {
          pageVia = 'decoration'
          const hs = rec.payload && rec.payload.htmlSig
          const hr = await send({ op: 'get-resource', sig: hs })
          htmlOk = hr.ok ? (hr.data.text ? hr.data.text.slice(0, 15) : 'bin') : 'MISSING'
          break
        }
      } catch (e) { /* skip */ }
    }
    if (pageVia === 'NONE' && ctx.length) {
      for (const s of ctx) {
        const hr = await send({ op: 'get-resource', sig: s })
        if (hr.ok && /^\s*(<!doctype|<html|<svg)/i.test(hr.data.text || '')) { pageVia = 'context'; htmlOk = (hr.data.text || '').slice(0, 15); break }
      }
    }
    console.log(`/${p}: page=${pageVia} html=${htmlOk}  [slots: ${slots.join(',')}] decs=${decs.length} ctx=${ctx.length}`)
  }
})().catch(e => { console.error(e.message); process.exit(1) })
