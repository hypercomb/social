// Read-only: dump notes (and optionally decoration payload kinds) for a hive path.
// Usage: node scripts/bridge/_rev-read.cjs <path/with/slashes> [--decos]
const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'
let n = 0
function call(req, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const id = `read-${Date.now()}-${++n}`
    const ws = new WebSocket(BRIDGE)
    const t = setTimeout(() => { ws.close(); reject(new Error('timeout ' + req.op)) }, timeout)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
    ws.on('message', (raw) => { clearTimeout(t); try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) }; ws.close() })
    ws.on('error', (e) => { clearTimeout(t); reject(e) })
  })
}
const seg = a => (a || '').split(/[\\/]/).filter(Boolean)

function printNote(n0, depth) {
  const pad = '  '.repeat(depth)
  const text = String(n0?.text ?? n0?.note ?? '')
  const mark = n0?.mark ? ` «${n0.mark}»` : ''
  console.log(`${pad}- ${text.replace(/\n/g, '\n' + pad + '  ')}${mark}`)
  for (const c of n0?.children || []) printNote(c, depth + 1)
}

;(async () => {
  const segments = seg(process.argv[2])
  const wantDecos = process.argv.includes('--decos')
  const nl = await call({ op: 'note-list', segments })
  const d = nl.ok ? nl.data : []
  const items = Array.isArray(d) ? d : (Array.isArray(d?.notes) ? d.notes : [])
  console.log(`=== NOTES @ /${segments.join('/')} (${items.length}) ===`)
  for (const it of items) printNote(it, 0)

  if (wantDecos) {
    const la = await call({ op: 'layer-at', segments })
    if (la.ok) {
      console.log(`\n=== DECORATIONS ===`)
      for (const sig of (la.data.decorations || []).map(String)) {
        const r = await call({ op: 'get-resource', sig })
        if (r.ok && r.data.encoding === 'text') {
          let j = null; try { j = JSON.parse(r.data.text) } catch {}
          if (!j) continue
          const payload = JSON.stringify(j.payload ?? j).slice(0, 1400)
          console.log(`--- ${j.kind} (${sig.slice(0, 12)})\n${payload}`)
        }
      }
    }
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
