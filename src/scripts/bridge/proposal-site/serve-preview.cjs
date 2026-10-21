// Serve a built proposal preview on loopback.
//   node scripts/bridge/proposal-site/serve-preview.cjs <proposal> [port]
const http = require('http')
const fs = require('fs')
const path = require('path')

const name = process.argv[2] || 'nlnet'
const PORT = Number(process.argv[3] || 4321)
const ROOT = path.join(__dirname, '..', '..', '..', '..', '.tmp', `proposal-site-${name}`)

http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0])
  if (url === '/') url = '/index.html'
  const file = path.join(ROOT, url)
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end(`not found: ${url}`); return }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' })
    res.end(data)
  })
}).listen(PORT, '127.0.0.1', () => console.log(`proposal preview (${name}) → http://127.0.0.1:${PORT}`))
