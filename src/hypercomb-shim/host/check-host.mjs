// hypercomb-shim/host/check-host.mjs
//
// THE HOST CONTRACT, MECHANICALLY. Point it at any origin and it says whether
// that origin is a working Hypercomb host — and if not, which requirement it
// misses and what to change.
//
//   node host/check-host.mjs http://localhost:4270
//   npm run host:check -- https://example.com        (from hypercomb-shim/)
//
// This exists because "seamless" is otherwise a promise. Every failure mode a
// host can have here is silent in a specific, expensive way: a missing CORS
// header looks exactly like a host that publishes nothing; an SPA fallback
// that swallows signature paths makes an origin's own heap invisible to the
// nodes replicating from it; a hard-cached service worker strands clients on
// an old runtime with no way to update. Each of those has cost real hours.
// A checker turns all of them into one line of output.
//
// It reads nothing but public URLs and writes nothing anywhere. Safe to run
// against someone else's host.

const SIG_RE = /^[a-f0-9]{64}$/

const origin = (process.argv[2] ?? '').replace(/\/+$/, '')
if (!origin) {
  console.error('usage: node host/check-host.mjs <origin>   e.g. https://example.com')
  process.exit(2)
}

const results = []
const record = (ok, name, detail, fix) => {
  results.push({ ok, name, detail, fix })
  const mark = ok === true ? '  ok  ' : ok === null ? ' warn ' : ' FAIL '
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`)
  if (ok !== true && fix) console.log(`         ↳ ${fix}`)
}

const sha256 = async (buffer) => {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

const get = async (path, init) => {
  try { return await fetch(`${origin}${path}`, init) } catch (error) { return { error } }
}

console.log(`\nHypercomb host check — ${origin}\n`)

// ── 1. the shell ─────────────────────────────────────────────────────────────
const index = await get('/')
if (index.error || !index.ok) {
  record(false, 'serves the shell', index.error ? String(index.error) : `HTTP ${index.status}`,
    'the origin must serve the shim build (index.html + main.js) at /')
} else {
  const html = await index.text()
  const hasModule = html.includes('main.js')
  record(hasModule, 'serves the shell', `${html.length} bytes of HTML at /`,
    'index.html must load ./main.js as a module — deploy the shim dist/, not a placeholder')
}

// ── 2. the pin ───────────────────────────────────────────────────────────────
// The one mutable pointer in the chain. Everything it names is verified.
let pin = ''
const pinRes = await get('/pin', { cache: 'no-store' })
if (pinRes.error || !pinRes.ok) {
  record(false, 'publishes /pin', pinRes.error ? String(pinRes.error) : `HTTP ${pinRes.status}`,
    'the shim build writes dist/pin — deploy the whole dist/, not just index.html + assets')
} else {
  pin = (await pinRes.text()).trim().toLowerCase()
  record(SIG_RE.test(pin), 'publishes /pin', pin ? `${pin.slice(0, 12)}…` : '(empty)',
    '/pin must hold one 64-hex signature')
  const cache = (pinRes.headers.get('cache-control') ?? '').toLowerCase()
  const fresh = cache.includes('no-store') || cache.includes('no-cache') || cache.includes('max-age=0')
  record(fresh ? true : null, 'pin is not hard-cached', cache || '(no cache-control)',
    'a hard-cached pin cannot be repointed — set max-age=0, must-revalidate (see public/_headers)')
}

// ── 3. the bootstrap bundle, verified ────────────────────────────────────────
if (SIG_RE.test(pin)) {
  let served = null
  for (const path of [`/${pin}`, `/content/${pin}`]) {
    const res = await get(path)
    if (!res.error && res.ok) { served = { res, path }; break }
  }
  if (!served) {
    record(false, 'serves the bootstrap it pins', 'no bytes at /<pin> or /content/<pin>',
      'the pinned bundle must be reachable — deploy dist/<sig> alongside dist/pin')
  } else {
    const bytes = await served.res.arrayBuffer()
    const hash = await sha256(bytes)
    record(hash === pin, 'bootstrap bytes hash to the pin',
      hash === pin ? `${(bytes.byteLength / 1024).toFixed(0)} kB at ${served.path}` : `served ${hash.slice(0, 12)}…, pinned ${pin.slice(0, 12)}…`,
      'the origin is serving something other than what it pins — redeploy; a mismatch is REFUSED by every client')
    const type = (served.res.headers.get('content-type') ?? '').toLowerCase()
    record(!type.includes('text/html'), 'signature paths are not swallowed by the SPA fallback', type || '(none)',
      'an unconditional /* → /index.html 200 rewrite hides the heap. Existing files must win (Pages does this by default)')
  }
}

// ── 4. the package heap ──────────────────────────────────────────────────────
let manifest = null
let manifestBase = ''
for (const base of ['/content', '']) {
  const res = await get(`${base}/manifest.json`, { cache: 'no-store' })
  if (res.error || !res.ok) continue
  try { manifest = await res.json(); manifestBase = base; break } catch { /* not JSON */ }
}
if (!manifest) {
  record(null, 'publishes a package manifest', 'none at /content/manifest.json or /manifest.json',
    'optional — a host with no packages is a valid shell host, but no node can install from it')
} else {
  const sigs = Object.keys(manifest.packages ?? {}).filter(s => SIG_RE.test(s))
  record(sigs.length > 0, 'publishes a package manifest',
    `${sigs.length} package(s) at ${manifestBase || '/'}/manifest.json`,
    'manifest.packages must be keyed by 64-hex package signatures')

  // Spot-check one real atom end to end: reachable, and its bytes are its name.
  const pkg = manifest.packages?.[sigs[0]]
  const atom = pkg?.bees?.[0] ?? pkg?.dependencies?.[0] ?? pkg?.layers?.[0]
  if (atom) {
    const res = await get(`${manifestBase}/${atom}`)
    if (res.error || !res.ok) {
      record(false, 'serves the atoms it lists', `${atom.slice(0, 12)}… → ${res.error ? String(res.error) : `HTTP ${res.status}`}`,
        'every signature in the manifest must be reachable at <origin>/<sig> — an unreachable atom fails the whole install')
    } else {
      const bytes = await res.arrayBuffer()
      const hash = await sha256(bytes)
      record(hash === atom, 'atom bytes hash to their name',
        hash === atom ? `${atom.slice(0, 12)}… verified` : `${atom.slice(0, 12)}… served ${hash.slice(0, 12)}…`,
        'served bytes do not match their signature — clients REFUSE them; the heap is corrupt or the path is wrong')
    }
  }
}

// ── 5. CORS — the one that looks like "publishes nothing" ────────────────────
{
  const res = await get(`${manifestBase || '/content'}/manifest.json`, { cache: 'no-store' })
  const acao = res.error ? null : res.headers.get('access-control-allow-origin')
  record(acao === '*' || (acao != null && acao !== ''), 'content is readable cross-origin', acao ?? '(no header)',
    'a host exists to be pulled FROM. Without Access-Control-Allow-Origin every replication from another ' +
    'origin dies as an opaque "Failed to fetch" and this host looks like it publishes nothing. ' +
    '`*` is correct: the bytes are public, immutable and verified by the reader.')
}

// ── 6. the fetcher, and its cache posture ────────────────────────────────────
{
  const res = await get('/hypercomb.worker.js')
  if (res.error || !res.ok) {
    record(false, 'serves the service worker', res.error ? String(res.error) : `HTTP ${res.status}`,
      '/hypercomb.worker.js resolves modules out of OPFS — without it nothing loads')
  } else {
    record(true, 'serves the service worker', `${res.headers.get('content-length') ?? '?'} bytes`)
    const cache = (res.headers.get('cache-control') ?? '').toLowerCase()
    const fresh = cache.includes('max-age=0') || cache.includes('no-cache') || cache.includes('no-store')
    record(fresh ? true : null, 'service worker is not hard-cached', cache || '(no cache-control)',
      'a stale service worker strands clients on an old runtime with no way to update — ' +
      'set max-age=0, must-revalidate (see public/_headers)')
  }
}

// ── 7. deep links reach the shell ────────────────────────────────────────────
{
  const res = await get('/a/deep/hive/location')
  if (res.error) {
    record(false, 'deep links reach the shell', String(res.error), 'unexpected network failure')
  } else {
    const type = (res.headers.get('content-type') ?? '').toLowerCase()
    record(res.ok && type.includes('text/html'), 'deep links reach the shell', `HTTP ${res.status} ${type || ''}`.trim(),
      'a hive location is not a file — unknown paths must serve index.html with 200 (public/_redirects)')
  }
}

// ── verdict ──────────────────────────────────────────────────────────────────
const failed = results.filter(r => r.ok === false)
const warned = results.filter(r => r.ok === null)
console.log(
  `\n${failed.length === 0 ? 'HOST OK' : 'HOST NOT READY'} — ` +
  `${results.filter(r => r.ok === true).length} passed, ${warned.length} warning(s), ${failed.length} failure(s)\n`,
)
// Set the code rather than calling process.exit: an in-flight keep-alive
// socket plus a hard exit trips a libuv assertion on Windows, and a checker
// that crashes on its own verdict is not a checker.
process.exitCode = failed.length === 0 ? 0 : 1
