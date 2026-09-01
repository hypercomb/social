// Shared-filesystem site branch — /shared-filesystem
//
//   node scripts/bridge/_shared-filesystem-build.cjs [--dry]
//
// One ROOT-LEVEL cell carrying the "Publish by Signature" diagram page as a
// POST-IT (the generic HTML-artifact behavior — no new kinds, no new code):
// `visual:postit:note` holds the page (htmlSig), `view:default` opens the
// branch AS the page, the tile shares the existing sticky-note art (SHARE
// RESOURCES: one record, N refs), and the notes explain what the page shows.
// Top-level on purpose: a first-level subdomain maps to a top-level lineage,
// so publishing this branch makes shared-filesystem.<zone> its website.
//
// Idempotent: content-addressed page, decoration-add replaceKind, notes gate
// on first line, ONE build-record seals the pass.

const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const DRY = process.argv.includes('--dry')
const ASSETS = path.join(__dirname, '_shared-filesystem-site')
const SEGMENTS = ['shared-filesystem']
const KIND = 'visual:postit:note'
const MARKER = 'set difference'
// The sticky-note tile art minted for /revolucion/meetup — referenced, never
// copied (N uses = N refs to ONE record).
const ART_SIG = '5e6145aa1f0c3082b2aefe69c6f9d3a61cdd5bbadbc64a17d244be32637ff75a'
const log = (...a) => console.log(...a)

// ── transport ─────────────────────────────────────────────────────────
let ws, pending = new Map(), seq = 0, connected = null
async function connect() {
  if (connected) return connected
  connected = new Promise((res, rej) => {
    ws = new WebSocket(BRIDGE, { maxPayload: 128 * 1024 * 1024 })
    ws.on('open', () => res(ws))
    ws.on('error', rej)
    ws.on('close', () => { connected = null; for (const [, p] of pending) p.rej(new Error('socket closed')); pending.clear() })
    ws.on('message', raw => {
      let m; try { m = JSON.parse(String(raw)) } catch { return }
      const p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timer); p.res(m) }
    })
  })
  return connected
}
async function call(req, timeoutMs = 90_000) {
  await connect()
  const id = `sf-${Date.now()}-${++seq}`
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { pending.delete(id); rej(new Error('bridge timeout: ' + req.op)) }, timeoutMs)
    pending.set(id, { res, rej, timer })
    try { ws.send(JSON.stringify({ ...req, id })) } catch (e) { pending.delete(id); clearTimeout(timer); rej(e) }
  })
}
async function ask(req, attempts = 8) {
  let wait = 2000
  for (let i = 0; i < attempts; i++) {
    try { const r = await call(req); if (r.ok || r.error !== 'no renderer connected') return r }
    catch (e) { if (i === attempts - 1) return { ok: false, error: e.message } }
    await new Promise(r => setTimeout(r, wait)); wait = Math.min(wait * 1.7, 30_000); connected = null
  }
  return { ok: false, error: 'renderer never came back' }
}

// ── guard: never write into the wrong hive ────────────────────────────
async function assertRightHive() {
  const r = await ask({ op: 'layer-at', segments: ['revolucion', 'meetup'] })
  if (!r.ok || r.data?.name !== 'meetup') {
    throw new Error('WRONG HIVE — /revolucion/meetup does not resolve. A stray tab stole the broker slot.')
  }
}

// ── primitives ────────────────────────────────────────────────────────
// `add` = by-name DELTA append. NEVER `update` root membership (SET wipes).
async function ensureRootChild(name) {
  const probe = await ask({ op: 'layer-at', segments: [name] })
  if (probe.ok) return 'present'
  if (DRY) return 'would-create'
  const u = await ask({ op: 'add', segments: [], cells: [name] })
  return u.ok ? 'created' : 'ERR ' + u.error
}

async function ensureNote(segments, text) {
  const parent = segments.slice(0, -1), cell = segments[segments.length - 1]
  const first = text.split('\n')[0].trim()
  const r = await ask({ op: 'note-list', segments })
  const d = r.ok ? r.data : []
  const items = Array.isArray(d) ? d : (Array.isArray(d?.notes) ? d.notes : [])
  const flat = items.filter(n => !(n?.children || []).length && !n?.mark)
  if (flat.map(n => String(n?.text || '').split('\n')[0].trim()).includes(first)) return 'present'
  if (DRY) return 'would-add'
  const a = await ask({ op: 'note-add', segments: parent, cell, text })
  return a.ok ? 'added' : 'ERR ' + a.error
}

const canonicalProps = obj => {
  const out = {}
  for (const k of Object.keys(obj).sort()) out[k] = obj[k]
  return JSON.stringify(out)
}

// Reference the shared sticky art — no new bytes, one record, many refs.
async function wearSharedArt(segments) {
  const art = await ask({ op: 'get-resource', sig: ART_SIG })
  if (!art.ok) throw new Error('shared art sig does not resolve: ' + art.error)
  const lr = await ask({ op: 'layer-at', segments })
  if (!lr.ok) throw new Error('layer-at: ' + lr.error)
  const propsSig = (lr.data.properties || [])[0]
  let props = {}
  if (propsSig) {
    const pr = await ask({ op: 'get-resource', sig: propsSig })
    if (pr.ok && pr.data.encoding === 'text') { try { props = JSON.parse(pr.data.text) } catch {} }
  }
  const worn = String(props?.small?.image || '')
  if (/^[0-9a-f]{64}$/.test(worn)) return 'keeps own ' + worn.slice(0, 12)
  if (DRY) return 'would-wear'
  const merged = { ...props, small: { ...(props.small || {}), image: ART_SIG }, substrate: false }
  const jr = await ask({ op: 'put-resource', text: canonicalProps(merged) })
  if (!jr.ok) throw new Error('put-resource props: ' + jr.error)
  const br = await ask({ op: 'bag-set', segments, slot: 'properties', cells: [jr.data.sig] })
  if (!br.ok) throw new Error('bag-set: ' + br.error)
  const sr = await ask({ op: 'stamp', segments, layer: { substrate: false } })
  if (!sr.ok) throw new Error('stamp: ' + sr.error)
  return 'wearing ' + ART_SIG.slice(0, 12)
}

// ── notes content ─────────────────────────────────────────────────────
const INSTRUCTION = 'The "Publish by Signature" diagram as a post-it: open it for the page. Publishing this branch serves it at shared-filesystem.hypercomb.com — the page explains the very mechanism that publishes it.'

const NOTE = [
  'Publish by Signature — one store, every subdomain',
  '',
  'This cell carries the diagram page showing how every hosted subdomain shares one signature-addressed file system: sites are lineage-head pointers into the same store of sig-named cells, so a publish is a set difference — only signatures the store lacks ever cross the wire, and duplication is structurally impossible.',
  '',
  'Figure 1 shows the real hostnames (pluginthematrix.com, revolucion, arkanoid, meetup, the * wildcard) resolving through one worker into one store, with a cell shared by two trees stored once. Figure 2 walks an incremental publish: six files signed, four skipped as already present, two uploaded, one head-marker flip goes live everywhere.',
  '',
  'The branch is deliberately top-level: a first-level subdomain maps to a top-level lineage, so publishing /shared-filesystem is the whole deployment for the bound zone.',
].join('\n')

// ── main ──────────────────────────────────────────────────────────────
async function main() {
  await assertRightHive()
  log(`building /${SEGMENTS.join('/')}${DRY ? ' (dry)' : ''}`)
  log('  tile       :', await ensureRootChild(SEGMENTS[0]))

  if (!DRY) {
    const probe = await ask({ op: 'layer-at', segments: SEGMENTS })
    if (!probe.ok) {
      const mk = await ask({ op: 'update', segments: SEGMENTS, layer: { name: SEGMENTS[SEGMENTS.length - 1] } })
      if (!mk.ok) throw new Error('materialize child layer: ' + mk.error)
      log('  layer      : materialized')
    }
  }

  const html = fs.readFileSync(path.join(ASSETS, 'page.html'), 'utf8')
  let htmlSig = '(dry)'
  if (!DRY) {
    const put = await ask({ op: 'put-resource', text: html })
    if (!put.ok) throw new Error('put page: ' + put.error)
    htmlSig = String(put.data.sig)
    const deco = await ask({
      op: 'decoration-add',
      segments: SEGMENTS,
      kind: KIND,
      appliesTo: SEGMENTS,
      // No wall-clock fields — identical content must mint an identical record.
      payload: { version: 1, title: 'Publish by Signature', htmlSig },
      mark: 'persistent',
      replaceKind: true,
    })
    if (!deco.ok) throw new Error('decoration-add: ' + deco.error)
    log(`  post-it    : html ${htmlSig.slice(0, 12)}… deco ${String(deco.data.sig).slice(0, 12)}…${deco.data.unchanged ? ' (unchanged)' : ''}`)

    const view = await ask({
      op: 'decoration-add',
      segments: SEGMENTS,
      kind: 'view:default',
      appliesTo: SEGMENTS,
      payload: { view: 'postit' },
      mark: 'persistent',
      replaceKind: true,
    })
    if (!view.ok) throw new Error('view:default decoration-add: ' + view.error)
    log(`  opens-as   : postit (${String(view.data.sig).slice(0, 12)}…${view.data.unchanged ? ' unchanged' : ''})`)
  }

  log('  instruction:', await ensureNote(SEGMENTS, INSTRUCTION))
  log('  note       :', await ensureNote(SEGMENTS, NOTE))
  log('  art        :', await wearSharedArt(SEGMENTS))

  // Verify by read-back FROM the hive. replaceKind is removeSig-then-append,
  // so poll until the commit settles.
  if (!DRY) {
    let page = false, opensAs = false, roundTrip = false, art = false
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(r => setTimeout(r, 2500))
      page = false; opensAs = false
      const layer = await ask({ op: 'layer-at', segments: SEGMENTS })
      const decoSigs = Array.isArray(layer?.data?.decorations) ? layer.data.decorations : []
      for (const sig of decoSigs) {
        const r = await ask({ op: 'get-resource', sig })
        if (!r.ok) continue
        try {
          const rec = JSON.parse(r.data.text)
          if (rec.kind === KIND && rec.payload?.htmlSig === htmlSig) page = true
          if (rec.kind === 'view:default' && rec.payload?.view === 'postit') opensAs = true
        } catch {}
      }
      const back = await ask({ op: 'get-resource', sig: htmlSig })
      roundTrip = back.ok && String(back.data.text || '').includes(MARKER)
      const propsSig = (layer?.data?.properties || [])[0]
      art = false
      if (propsSig) {
        const pr = await ask({ op: 'get-resource', sig: propsSig })
        if (pr.ok) { try { art = /^[0-9a-f]{64}$/.test(JSON.parse(pr.data.text)?.small?.image || '') } catch {} }
      }
      if (page && opensAs && roundTrip && art) break
    }
    log(`  verify     : page:${page} opens-as:${opensAs} bytes:${roundTrip} art:${art}`)
    if (!page || !opensAs || !roundTrip || !art) throw new Error('read-back verification FAILED')

    const rev = await ask({ op: 'build-record', segments: SEGMENTS, label: 'shared filesystem diagram' })
    log('  record     :', rev.ok ? `sealed ${String(rev.data.seal || rev.data.label || '').slice(0, 12)}` : 'ERR ' + rev.error)
  }

  log('done')
  try { ws.close() } catch {}
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1) })
