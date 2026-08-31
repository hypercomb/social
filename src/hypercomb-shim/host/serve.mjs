// hypercomb-shim/host/serve.mjs
//
// THE REFERENCE HOST. Forty lines of Node, no dependencies — and it is a
// complete, correct Hypercomb host. `node host/serve.mjs dist 4270` passes
// every check in check-host.mjs.
//
// It exists for two reasons. The first is local development. The second is
// that it is the shortest possible STATEMENT of the host contract: if you are
// hosting on a VPS, in a container, behind nginx, or anywhere the ready-made
// Pages config does not apply, this file is what your host has to do.
//
// The contract, in full:
//
//   1. Serve a file when one exists — BEFORE any rewrite. This is the rule
//      every off-the-shelf SPA server gets wrong, and it is not a detail:
//      signature-named files have NO EXTENSION, and the usual heuristic
//      ("no extension ⇒ it's a route") rewrites them to index.html. The
//      origin then serves its own heap as HTML, `/pin` answers `<!doctype`,
//      atoms fail their hash, and the host looks corrupt rather than
//      misconfigured. `serve --single` fails exactly here.
//   2. Fall back to index.html with 200 for anything genuinely missing —
//      a hive location is not a file.
//   3. Access-Control-Allow-Origin — a host exists to be pulled FROM.
//   4. Never hard-cache /pin, the service worker, or main.js; a signature
//      path may be cached forever, because its name IS its hash.
//   5. Never serve outside the root.

import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'

const root = resolve(process.argv[2] ?? 'dist')
const port = Number(process.argv[3] ?? 4270)

const SIG_RE = /^[a-f0-9]{64}$/
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
}

/** Signature paths are immutable — the name IS the hash, so the bytes behind
 *  it can never change. Everything else is either the shell or a pointer, and
 *  a stale pointer is the one failure with no way out. */
const cacheFor = (urlPath, name) => {
  if (SIG_RE.test(name)) return 'public, max-age=31536000, immutable'
  if (urlPath === '/pin' || name === 'hypercomb.worker.js' || name === 'main.js' || name === 'env.js') {
    return 'no-cache, no-store, must-revalidate'
  }
  return 'public, max-age=0, must-revalidate'
}

const send = (res, status, headers, stream) => {
  res.writeHead(status, headers)
  if (stream) stream.pipe(res)
  else res.end()
}

const fileAt = async (path) => {
  try {
    const held = await stat(path)
    return held.isFile() ? held : null
  } catch { return null }
}

createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname)
  // Never escape the root: normalize, then require the result to still be
  // inside it. `..` in a URL is a traversal attempt, not a path.
  const target = normalize(join(root, urlPath))
  if (target !== root && !target.startsWith(root + sep)) return send(res, 403, {}, null)

  const name = urlPath.split('/').filter(Boolean).pop() ?? ''
  const cors = { 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' }

  if (req.method === 'OPTIONS') {
    return send(res, 204, { ...cors, 'access-control-allow-methods': 'GET, HEAD, OPTIONS' }, null)
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, cors, null)

  // (1) A real file wins, always — before any rewrite is considered.
  const held = await fileAt(target)
  if (held) {
    const type = TYPES[extname(target).toLowerCase()]
      // No extension and a 64-hex name: content-addressed bytes. Opaque on
      // purpose — the client hashes them and decides what they are. The
      // service worker, not the host, gives modules their JavaScript type.
      ?? (SIG_RE.test(name) ? 'application/octet-stream' : 'application/octet-stream')
    const headers = {
      ...cors,
      'content-type': type,
      'content-length': String(held.size),
      'cache-control': cacheFor(urlPath, name),
    }
    if (SIG_RE.test(name)) headers['etag'] = `"${name}"`
    return send(res, 200, headers, req.method === 'HEAD' ? null : createReadStream(target))
  }

  // (2) Genuinely missing → the shell, so a hive location resolves. A missing
  // SIGNATURE is a real 404 though: answering it with HTML would make the
  // origin's own heap look present-but-corrupt to every node replicating
  // from it, which is far worse than absent.
  //
  // The same goes for anything INSIDE a signature-named directory — a marker
  // or a pool member — and that case is sharper, because those are the bytes
  // nothing downstream verifies. A replicator fetches /<bagSig>/00000007 and
  // writes back whatever it gets; markers are not content-addressed, so an
  // index.html answer lands in the reader's own lineage bag unchallenged.
  const inSignature = SIG_RE.test(urlPath.split('/').filter(Boolean)[0] ?? '')
  if (SIG_RE.test(name) || inSignature) return send(res, 404, cors, null)

  const shell = join(root, 'index.html')
  if (await fileAt(shell)) {
    return send(res, 200, { ...cors, 'content-type': TYPES['.html'], 'cache-control': 'no-cache' },
      req.method === 'HEAD' ? null : createReadStream(shell))
  }
  return send(res, 404, cors, null)
}).listen(port, () => {
  console.log(`[host] serving ${root} on http://localhost:${port}`)
  console.log(`[host] verify it:  node host/check-host.mjs http://localhost:${port}`)
})
