const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'
let c = 0
const send = req => new Promise((res, rej) => {
  const ws = new WebSocket(BRIDGE, { maxPayload: 64 * 1024 * 1024 })
  const t = setTimeout(() => { try { ws.close() } catch {}; rej(new Error('timeout')) }, 30000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id: `v-${Date.now()}-${++c}` })))
  ws.on('message', r => { clearTimeout(t); try { res(JSON.parse(String(r))) } catch (e) { rej(e) }; try { ws.close() } catch {} })
  ws.on('error', e => { clearTimeout(t); rej(e) })
})
const ROOT = 'moose-on-the-loose'
async function names(seg) {
  const l = await send({ op: 'layer-at', segments: seg })
  if (!l.ok) return []
  const out = []
  for (const s of (l.data.children || [])) {
    const r = await send({ op: 'get-resource', sig: s })
    if (r.ok) { try { out.push(JSON.parse(r.data.text).name) } catch {} }
  }
  return out
}
async function marks(seg) {
  const l = await send({ op: 'layer-at', segments: seg })
  const out = []
  for (const s of ((l.ok && l.data.decorations) || [])) {
    const r = await send({ op: 'get-resource', sig: s })
    if (!r.ok) continue
    try { const d = JSON.parse(r.data.text); if (d.kind === 'tag') out.push(d.payload.name) } catch {}
  }
  return out
}
async function notes(seg) {
  const r = await send({ op: 'note-list', segments: seg })
  const items = r.ok ? (Array.isArray(r.data) ? r.data : (r.data.notes || [])) : []
  return items.map(n => String(n.text || '').split('\n')[0].slice(0, 72))
}
;(async () => {
  console.log('root children :', (await names([])).join(', '))
  console.log(ROOT + '  :', (await names([ROOT])).join(', '))
  const coi = [ROOT, 'people', 'mark-carney', 'conflicts-of-interest']
  const cs = await names(coi)
  console.log('conflicts (' + cs.length + ') :', cs.join(', '))
  const co = await names([ROOT, 'companies'])
  console.log('companies (' + co.length + ') :', co.join(', '))
  const cap = await names([ROOT, 'miro-board'])
  console.log('captures  (' + cap.length + ') :', cap.join(', '))
  for (const p of [[ROOT], [ROOT, 'people', 'mark-carney'], [...coi, 'ukraine-industrial-reconstruction'], [ROOT, 'companies', 'vestas'], [ROOT, 'companies', 'brookfield']]) {
    console.log('\n/' + p.join('/'))
    console.log('  marks:', (await marks(p)).join(', ') || '(none)')
    for (const n of await notes(p)) console.log('  note :', n)
  }
  // face check
  for (const p of [[ROOT, 'people', 'mark-carney'], [ROOT, 'miro-board', 'capture-ukraine-tata']]) {
    const l = await send({ op: 'layer-at', segments: p })
    const sig = (l.ok && l.data.properties || [])[0]
    if (!sig) { console.log('\nface /' + p.join('/') + ': NONE'); continue }
    const r = await send({ op: 'get-resource', sig })
    const props = JSON.parse(r.data.text)
    const img = props.small && props.small.image
    const bytes = img ? await send({ op: 'get-resource', sig: img }) : null
    const len = bytes && bytes.ok ? (bytes.data.base64 ? Buffer.from(bytes.data.base64, 'base64').length : (bytes.data.text || '').length) : 0
    console.log('\nface /' + p.join('/') + ': ' + String(img).slice(0, 12) + ' (' + Math.round(len / 1024) + 'kb readable)')
  }
})().catch(e => { console.error(e); process.exit(2) })
