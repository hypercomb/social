// Café Society, step 3 of 3 — plant the cut site into the hive over the bridge.
//
//   node scripts/bridge/_cafe-society/plant.cjs [--dry] [--port 2401]
//
// Reads <work>/out/site.json (build.cjs) and <work>/img (mine.cjs), where
// <work> is src/.tmp/cafe-society or CAFE_WORK.
//
// Idempotent: every byte is content-addressed, page marks replace by kind,
// enrolment marks are checked before they are written, ONE build-record seals
// the pass. Nothing is ever removed except an enrolment mark whose position
// changed.
//
//   /cafe-society                    the home frame
//   /cafe-society/<route>            one frame per route (holes only)
//   /cafe-society/parts/<name>       one tile per part — filing, not membership:
//                                    a part belongs to a page by the mark it wears
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const WebSocket = require('ws')

const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const PORT = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 2401
const DIR = process.env.CAFE_WORK || path.resolve(__dirname, '../../../.tmp/cafe-society')
const site = JSON.parse(fs.readFileSync(path.join(DIR, 'out', 'site.json'), 'utf8'))
const SITE = site.site
const SHELF = 'parts'
const log = (...a) => console.log(...a)
const sha = s => crypto.createHash('sha256').update(s).digest('hex')

// ── transport ────────────────────────────────────────────────────────────
let ws, pending = new Map(), seq = 0, connected = null
async function connect() {
  if (connected) return connected
  connected = new Promise((res, rej) => {
    ws = new WebSocket('ws://localhost:' + PORT, { maxPayload: 128 * 1024 * 1024 })
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
async function call(req, timeoutMs = 120_000) {
  await connect()
  const id = `cs-${Date.now()}-${++seq}`
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { pending.delete(id); rej(new Error('bridge timeout: ' + req.op)) }, timeoutMs)
    pending.set(id, { res, rej, timer })
    try { ws.send(JSON.stringify({ ...req, id })) } catch (e) { pending.delete(id); clearTimeout(timer); rej(e) }
  })
}
async function ask(req, attempts = 6) {
  let wait = 2000
  for (let i = 0; i < attempts; i++) {
    try { const r = await call(req); if (r.ok || r.error !== 'no renderer connected') return r }
    catch (e) { if (i === attempts - 1) return { ok: false, error: e.message } }
    await new Promise(r => setTimeout(r, wait)); wait = Math.min(wait * 1.7, 30_000); connected = null
  }
  return { ok: false, error: 'renderer never came back' }
}
const must = async (req, what) => { const r = await ask(req); if (!r.ok) throw new Error(`${what}: ${r.error}`); return r.data }

// ── addresses ────────────────────────────────────────────────────────────
// The group a frame's parts enrol under, derived exactly as the renderer
// derives it (presentation/tiles/division-group.ts): the whole's label plus
// the head of its location signature, in the `division` family.
const slug = s => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
function groupOf(segments) {
  const relation = `${segments[segments.length - 1]}-${sha(segments.join('/')).slice(0, 12)}`
  const meaning = `division:${slug(relation)}`
  return { meaning, sig: sha('group:' + meaning) }
}
const frameSegments = frame => [SITE, ...frame.route]
const partSegments = name => [SITE, SHELF, name]

// ── tiles ────────────────────────────────────────────────────────────────
const exists = async segments => (await ask({ op: 'layer-at', segments })).ok
async function ensureTile(segments) {
  if (await exists(segments)) return 'present'
  if (DRY) return 'would-create'
  // `add` is the by-name APPEND to the parent's children — never a SET.
  await must({ op: 'add', segments: segments.slice(0, -1), cells: [segments[segments.length - 1]] }, 'add ' + segments.join('/'))
  if (!(await exists(segments))) {
    await must({ op: 'update', segments, layer: { name: segments[segments.length - 1] } }, 'materialize ' + segments.join('/'))
  }
  return 'created'
}

async function decorationsAt(segments) {
  const layer = await ask({ op: 'layer-at', segments })
  const sigs = Array.isArray(layer?.data?.decorations) ? layer.data.decorations : []
  const out = []
  for (const sig of sigs) {
    const r = await ask({ op: 'get-resource', sig })
    if (!r.ok) continue
    try { out.push({ sig, record: JSON.parse(r.data.text) }) } catch { /* not a record */ }
  }
  return { layer: layer?.data ?? null, records: out }
}

async function wearPage(segments, htmlSig, label, order) {
  const r = await must({
    op: 'decoration-add', segments, kind: 'visual:website:page', appliesTo: segments,
    // No wall-clock field: identical content mints an identical record.
    payload: { htmlSig, icon: 'local_cafe', label, order },
    mark: 'persistent', replaceKind: true,
  }, 'page mark ' + segments.join('/'))
  return r.unchanged ? 'unchanged' : 'written'
}

async function enrol(segments, group, order, worn) {
  const same = worn.filter(e => e.record.kind === 'group' && String(e.record.payload?.sig) === group.sig)
  if (same.some(e => e.record.payload?.order === order)) return 'present'
  for (const stale of same) await must({ op: 'bag-remove', segments, slot: 'decorations', cells: [stale.sig] }, 'drop moved mark')
  await must({
    op: 'decoration-add', segments, kind: 'group', appliesTo: segments,
    payload: { sig: group.sig, meaning: group.meaning, order }, mark: 'persistent',
  }, 'enrol ' + segments.join('/'))
  return 'enrolled'
}

const canonical = obj => { const o = {}; for (const k of Object.keys(obj).sort()) o[k] = obj[k]; return JSON.stringify(o) }
async function wearPicture(segments, imageSig) {
  const layer = await must({ op: 'layer-at', segments }, 'layer')
  const propsSig = (layer.properties || [])[0]
  let props = {}
  if (propsSig) {
    const pr = await ask({ op: 'get-resource', sig: propsSig })
    if (pr.ok) { try { props = JSON.parse(pr.data.text) } catch { /* keep empty */ } }
  }
  if (/^[0-9a-f]{64}$/.test(String(props?.small?.image || ''))) return 'keeps its own'
  const merged = { ...props, small: { ...(props.small || {}), image: imageSig }, substrate: false }
  const put = await must({ op: 'put-resource', text: canonical(merged) }, 'props')
  await must({ op: 'bag-set', segments, slot: 'properties', cells: [put.sig] }, 'bag-set properties')
  await must({ op: 'stamp', segments, layer: { substrate: false } }, 'stamp')
  return 'wearing'
}

async function ensureNote(segments, text) {
  const parent = segments.slice(0, -1), cell = segments[segments.length - 1]
  const first = text.split('\n')[0].trim()
  const r = await ask({ op: 'note-list', segments })
  const d = r.ok ? r.data : []
  const items = Array.isArray(d) ? d : (Array.isArray(d?.notes) ? d.notes : [])
  if (items.map(n => String(n?.text || '').split('\n')[0].trim()).includes(first)) return 'present'
  await must({ op: 'note-add', segments: parent, cell, text }, 'note')
  return 'added'
}

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  // Never write into the wrong hive: a bag-resolved path only the authoring
  // hive holds.
  const guard = await ask({ op: 'layer-at', segments: ['revolucion', 'meetup'] })
  if (!guard.ok) throw new Error('WRONG HIVE — /revolucion/meetup does not resolve; nothing written')

  log(`planting /${SITE}${DRY ? ' (dry)' : ''}: ${site.frames.length} frames, ${site.parts.length} parts`)
  if (DRY) {
    for (const f of site.frames) log('  frame', '/' + frameSegments(f).join('/'), '→', groupOf(frameSegments(f)).meaning, f.holes.length, 'holes')
    log('  root :', await ensureTile([SITE]))
    return
  }

  // 1. pictures and style atoms — put once, referenced everywhere after.
  const pictureNames = new Set()
  for (const doc of [...site.parts, ...site.frames]) {
    for (const m of doc.html.matchAll(/\{\{img:([^}]+)\}\}/g)) pictureNames.add(m[1])
    if (doc.picture) pictureNames.add(doc.picture)
  }
  const img = {}
  for (const name of pictureNames) {
    const bytes = fs.readFileSync(path.join(DIR, 'web-1280', name))
    img[name] = (await must({ op: 'put-resource', base64: bytes.toString('base64') }, 'picture ' + name)).sig
  }
  log(`  pictures : ${Object.keys(img).length} held (${new Set(Object.values(img)).size} distinct)`)
  const css = {}
  for (const [atom, text] of Object.entries(site.atoms)) css[atom] = (await must({ op: 'put-resource', text }, 'atom ' + atom)).sig
  log('  atoms    :', Object.entries(css).map(([a, s]) => `${a} ${s.slice(0, 12)}…`).join(' · '))
  const js = {}
  for (const [name, text] of Object.entries(site.scripts || {})) js[name] = (await must({ op: 'put-resource', text }, 'script ' + name)).sig
  log('  scripts  :', Object.entries(js).map(([a, s]) => `${a} ${s.slice(0, 12)}…`).join(' · ') || 'none')
  const fill = html => html
    .replace(/\{\{js:([\w-]+)\}\}/g, (_m, n) => js[n])
    .replace(/\{\{img:([^}]+)\}\}/g, (_m, n) => img[n])
    .replace(/\{\{css:(\w+)\}\}/g, (_m, a) => css[a])

  // 2. tiles: root, routes, the shelf, the parts.
  log('  tile     : /' + SITE, await ensureTile([SITE]))
  const routes = site.frames.map(frameSegments).filter(s => s.length > 1).sort((a, b) => a.length - b.length)
  for (const segments of routes) log('  tile     : /' + segments.join('/'), await ensureTile(segments))
  log('  tile     : /' + [SITE, SHELF].join('/'), await ensureTile([SITE, SHELF]))
  let made = 0
  for (const part of site.parts) if ((await ensureTile(partSegments(part.name))) === 'created') made++
  log(`  parts    : ${site.parts.length} tiles (${made} new)`)

  // 3. pages: each part its own page, each frame its holes.
  const htmlSig = {}
  for (const part of site.parts) {
    const segments = partSegments(part.name)
    htmlSig['part:' + part.name] = (await must({ op: 'put-resource', text: fill(part.html) }, 'part page')).sig
    await wearPage(segments, htmlSig['part:' + part.name], part.title, 0)
  }
  log(`  part pages: ${site.parts.length} written`)
  for (const frame of site.frames) {
    const segments = frameSegments(frame)
    htmlSig['frame:' + segments.join('/')] = (await must({ op: 'put-resource', text: fill(frame.html) }, 'frame page')).sig
    await wearPage(segments, htmlSig['frame:' + segments.join('/')], frame.title, 0)
  }
  log(`  frames   : ${site.frames.length} written`)

  // Walking into the site opens it AS the site; the parts shelf opens as its
  // hexagons, so the parts can be seen and picked up. Without the first mark
  // the tile shows its hexagons and the site looks as if it never landed.
  // (On a hive where the website view is bound to other tiles, also stand on
  // the site once and say `behavior bind website`: a binding is the
  // participant's own and no mark can carry it.)
  for (const [segments, view] of [[[SITE], 'website'], [[SITE, SHELF], 'hexagons']]) {
    await must({
      op: 'decoration-add', segments, kind: 'view:default', appliesTo: segments,
      payload: { view }, mark: 'persistent', replaceKind: true,
    }, 'opens-as ' + segments.join('/'))
  }
  log('  opens as : /' + SITE + ' website · /' + SITE + '/' + SHELF + ' hexagons')

  // 4. enrolment: a part wears one mark per page it sits in; the mark carries
  //    the position. The frame names no part and the part names no frame.
  let marks = 0, fresh = 0
  const wornBy = new Map()
  for (const frame of site.frames) {
    const group = groupOf(frameSegments(frame))
    for (let k = 0; k < frame.holes.length; k++) {
      const segments = partSegments(frame.holes[k])
      const key = segments.join('/')
      if (!wornBy.has(key)) wornBy.set(key, (await decorationsAt(segments)).records)
      const result = await enrol(segments, group, k, wornBy.get(key))
      marks++; if (result === 'enrolled') fresh++
    }
  }
  log(`  enrolment: ${marks} marks (${fresh} new)`)

  // 5. every tile looks like itself on the hexagons: the picture it is about.
  let dressed = 0
  for (const frame of site.frames) if (frame.picture) { await wearPicture(frameSegments(frame), img[frame.picture]); dressed++ }
  for (const part of site.parts) if (part.picture) { await wearPicture(partSegments(part.name), img[part.picture]); dressed++ }
  log(`  pictures : ${dressed} tiles dressed`)

  // 6. the note that says what this is and where its shared atoms are.
  const NOTE = [
    'Café Society — the embedded site, cut from the cafesociety.app mockup',
    '',
    'Every route is a frame of holes; every section, the header and the footer are parts filed under /cafe-society/parts. A part belongs to a page by the enrolment mark it wears, and the mark carries its position, so one part sits in many pages and a page is rearranged by moving marks.',
    '',
    'Shared atoms (put once, linked by signature from every part and frame):',
    `style:cafe-society-type   ${css.type}`,
    `style:cafe-society-theme  ${css.theme}`,
    `style:cafe-society        ${css.sheet}`,
    '',
    'Restyle: put a new theme atom and rebuild. Rearrange: change a part\'s order on its mark. Reuse: enrol a part in another page\'s group.',
  ].join('\n')
  log('  note     :', await ensureNote([SITE], NOTE))

  // 7. read back from the hive, never from our own lines.
  await new Promise(r => setTimeout(r, 3000))
  const failures = []
  for (const frame of site.frames) {
    const segments = frameSegments(frame)
    const { records } = await decorationsAt(segments)
    const page = records.find(e => e.record.kind === 'visual:website:page')
    if (page?.record.payload?.htmlSig !== htmlSig['frame:' + segments.join('/')]) failures.push('frame page ' + segments.join('/'))
    const group = groupOf(segments)
    for (let k = 0; k < frame.holes.length; k++) {
      const part = await decorationsAt(partSegments(frame.holes[k]))
      const mark = part.records.find(e => e.record.kind === 'group' && e.record.payload?.sig === group.sig)
      if (mark?.record.payload?.order !== k) failures.push(`mark ${frame.holes[k]} in ${segments.join('/')}`)
      const own = part.records.find(e => e.record.kind === 'visual:website:page')
      if (own?.record.payload?.htmlSig !== htmlSig['part:' + frame.holes[k]]) failures.push('part page ' + frame.holes[k])
    }
  }
  log(`  verify   : ${failures.length === 0 ? 'every frame, part page and mark reads back' : failures.length + ' FAILED'}`)
  for (const f of failures.slice(0, 20)) log('     ✗', f)

  fs.writeFileSync(path.join(DIR, 'out', 'planted.json'), JSON.stringify({
    site: SITE, css, img, htmlSig,
    groups: Object.fromEntries(site.frames.map(f => [frameSegments(f).join('/'), groupOf(frameSegments(f))])),
  }, null, 2))
  if (failures.length) throw new Error('read-back verification FAILED')

  const rev = await ask({ op: 'build-record', segments: [SITE], label: 'cafe society from the mockup' })
  log('  record   :', rev.ok ? `sealed ${String(rev.data.seal || rev.data.label || '').slice(0, 12)}${rev.data.unchanged ? ' (unchanged)' : ''}` : 'ERR ' + rev.error)
  log('done')
}
main().then(() => { try { ws.close() } catch {} ; process.exit(0) }).catch(e => { console.error('FATAL', e.message); process.exit(1) })
