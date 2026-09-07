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
const contentOnly = process.argv.includes('--content-only')
if (!origin) {
  console.error('usage: node host/check-host.mjs <origin> [--content-only]   e.g. https://example.com')
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
  const hasModule = /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["'][^"']+\.js(?:[?#][^"']*)?["'])[^>]*>/i.test(html)
  record(hasModule, 'serves the shell', `${html.length} bytes of HTML at /`,
    'index.html must load a JavaScript module entry point — deploy the complete built shell, not a placeholder')
}

// ── 2. the pin ───────────────────────────────────────────────────────────────
// The one mutable pointer in the chain. Everything it names is verified.
let pin = ''
if (!contentOnly) {
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

  // ── 3. the bootstrap bundle, verified ──────────────────────────────────────
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
  record(true, 'does not require a legacy package manifest',
    'none at /content/manifest.json or /manifest.json; checking the host:packages pool below')
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
// A missing legacy manifest is not a useful CORS probe: Azure does not attach
// route headers to its generated 404 page. Current pool-based hosts are
// checked against resources they actually publish below.
if (manifest) {
  const res = await get(`${manifestBase}/manifest.json`, { cache: 'no-store' })
  const acao = res.error ? null : res.headers.get('access-control-allow-origin')
  record(acao === '*' || (acao != null && acao !== ''), 'package manifest is readable cross-origin', acao ?? '(no header)',
    'a host exists to be pulled FROM. Without Access-Control-Allow-Origin every replication from another ' +
    'origin dies as an opaque "Failed to fetch" and this host looks like it publishes nothing. ' +
    '`*` is correct: the bytes are public, immutable and verified by the reader.')
}

// A guaranteed miss distinguishes an honest heap from an SPA fallback that
// turns every unknown signature into index.html. /content is the canonical
// machine namespace on static hosts; the root alias is retained for older
// hosts, but is optional when the manifest itself was found under /content.
{
  const missing = '0'.repeat(64)
  const canonicalBase = manifest ? manifestBase : '/content'
  const canonicalPath = `${canonicalBase}/${missing}`
  const res = await get(canonicalPath, { cache: 'no-store', redirect: 'manual' })
  const type = (res.headers?.get?.('content-type') ?? '').toLowerCase()
  record(!res.error && res.status === 404, 'missing content signatures return 404',
    res.error ? String(res.error) : `${canonicalPath} returned HTTP ${res.status} ${type || ''}`.trim(),
    'exclude the content namespace from the SPA fallback; missing machine bytes must be absent, not HTML')

  const nestedPath = `${canonicalPath}/00000000`
  const nested = await get(nestedPath, { cache: 'no-store', redirect: 'manual' })
  const nestedType = (nested.headers?.get?.('content-type') ?? '').toLowerCase()
  record(!nested.error && nested.status === 404, 'missing pool members return 404',
    nested.error ? String(nested.error) : `${nestedPath} returned HTTP ${nested.status} ${nestedType || ''}`.trim(),
    'exclude nested machine paths from the SPA fallback; a pool member miss must never return the shell')

  if (canonicalBase) {
    const rootPath = `/${missing}`
    const root = await get(rootPath, { cache: 'no-store', redirect: 'manual' })
    const rootType = (root.headers?.get?.('content-type') ?? '').toLowerCase()
    const honest = !root.error && root.status === 404
    record(honest ? true : null, 'root signature aliases do not impersonate content',
      root.error ? String(root.error) : `${rootPath} returned HTTP ${root.status} ${rootType || ''}`.trim(),
      'optional root aliases should return 404 on a miss; Azure static hosts use /content for machine reads')
  }
}

// ── 6. locales, as content ───────────────────────────────────────────────────
// A locale is not bundled and not an installer resource — it is bytes the host
// holds, named by their own hash. A host with no index simply publishes no
// languages, which is a warning rather than a failure: the shell still runs in
// its fallback locale.
if (!contentOnly) {
  const res = await get('/locales.json', { cache: 'no-store' })
  if (res.error || !res.ok) {
    record(null, 'publishes locales as content', 'no /locales.json',
      'optional — without it the host offers no languages and clients fall back to their built-in keys')
  } else {
    let index = {}
    try { index = await res.json() } catch { /* not JSON */ }
    const locales = Object.entries(index).filter(([, sig]) => SIG_RE.test(String(sig)))
    record(locales.length > 0, 'publishes locales as content', `${locales.length} locale(s)`,
      '/locales.json maps locale -> 64-hex signature')
    const [locale, sig] = locales[0] ?? []
    if (sig) {
      const bytes = await get(`/${sig}`).then(r => r.error || !r.ok ? null : r.arrayBuffer())
      if (!bytes) {
        record(false, 'serves the catalogs it lists', `${locale} -> ${String(sig).slice(0, 12)}… unreachable`,
          'every signature in /locales.json must be reachable at <origin>/<sig>')
      } else {
        record(await sha256(bytes) === sig, 'catalog bytes hash to their name',
          `${locale} verified, ${(bytes.byteLength / 1024).toFixed(0)} kB`,
          'served bytes do not match their signature — the client REFUSES them and the locale stays untranslated')
      }
    }
  }
}

// ── 7. the fetcher, and its cache posture ────────────────────────────────────
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

// ── 8. deep links reach the shell ────────────────────────────────────────────
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

// ── 9. the mark ──────────────────────────────────────────────────────────────
// A host is a door onto a hive, and a door with no icon paints the browser's
// blank globe. The shim ships the Hypercomb hexagon at these paths, so the
// default costs a host nothing; a host that has replaced it with its own
// passes just the same — what is checked is that SOMETHING image-shaped
// answers, not whose mark it is.
//
// The interesting failure is neither: a 200 of text/html means the SPA
// fallback swallowed the request, which is the same misconfiguration that
// makes signature paths invisible (check 4) wearing a different hat.
{
  const marks = []
  for (const path of ['/favicon.svg', '/favicon.ico', '/icon.svg', '/apple-touch-icon.png']) {
    const res = await get(path)
    if (res.error || !res.ok) continue
    marks.push({ path, type: (res.headers.get('content-type') ?? '').toLowerCase() })
  }
  const images = marks.filter(m => m.type.startsWith('image/'))
  const html = marks.filter(m => m.type.includes('text/html'))
  if (images.length > 0) {
    record(true, 'wears a mark', images.map(m => m.path).join(', '))
  } else if (html.length > 0) {
    record(false, 'wears a mark', `${html[0].path} answered text/html`,
      'the SPA fallback is answering icon paths — a real file must win before any rewrite')
  } else {
    record(null, 'wears a mark', 'no icon answered',
      'ship the shim public/ icons (node scripts/build-favicons.cjs) or your own — ' +
      'without one every tab on this host shows the browser default')
  }
}

// ── 10. the pool at its address ──────────────────────────────────────────────
// documentation/host-packages-pool.md, "The directory branch": a pool is a
// DIRECTORY, and it is reached at the one address every client derives for
// itself. Hosts may expose their heap at /content or at the origin root, so the
// checker follows the same ordered bases as runtime host discovery. A listing
// answers text/plain, one entry name per line, no-store. A live host readdirs;
// a static host ships the same bytes as that directory's own index.html.
//
// The interesting failure is the SPA fallback again (checks 4 and 9): a
// redirect to / or a 200 of text/html means the rewrite ate the address.
// An honest 404 is a host that has no packages yet — a warning, not a fail.
{
  const meaning = 'host:packages'
  const poolSig = await sha256(new TextEncoder().encode(meaning))
  const probes = []
  for (const base of ['/content', '']) {
    const path = `${base}/${poolSig}/`
    const res = await get(path, { cache: 'no-store', redirect: 'manual' })
    probes.push({ path, res, type: (res.headers?.get?.('content-type') ?? '').toLowerCase() })
  }
  const served = probes.find(p => !p.res.error && p.res.ok && !p.type.includes('text/html'))
  if (served) {
    const { path, res, type } = served
    const cache = (res.headers.get('cache-control') ?? '').toLowerCase()
    const acao = res.headers.get('access-control-allow-origin')
    const body = await res.text()
    const entries = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    const wellFormed = entries.length > 0 && entries.every(e => /^\d{8}$/.test(e) || SIG_RE.test(e))
    record(wellFormed, 'serves the packages pool at its address',
      `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} at ${path}, ${type || '(no content-type)'}`,
      'the listing is one entry name per line — 8-digit marker names or 64-hex members — and nothing else')
    const fresh = cache.includes('no-store') || cache.includes('max-age=0') || cache.includes('no-cache')
    record(fresh ? true : null, 'the pool listing is not hard-cached', cache || '(no cache-control)',
      'a pool GROWS — cache the listing and every client stops at the head it first saw; set no-store on the pool directory')
    record(acao === '*' || (acao != null && acao !== ''), 'package pool is readable cross-origin',
      acao ?? '(no header)',
      'set Access-Control-Allow-Origin on the pool directory and its members so another host can discover them')

    // Prove the package picker can walk beyond the directory. A listing alone
    // can pass while the static host rewrites `<pool>/<entry>` to HTML — which
    // looks like an offer until the participant clicks it.
    if (wellFormed) {
      const entry = entries[entries.length - 1]
      const memberPath = `${path}${entry}`
      const memberRes = await get(memberPath, { cache: 'no-store' })
      const memberType = (memberRes.headers?.get?.('content-type') ?? '').toLowerCase()
      if (memberRes.error || !memberRes.ok || memberType.includes('text/html')) {
        record(false, 'serves a package-pool member',
          memberRes.error ? String(memberRes.error) : `${memberPath} returned HTTP ${memberRes.status} ${memberType || ''}`.trim(),
          'the pool member must be served as its own text bytes, before the SPA fallback')
      } else {
        const member = await memberRes.text()
        const packageSig = (member.split(/\r?\n/)[0] ?? '').trim().toLowerCase()
        record(SIG_RE.test(packageSig), 'serves a package-pool member',
          SIG_RE.test(packageSig) ? `${entry} names ${packageSig.slice(0, 12)}…` : `${entry} does not begin with a package signature`,
          'a host:packages member begins with the 64-hex package root it offers')

        if (SIG_RE.test(packageSig)) {
          const base = path.slice(0, -`${poolSig}/`.length)
          const packagePath = `${base}${packageSig}`
          const packageRes = await get(packagePath)
          if (packageRes.error || !packageRes.ok) {
            record(false, 'serves the package root its pool names',
              packageRes.error ? String(packageRes.error) : `${packagePath} returned HTTP ${packageRes.status}`,
              'publish every package root before appending its pool member')
          } else {
            const bytes = await packageRes.arrayBuffer()
            const hash = await sha256(bytes)
            const packageAcao = packageRes.headers.get('access-control-allow-origin')
            record(hash === packageSig, 'serves the package root its pool names',
              hash === packageSig ? `${packageSig.slice(0, 12)}… verified` : `served ${hash.slice(0, 12)}…, named ${packageSig.slice(0, 12)}…`,
              'the package root bytes must hash to the signature advertised by the pool member')
            record(packageAcao === '*' || (packageAcao != null && packageAcao !== ''),
              'package bytes are readable cross-origin', packageAcao ?? '(no header)',
              'set Access-Control-Allow-Origin on immutable content so another host can pull and verify the package')
          }
        }
      }
    }
  } else {
    const network = probes.find(p => p.res.error)
    const redirected = probes.find(p => p.res.status >= 300 && p.res.status < 400)
    const swallowed = probes.find(p => p.res.ok && p.type.includes('text/html'))
    const unexpected = probes.find(p => !p.res.error && p.res.status !== 404)
    if (network) {
      record(false, 'serves the packages pool at its address', String(network.res.error), 'unexpected network failure')
    } else if (redirected) {
      record(false, 'serves the packages pool at its address',
        `${redirected.path} returned HTTP ${redirected.res.status} → ${redirected.res.headers.get('location') ?? '?'}`,
        'a rewrite is answering the pool address; the real directory listing must win')
    } else if (swallowed) {
      record(false, 'serves the packages pool at its address', `${swallowed.path} answered text/html`,
        'the SPA fallback swallowed the pool address — the listing (text/plain, one entry per line) must win before any rewrite')
    } else if (unexpected) {
      record(false, 'serves the packages pool at its address', `${unexpected.path} returned HTTP ${unexpected.res.status}`,
        'the pool address must answer 200 (a listing) or 404 (no pool)')
    } else {
      record(null, 'serves the packages pool at its address', 'HTTP 404 at /content and /',
        'this host offers no packages yet — fine for a shell host; a node cannot install from it')
    }
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
