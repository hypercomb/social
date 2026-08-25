// hypercomb serve — the standalone server shim.
//
//   hypercomb serve <dir> [--port 8080] [--public]
//   hypercomb serve <dir> --site <sig> --from <url> [--from <url>…]
//
// The shim IS a standalone server: one command serves a published folder
// with the read-only contract, and — given --site — syncs the folder to a
// signature first (the shim's one verb). Same rules as the desktop app's
// SiteServer, in Node:
//
// - GET/HEAD/OPTIONS only; a read-only deployment never writes.
// - Directory requests fall to the directory's index.html.
// - Sig-named files: Cache-Control immutable (immutable by name);
//   .html faces: no-cache (they move when the site syncs).
// - CORS wide open — the folder is an open oasis; the Merkle gate is the
//   security, not the transport.
// - Loopback by default (a tunnel is the intended front door); --public
//   binds 0.0.0.0 for a bare VPS serving directly.
//
// Update = run the same command with the new signature (or re-run
// `hypercomb site`); delta-only, verified, rollback by older sig.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { networkSiteIO, syncSite } from './site.js'

const SIG = /^[a-f0-9]{64}$/
const DEFAULT_PORT = 8080

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
} as const

export const handleRequest = (root: string, req: IncomingMessage, res: ServerResponse): void => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end()
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...CORS, 'Content-Type': 'text/plain' })
    res.end('read-only')
    return
  }

  const raw = decodeURIComponent((req.url ?? '/').split('?')[0])
  let file = join(root, raw)
  try {
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  } catch { /* fall through to the guard */ }

  // Traversal guard: resolve, then verify the result still lives in root.
  const resolved = resolve(file)
  if ((!resolved.startsWith(root + sep) && resolved !== root) || !existsSync(resolved) || statSync(resolved).isDirectory()) {
    res.writeHead(404, { ...CORS, 'Content-Type': 'text/plain' })
    res.end('not found')
    return
  }

  const name = resolved.slice(resolved.lastIndexOf(sep) + 1)
  const extension = extname(resolved).toLowerCase()
  const cache = SIG.test(name)
    ? 'public, max-age=31536000, immutable'
    : extension === '.html' ? 'no-cache' : 'public, max-age=300'
  const headers = {
    ...CORS,
    'Content-Type': MIME[extension] ?? 'application/octet-stream',
    'Content-Length': statSync(resolved).size,
    'Cache-Control': cache,
  }
  res.writeHead(200, headers)
  if (req.method === 'HEAD') { res.end(); return }
  createReadStream(resolved).pipe(res)
}

const USAGE = `usage: hypercomb serve <dir> [--port ${DEFAULT_PORT}] [--public] [--site <sig> --from <url>…]

The standalone server shim: serve a published folder read-only; with --site,
sync the folder to that signature first. Loopback by default — put a tunnel
or reverse proxy in front, or pass --public to bind 0.0.0.0 directly.`

export async function runServe(args: string[]): Promise<void> {
  const sources: string[] = []
  let dir = ''
  let port = DEFAULT_PORT
  let site = ''
  let publicBind = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') port = Number(args[++i]) || DEFAULT_PORT
    else if (args[i] === '--from') sources.push(args[++i] ?? '')
    else if (args[i] === '--site') site = args[++i] ?? ''
    else if (args[i] === '--public') publicBind = true
    else if (!args[i].startsWith('--') && !dir) dir = args[i]
  }
  if (!dir || (site && (!SIG.test(site) || !sources.length))) {
    console.error(USAGE)
    process.exit(1)
  }

  if (site) {
    const stats = await syncSite(site, dir, networkSiteIO(dir, sources))
    console.log(`synced to ${site.slice(0, 12)}…: ${stats.total} sigs (${stats.fetched} fetched, ${stats.present} present), ${stats.pages} page(s)`)
  }

  const root = resolve(dir)
  if (!existsSync(root)) {
    console.error(`no such folder: ${root}`)
    process.exit(1)
  }
  const host = publicBind ? '0.0.0.0' : '127.0.0.1'
  const server = createServer((req, res) => handleRequest(root, req, res))
  server.listen(port, host, () => {
    console.log(`serving ${root}`)
    console.log(`  http://${host}:${port}/  (read-only: GET/HEAD/OPTIONS)`)
    if (!publicBind) console.log('  loopback only — front it with a tunnel, or pass --public for 0.0.0.0')
  })
}
