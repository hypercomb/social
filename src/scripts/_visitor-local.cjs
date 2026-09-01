// Local visitor harness: serves the built visitor bundle and proxies every
// content read to the live host, so the published site can be debugged
// locally (same-origin, real bytes) without a deploy per iteration.
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path')
const ROOT = path.resolve(process.env.VISITOR_ROOT || path.join(__dirname, '../hypercomb-web/dist/hypercomb-web/visitor'))
const UPSTREAM = 'revolucion.pluginthematrix.com', UPSTREAM_IP = '104.21.25.138'
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp' }
let reqs = 0, proxied = 0, lastProxyAt = 0
// site.json must advertise THIS origin: the visitor's read-only network gate
// allows same-origin reads only, and the harness serves the same heap.
const proxySiteJson = (req, res) => {
  const up = https.request({ host: UPSTREAM_IP, servername: UPSTREAM, headers: { Host: UPSTREAM }, path: req.url, method: 'GET', timeout: 30000 }, r => {
    const chunks = []
    r.on('data', d => chunks.push(d))
    r.on('end', () => {
      let body = Buffer.concat(chunks).toString()
      try { const j = JSON.parse(body); if (j.hosts) j.hosts = [process.env.HOST_REWRITE || 'localhost:4300']; body = JSON.stringify(j) } catch {}
      res.writeHead(r.statusCode, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(body)
    })
  })
  up.on('error', () => res.writeHead(502).end('proxy error'))
  up.end()
}
const DELAY = Number(process.env.PROXY_DELAY_MS || 0)
const proxy = (req, res) => {
  if (DELAY > 0) { setTimeout(() => proxyNow(req, res), DELAY); return }
  proxyNow(req, res)
}
const proxyNow = (req, res) => {
  proxied++; lastProxyAt = Date.now()
  const up = https.request({ host: UPSTREAM_IP, servername: UPSTREAM, headers: { Host: UPSTREAM, 'sec-fetch-dest': req.headers['sec-fetch-dest'] || '' }, path: req.url, method: 'GET', timeout: 30000 }, r => {
    res.writeHead(r.statusCode, { 'content-type': r.headers['content-type'] || 'application/octet-stream', 'access-control-allow-origin': '*', 'cache-control': 'no-store' })
    r.pipe(res)
  })
  up.on('error', () => { res.writeHead(502).end('proxy error') })
  up.on('timeout', () => { up.destroy(); res.writeHead(504).end('proxy timeout') })
  up.end()
}
const handler = (req, res) => {
  reqs++
  const url = req.url.split('?')[0]
  if (url === '/site.json') return proxySiteJson(req, res)
  if (/^\/(publications)\.json$/.test(url) || /^\/hive\/[0-9a-f]{64}$/.test(url) || /^\/(@resource\/)?[0-9a-f]{64}$/.test(url)) return proxy(req, res)
  let file = path.join(ROOT, url === '/' ? 'index.html' : decodeURIComponent(url))
  if (!file.startsWith(ROOT)) file = path.join(ROOT, 'index.html')
  fs.readFile(file, (err, buf) => {
    if (err) {
      if (/^\/content\/[0-9a-f]{64}$/.test(url)) return proxy(req, res)
      console.log('[visitor-local] MISS ' + url)
      return fs.readFile(path.join(ROOT, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(404).end('not found'); return }
        res.writeHead(200, { 'content-type': 'text/html' }).end(html)
      })
    }
    const headers = { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }
    if (process.env.LIVE_HEADERS === '1') {
      headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'"
      headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
      headers['Referrer-Policy'] = 'no-referrer'
      headers['X-Content-Type-Options'] = 'nosniff'
    }
    res.writeHead(200, headers).end(buf)
  })
}
if (process.env.TLS_DIR) {
  const opts = { key: fs.readFileSync(path.join(process.env.TLS_DIR, 'key.pem')), cert: fs.readFileSync(path.join(process.env.TLS_DIR, 'cert.pem')) }
  https.createServer(opts, handler).listen(4443, '127.0.0.1', () => console.log('[visitor-local] https://hive.test:4443 → proxying content to ' + UPSTREAM))
} else {
  http.createServer(handler).listen(4300, '127.0.0.1', () => console.log('[visitor-local] http://localhost:4300 → proxying content to ' + UPSTREAM))
}
setInterval(() => console.log(`[visitor-local] reqs=${reqs} proxied=${proxied} idle=${lastProxyAt ? ((Date.now() - lastProxyAt) / 1000).toFixed(0) + 's' : 'n/a'}`), 10000)
