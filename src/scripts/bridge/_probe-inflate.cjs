const WebSocket = require('ws')
const ws = new WebSocket('ws://localhost:2401')
ws.on('open', () => ws.send(JSON.stringify({ id: 'probe', op: 'inflate', segments: ['dolphin'] })))
ws.on('message', raw => {
  const r = JSON.parse(String(raw))
  if (r.ok) {
    for (const branch of r.data?.children || []) {
      console.log('=== branch:', branch.name, '===')
      for (const leaf of branch.children || []) {
        const keys = leaf && typeof leaf === 'object' ? Object.keys(leaf) : 'NOT-OBJECT';
        const name = leaf?.name ?? '(MISSING)'
        console.log('  - name:', name, ' keys:', keys)
      }
    }
  } else {
    console.log('error:', r.error)
  }
  ws.close()
})
ws.on('error', e => { console.error('ws err:', e.message); process.exit(1) })
setTimeout(() => { console.error('timeout'); process.exit(1) }, 8000)
