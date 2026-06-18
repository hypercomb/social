// Minimal static file server for the Humanity Centres preview.
//   node scripts/bridge/humanity-site/static-server.cjs [port]
const http = require('http')
const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, 'preview')
const PORT = Number(process.argv[2] || process.env.PORT || 4319)
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' }
http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0])
  if (url === '/' || url === '') url = '/index.html'
  const file = path.join(ROOT, url)
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found: ' + url); return }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' })
    res.end(data)
  })
}).listen(PORT, () => console.log(`Humanity Centres preview → http://localhost:${PORT}`))
