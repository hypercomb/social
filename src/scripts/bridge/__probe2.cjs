const WebSocket = require('ws')
const segments = JSON.parse(process.argv[2])
const ws = new WebSocket('ws://localhost:2401')
const t = setTimeout(() => { console.error('timeout'); process.exit(1) }, 40000)
ws.on('open', () => ws.send(JSON.stringify({ op: 'inflate', segments, id: 'probe-' + Date.now() })))
ws.on('message', m => {
  clearTimeout(t)
  const res = JSON.parse(String(m))
  if (!res.ok) { console.log('FAIL', res.error); process.exit(0) }
  const walk = (n, d) => {
    const kids = Array.isArray(n.children) ? n.children : []
    console.log('  '.repeat(d) + (n.name ?? '?') + (kids.length ? ` (${kids.length})` : '')
      + (Array.isArray(n.decorations) ? ' [' + n.decorations.map(x => x.kind === 'tag' ? x.payload?.name : x.kind).join(',') + ']' : ''))
    if (d < 2) for (const k of kids) walk(k, d + 1)
  }
  walk(res.data, 0)
  ws.close(); process.exit(0)
})
ws.on('error', e => { console.error('ERR', e.message); process.exit(1) })
