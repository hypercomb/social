// Local visitor harness: serves the built visitor bundle and proxies every
// content read to the live host, so the published site can be debugged
// locally (same-origin, real bytes) without a deploy per iteration.
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path')
const ROOT = path.resolve(process.env.VISITOR_ROOT || path.join(__dirname, '../hypercomb-web/dist/hypercomb-web/visitor'))
const UPSTREAM = 'revolucion.pluginthematrix.com', UPSTREAM_IP = '104.21.25.138'
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp' }
let reqs = 0, proxied = 0, lastProxyAt = 0
// The door's own bag: the visitor asks sign(<this host>); the answer is the
// upstream door's bag, sign(UPSTREAM) — the same records, on this origin.
const sha = text => require('crypto').createHash('sha256').update(text).digest('hex')
const UPSTREAM_BAG = sha(UPSTREAM)
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
  const localBag = sha(String(req.headers.host || 'localhost').split(':')[0].toLowerCase())
  if (url.startsWith(`/${localBag}/`)) { req.url = `/${UPSTREAM_BAG}/${url.slice(localBag.length + 2)}`; return proxy(req, res) }
  // A module import at the flat root (`/<sig>`, Sec-Fetch-Dest script/worker)
  // is THIS build's package, not the live heap's: serve it from dist/content
  // with a JavaScript MIME exactly as the worker does, and proxy only what the
  // build does not carry.
  const flat = url.match(/^\/([0-9a-f]{64})$/)
  if (flat) {
    const dest = String(req.headers['sec-fetch-dest'] || '').toLowerCase()
    const local = path.join(ROOT, 'content', flat[1])
    if (fs.existsSync(local)) {
      const type = (dest === 'script' || dest === 'worker' || dest === 'sharedworker') ? 'text/javascript' : 'application/octet-stream'
      return fs.readFile(local, (err, buf) => err ? proxy(req, res) : res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable' }).end(buf))
    }
  }
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
