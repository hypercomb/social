// The visual pass, with the children linkage checked at every step.
//
//   node scripts/bridge/_division-live.cjs build    create + dress + distribute
//   node scripts/bridge/_division-live.cjs show     navigate the hive into it
//   node scripts/bridge/_division-live.cjs clean    remove it
const WebSocket = require('ws')
const fs = require('fs'), path = require('path')
const DIR = process.env.DP_DIR || __dirname
const WHOLE = 'division-live'
const PARTS = ['live-hub','live-intake','live-compressor','live-combustor','live-turbine','live-nozzle','live-casing']
const CREATION = 'c'.repeat(64)

let n = 0
const send = (req) => new Promise((res, rej) => {
  const ws = new WebSocket('ws://localhost:2401')
  const t = setTimeout(() => { try{ws.close()}catch{}; rej(new Error('timeout')) }, 40000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id: `dl-${Date.now()}-${++n}` })))
  ws.on('message', r => { clearTimeout(t); let p=null; try{p=JSON.parse(String(r))}catch{}; try{ws.close()}catch{}; res(p) })
  ws.on('error', e => { clearTimeout(t); rej(e) })
})
const ok = async (req, what) => { const r = await send(req); if (!r || r.ok === false) throw new Error(`${what}: ${r && r.error}`); return r.data }
const childCount = async (segments) => ((await ok({ op:'layer-at', segments }, 'layer')).children || []).length
const propsOf = async (segments) => {
  const L = await ok({ op:'layer-at', segments }, 'layer')
  const p = (L.properties || [])[0]; if (!p) return null
  try { const j = JSON.parse((await ok({ op:'get-resource', sig:p }, 'props')).text)
        return { img: j.large?.image ?? j.small?.image ?? j.imageSig, index: j.index } } catch { return null }
}

async function build() {
  const png = fs.readFileSync(path.join(DIR, 'division-source.png'))
  const { sig: imageSig } = await ok({ op:'put-resource', base64: png.toString('base64') }, 'picture')

  await ok({ op:'update', segments:[WHOLE], layer:{ name:WHOLE, children:[] } }, 'whole')
  console.log('1. whole created            root children:', await childCount([]))

  for (const part of PARTS) {
    await ok({ op:'update', segments:[WHOLE, part], layer:{ name:part, children:[] } }, `create ${part}`)
  }
  const afterCreate = await childCount([WHOLE])
  console.log(`2. ${PARTS.length} parts created       whole children:`, afterCreate)

  // THE REGRESSION, LIVE. Before the fix, this bag-set wiped the whole's
  // children. Same call, same tile, children must survive it.
  const { sig: propSig } = await ok({ op:'put-resource', text: JSON.stringify({
    large:{ image:imageSig, x:0, y:0, scale:1 }, small:{ image:imageSig }, participant:true }) }, 'props')
  await ok({ op:'bag-set', segments:[WHOLE], slot:'properties', cells:[propSig] }, 'dress whole')
  const afterBagSet = await childCount([WHOLE])
  console.log('3. bag-set properties      whole children:', afterBagSet,
    afterBagSet === afterCreate ? '  <-- SURVIVED (fix works)' : '  <-- ORPHANED (fix failed)')

  for (const part of PARTS) {
    await ok({ op:'decoration-add', segments:[WHOLE, part], kind:'creation', appliesTo:[WHOLE, part],
      payload:{ id: CREATION, task:'break-apart', role:'part' }, mark:'persistent' }, `stamp ${part}`)
  }
  const afterStamp = await childCount([WHOLE])
  console.log('4. decoration-add x7       whole children:', afterStamp)

  // No `parts` list — the drone must find them itself, by creation stamp.
  await ok({ op:'effect-emit', cell:'parts:distribute-visual',
    payload:{ segments:[WHOLE], creationId: CREATION } }, 'distribute')
  console.log('5. distribute emitted      { segments, creationId } — no parts list')
  await new Promise(r => setTimeout(r, 12000))

  const wholePic = await propsOf([WHOLE])
  console.log('\nwhole picture:', String(wholePic?.img).slice(0,12) + '…  children:', await childCount([WHOLE]))
  const seen = new Set()
  for (let k = 0; k < PARTS.length; k++) {
    const L = await ok({ op:'layer-at', segments:[WHOLE, PARTS[k]] }, 'layer')
    let order = '—'
    for (const s of (L.decorations || [])) {
      try { const d = JSON.parse((await ok({ op:'get-resource', sig:s }, 'd')).text)
            if (d.kind === 'group') order = d.payload.order } catch {}
    }
    const p = await propsOf([WHOLE, PARTS[k]])
    if (p?.img) seen.add(p.img)
    console.log(`  ${k} ${PARTS[k].padEnd(17)} order=${order} index=${p?.index ?? '—'} picture=${p?.img ? p.img.slice(0,12)+'…' : 'NONE'}`)
  }
  console.log(`distinct pictures: ${seen.size}/${PARTS.length}`,
    seen.has(wholePic?.img) ? ' — one is the WHOLE\'S (duplicated)' : ' — none is the whole\'s (divided)')

  // ONE BUILD REVISION FOR THE WHOLE PASS (documentation/build-revisions.md).
  //
  // This runs against a real hive over the bridge, and it stamps eight anchors
  // on the way through — the whole's properties, then a creation mark on each
  // of the seven parts — before the distribute writes more again. Without a
  // record that is eight-plus separate entries in somebody's history and no
  // single step to go back to, which is the whole reason the standard exists.
  //
  // AFTER the distribute has settled, not before: the seal should capture the
  // divided visual, which is the state this pass exists to produce.
  // Reported, never thrown — and that needs the guard, not just the shape of
  // the log. `send` rejects on a bridge timeout, and the runner's catch would
  // turn a proof that had already reported its findings into exit(1).
  let rev
  try { rev = await send({ op:'build-record', segments:[WHOLE], label:'division-live build' }) }
  catch (err) { rev = { ok:false, error: err.message } }
  console.log(rev && rev.ok
    ? `build revision: ${rev.data.label} seal=${String(rev.data.seal).slice(0, 12)}${rev.data.unchanged ? ' (unchanged)' : ''}`
    : `build revision FAILED: ${rev && rev.error}`)
}

const show = async () => { await ok({ op:'submit', cell: WHOLE }, 'navigate'); console.log(`hive navigated into /${WHOLE}`) }
const clean = async () => {
  for (const p of PARTS) await send({ op:'remove', segments:[WHOLE], cells:[p] })
  await send({ op:'remove', segments:[], cells:[WHOLE] })
  console.log('removed')
}

const cmd = process.argv[2] || 'build'
;({ build, show, clean })[cmd]().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
