const WebSocket = require('ws')
const ask = (req) => new Promise((resolve, reject) => {
  const ws = new WebSocket('ws://localhost:2401')
  const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')) }, 50000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id: `probe-${Date.now()}-${Math.random()}` })))
  ws.on('message', raw => { clearTimeout(timer); ws.close(); try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) } })
  ws.on('error', e => { clearTimeout(timer); reject(e) })
})
;(async () => {
  const r = await ask({ op: 'layer-at', segments: [] })
  if (!r.ok) { console.log('layer-at NOT OK:', r.error); return }
  const layer = r.data?.layer ?? r.data
  const slots = Object.keys(layer ?? {})
  console.log('root layer slots:', slots.join(', '))
  const kids = layer?.children ?? layer?.cells ?? layer?.layers ?? []
  console.log('declared children:', kids.length)
  const seen = []
  for (const sig of kids) {
    const c = await ask({ op: 'inflate', cell: sig }).catch(() => null)
    const name = c?.data?.name ?? c?.data?.layer?.name ?? '(unreadable)'
    seen.push([sig, name])
  }
  const byName = new Map()
  for (const [sig, name] of seen) byName.set(name, [...(byName.get(name) ?? []), sig])
  for (const [name, sigs] of byName) {
    if (sigs.length > 1 || String(name).toLowerCase().includes('pheromone')) {
      console.log(`${JSON.stringify(name)} x${sigs.length} codepoints=[${[...String(name)].map(c => c.codePointAt(0)).join(',')}]`)
      for (const s of sigs) console.log(`   ${String(s).slice(0, 12)}…`)
    }
  }
  console.log('distinct names:', byName.size, 'of', kids.length, 'declared entries,', new Set(kids.map(String)).size, 'distinct sigs')
})().catch(e => console.log('ERROR', e.message))
