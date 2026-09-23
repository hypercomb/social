#!/usr/bin/env node
// local-content-host — the public content host's OWN worker code, served from
// this machine over in-memory storage, for proving publish and replication
// end to end without touching the real host.
//
//   node scripts/local-content-host.mjs [port=4291] [shell=http://localhost:4260] [--ai-stub]
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
import worker from '../hypercomb-relay/blossom-worker/worker.js'

const port = Number(process.argv[2] || 4291)
const shell = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'http://localhost:4260'
const aiStub = process.argv.includes('--ai-stub')

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

const bindings = {}
const env = { CONTENT: r2(), HIVES: kv(), GRANTS: kv(), AUTO_GRANT: '1', SANDBOX_SHELL_ORIGIN: shell, SITE_BINDINGS: '{}', ...(aiStub ? { ANTHROPIC_API_KEY: 'local-stub' } : {}) }

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
      hives: Object.fromEntries([...env.HIVES.values].map(([key, value]) => [key, JSON.parse(value)])),
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
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks)
  try {
    // A fresh view per request: the worker caches parsed bindings per env
    // object, and a zone bound by /__bind must be seen on the next request.
    const response = await worker.fetch(new Request(url, { method: req.method, headers: req.headers, body }), { ...env }, { waitUntil: () => {} })
    const headers = {}
    response.headers.forEach((value, key) => { headers[key] = value })
    res.writeHead(response.status, headers)
    res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' })
    res.end(String(error?.stack ?? error))
  }
}).listen(port, '127.0.0.1', () => console.log(`[local-content-host] the content host's worker on http://localhost:${port}`))
