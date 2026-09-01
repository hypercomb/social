// LOCAL only: does /susan's branch layer now address each tile's current props?
const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'
const SIG = /^[0-9a-f]{64}$/
let n = 0
const send = (req, ms = 30000) => new Promise((res, rej) => {
  const ws = new WebSocket(BRIDGE); const id = `lc-${Date.now()}-${++n}`
  const t = setTimeout(() => { ws.close(); rej(new Error('timeout')) }, ms)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', r => { clearTimeout(t); try { res(JSON.parse(String(r))) } catch { rej(new Error('bad')) } ws.close() })
  ws.on('error', e => { clearTimeout(t); rej(e) })
})
const read = async sig => {
  if (!SIG.test(String(sig ?? ''))) return null
  const r = await send({ op: 'get-resource', sig })
  if (!r.ok || r.data == null) return null
  const d = r.data
  const body = typeof d === 'string' ? d : (typeof d.text === 'string' ? d.text : JSON.stringify(d))
  try { return JSON.parse(body) } catch { return null }
}
const picsOf = p => p ? [p.large?.image, p.small?.image, p.flat?.small?.image].filter(s => SIG.test(String(s ?? ''))) : []
;(async () => {
  const branch = await send({ op: 'layer-at', segments: ['susan'] })
  let mismatch = 0
  console.log('tile                      branch props    tile-bag props   verdict')
  for (const cs of branch.data.children ?? []) {
    const inf = await send({ op: 'inflate', cell: String(cs) })
    const child = inf?.data
    const name = child?.name
    if (!name) continue
    const branchProps = Array.isArray(child.properties) ? child.properties[0] : null
    const bagLayer = await send({ op: 'layer-at', segments: ['susan', name] })
    const bagProps = bagLayer.ok && Array.isArray(bagLayer.data.properties) ? bagLayer.data.properties[0] : null
    const same = String(branchProps) === String(bagProps)
    if (!same) mismatch++
    console.log(`${String(name).padEnd(25)} ${String(branchProps ?? '—').slice(0, 12).padEnd(15)} ${String(bagProps ?? '—').slice(0, 12).padEnd(16)} ${same ? 'current' : 'BEHIND'}`)
    if (!same) console.log(`    branch pics ${picsOf(await read(branchProps)).map(s => s.slice(0, 10)).join(' ')}\n    newest pics ${picsOf(await read(bagProps)).map(s => s.slice(0, 10)).join(' ')}`)
  }
  console.log(mismatch === 0 ? '\n/susan addresses every tile\'s current generation.' : `\n${mismatch} still behind.`)
})().catch(e => { console.error('failed:', e.message || e); process.exit(1) })
