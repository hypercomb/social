// The directory of doors under the zone, resolved at BUILD time.
//
//   node scripts/presentation/hosts.cjs           # refresh hosts.json + stamp the pages
//   node scripts/presentation/hosts.cjs --check   # report, write nothing
//   node scripts/presentation/hosts.cjs --verify  # dial every door before believing it
//
// hypercomb.com is a wildcard host: publishing a creation named `susan` makes
// `susan.hypercomb.com` its website, with no configuration anywhere. A
// hand-written list on the splash would therefore be stale the moment somebody
// publishes. The worker already derives the ledger from the publishers' signed
// indexes (`/publications.json` → `servePublications` in
// hypercomb-relay/blossom-worker/worker.js); this reads that ledger, keeps the
// doors that are under this zone, and writes hosts.json — which build.cjs bakes
// into the page.
//
// The worker reports every address a creation answers on (`hosts` on each site),
// each already validated back through `resolveSite` and against what is
// deployed. So this script derives nothing: re-deriving `<lineage>.<zone>` here
// was worker logic living in a build script, and the two would drift.
//
// Resolved here rather than in the reader's browser on purpose: a page we serve
// must not make a visitor's browser contact anything
// (documentation/no-third-party-requests.md), and the deliverable is one
// self-contained file. hosts.json is committed, so a build with no network
// produces the same page as one with.
//
// Two pages carry the directory. The presentation splash takes it through the
// `{{DOORS}}` placeholder its build already substitutes; the welcome page is
// hand-authored with no build, so it carries a marked region that this script
// rewrites in place. Same list, same source, one derivation.
const fs = require('fs')
const path = require('path')

const ROOT = __dirname
const ZONE = 'hypercomb.com'
const CACHE = path.join(ROOT, 'hosts.json')
// Hand-authored pages that carry the directory between markers.
const STAMPED = [path.join(ROOT, '..', '..', 'documentation', 'hypercomb.com', 'index.html')]
const BEGIN = '<!-- doors:begin'
const END = '<!-- doors:end -->'
const SIG_RE = /^[0-9a-f]{64}$/
// A DNS label. `install:essentials` is a real lineage and NOT a hostname — the
// ledger reports one plate per creation, and only some creations are nameable.
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

// Where the ledger is read from. The apex is first because that is where it
// belongs once the Azure→worker cutover lands; today the apex is the Azure app,
// which rewrites every unknown path to index.html — so a 200 proves nothing and
// every answer is validated as a real ledger before it is believed. The second
// entry is any label on the zone: `/publications.json` is served by every
// resolved site host, published or not, so it answers even when nothing is
// published under that name.
const LEDGERS = [`https://${ZONE}/publications.json`, `https://directory.${ZONE}/publications.json`]

const get = async (url, ms = 12_000) => {
  const stop = AbortSignal.timeout(ms)
  const res = await fetch(url, { signal: stop, redirect: 'follow', headers: { accept: 'application/json' } })
  return res
}

/** The first candidate that answers with an actual ledger. */
async function readLedger() {
  const failures = []
  for (const url of LEDGERS) {
    try {
      const res = await get(url)
      if (!res.ok) { failures.push(`${url} → ${res.status}`); continue }
      const body = await res.json()
      if (!Array.isArray(body?.sites)) { failures.push(`${url} → not a ledger`); continue }
      return { url, sites: body.sites }
    } catch (e) { failures.push(`${url} → ${e.message}`) }
  }
  throw new Error(`no ledger answered (${failures.join('; ')})`)
}

/** Has any publisher actually put a head behind this site? A bound-but-never-published name is not a door. */
const published = site => (Array.isArray(site?.publishers) ? site.publishers : [])
  .some(p => SIG_RE.test(String(p?.head || '').toLowerCase()))

const byTitle = (a, b) =>
  a.title.toLowerCase().localeCompare(b.title.toLowerCase()) || a.host.localeCompare(b.host)

const doorOf = (host, title) => ({ host, label: host.slice(0, -(ZONE.length + 1)), title })

/**
 * Ledger → the addresses under this zone, straight off `hosts`.
 *
 * The worker reports every door a creation answers on, each one validated back
 * through `resolveSite` and checked against what is actually deployed. That is
 * strictly better evidence than anything this script could gather, so there is
 * nothing to derive and nothing to probe.
 */
function doorsFrom(sites) {
  const doors = new Map()
  for (const site of sites) {
    if (!published(site)) continue
    const title = String(site?.title || '').trim() || String(site?.lineage || '').trim()
    for (const raw of Array.isArray(site?.hosts) ? site.hosts : []) {
      const host = String(raw?.host || '').trim().toLowerCase()
      if (!host.endsWith('.' + ZONE)) continue
      if (!LABEL_RE.test(host.slice(0, -(ZONE.length + 1)))) continue
      if (!doors.has(host)) doors.set(host, doorOf(host, title))
    }
  }
  // `content.<zone>` is the write/relay face and is never a site.
  doors.delete(`content.${ZONE}`)
  return [...doors.values()].sort(byTitle)
}

/**
 * The same answer, worked out here — for a ledger served by a worker that
 * predates `hosts`.
 *
 * DELETE THIS once the worker carrying `hostsOfLineage` is deployed everywhere
 * this script reads from. It is duplicated worker logic, which is the whole
 * reason `hosts` exists; it survives only so the page does not lose every door
 * on the day between this commit and that deploy. `refresh` says loudly when it
 * runs, so a silent fallback can never become the permanent path.
 */
function derivedDoorsFrom(sites) {
  const doors = new Map()
  const add = (host, title) => { if (!doors.has(host)) doors.set(host, doorOf(host, title)) }
  for (const site of sites) {
    if (!published(site)) continue
    const host = String(site?.host || '').trim().toLowerCase()
    const lineage = String(site?.lineage || '').trim()
    const title = String(site?.title || '').trim()
    if (host.endsWith('.' + ZONE) && LABEL_RE.test(host.slice(0, -(ZONE.length + 1)))) add(host, title || lineage)
    else if (lineage && !lineage.includes('/') && LABEL_RE.test(lineage)) add(`${lineage}.${ZONE}`, title || lineage)
  }
  doors.delete(`content.${ZONE}`)
  return [...doors.values()].sort(byTitle)
}

/** A door is only advertised if it opens: the site descriptor has to be there. */
async function answers(door) {
  try { return (await get(`https://${door.host}/site.json`, 15_000)).status === 200 } catch { return false }
}

/** The committed list — what the build uses when the network is not there. */
function load() {
  try {
    const cached = JSON.parse(fs.readFileSync(CACHE, 'utf8'))
    return { zone: String(cached?.zone || ZONE), doors: Array.isArray(cached?.doors) ? cached.doors : [] }
  } catch { return { zone: ZONE, doors: [] } }
}

async function refresh({ write = true, verify = false } = {}) {
  const { url, sites } = await readLedger()
  // A ledger that reports doors is believed. One that does not predates the
  // field, and the addresses have to be worked out here instead — which is the
  // path that goes away, so say so every time it runs.
  const reported = sites.some(site => Array.isArray(site?.hosts))
  const candidates = reported ? doorsFrom(sites) : derivedDoorsFrom(sites)
  if (!reported) console.warn(`  ! ${url} reports no \`hosts\` — deriving and probing (delete derivedDoorsFrom once the worker ships)`)

  const live = []
  for (const door of candidates) {
    // The ledger already proved these through `resolveSite`; a probe adds a
    // round-trip and worse evidence. Derived candidates were proved by nobody.
    const ok = (reported && !verify) || await answers(door)
    console.log(`  ${ok ? '✓' : '·'} ${door.host}${ok ? '' : ' — no answer, left out'}`)
    if (ok) live.push(door)
  }
  if (!live.length) throw new Error(`the ledger at ${url} named ${candidates.length} candidate(s) and none answered`)
  const next = { zone: ZONE, doors: live }
  const before = fs.existsSync(CACHE) ? fs.readFileSync(CACHE, 'utf8') : ''
  const after = JSON.stringify(next, null, 2) + '\n'
  if (write && after !== before) { fs.writeFileSync(CACHE, after); console.log(`hosts.json updated — ${live.length} door(s) under ${ZONE}`) }
  else console.log(`${live.length} door(s) under ${ZONE}${write ? ' — unchanged' : ''}`)
  if (write) for (const file of STAMPED) stamp(file, live)
  return next
}

// ── stamping a hand-authored page ───────────────────────────────────────────
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The welcome page's markup for the directory — its own design language, the same data. */
function pageMarkup(doors) {
  if (!doors.length) return '      <p class="doors-empty">No hive is published under this domain yet.</p>'
  const card = d => `        <a class="door" href="https://${esc(d.host)}/">` +
    `<b>${esc(d.title)}</b><span><em>${esc(d.label)}</em>.${esc(ZONE)}</span></a>`
  return ['      <div class="door-list">', ...doors.map(card), '      </div>'].join('\n')
}

/** Rewrite the region between the markers. A page without them is left alone and reported. */
function stamp(file, doors) {
  let html
  try { html = fs.readFileSync(file, 'utf8') } catch { console.warn(`  · ${path.basename(file)} — not there, skipped`); return false }
  const open = html.indexOf(BEGIN)
  const close = html.indexOf(END)
  if (open < 0 || close < open) { console.warn(`  · ${path.basename(file)} — no doors:begin/doors:end markers, skipped`); return false }
  const head = html.slice(0, html.indexOf('-->', open) + 3)   // the begin marker, kept
  const next = `${head}\n${pageMarkup(doors)}\n      ${html.slice(close)}`
  if (next === html) return false
  fs.writeFileSync(file, next)
  console.log(`  ✎ ${path.basename(file)} — ${doors.length} door(s) stamped`)
  return true
}

module.exports = { ZONE, load, refresh, doorsFrom, derivedDoorsFrom, stamp, STAMPED }

if (require.main === module) {
  refresh({ write: !process.argv.includes('--check'), verify: process.argv.includes('--verify') })
    .catch(e => { console.error('hosts:', e.message); process.exit(1) })
}
