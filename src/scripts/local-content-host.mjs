#!/usr/bin/env node
// local-content-host — the public content host's OWN worker code, served from
// this machine over in-memory storage, for proving publish and replication
// end to end without touching the real host.
//
//   node scripts/local-content-host.mjs [port=4291] [shell=http://localhost:4260] [--ai-stub] [--visitor-assets <dir>] [--restore <dir>]
//
// Everything a browser meets is the real worker (hypercomb-relay/blossom-worker
// worker.js): NIP-98 signed uploads checked against the body's sha256, the
// signed hive index at /hive/<pubkey> with its rollback refusal, pool
// listings, CORS. Only the storage is swapped — R2 and KV become maps that
// live as long as the process. `GET /__state` answers what it holds, for a
// harness to assert on. `POST /__bind {zone, pubkey, label?}` binds a zone to
// a publisher as the operator's SITE_BINDINGS would, so `try-<change>.localhost`
// is a sandbox door; a second call with another key approves that publisher
// too. The door's shell is fetched from the second argument.
//
// `--ai-stub` stands in for Anthropic behind the worker's `/ai/ask`: the real
// endpoint runs (NIP-98, the context read from the heap by signature, the
// meter), and only the upstream call is answered here — with a reading that
// says how many files it was shown and whether the change's proof marker was
// among them, so a harness can prove the host's AI read the changed code.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import zlib from 'node:zlib'
import worker from '../hypercomb-relay/blossom-worker/worker.js'

const port = Number(process.argv[2] || 4291)
const shell = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'http://localhost:4260'
const aiStub = process.argv.includes('--ai-stub')
const assetsFlag = process.argv.indexOf('--visitor-assets')
const assetsRoot = assetsFlag >= 0 ? path.resolve(process.argv[assetsFlag + 1] || '') : ''
const restoreFlag = process.argv.indexOf('--restore')
const restoreRoot = restoreFlag >= 0 ? path.resolve(process.argv[restoreFlag + 1] || '') : ''

const contentType = (file) => {
  switch (path.extname(file).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.json': return 'application/json'
    case '.svg': return 'image/svg+xml'
    case '.png': return 'image/png'
    case '.ico': return 'image/x-icon'
    default: return 'application/octet-stream'
  }
}

// The visitor engine reads its shell from ASSETS. This host has none unless a
// built visitor directory is named; a published site then answers 503.
const assets = assetsRoot ? {
  fetch: async (request) => {
    const url = new URL(request.url)
    let rel = decodeURIComponent(url.pathname)
    if (rel.endsWith('/')) rel += 'index.html'
    const root = path.resolve(assetsRoot)
    const file = path.resolve(root, `.${rel}`)
    if (file !== root && !file.startsWith(root + path.sep)) return new Response('no', { status: 403 })
    try {
      const bytes = fs.readFileSync(file)
      return new Response(bytes, { status: 200, headers: { 'content-type': contentType(file) } })
    } catch {
      return new Response('missing', { status: 404 })
    }
  },
} : null

if (aiStub) {
  const upstream = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = String(input?.url ?? input)
    if (!url.startsWith('https://api.anthropic.com/')) return upstream(input, init)
    const body = JSON.parse(String(init?.body ?? '{}'))
    const asked = String(body.messages?.[0]?.content ?? '')
    const files = (asked.match(/^--- context [0-9a-f]{12}… ---$/gm) ?? []).length
    const text = [
      'Stub reading (the local content host stands in for Anthropic).',
      `Context files shown: ${files}.`,
      `The change sets __hivePublishProof: ${asked.includes('__hivePublishProof') ? 'yes' : 'no'}.`,
      'VERDICT: accept',
    ].join('\n')
    return new Response(JSON.stringify({ type: 'message', model: 'local-stub', content: [{ type: 'text', text }] }), { headers: { 'content-type': 'application/json' } })
  }
}

const bytesOf = (value) => value instanceof Uint8Array ? value
  : value instanceof ArrayBuffer ? new Uint8Array(value)
  : typeof value === 'string' ? new TextEncoder().encode(value)
  : new Uint8Array(0)

const r2 = () => {
  const objects = new Map()
  const meta = (key, entry) => ({
    key, size: entry.bytes.byteLength, etag: key, httpEtag: `"${key}"`, httpMetadata: entry.httpMetadata ?? {},
    writeHttpMetadata: (headers) => { if (entry.httpMetadata?.contentType) headers.set('content-type', entry.httpMetadata.contentType) },
  })
  return {
    objects,
    put: async (key, body, options = {}) => {
      const bytes = body instanceof ReadableStream ? new Uint8Array(await new Response(body).arrayBuffer()) : bytesOf(body)
      objects.set(key, { bytes, httpMetadata: options.httpMetadata })
      return meta(key, objects.get(key))
    },
    head: async (key) => objects.has(key) ? meta(key, objects.get(key)) : null,
    get: async (key) => {
      const entry = objects.get(key)
      if (!entry) return null
      const copy = () => entry.bytes.slice()
      return {
        ...meta(key, entry),
        get body() { return new Response(copy()).body },
        arrayBuffer: async () => copy().buffer,
        text: async () => new TextDecoder().decode(copy()),
        json: async () => JSON.parse(new TextDecoder().decode(copy())),
      }
    },
    list: async ({ prefix = '' } = {}) => ({ objects: [...objects.keys()].filter(key => key.startsWith(prefix)).sort().map(key => ({ key })), truncated: false }),
    delete: async (key) => { objects.delete(key) },
  }
}
const kv = () => {
  const values = new Map()
  return { values, get: async (key) => values.get(key) ?? null, put: async (key, value) => { values.set(key, String(value)) }, delete: async (key) => { values.delete(key) } }
}

/** sign('hive:indexes') — where the worker keeps each publisher's signed index. */
const HIVE_INDEXES = createHash('sha256').update('hive:indexes').digest('hex')
const bindings = {}
const env = { CONTENT: r2(), HIVES: kv(), GRANTS: kv(), AUTO_GRANT: '1', SANDBOX_SHELL_ORIGIN: shell, SITE_BINDINGS: '{}', ...(assets ? { ASSETS: assets } : {}), ...(aiStub ? { ANTHROPIC_API_KEY: 'local-stub' } : {}) }

// A restart of this process forgets the heap. `--restore` puts a snapshot back
// before the first request: one file per flat signature, and index.json as the
// publisher's signed hive index (the KV the worker drains into the pool).
if (restoreRoot) {
  const blobs = path.join(restoreRoot, 'blobs')
  for (const name of fs.existsSync(blobs) ? fs.readdirSync(blobs) : []) {
    if (!/^[0-9a-f]{64}$/.test(name)) continue
    env.CONTENT.objects.set(name, { bytes: fs.readFileSync(path.join(blobs, name)), httpMetadata: {} })
  }
  const indexFile = path.join(restoreRoot, 'index.json')
  if (fs.existsSync(indexFile)) {
    const raw = fs.readFileSync(indexFile, 'utf8')
    const pubkey = JSON.parse(raw).pubkey
    if (pubkey) env.HIVES.values.set(pubkey, raw)
  }
  console.log(`[local-content-host] restored ${env.CONTENT.objects.size} objects`)
}

// A replicated website page is the deployment. The visitor shell boots the
// whole package — every default tile — and a trial that only replicated a
// page stays black behind that cover. `/` on a plain label serves the page
// the signed layer names. A try- door, the host card, and anything without a
// page still go to the worker.
const bytesOfKey = (sig) => {
  const entry = /^[0-9a-f]{64}$/.test(String(sig || '')) ? env.CONTENT.objects.get(sig) : null
  return entry ? entry.bytes : null
}
const jsonOf = (sig) => {
  const bytes = bytesOfKey(sig)
  return bytes ? JSON.parse(Buffer.from(bytes).toString('utf8')) : null
}
const replicatedPage = (hostHeader) => {
  const host = String(hostHeader || '').split(':')[0].toLowerCase()
  const match = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.localhost$/.exec(host)
  if (!match) return null
  const label = match[1]
  if (label === 'content' || label === 'host' || label === 'swarm' || label.startsWith('try-')) return null
  const publishers = bindings.localhost?.publishers ?? []
  for (const publisher of publishers) {
    let raw = env.HIVES.values.get(publisher.pubkey) ?? null
    if (!raw) raw = bytesOfKey(`${HIVE_INDEXES}/${publisher.pubkey}`) ? Buffer.from(bytesOfKey(`${HIVE_INDEXES}/${publisher.pubkey}`)).toString('utf8') : null
    if (!raw) continue
    try {
      const content = JSON.parse(JSON.parse(raw).content)
      const layer = jsonOf(content?.roots?.[label])
      for (const deco of layer?.decorations ?? []) {
        const record = jsonOf(jsonOf(deco)?.resource)
        if (record?.kind !== 'visual:website:page') continue
        const html = bytesOfKey(record.payload?.htmlSig)
        if (html) return html
      }
    } catch { /* this publisher's index is not a page */ }
  }
  return null
}

http.createServer(async (req, res) => {
  const url = `http://${req.headers.host || `localhost:${port}`}${req.url}`
  // THE HARNESS'S OWN ENDPOINTS answer the harness alone. It calls them from Node,
  // which sends neither an Origin nor Sec-Fetch-Site; any page in this machine's
  // browser — a sandbox door above all — sends one (a same-origin GET carries no
  // Origin, but always Sec-Fetch-Site), and must not bind a zone or read the store.
  if ((req.url === '/__state' || req.url === '/__bind') && (req.headers.origin || req.headers['sec-fetch-site'])) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('the harness endpoints answer the harness, not a page\n')
    return
  }
  if (req.url === '/__state') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      content: [...env.CONTENT.objects.keys()].sort(),
      // Indexes live in the content pool sign('hive:indexes')/<pubkey> since
      // 2026-09-25; the KV namespace is only a drain source. Both are read,
      // the pool winning, so a harness sees every publisher's index.
      hives: {
        ...Object.fromEntries([...env.HIVES.values].map(([key, value]) => [key, JSON.parse(value)])),
        ...Object.fromEntries([...env.CONTENT.objects.entries()]
          .filter(([key]) => key.startsWith(`${HIVE_INDEXES}/`))
          .map(([key, entry]) => [key.slice(HIVE_INDEXES.length + 1), JSON.parse(new TextDecoder().decode(entry.bytes))])),
      },
    }))
    return
  }
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (req.url === '/__bind' && req.method === 'POST') {
    const { zone, pubkey, label = 'publisher' } = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    const bound = bindings[String(zone)]
    if (!bound) bindings[String(zone)] = { title: zone, lineage: String(zone).split('.')[0], publishers: [{ pubkey, label, primary: true }] }
    else if (!bound.publishers.some((publisher) => publisher.pubkey === pubkey)) bound.publishers.push({ pubkey, label })
    env.SITE_BINDINGS = JSON.stringify(bindings)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, bindings }))
    return
  }
  const asked = new URL(url)
  if ((req.method === 'GET' || req.method === 'HEAD') && asked.pathname === '/') {
    const page = replicatedPage(req.headers.host)
    if (page) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(req.method === 'HEAD' ? undefined : page)
      return
    }
  }
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks)
  try {
    // A fresh view per request: the worker caches parsed bindings per env
    // object, and a zone bound by /__bind must be seen on the next request.
    const response = await worker.fetch(new Request(url, { method: req.method, headers: req.headers, body }), { ...env }, { waitUntil: () => {} })
    const headers = {}
    response.headers.forEach((value, key) => { headers[key] = value })
    let out = req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer())
    // workerd encodes a body whose header asks for gzip (encodeBody
    // 'automatic'); Node's Response never does, so this host does it here.
    if (out && /^gzip$/i.test(String(headers['content-encoding'] || '').trim())) {
      out = zlib.gzipSync(out)
      delete headers['content-length']
    }
    res.writeHead(response.status, headers)
    res.end(out)
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' })
    res.end(String(error?.stack ?? error))
  }
}).listen(port, '127.0.0.1', () => console.log(`[local-content-host] the content host's worker on http://localhost:${port}`))
