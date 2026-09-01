// Is the branch's child hint a marker in the tile's own bag?
//   in bag  → sealSubtree FRESHENS (publish would already carry the new picture)
//   not     → 'hint-off-lineage': the seal honours the stale hint FOREVER
const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'
let n = 0
const send = (req, ms = 20000) => new Promise((res, rej) => {
  const ws = new WebSocket(BRIDGE); const id = `hc-${Date.now()}-${++n}`
  const t = setTimeout(() => { ws.close(); rej(new Error('timeout')) }, ms)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', r => { clearTimeout(t); try { res(JSON.parse(String(r))) } catch { rej(new Error('bad')) } ws.close() })
  ws.on('error', e => { clearTimeout(t); rej(e) })
})
;(async () => {
  const branch = await send({ op: 'layer-at', segments: ['susan'] })
  const hints = new Map()
  for (const sig of branch.data.children ?? []) {
    const inf = await send({ op: 'inflate', cell: sig })
    const name = inf?.data?.name
    if (name) hints.set(name, String(sig))
  }
  console.log('tile                      hint(child sig in /susan)  in tile bag?  bag markers')
  for (const name of ['family-support', 'its-allowed-heavy', 'dont-start-static', 'finding-help']) {
    const hint = hints.get(name)
    const h = await send({ op: 'history', segments: ['susan', name] })
    const entries = Array.isArray(h.data) ? h.data : []
    const bagSigs = entries.map(e => String(e.layerSig ?? e.sig ?? '')).filter(Boolean)
    const inBag = hint ? bagSigs.includes(hint) : false
    console.log(`${name.padEnd(25)} ${String(hint ?? '—').slice(0, 12).padEnd(26)} ${inBag ? 'yes → freshens' : 'NO  → off-lineage'}   ${bagSigs.length}`)
  }
})().catch(e => { console.error('failed:', e.message || e); process.exit(1) })
