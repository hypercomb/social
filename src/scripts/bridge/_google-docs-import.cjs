// Import the participant's Google Docs into the hive as tiles.
//
//   node scripts/bridge/_google-docs-import.cjs [--limit N] [--dry] [--parent "Google Docs"]
//
// One tile per document, under a single parent. Each tile gets:
//   • the markdown body in its first-class `document` slot (put-resource + bag-set)
//   • a `visual:google:doc` decoration recording WHERE it came from
//   • a note saying what it is
// The pass ends with ONE build revision at the parent root
// (documentation/build-revisions.md R3) — the whole import restores as a unit.
//
// RESUMABLE + IDEMPOTENT. A manifest in the scratchpad records docId -> cell +
// version + bodySig; a re-run skips documents whose Google version has not
// moved. That matters because 30 documents is ~150 bridge ops and any one of
// them can fail on a renderer blink — a failed run must be re-runnable without
// minting duplicate tiles.
//
// Tiles are created with the `add` op (which APPENDS to the parent's children),
// never `update` with a `children` array — that is a SET and would wipe every
// sibling already there.

const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const BRIDGE = 'ws://localhost:2401'
const ENDPOINT = 'https://script.google.com/macros/s/AKfycbzHUhyf-1LvAw9_q9nc0PKSEI6eg7mLcLpdl5ulRUsOglY_iRUv1VmwmBCdsc2-62Me1A/exec'
const TOKEN = 'GIucoJPJQLLPSrqwR2SEJyDgAiyEB7Ii'
const GOOGLE_DOC_KIND = 'visual:google:doc'

const SCRATCH = 'C:/Users/Jaime/AppData/Local/Temp/claude/C--Projects-hypercomb-social-src/5e2f2a96-f4b8-46eb-ae2e-dfd4c4fcf2ad/scratchpad'
const MANIFEST = path.join(SCRATCH, 'google-docs-import.json')

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(name)
  return i === -1 ? fallback : args[i + 1]
}
const LIMIT = Number(flag('--limit', '0')) || 0
const DRY = args.includes('--dry')
const PARENT_LABEL = flag('--parent', 'Google Docs')
/** The deploying account — anything owned by someone else is shared-with-me. */
const SELF = flag('--self', 'tsiktech@gmail.com')

/** Mirrors hypercomb-core/src/cell.ts exactly — the hive normalizes every name
 *  it is given, so the tile's real address is this, not what we typed. */
function normalizeCell(s) {
  return String(s)
    .trim()
    .toLocaleLowerCase()
    .replace(/[._\s]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '')
}

let counter = 0

/**
 * One bridge op, retrying while the RENDERER is momentarily away.
 *
 * The hive tab drops and re-establishes its socket regularly (a dev-server
 * reload is enough), and a 26-document pass is ~150 ops — long enough that a
 * blink lands mid-run almost every time. Only transport-shaped failures are
 * retried; a real op error (bad segments, cold cell) fails immediately, since
 * retrying those just hides them.
 */
async function bridge(req, tries = 30) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await bridgeOnce(req)
    } catch (err) {
      const transient = /no renderer|bridge timeout|ECONNREFUSED|socket hang up/i.test(err.message)
      if (!transient || attempt >= tries) throw err
      await new Promise(r => setTimeout(r, 4000))
    }
  }
}

function bridgeOnce(req) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE)
    const timer = setTimeout(() => { try { ws.close() } catch {} ; reject(new Error('bridge timeout')) }, 30000)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id: `gdi-${Date.now()}-${++counter}` })))
    ws.on('message', (raw) => {
      clearTimeout(timer)
      let parsed
      try { parsed = JSON.parse(String(raw)) } catch { reject(new Error('bad bridge response')); return }
      try { ws.close() } catch {}
      if (!parsed.ok) reject(new Error(parsed.error || 'bridge op failed'))
      else resolve(parsed.data)
    })
    ws.on('error', (e) => { clearTimeout(timer); reject(e) })
  })
}

const google = async (params) => {
  const url = new URL(ENDPOINT)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  url.searchParams.set('token', TOKEN)
  const r = await fetch(url.toString())
  const d = await r.json()
  if (!d.ok) throw new Error(d.error || 'google call failed')
  return d
}

const loadManifest = () => {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) } catch { return { docs: {} } }
}
const saveManifest = (m) => fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 1))

/**
 * Where a document actually lives, told honestly.
 *
 * Most of these documents have NO parent folder — not a bug in the export:
 * they are SHARED WITH ME files owned by other people, which sit in no folder
 * of this Drive at all. Saying "My Drive" for those would be a lie, so the
 * owner becomes the location instead.
 */
function locationOf(doc) {
  const folders = (doc.parents || []).map(p => p.name).filter(Boolean)
  if (folders.length) return { label: folders.join(' / '), tags: folders.map(normalizeCell) }
  if (doc.owner && doc.owner !== SELF) return { label: `Shared with me · owned by ${doc.owner}`, tags: ['shared-with-me'] }
  return { label: 'My Drive (no folder)', tags: ['my-drive'] }
}

/**
 * Set the tile's truth slots in ONE write, carrying every existing slot across.
 *
 * ── Why not bag-set ──────────────────────────────────────────────────
 *
 * `bag-set` on any slot other than `children` commits through
 * `committer.update` with a PARTIAL layer, and that REPLACES the layer — every
 * other slot on the tile is dropped. (The op's own comment says other slots are
 * untouched; it is wrong. Verified the hard way: a properties-only bag-set on
 * 21 populated tiles left each of them holding `properties` alone, with
 * `document`, `decorations` and `notes` gone.)
 *
 * So the layer is read, spread, and written back whole. `children` is deleted
 * from the spread because it is a NAME slot in `update` — passing the sigs a
 * layer actually stores would resolve each sig AS A TILE NAME and mint husk
 * tiles. These document tiles have no children, so dropping it is safe here.
 *
 * `decoration-add` and `note-add` genuinely do merge, so they run AFTER this.
 */
async function writeTileLayer(segments, { bodySig, props }) {
  let layer = {}
  try { layer = await bridge({ op: 'layer-at', segments }) } catch { /* fresh tile */ }

  let current = {}
  const priorSig = Array.isArray(layer?.properties) ? layer.properties[0] : null
  if (priorSig) {
    try {
      const res = await bridge({ op: 'get-resource', sig: priorSig })
      const parsed = JSON.parse(res.text || '{}')
      if (parsed && typeof parsed === 'object') current = parsed
    } catch { /* unreadable — treated as empty */ }
  }

  const tags = [...new Set([...(Array.isArray(current.tags) ? current.tags : []), ...(props.tags || [])])]
  const { sig: propsSig } = await bridge({
    op: 'put-resource',
    text: JSON.stringify({ ...current, ...props, tags }),
  })

  const next = { ...layer, name: layer.name || segments[segments.length - 1], properties: [propsSig] }
  if (bodySig) next.document = [bodySig]
  delete next.children

  await bridge({ op: 'update', segments, layer: next })
  return { hadDecorations: Array.isArray(layer.decorations) && layer.decorations.length > 0,
           hadNotes: Array.isArray(layer.notes) && layer.notes.length > 0 }
}


/**
 * Names of a branch's children, read from the LAYER.
 *
 * Not `list-at`: that op answers for the renderer's CURRENT location and
 * returns [] (or "path not found") for a populated branch the renderer is not
 * standing in. Reading it as "no children" would make every guarded `add`
 * fire again and duplicate every tile.
 */
async function childNames(segments) {
  let layer
  try { layer = await bridge({ op: 'layer-at', segments }) } catch { return null }
  const names = []
  for (const sig of (layer.children || [])) {
    try { names.push(JSON.parse((await bridge({ op: 'get-resource', sig })).text).name) } catch { /* unresolved */ }
  }
  return names
}

async function main() {
  const parentCell = normalizeCell(PARENT_LABEL)
  console.log(`[import] parent tile: "${PARENT_LABEL}" -> /${parentCell}`)

  const listing = await google({ action: 'list' })
  let docs = listing.docs
  console.log(`[import] ${docs.length} documents in Drive`)

  // Artifacts of bridge testing, not the participant's content. Each apparently
  // failed POST during verification (HTTP 411, then 404) had in fact already
  // run doPost and created a document before the response was lost, so several
  // identical copies exist. They are left in Drive for the participant to
  // delete, but they are not theirs and must not become tiles.
  const TEST_DOC = 'Hypercomb bridge test (safe to delete)'
  const debris = docs.filter(d => d.name === TEST_DOC)
  if (debris.length) {
    docs = docs.filter(d => d.name !== TEST_DOC)
    console.log(`[import] skipping ${debris.length} bridge-test document(s) — testing debris, not content`)
  }

  // OWNED-BY-ME ONLY (participant's rule). Most documents visible to this
  // account are SHARED WITH ME and owned by other people; mirroring those makes
  // tiles for material the participant does not control and cannot push back to.
  const foreign = docs.filter(d => d.owner && d.owner !== SELF)
  if (foreign.length) {
    docs = docs.filter(d => !d.owner || d.owner === SELF)
    console.log(`[import] skipping ${foreign.length} document(s) owned by other people — mirroring only ${SELF}`)
  }

  // Collisions are real: normalizeCell truncates at 64 chars, so two long
  // names can land on the same address and the second `add` would merge into
  // the first tile instead of creating its own.
  const taken = new Map()
  for (const doc of docs) {
    let cell = normalizeCell(doc.name) || 'untitled'
    if (taken.has(cell)) {
      const n = taken.get(cell) + 1
      taken.set(cell, n)
      const suffix = `-${n}`
      cell = (cell.slice(0, 64 - suffix.length) + suffix).replace(/-{2,}/g, '-')
      console.log(`[import] name collision -> ${cell}`)
    } else {
      taken.set(cell, 1)
    }
    doc.cell = cell
  }

  if (LIMIT) docs = docs.slice(0, LIMIT)

  const manifest = loadManifest()
  if (DRY) {
    for (const doc of docs) console.log(`  would import: ${doc.cell}   <- ${doc.name}`)
    console.log(`[import] dry run, nothing written`)
    return
  }

  // `add` APPENDS — it does not upsert. Calling it for a name that is already
  // there mints a SECOND child entry (this is exactly how /google-docs came to
  // be listed twice at root). So every add in this script is guarded by a
  // membership check first.
  const rootNames = await childNames([])
  if (rootNames && !rootNames.includes(parentCell)) {
    await bridge({ op: 'add', cells: [PARENT_LABEL], segments: [] })
    console.log(`[import] parent created`)
  } else {
    console.log(`[import] parent already present`)
  }

  const existing = new Set(await childNames([parentCell]) || [])
  console.log(`[import] ${existing.size} tiles already under /${parentCell}`)

  let created = 0, skipped = 0, failed = 0
  for (const [i, doc] of docs.entries()) {
    const tag = `[${i + 1}/${docs.length}] ${doc.cell}`
    const prior = manifest.docs[doc.id]
    try {
      const body = await google({ action: 'get', id: doc.id, format: 'markdown' })
      const where = locationOf(doc)
      const unchanged = prior && String(prior.version) === String(body.version)

      // Properties are refreshed on EVERY pass, including unchanged documents.
      // The link and the location are cheap to write and were missing from the
      // first import, so a re-run repairs existing tiles instead of only
      // helping new ones.
      let sig = prior && prior.bodySig
      if (!unchanged || !sig) {
        sig = (await bridge({ op: 'put-resource', text: body.content || '' })).sig
      }

      if (!existing.has(doc.cell)) {
        await bridge({ op: 'add', cells: [doc.name], segments: [parentCell] })
        existing.add(doc.cell)
      }

      // ONE write for both truth slots, carrying every other slot across.
      // `link` is what the tile editor's Link field shows and what the open
      // action follows; `tags` make the location navigable and groupable
      // rather than buried in a decoration payload.
      const state = await writeTileLayer([parentCell, doc.cell], {
        bodySig: sig,
        props: { link: doc.url, title: doc.name, tags: ['google-doc', ...where.tags] },
      })
      await bridge({
        op: 'decoration-add',
        segments: [parentCell, doc.cell],
        kind: GOOGLE_DOC_KIND,
        replaceKind: true,
        payload: {
          id: doc.id,
          url: doc.url,
          title: doc.name,
          owner: doc.owner || null,
          version: String(body.version ?? ''),
          // The signature of what GOOGLE EXPORTS — never of what we might later
          // send. The round trip is not byte-identical, so recording sent bytes
          // here would report unpushed edits forever.
          pulledSig: sig,
          pulledAt: body.modified || null,
          folders: (doc.parents || []).map(p => p.name),
          location: where.label,
        },
      })
      // note-add is ADDITIVE — a second pass would stack a duplicate note on
      // the tile. The test is the LAYER's own state, not the manifest: a tile
      // whose notes were wiped needs one back, and a tile that still has its
      // note must not get a second. Asking the layer is authoritative; asking
      // the manifest is a guess about the layer.
      if (!state.hadNotes) {
        await bridge({
          op: 'note-add',
          cell: doc.cell,
          segments: [parentCell],
          text:
            `Mirrored from Google Docs.\n` +
            `Location: ${where.label}\n` +
            `Owner: ${doc.owner || 'unknown'}\n` +
            `The body here is the canonical copy — edit it in the document view; pushing back to Google is a separate step.\n` +
            `Source: ${doc.url}`,
        })
      }

      manifest.docs[doc.id] = {
        cell: doc.cell, name: doc.name, version: String(body.version ?? ''),
        bodySig: sig, chars: (body.content || '').length,
        link: doc.url, location: where.label, noted: true,
      }
      saveManifest(manifest)
      const repaired = !state.hadDecorations || !state.hadNotes
      console.log(
        `${tag} — ${unchanged ? 'refreshed' : 'imported'} (v${body.version}, ${(body.content || '').length} chars)` +
        (repaired ? ' [restored missing slots]' : ''),
      )
      if (unchanged) skipped++; else created++
    } catch (err) {
      console.log(`${tag} — FAILED: ${err.message}`)
      failed++
    }
  }

  // One build revision for the whole pass (documentation/build-revisions.md).
  // Idempotent like everything above: an unchanged seal declines to mint, so
  // a re-run that skipped every document records nothing new.
  try {
    const rev = await bridge({ op: 'build-record', segments: [parentCell], label: 'google docs import' })
    console.log(`[import] build revision: ${rev.label} seal=${String(rev.seal).slice(0, 12)}${rev.unchanged ? ' (unchanged)' : ''}`)
  } catch (err) {
    console.log(`[import] build revision FAILED: ${err.message} — re-run to mint it (imported docs are version-skipped)`)
  }

  console.log(`\n[import] done: ${created} imported, ${skipped} unchanged, ${failed} failed`)
  if (failed) console.log(`[import] re-run to retry the failures — imported docs are skipped by version`)
}

main().then(() => process.exit(0)).catch(e => { console.error('[import] fatal:', e.message); process.exit(1) })
