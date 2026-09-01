// REPLICATION BY SIGNATURE — the presentation, into the hive as ONE atomic unit.
//
//   node scripts/bridge/_replication-presentation.cjs [--dry]
//
// STRATEGY (Jaime, 2026-08-30): start atomic, refine by breaking apart.
//
// The whole deck goes in as a SINGLE self-contained page on a SINGLE tile.
// That is the prototype, and it is already complete, hostable and shareable
// as it stands. Nothing is pre-split into parts it has not earned yet.
//
// When a piece of it wants its own life — a stage that needs its own work, a
// diagram that belongs to more than one deck — `/break-apart` splits it out
// into its own tile with its own HTML, and the relation between the pieces is
// carried by MARKS (enrolment, groups), never by a parent that owns them. The
// same way a stylesheet composes: small named things, related by reference,
// each replaceable on its own.
//
// So this script deliberately does NOT create eight slide tiles. Slide
// captures are kept on disk (tmp-preview/slides) for the pass that breaks the
// deck apart, if and when that pass is wanted.
//
// IDEMPOTENT. The page is content-addressed, so re-running mints the same
// signature; `replaceKind` keeps one page per cell; the note is gated on its
// own first line. Safe to re-run after a wedged renderer.

const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const DRY = process.argv.includes('--dry')

const REPO = path.join(__dirname, '..', '..')
const DECK = path.join(REPO, 'tmp-preview', 'deck.html')

const BRANCH = ['hypercomb', 'architecture']
const CELL = 'replication-by-signature'
const PAGE_KIND = 'visual:website:page'
const ARTIFACT_URL = 'https://claude.ai/code/artifact/fc3dfbce-5ea8-44e8-85ad-dcb2692e8cd2'

const NOTE = [
  'Replication by signature — how servers come to hold the same content.',
  '',
  'An eight-stage interactive walkthrough: the idea, the shim, the handshake, inflate, fetching everything, the second server, subscribing to updates, and publishing a node. It is one self-contained page — no external files, no build step — so it hosts and publishes exactly as it stands.',
  '',
  'ATOMIC ON PURPOSE. This is the prototype, whole. If a stage later needs its own work, or a diagram turns out to belong to more than one deck, break that piece out into its own tile with its own page and relate the pieces by marks. Nothing is split before it has earned a life of its own.',
  '',
  'Slide captures of all eight stages are held in the repo at tmp-preview/slides, ready for the pass that breaks this apart into per-slide tiles.',
  '',
  'Interactive source: ' + ARTIFACT_URL,
].join('\n')

// ── the standalone document ───────────────────────────────────────────
//
// The artifact host supplies the document shell, so the source file starts at
// the <title>. A page in the hive has to stand on its own — served straight
// off a dumb static host with no rewrite rules — so it gets a real shell here.
// Everything else is already inline: no `resource:` refs, no external CSS, no
// scripts to fetch. The one outbound request is Google Fonts, and every face
// declares a real fallback stack, so the page holds if it never arrives.
function standalone(body) {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="description" content="How two servers come to hold the same content, starting from one signature.">',
    body,
    '</head>',
    '<body>',
    '</body>',
    '</html>',
  ].join('\n')
}

// ── bridge ────────────────────────────────────────────────────────────

let counter = 0
function send(req) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE, { maxPayload: 64 * 1024 * 1024 })
    const t = setTimeout(() => { try { ws.close() } catch {} ; reject(new Error('bridge timeout')) }, 45_000)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id: `repl-${Date.now()}-${++counter}` })))
    ws.on('message', raw => {
      clearTimeout(t)
      try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) }
      try { ws.close() } catch {}
    })
    ws.on('error', e => { clearTimeout(t); reject(e) })
  })
}

async function ask(req, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await send(req)
      if (r.ok || r.error !== 'no renderer connected') return r
    } catch (e) { if (i === attempts - 1) throw e }
    await new Promise(r => setTimeout(r, 1500))
  }
  return { ok: false, error: 'renderer never connected' }
}

const log = (...a) => console.log(...a)

/**
 * Make sure `name` exists under `parent`, WITHOUT ever reading or rewriting
 * the parent's children slot.
 *
 * The obvious implementation — read the children, merge, `update` — is a trap
 * here. A parent's `children` holds LAYER signatures, and a layer sig is not
 * a resource: `get-resource` on one answers "resource not found". So the read
 * comes back empty on a perfectly healthy hive, the merge produces a list of
 * one, and `update` SETS the slot to that one, deleting every sibling. It
 * fails silently and positively, which is the worst way to fail.
 *
 * Two rules avoid it. Ask whether the CHILD PATH resolves, rather than
 * enumerating the parent — one cheap call, no name decoding. And create with
 * `add`, which the committer turns into an APPEND for the parent's slot and
 * which therefore cannot drop a sibling even if this read were wrong.
 */
async function ensureCell(parent, name) {
  const at = [...parent, name]
  const here = await ask({ op: 'layer-at', segments: at })
  if (here.ok) { log(`  = /${at.join('/')}`); return }
  if (DRY) { log(`  + /${at.join('/')} would be created`); return }
  const r = await ask({ op: 'add', segments: parent, cells: [name] })
  log(`  ${r.ok ? '+' : '!'} /${at.join('/')}${r.ok ? '' : ' ' + r.error}`)
  if (!r.ok) process.exit(1)
}

async function noteFirstLines(segments) {
  const res = await ask({ op: 'note-list', segments })
  const data = res.ok ? res.data : []
  const items = Array.isArray(data) ? data : (Array.isArray(data && data.notes) ? data.notes : [])
  return items.map(n => String((n && n.text) || '').split('\n')[0].trim())
}

async function ensureNote(segments, text) {
  const first = text.split('\n')[0].trim()
  const have = await noteFirstLines(segments)
  if (have.includes(first)) { log(`  = note on /${segments.join('/')}`); return }
  if (DRY) { log(`  + note on /${segments.join('/')} would be written`); return }
  const cell = segments[segments.length - 1]
  const r = await ask({ op: 'note-add', segments: segments.slice(0, -1), cell, text })
  log(`  ${r.ok ? '+' : '!'} note on /${segments.join('/')}${r.ok ? '' : ' ' + r.error}`)
}

// ── the pass ──────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(DECK)) {
    console.error(`[deck] missing ${DECK}`)
    process.exit(1)
  }
  const html = standalone(fs.readFileSync(DECK, 'utf8'))
  log(`replication-by-signature -> /${[...BRANCH, CELL].join('/')}`)
  log(`  page ${(html.length / 1024).toFixed(1)} KB, self-contained`)
  if (DRY) log('  (dry run - nothing is written)')

  const probe = await ask({ op: 'layer-at', segments: [] })
  if (!probe.ok && /renderer/.test(probe.error || '')) {
    console.error(`\n[bridge] ${probe.error} - start the broker and attach a renderer, then re-run.`)
    process.exit(1)
  }

  // The branch. Filing only: a tile has to live somewhere, and where it is
  // filed is not what it IS.
  log('\nbranch')
  await ensureCell([], BRANCH[0])
  await ensureCell([BRANCH[0]], BRANCH[1])
  await ensureCell(BRANCH, CELL)

  const segments = [...BRANCH, CELL]

  // The atomic unit: one tile, one page, whole.
  log('\npage')
  if (DRY) {
    log(`  + would put ${(html.length / 1024).toFixed(1)} KB and mark ${PAGE_KIND}`)
  } else {
    const put = await ask({ op: 'put-resource', text: html })
    if (!put.ok) { console.error(`  ! put-resource failed: ${put.error}`); process.exit(1) }
    log(`  + html ${put.data.sig} (${put.data.bytes} bytes)`)

    const dec = await ask({
      op: 'decoration-add',
      segments,
      appliesTo: segments,
      kind: PAGE_KIND,
      payload: { htmlSig: put.data.sig },
      mark: 'persistent',
      // One page per cell: replace any earlier page rather than stacking them.
      replaceKind: true,
    })
    log(`  ${dec.ok ? '+' : '!'} ${PAGE_KIND} on /${segments.join('/')}${dec.ok ? '' : ' ' + dec.error}`)
  }

  log('\nnote')
  await ensureNote(segments, NOTE)

  // Seal the pass: page + decoration + note become ONE restorable build
  // revision at the cell (documentation/build-revisions.md). Free when
  // nothing changed, so idempotency holds.
  log('\nseal')
  if (DRY) {
    log(`  + build-record on /${segments.join('/')} would be minted`)
  } else {
    const rev = await ask({ op: 'build-record', segments, label: 'replication-by-signature build' })
    log(rev.ok
      ? `  + build revision "${rev.data.label}" seal=${rev.data.seal.slice(0, 12)}${rev.data.unchanged ? ' (unchanged)' : ''}`
      : `  ! build-record failed: ${rev.error}`)
    if (!rev.ok) process.exit(1)
  }

  log('\ndone.')
}

main().catch(e => { console.error(e); process.exit(1) })
