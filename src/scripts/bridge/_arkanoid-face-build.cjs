// Arkanoid arrival face — /games/arkanoid
//
//   node scripts/bridge/_arkanoid-face-build.cjs [--dry]
//
// The published head of /games/arkanoid carried only view:default='document'
// with nothing to mount, so arkanoid.pluginthematrix.com arrived BLANK (the
// arrival gate honestly refuses a view with no content). This pass gives the
// branch its interim face: a themed post-it page (visual:postit:note) and
// view:default='postit', the dylan pattern. The REAL fix — a game-arrival view
// that opens INTO the game — is its own worktree-scale feature (chip raised);
// this page says so in its footer.
//
// No art step on purpose: the post-it takeover draws its own sticky in the
// tile's place, and minting unrequested art onto a bare tile is not ours to do.
//
// Idempotent: content-addressed page, decoration-add replaceKind, notes gate
// on first line, ONE build-record seals the pass.

const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const DRY = process.argv.includes('--dry')
const ASSETS = path.join(__dirname, '_arkanoid-face')
const SEGMENTS = ['games', 'arkanoid']
const KIND = 'visual:postit:note'
const MARKER = 'hand-built walls'
const log = (...a) => console.log(...a)

// ── transport (the _moose-paint pattern) ──────────────────────────────
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
  const id = `ak-${Date.now()}-${++seq}`
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

// ── notes content ─────────────────────────────────────────────────────
const INSTRUCTION = 'The Arkanoid arrival face as a post-it: the branch opens AS this page. Publishing games/arkanoid serves it at arkanoid.pluginthematrix.com. Interim on purpose — the real fix is a game-arrival view that opens INTO the game (its own feature).'

const NOTE = [
  'Arkanoid — the arrival face for the published site',
  '',
  'This cell is the /games/arkanoid lineage head that arkanoid.pluginthematrix.com serves. It arrived blank because the tile carried view:default=document with no document — the arrival gate honestly refused. This post-it is the face: what the game is (100 hand-built walls, 3 themes, 11 pills, a level designer), the controls straight from the overlay help text, and how to play it in the hive (/arkanoid, /breakout, /bricks; /arkanoid design).',
  '',
  'The REAL face is already on this tile, waiting: visual:game:play {gameId:arkanoid} plus the game-view frame (games/game-view.drone.ts, uncommitted at the time of this pass). The post-it holds the door only because the deployed visitor engine does not carry the game view yet — the day it ships, flipping view:default from postit to game is the whole cutover; every other record is already in place.',
].join('\n')

// ── main ──────────────────────────────────────────────────────────────
async function main() {
  await assertRightHive()
  log(`building /${SEGMENTS.join('/')}${DRY ? ' (dry)' : ''}`)

  const probe = await ask({ op: 'layer-at', segments: SEGMENTS })
  if (!probe.ok) throw new Error('/games/arkanoid does not resolve: ' + probe.error)
  log('  layer      : present (' + (probe.data?.decorations || []).length + ' decorations)')

  const html = fs.readFileSync(path.join(ASSETS, 'arkanoid-page.html'), 'utf8')
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
      payload: { version: 1, title: 'Arkanoid', htmlSig },
      mark: 'persistent',
      replaceKind: true,
    })
    if (!deco.ok) throw new Error('decoration-add: ' + deco.error)
    log(`  post-it    : html ${htmlSig.slice(0, 12)}… deco ${String(deco.data.sig).slice(0, 12)}…${deco.data.unchanged ? ' (unchanged)' : ''}`)

    // The branch OPENS AS the page — replaces the empty 'document' arrival face.
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

  // Verify by read-back FROM the hive (never trust our own console line).
  // replaceKind is removeSig-then-append — poll until the commit settles.
  if (!DRY) {
    let page = false, opensAs = false, roundTrip = false
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
      if (page && opensAs && roundTrip) break
    }
    log(`  verify     : page:${page} opens-as:${opensAs} bytes:${roundTrip}`)
    if (!page || !opensAs || !roundTrip) throw new Error('read-back verification FAILED')

    const rev = await ask({ op: 'build-record', segments: SEGMENTS, label: 'arkanoid arrival face' })
    log('  record     :', rev.ok ? `sealed ${String(rev.data.seal || rev.data.label || '').slice(0, 12)}` : 'ERR ' + rev.error)
  }

  log('done')
  try { ws.close() } catch {}
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1) })
