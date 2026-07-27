// scripts/audit-atomicity.cjs — the continuous atomicity audit.
//
// Verifies the build-revisions standard (documentation/build-revisions.md)
// keeps holding — "a multi-file build pass is ONE restorable step" — in the
// two places it can drift:
//
//   STATIC  — producer scripts. Any script that mints resources
//             (`put-resource`) AND stamps anchors (`decoration-add`/`bag-set`)
//             is a producer; a multi-anchor producer must end its pass with
//             `build-record`. New producers missing it = DRIFT. The frozen
//             KNOWN_DEBT list below tracks producers that predate (or lost)
//             their wiring — re-wiring one is debt paid: remove it here AND
//             from the doctrine ratchet so both click tight.
//
//   LIVE    — the hive itself, over the bridge (non-mutating). For each known
//             site root: `{ op:'build-record', dryRun:true }` seals the live
//             subtree and compares against the `builds` slot head. A root
//             with content but NO recorded build = DRIFT (pages were stamped
//             without minting the revision). A changed-since-last-build root
//             is reported as info — user edits between builds are legitimate.
//
//   ATOMIC RENDER — the invariant behind hide/unhide-any-subset ("features
//             on/off by node", documentation/build-revisions.md): every
//             renderable piece must carry its COMPLETE closure, so any
//             subset renders perfectly alone. Checked mechanically: walk
//             each site root's cells → page slots/decorations → page bytes →
//             extracted `resource:`/bare-sig refs → every sig must resolve
//             locally. A hole = the one thing that can break subset render.
//
// Run:      node scripts/audit-atomicity.cjs            (from src/)
// Exit:     0 conforming (or live skipped — bridge/op unavailable), 1 drift.
// Schedule: a periodic routine runs this and only escalates on exit 1; the
//           vitest doctrine ratchet enforces the STATIC half on every test
//           run independently.
//
// Requires for the live half: broker on ws://127.0.0.1:2401 + a renderer tab
// (?claudeBridge=1) built with the `build-record` op. Both absent → the live
// half is skipped with a note, never a failure — the audit must be safe to
// run anywhere, anytime.

const { readdirSync, readFileSync, statSync } = require('fs')
const { join, relative } = require('path')

const SRC = join(__dirname, '..')
const SCRIPTS = __dirname

// ── static config (frozen — may only shrink; see doctrine.spec.ts twin) ──

/** Producers whose single write anchor already versions them (page-slot or
 *  per-cell chain) — build-record is genuinely n/a. */
const SINGLE_ANCHOR = new Set([
  'scripts/ai-inside/test-edge-aihive.cjs',      // test harness, throwaway page
  'scripts/bridge/_dashboard-refresh.cjs',       // one page, one cell
  'scripts/bridge/_put-file.cjs',                // single-file utility
  'scripts/bridge/_tutor-deck.cjs',              // per-cell atomic bag-set
  'scripts/build-hypercomb-articles.cjs',        // single page
  'scripts/meaning-loop-phase1.ts',              // structure ingest, not an artifact build
])

/** Multi-anchor producers KNOWN to lack the end-of-pass build-record.
 *  FROZEN DEBT: wiring one = remove it here and the ratchet clicks. */
const KNOWN_DEBT = new Set([
  'scripts/bridge/_ai-privacy-build.cjs',
  'scripts/bridge/_ai-privacy-chart.cjs',
  'scripts/bridge/_generate-dolphin-pages.cjs',
  'scripts/bridge/_pheromone-workflow.cjs',
])

/** Site roots the live probe checks — the roots the producers above target.
 *  Extend when a new multi-page root ships. */
const SITE_ROOTS = [
  ['dolphin'], ['dashboard'], ['humanity-centres'], ['susan'], ['howard'],
  ['ai-inside'], ['revolucion'], ['diagrams'],
]

// ── static sweep ────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(cjs|mjs|ts|js)$/.test(entry.name)) out.push(full)
  }
  return out
}

function staticAudit() {
  const drift = []
  const debtStillOpen = []
  const debtPaid = []
  for (const file of walk(SCRIPTS)) {
    let code
    try { if (statSync(file).size > 2_000_000) continue; code = readFileSync(file, 'utf8') } catch { continue }
    const isProducer = code.includes('put-resource') && (code.includes('decoration-add') || code.includes('bag-set'))
    if (!isProducer) continue
    const rel = 'scripts/' + relative(SCRIPTS, file).replace(/\\/g, '/')
    if (rel === 'scripts/audit-atomicity.cjs') continue          // self
    const wired = code.includes('build-record')
    if (SINGLE_ANCHOR.has(rel)) continue                          // n/a by design
    if (KNOWN_DEBT.has(rel)) { (wired ? debtPaid : debtStillOpen).push(rel); continue }
    if (!wired) drift.push(rel)
  }
  return { drift, debtStillOpen, debtPaid }
}

// ── live probe (non-mutating) ───────────────────────────────────────────

let WebSocket = null
try { WebSocket = require('ws') } catch { /* live half degrades to skipped */ }

let counter = 0
function send(req, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:2401')
    const id = `audit-${Date.now()}-${++counter}`
    const t = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, timeout)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
    ws.on('message', raw => { clearTimeout(t); try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) } ws.close() })
    ws.on('error', e => { clearTimeout(t); reject(e) })
  })
}

async function liveAudit() {
  const out = { skipped: null, unrecorded: [], changed: [], conforming: [], unresolvable: [] }
  if (!WebSocket) { out.skipped = 'ws module unavailable'; return out }

  try {
    const probe = await send({ op: 'list-at', segments: [] }, 8_000)
    if (!probe.ok) { out.skipped = `no renderer (${probe.error})`; return out }
  } catch (e) { out.skipped = `bridge unreachable (${e.message})`; return out }

  for (const root of SITE_ROOTS) {
    const name = '/' + root.join('/')
    let layer
    try { layer = await send({ op: 'layer-at', segments: root }, 10_000) } catch { out.unresolvable.push(name); continue }
    // A root that doesn't exist (or is empty) has nothing to be atomic about.
    const hasContent = layer.ok && layer.data && (
      (Array.isArray(layer.data.children) && layer.data.children.length > 0) ||
      (Array.isArray(layer.data.decorations) && layer.data.decorations.length > 0)
    )
    if (!hasContent) continue

    let res
    try { res = await send({ op: 'build-record', segments: root, dryRun: true }) } catch (e) { out.unresolvable.push(`${name} (${e.message})`); continue }
    if (!res.ok) {
      if (String(res.error || '').startsWith('unknown op')) { out.skipped = 'renderer predates the build-record op — rebuild essentials to activate the live audit'; return out }
      out.unresolvable.push(`${name} (${res.error})`)
      continue
    }
    const d = res.data || {}
    if (!d.sig) out.unrecorded.push(name)                          // content, no build revision ever
    else if (d.unchanged) out.conforming.push(name)
    else out.changed.push(`${name} (last: "${d.label}")`)
  }
  return out
}

// ── atomic-render closure probe (non-mutating) ──────────────────────────

const PAGE_KIND = 'visual:website:page'
const SIG_RE = /^[0-9a-f]{64}$/
const NODE_CAP = 300        // per root — bound the walk
const REF_CHECK_CAP = 800   // per run — bound resource fetches

/** The two ref forms the renderer rewrites and the closure walk carries
 *  (decoration-closure.ts): `resource:<sig>` anywhere, bare 64-hex on
 *  src/href/data-src attributes. */
function extractRefSigs(html) {
  const out = new Set()
  for (const m of String(html).matchAll(/resource:([0-9a-f]{64})/g)) out.add(m[1])
  for (const m of String(html).matchAll(/(?:src|href|data-src)\s*=\s*["']([0-9a-f]{64})["']/g)) out.add(m[1])
  return out
}

function flattenTree(node, segments, out) {
  if (!node || typeof node.name !== 'string' || out.length >= NODE_CAP) return
  const here = [...segments, node.name]
  out.push(here)
  for (const child of (Array.isArray(node.children) ? node.children : [])) flattenTree(child, here, out)
}

async function closureAudit() {
  const out = { holes: [], pages: 0, refsChecked: 0, capped: false }
  const resolvable = new Map()   // sig → boolean (global dedupe)

  const resolves = async (sig) => {
    if (resolvable.has(sig)) return resolvable.get(sig)
    if (out.refsChecked >= REF_CHECK_CAP) { out.capped = true; return true }
    out.refsChecked++
    let okFlag = false
    try { const r = await send({ op: 'get-resource', sig, text: 'base64' }, 20_000); okFlag = !!r.ok } catch { okFlag = false }
    resolvable.set(sig, okFlag)
    return okFlag
  }

  for (const root of SITE_ROOTS) {
    let tree
    try { tree = await send({ op: 'inflate', segments: root }, 60_000) } catch { continue }
    if (!tree.ok || !tree.data) continue
    const cells = []
    flattenTree({ name: root[root.length - 1], children: tree.data.children }, root.slice(0, -1), cells)

    for (const segments of cells) {
      let layer
      try { layer = await send({ op: 'layer-at', segments }, 15_000) } catch { continue }
      if (!layer.ok || !layer.data) continue
      const cellName = '/' + segments.join('/')

      // Candidate page sigs: the `website` slot's newest entry + every
      // visual:website:page decoration's htmlSig.
      const pageSigs = new Set()
      const slot = layer.data.website
      if (Array.isArray(slot) && slot.length) {
        const newest = String(slot[slot.length - 1])
        if (SIG_RE.test(newest)) pageSigs.add(newest)
      }
      for (const raw of (Array.isArray(layer.data.decorations) ? layer.data.decorations : [])) {
        const decSig = String(raw)
        if (!SIG_RE.test(decSig)) continue
        if (!(await resolves(decSig))) { out.holes.push(`${cellName} — decoration record ${decSig.slice(0, 12)}… missing`); continue }
        try {
          const r = await send({ op: 'get-resource', sig: decSig }, 15_000)
          if (r.ok && r.data && r.data.encoding === 'text') {
            const rec = JSON.parse(r.data.text)
            const htmlSig = String((rec && rec.payload && rec.payload.htmlSig) || '')
            if (rec && rec.kind === PAGE_KIND && SIG_RE.test(htmlSig)) pageSigs.add(htmlSig)
          }
        } catch { /* not JSON / not a page record — fine */ }
      }

      for (const pageSig of pageSigs) {
        out.pages++
        let page
        try { page = await send({ op: 'get-resource', sig: pageSig }, 20_000) } catch { page = { ok: false } }
        if (!page.ok || page.data?.encoding !== 'text') {
          out.holes.push(`${cellName} — page ${pageSig.slice(0, 12)}… ${page.ok ? 'not text' : 'missing'}`)
          continue
        }
        for (const ref of extractRefSigs(page.data.text)) {
          if (!(await resolves(ref))) out.holes.push(`${cellName} — page ${pageSig.slice(0, 12)}… references missing ${ref.slice(0, 12)}…`)
        }
      }
    }
  }
  return out
}

// ── report ──────────────────────────────────────────────────────────────

async function main() {
  console.log('atomicity audit —', new Date().toISOString())

  const s = staticAudit()
  let failed = false

  if (s.drift.length) {
    failed = true
    console.log(`\nSTATIC DRIFT — new multi-anchor producers without an end-of-pass build-record:`)
    for (const f of s.drift) console.log(`  ${f}`)
    console.log(`  → add { op: 'build-record', segments: [<root>], label } as the pass's last op.`)
  }
  if (s.debtPaid.length) {
    failed = true
    console.log(`\nDEBT PAID — now wired; remove from KNOWN_DEBT here AND in doctrine.spec.ts so the ratchet clicks:`)
    for (const f of s.debtPaid) console.log(`  ${f}`)
  }
  if (s.debtStillOpen.length) {
    console.log(`\nknown debt (frozen, ${s.debtStillOpen.length} producers still unwired — informational):`)
    for (const f of s.debtStillOpen) console.log(`  ${f}`)
  }
  if (!s.drift.length && !s.debtPaid.length) console.log('static: conforming (no new unwired producers)')

  const live = await liveAudit()
  if (live.skipped) {
    console.log(`\nlive: skipped — ${live.skipped}`)
  } else {
    if (live.unrecorded.length) {
      failed = true
      console.log(`\nLIVE DRIFT — roots with content but NO build revision (pages stamped without minting):`)
      for (const r of live.unrecorded) console.log(`  ${r}`)
      console.log(`  → run the producer with its build-record call, or /builds record at the root.`)
    }
    if (live.changed.length) {
      console.log(`\nchanged since last build revision (informational — user edits are legitimate):`)
      for (const r of live.changed) console.log(`  ${r}`)
    }
    if (live.unresolvable.length) {
      console.log(`\nunresolvable roots (bridge errors — rerun when stable):`)
      for (const r of live.unresolvable) console.log(`  ${r}`)
    }
    console.log(`\nlive: ${live.conforming.length} conforming${live.conforming.length ? ` (${live.conforming.join(', ')})` : ''}`)

    const closure = await closureAudit()
    if (closure.holes.length) {
      failed = true
      console.log(`\nATOMIC RENDER DRIFT — pieces whose closure has a hole (subset render would break):`)
      for (const h of closure.holes) console.log(`  ${h}`)
      console.log(`  → re-push/re-adopt the missing resource, or re-run the producer that minted the piece.`)
    }
    console.log(`atomic render: ${closure.pages} pages walked, ${closure.refsChecked} refs checked${closure.capped ? ` (capped at ${REF_CHECK_CAP} — rerun to continue)` : ''}, ${closure.holes.length} holes`)
  }

  console.log(failed ? '\nRESULT: DRIFT — atomicity standard violated, see above.' : '\nRESULT: conforming.')
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error('audit failed to run:', e); process.exit(1) })
