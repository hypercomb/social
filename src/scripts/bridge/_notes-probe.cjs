const WebSocket = require('ws')
let c = 0
const send = (req) => new Promise((res, rej) => {
  const ws = new WebSocket('ws://localhost:2401')
  const id = 'n' + (++c)
  const t = setTimeout(() => { ws.close(); rej(new Error('timeout')) }, 15000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', r => { clearTimeout(t); res(JSON.parse(String(r))); ws.close() })
  ws.on('error', e => { clearTimeout(t); rej(e) })
})
function txt(n) {
  if (typeof n === 'string') return n
  if (n && typeof n === 'object') {
    if (typeof n.text === 'string') return n.text
    if (Array.isArray(n.body) && n.body[0]) return String(n.body[0].text || '')
  }
  return JSON.stringify(n).slice(0, 60)
}
;(async () => {
  const paths = process.argv.slice(2).map(p => p.split('/').filter(Boolean))
  for (const segs of paths) {
    const r = await send({ op: 'note-list', segments: segs })
    if (!r.ok) { console.log('/' + segs.join('/') + ' ERR ' + r.error); continue }
    const arr = r.data || []
    console.log('/' + segs.join('/') + ' notes[' + arr.length + ']: ' + (arr.length ? txt(arr[0]).slice(0, 100) : '(none)'))
  }
})().catch(e => { console.error(e.message); process.exit(1) })
