const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'
const SITE = 'https://susan.pluginthematrix.com'
const SIG = /^[0-9a-f]{64}$/
let n = 0
const send = (req, ms = 15000) => new Promise((res, rej) => {
  const ws = new WebSocket(BRIDGE); const id = `np-${Date.now()}-${++n}`
  const t = setTimeout(() => { ws.close(); rej(new Error('timeout')) }, ms)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', r => { clearTimeout(t); try { res(JSON.parse(String(r))) } catch { rej(new Error('bad')) } ws.close() })
  ws.on('error', e => { clearTimeout(t); rej(e) })
})
// get-resource answers an envelope { sig, encoding:'text', text } — unwrap it.
const readLocal = async sig => {
  if (!SIG.test(String(sig ?? ''))) return null
  const r = await send({ op: 'get-resource', sig })
  if (!r.ok || r.data == null) return null
  const d = r.data
  const body = typeof d === 'string' ? d : (typeof d.text === 'string' ? d.text : JSON.stringify(d))
  try { return JSON.parse(body) } catch { return null }
}
const picturesOf = p => p ? {
  large: p.large?.image ?? null, small: p.small?.image ?? null,
  flatSmall: p.flat?.small?.image ?? null, imageSig: p.imageSig ?? null,
} : {}
const onServer = async sig => {
  if (!SIG.test(String(sig ?? ''))) return 'n/a'
  const r = await fetch(`${SITE}/${sig}`, { method: 'HEAD' })
  return r.ok ? `on server (${r.headers.get('content-length') ?? '?'} bytes)` : `NOT ON SERVER (${r.status})`
}
const httpJson = async sig => { const r = await fetch(`${SITE}/${sig}`); if (!r.ok) return null; try { return JSON.parse(await r.text()) } catch { return null } }
;(async () => {
  const head = await httpJson('fab0296bb061d35f912fe892e5462c78febe557c5b26a982bf6819440630a936')
  const published = new Map()
  for (const cs of head.children ?? []) {
    let c = await httpJson(cs); if (c && c.meta === 1) c = await httpJson(c.layer)
    if (!c?.name) continue
    let p = await httpJson(c.properties?.[0]); if (p && p.meta === 1) p = await httpJson(p.resource)
    published.set(c.name, picturesOf(p))
  }
  for (const name of ['family-support','the-practical-work','what-recovery-is','its-allowed-heavy','keeping-standing','finding-help','dont-start-static']) {
    const r = await send({ op: 'layer-at', segments: ['susan', name] })
    const props = await readLocal(r.ok ? r.data.properties?.[0] : null)
    const now = picturesOf(props), was = published.get(name) ?? {}
    console.log(`\n=== ${name}`)
    for (const slot of ['large', 'small', 'flatSmall', 'imageSig']) {
      const a = was[slot], b = now[slot]
      if (!a && !b) continue
      const changed = a !== b
      console.log(`  ${slot.padEnd(10)} published ${String(a ?? '—').slice(0, 12)}  →  local ${String(b ?? '—').slice(0, 12)}  ${changed ? '*** CHANGED' : ''}`)
      if (changed && b) console.log(`             new bytes: ${await onServer(b)}`)
    }
  }
})().catch(e => { console.error('failed:', e.message || e); process.exit(1) })
