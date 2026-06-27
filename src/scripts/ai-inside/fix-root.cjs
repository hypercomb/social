// Surgically dedupe root.children (preserving exact current sigs) and force a
// synchronize repaint on the connected renderer.
const WebSocket = require('ws')
let ws, n = 0; const pend = new Map()
function rpc(req, to=12000){return new Promise(res=>{const id='fr-'+(++n);const t=setTimeout(()=>{pend.delete(id);res({ok:false,error:'timeout'})},to);pend.set(id,m=>{clearTimeout(t);res(m)});ws.send(JSON.stringify({...req,id}))})}
ws = new WebSocket('ws://localhost:2401')
ws.on('message', raw => { let m; try { m = JSON.parse(String(raw)) } catch { return } const cb = pend.get(m.id); if (cb) { pend.delete(m.id); cb(m) } })
ws.on('open', async () => {
  let r = await rpc({ op: 'layer-at', segments: [] })
  if (!r.ok) { console.log('layer-at ERR', r.error); process.exit(1) }
  const children = Array.isArray(r.data.children) ? r.data.children : []
  const unique = [...new Set(children)]
  console.log('root children: total', children.length, ', unique', unique.length, ', name', JSON.stringify(r.data.name))

  if (unique.length !== children.length) {
    const set = await rpc({ op: 'bag-set', segments: [], slot: 'children', cells: unique })
    console.log('bag-set root.children →', set.ok ? `ok (count ${set.data.count})` : 'FAIL ' + set.error)
  } else {
    console.log('no duplicate — root.children untouched')
  }

  // force a synchronize repaint: a no-op remove still calls hypercomb.act()
  const rep = await rpc({ op: 'remove', segments: [], cells: ['__repaint_trigger_noop__'] })
  console.log('repaint trigger (no-op remove):', rep.ok ? 'ok' : 'FAIL ' + rep.error)

  // verify
  r = await rpc({ op: 'layer-at', segments: [] })
  const after = Array.isArray(r.data.children) ? r.data.children : []
  console.log('AFTER: root children total', after.length, ', unique', [...new Set(after)].length)
  const ai = await rpc({ op: 'layer-at', segments: ['ai-inside'] })
  console.log('ai-inside still intact:', ai.ok ? `yes (${ai.data.children ? ai.data.children.length : 0} companies)` : 'NO ' + ai.error)
  ws.close(); process.exit(0)
})
ws.on('error', e => { console.log('ERR', e.message); process.exit(1) })
