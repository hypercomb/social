// Local mirror of a DEPLOYED published site over the FRESHLY BUILT visitor.
//
//   node scripts/visitor-local-mirror.mjs [site] [port]
//   site: a <site>.pluginthematrix.com subdomain (default: meetup)
//   port: listen port (default: 4310)
//
// Serves dist/hypercomb-web/visitor with the REAL site data so renderer
// changes are testable before `wrangler deploy` touches the live worker:
//   /site.json            → live descriptor, hosts rewritten to localhost
//   /hive/<pubkey>        → proxied live signed index (never cached)
//   /<sig>, /@resource/<sig> → proxied from the live domain, disk-cached
//   everything else       → static visitor assets (SPA fallback to index)
// Every non-static request is logged — the boot's fetch trail is the
// observability that found the nav/enablement/index bugs (2026-08-28).
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join, extname, resolve, normalize, relative, isAbsolute, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const assets = resolve(here, '..', 'dist', 'hypercomb-web', 'visitor')
const site = (process.argv[2] ?? 'meetup').trim()
const port = Number(process.argv[3] ?? 4310)
const LIVE = `https://${site}.pluginthematrix.com`
const cacheDir = join(tmpdir(), 'hypercomb-visitor-mirror', site)
mkdirSync(cacheDir, { recursive: true })

const mime = (p) => ({
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
  '.webp': 'image/webp', '.wasm': 'application/wasm',
}[extname(p).toLowerCase()] ?? 'application/octet-stream')

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`)
  const path = url.pathname
  const log = (note) => console.log(`${req.method} ${path} ${note}`)
  try {
    if (path === '/site.json') {
      const live = await fetch(`${LIVE}/site.json`).then(r => r.json())
      live.hosts = [`localhost:${port}`]
      log('→ live descriptor (host rewritten)')
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      return res.end(JSON.stringify(live))
    }
    if (path.startsWith('/hive/')) {
      const r = await fetch(`${LIVE}${path}`)
      const body = Buffer.from(await r.arrayBuffer())
      log(`→ live index ${r.status} ${body.length}B`)
      res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      return res.end(body)
    }
    const sigMatch = path.match(/^\/(?:@resource\/)?([0-9a-f]{64})$/)
    if (sigMatch) {
      const sig = sigMatch[1]
      const cached = join(cacheDir, sig)
      if (existsSync(cached)) {
        log('→ sig (cache)')
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable' })
        return createReadStream(cached).pipe(res)
      }
      const r = await fetch(`${LIVE}/${sig}`)
      const body = Buffer.from(await r.arrayBuffer())
      if (r.ok) writeFileSync(cached, body)
      log(`→ sig (live ${r.status} ${body.length}B)`)
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/octet-stream' })
      return res.end(body)
    }
    const requested = path === '/' ? 'index.html' : decodeURIComponent(path.slice(1))
    let file = resolve(assets, normalize(requested))
    const within = relative(assets, file)
    if (within.startsWith('..') || isAbsolute(within)) { res.writeHead(403); return res.end() }
    if (!existsSync(file) && !extname(file)) file = join(assets, 'index.html')
    if (!existsSync(file)) { log('→ 404'); res.writeHead(404); return res.end('not found') }
    res.writeHead(200, { 'content-type': mime(file), 'cache-control': 'no-store' })
    return createReadStream(file).pipe(res)
  } catch (err) {
    log(`→ 500 ${err?.message}`)
    res.writeHead(500)
    res.end(String(err?.message ?? err))
  }
})

server.listen(port, '127.0.0.1', () =>
  console.log(`[visitor-mirror] ${LIVE} over ${assets} → http://localhost:${port} (cache ${cacheDir})`))
