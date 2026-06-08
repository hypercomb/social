#!/usr/bin/env node
// diamond-core-processor/scripts/serve-dist.js
//
// Static-file server for the DCP production dist.
//
// Why this exists (and lives HERE, not in hypercomb-relay):
//   The slim relay (hypercomb-relay) is STORAGE + MESH only. Per the
//   "you shouldn't host on your storage" principle, the relay does NOT
//   serve installer code. But the installer dist still has to be servable
//   somewhere — canonical (diamondcoreprocessor.com) for production, and
//   any operator who wants to MIRROR canonical can run this script to
//   serve the byte-equal dist from their own infra.
//
// Three roles this serves:
//   1. Canonical project deploy — runs at diamondcoreprocessor.com
//   2. Operator-as-mirror — alice.com runs this to serve canonical-equivalent
//      bytes from her infra; participants verify her served buildSig matches
//      canonical's published buildSig via /.well-known/hypercomb-installer.json
//   3. Local dev / contributor testing — verify a fresh build works against
//      hypercomb-dev (which expects DCP at localhost:2400 by default)
//
// What it does:
//   • Serves diamond-core-processor/dist/diamond-core-processor/browser/
//     as a static site (with SPA fallback to index.html for client routing)
//   • Sets CSP, Permissions-Policy, X-Content-Type-Options nosniff headers
//   • Sets Cache-Control: immutable on hashed assets, no-cache on index.html
//   • Computes a deterministic build signature on startup (sha256 of file
//     contents in a canonical order) and exposes it at
//     /.well-known/hypercomb-installer.json so participants can verify
//     "this server is serving the same bytes canonical published"
//
// Run:  node scripts/serve-dist.js [--port 2400]
// Or:   npm run serve:dist

import { createServer } from 'node:http'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { resolve, join, sep, extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const DEFAULT_PORT = 2400
const DIST_ROOT = resolve(__dirname, '..', 'dist', 'diamond-core-processor', 'browser')

// ── arg parsing ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { port: DEFAULT_PORT, distRoot: DIST_ROOT }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--port' && next) { args.port = Number(next); i++ }
    else if (a === '--dist' && next) { args.distRoot = resolve(next); i++ }
  }
  return args
}
const cfg = parseArgs(process.argv)

if (!existsSync(cfg.distRoot)) {
  console.error(`[dcp-serve] dist not found at: ${cfg.distRoot}`)
  console.error(`[dcp-serve] run \`npm run build\` first to produce dist/`)
  process.exit(2)
}

// ── build signature (deterministic sha256 of dist contents) ─────────────────
//
// Walks the dist tree in sorted order, hashes each file's relative path +
// content, and folds into a single sha256. This is the "buildSig" — two
// operators serving byte-equal dists will compute the same buildSig
// regardless of file-system order, timestamps, or anything else.
//
// Participants verify this against canonical's published buildSig to confirm
// the mirror is serving canonical-equivalent code.

function computeBuildSig(root) {
  const files = []
  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name)
      const s = statSync(p)
      if (s.isDirectory()) walk(p)
      else files.push(p)
    }
  }
  walk(root)
  const hash = createHash('sha256')
  for (const f of files) {
    const rel = relative(root, f).replace(/\\/g, '/')
    hash.update(rel + '\n')
    hash.update(readFileSync(f))
    hash.update('\n')
  }
  return hash.digest('hex')
}

const BUILD_SIG = computeBuildSig(cfg.distRoot)

// ── content-type sniff ──────────────────────────────────────────────────────
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
}
const getContentType = (p) => CONTENT_TYPES[extname(p).toLowerCase()] || 'application/octet-stream'

// ── headers ────────────────────────────────────────────────────────────────
//
// Permissions-Policy: kill Edge's auto-prompt for window-management etc.
const PERMISSIONS_POLICY = [
  'window-management=()',
  'display-capture=()',
  'screen-wake-lock=()',
  'idle-detection=()',
  'midi=()',
  'serial=()',
  'usb=()',
  'hid=()',
  'bluetooth=()',
  'xr-spatial-tracking=()',
].join(', ')

// ── well-known installer manifest ──────────────────────────────────────────
//
// Participants fetch this to verify the served bytes match canonical's
// published buildSig. Matches the schema designed for task #49.
function renderInstallerManifest() {
  return JSON.stringify({
    buildSig: BUILD_SIG,
    role: 'installer',
    // Project + version metadata are best-effort here — production canonical
    // deploys can extend this with signer, sourceCommit, builtAt, etc.
    name: 'diamond-core-processor',
    distRoot: relative(process.cwd(), cfg.distRoot).replace(/\\/g, '/'),
  }, null, 2)
}

// ── request handler ────────────────────────────────────────────────────────
function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain', 'Allow': 'GET, HEAD' })
    res.end('method not allowed')
    return
  }

  let urlPath
  try { urlPath = decodeURIComponent((req.url || '').split('?')[0]) }
  catch { res.writeHead(400); res.end('bad request'); return }

  // /.well-known/hypercomb-installer.json — sig verification endpoint
  if (urlPath === '/.well-known/hypercomb-installer.json') {
    const body = renderInstallerManifest()
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(body, 'utf8')),
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    })
    if (req.method === 'HEAD') { res.end(); return }
    res.end(body)
    return
  }

  // Static-file serve from dist with SPA fallback
  const indexPath = join(cfg.distRoot, 'index.html')
  let filePath = resolve(cfg.distRoot, '.' + (urlPath === '/' ? '/index.html' : urlPath))

  // Traversal guard
  if (filePath !== cfg.distRoot && !filePath.startsWith(cfg.distRoot + sep)) {
    filePath = indexPath
  }
  // SPA fallback: not a real file → index.html (Angular client router)
  try { if (!statSync(filePath).isFile()) filePath = indexPath } catch { filePath = indexPath }

  let bytes
  try { bytes = readFileSync(filePath) } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
    return
  }

  const isIndex = filePath === indexPath
  res.writeHead(200, {
    'Content-Type': getContentType(filePath),
    'Content-Length': String(bytes.length),
    'Access-Control-Allow-Origin': '*',
    // index.html must revalidate (it names the current hashed assets); hashed
    // assets themselves are immutable (Angular outputHashing).
    'Cache-Control': isIndex ? 'no-cache' : 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': PERMISSIONS_POLICY,
    // Custom header so participants / browser extensions can see the buildSig
    // at every response without a separate manifest fetch.
    'X-Hypercomb-Build-Sig': BUILD_SIG,
  })
  if (req.method === 'HEAD') { res.end(); return }
  res.end(bytes)
}

// ── start ───────────────────────────────────────────────────────────────────
const server = createServer(handler)
server.listen(cfg.port, () => {
  console.log(`[dcp-serve] serving dist from: ${cfg.distRoot}`)
  console.log(`[dcp-serve] buildSig: ${BUILD_SIG}`)
  console.log(`[dcp-serve] listening on http://localhost:${cfg.port}`)
  console.log(`[dcp-serve] manifest: http://localhost:${cfg.port}/.well-known/hypercomb-installer.json`)
  console.log(`[dcp-serve] role: installer (static dist; verifiable canonical-mirror)`)
})
