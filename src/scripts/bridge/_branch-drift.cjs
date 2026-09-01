// Generic: for a branch, is each tile's CURRENT generation the one the
// published head carries? Usage: node _branch-drift.cjs <host> <headSig> <seg...>
const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'
const SIG = /^[0-9a-f]{64}$/
const [host, HEAD, ...segs] = process.argv.slice(2)
let n = 0
const send = (req, ms = 40000) => new Promise((res, rej) => {
  const ws = new WebSocket(BRIDGE); const id = `bd-${Date.now()}-${++n}`
  const t = setTimeout(() => { ws.close(); rej(new Error('timeout')) }, ms)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', r => { clearTimeout(t); try { res(JSON.parse(String(r))) } catch { rej(new Error('bad')) } ws.close() })
  ws.on('error', e => { clearTimeout(t); rej(e) })
})
const http = async sig => { const r = await fetch(`https://${host}/${sig}`); if (!r.ok) return null; try { return JSON.parse(await r.text()) } catch { return '(binary)' } }
const readLocal = async sig => {
  if (!SIG.test(String(sig ?? ''))) return null
  const r = await send({ op: 'get-resource', sig })
  if (!r.ok || r.data == null) return null
  const d = r.data
  const body = typeof d === 'string' ? d : (typeof d.text === 'string' ? d.text : JSON.stringify(d))
  try { return JSON.parse(body) } catch { return null }
}
const pics = p => p ? [p.large?.image, p.small?.image, p.flat?.small?.image].filter(s => SIG.test(String(s ?? ''))) : []
;(async () => {
  const head = await http(HEAD)
  if (!head) { console.error('published head did not resolve'); process.exit(1) }
  let behind = 0, checked = 0
  for (const cs of head.children ?? []) {
    let c = await http(cs); if (c && c.meta === 1) c = await http(c.layer)
    if (!c?.name) continue
    let pubProps = await http(c.properties?.[0]); if (pubProps && pubProps.meta === 1) pubProps = await http(pubProps.resource)
    const bag = await send({ op: 'layer-at', segments: [...segs, c.name] })
    const bagProps = bag.ok ? await readLocal(bag.data?.properties?.[0]) : null
    const a = pics(pubProps).join(' '), b = pics(bagProps).join(' ')
    checked++
    if (a !== b) {
      behind++
      console.log(`BEHIND ${c.name}`)
      console.log(`   published ${a || '(none)'}`)
      console.log(`   local     ${b || '(none)'}`)
      for (const sig of pics(bagProps)) {
        const r = await fetch(`https://${host}/${sig}`, { method: 'HEAD' })
        console.log(`     ${sig.slice(0, 12)} on server: ${r.ok ? 'yes' : `NO (${r.status})`}`)
      }
    }
  }
  console.log(`\n${checked} tiles checked, ${behind} behind`)
})().catch(e => { console.error('failed:', e.message || e); process.exit(1) })
