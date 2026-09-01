// Compare the LOCAL /susan branch against what susan.pluginthematrix.com serves.
//
// Answers one question: did the republish carry the change, or is the local
// tree ahead of the published head? Waits for a renderer, then reads the local
// layer over the bridge and the published layer over plain HTTP, and diffs the
// tiles' properties resources (where the tile PICTURE signature lives).
const WebSocket = require('ws')

const BRIDGE = 'ws://localhost:2401'
const SITE = 'https://susan.pluginthematrix.com'
const PUBLISHED_HEAD = '6164395db9207c204c773e59a62d3ffe49bd689785f2c6f197dd97a3f8efe5b9'
const SIG = /^[0-9a-f]{64}$/

let counter = 0
const send = (req, timeoutMs = 15000) => new Promise((resolve, reject) => {
  const ws = new WebSocket(BRIDGE)
  const id = `susan-${Date.now()}-${++counter}`
  const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, timeoutMs)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', raw => {
    clearTimeout(timer)
    try { resolve(JSON.parse(String(raw))) } catch { reject(new Error('bad response')) }
    ws.close()
  })
  ws.on('error', err => { clearTimeout(timer); reject(err) })
})

const http = async sig => {
  const r = await fetch(`${SITE}/${sig}`)
  if (!r.ok) return null
  const t = await r.text()
  try { return JSON.parse(t) } catch { return '(binary)' }
}

// A properties slot may hold a meta envelope; follow one hop to the real bag.
const resolveProps = async (readJson, slot) => {
  const sig = Array.isArray(slot) ? slot[0] : null
  if (!SIG.test(String(sig ?? ''))) return { sig: null, props: null }
  let props = await readJson(sig)
  if (props && props.meta === 1 && SIG.test(String(props.resource ?? ''))) {
    props = await readJson(props.resource)
  }
  return { sig, props }
}

const picturesOf = props => props
  ? [props.large?.image, props.small?.image, props.flat?.small?.image, props.imageSig]
      .filter(s => SIG.test(String(s ?? '')))
  : []

async function main() {
  // 1. Wait for a renderer (the user reloads their hive tab).
  const deadline = Date.now() + 10 * 60_000
  for (;;) {
    const probe = await send({ op: 'list' }).catch(e => ({ ok: false, error: String(e.message || e) }))
    if (probe.ok) break
    if (Date.now() > deadline) { console.log('NO RENDERER — gave up waiting'); process.exit(2) }
    console.log(`waiting for renderer… (${probe.error})`)
    await new Promise(r => setTimeout(r, 5000))
  }
  console.log('renderer connected\n')

  // 2. The local /susan layer, straight from the participant's own history.
  const local = await send({ op: 'layer-at', segments: ['susan'] })
  if (!local.ok) { console.log('layer-at /susan failed:', local.error); process.exit(1) }
  const localLayer = local.data

  // 3. The published head the site actually serves.
  const publishedLayer = await http(PUBLISHED_HEAD)
  if (!publishedLayer) { console.log('published head did not resolve'); process.exit(1) }

  const localJson = JSON.stringify(localLayer)
  const pubJson = JSON.stringify(publishedLayer)
  console.log('local /susan children :', (localLayer.children ?? []).length)
  console.log('published children    :', (publishedLayer.children ?? []).length)
  console.log('layers identical      :', localJson === pubJson ? 'YES — the site serves exactly your local branch'
    : 'NO — your local /susan has moved past what is published')

  // 4. Where the difference lives: per-tile properties + picture signatures.
  const localRead = async sig => {
    const r = await send({ op: 'get-resource', sig })
    if (!r.ok || r.data == null) return null
    if (typeof r.data === 'string') { try { return JSON.parse(r.data) } catch { return '(binary)' } }
    return r.data
  }

  const tileRows = async (layer, readJson, label) => {
    const rows = []
    for (const childSig of layer.children ?? []) {
      let child = await readJson(childSig)
      if (child && child.meta === 1 && SIG.test(String(child.layer ?? ''))) child = await readJson(child.layer)
      if (!child || typeof child !== 'object') { rows.push({ name: '(unreadable)', sig: childSig }); continue }
      const { sig, props } = await resolveProps(readJson, child.properties)
      rows.push({ name: child.name, propsSig: sig, pictures: picturesOf(props) })
    }
    console.log(`\n${label}`)
    for (const r of rows) {
      console.log(`  ${String(r.name).padEnd(24)} props ${String(r.propsSig ?? '—').slice(0, 10)}  pictures ${r.pictures.map(s => s.slice(0, 10)).join(' ') || '(none)'}`)
    }
    return rows
  }

  const pubRows = await tileRows(publishedLayer, http, 'PUBLISHED (what the site serves)')
  const locRows = await tileRows(localLayer, localRead, 'LOCAL (your hive right now)')

  console.log('\nDIFFERENCES')
  const byName = new Map(pubRows.map(r => [r.name, r]))
  let differences = 0
  for (const loc of locRows) {
    const pub = byName.get(loc.name)
    if (!pub) { console.log(`  ${loc.name}: only in your local tree (never published)`); differences++; continue }
    if (loc.propsSig !== pub.propsSig) {
      console.log(`  ${loc.name}: properties differ — local ${String(loc.propsSig).slice(0, 10)} vs published ${String(pub.propsSig).slice(0, 10)}`)
      console.log(`      local pictures     ${loc.pictures.map(s => s.slice(0, 10)).join(' ') || '(none)'}`)
      console.log(`      published pictures ${pub.pictures.map(s => s.slice(0, 10)).join(' ') || '(none)'}`)
      differences++
    }
  }
  for (const pub of pubRows) {
    if (!locRows.some(l => l.name === pub.name)) { console.log(`  ${pub.name}: published but gone locally`); differences++ }
  }
  if (differences === 0) console.log('  none — every tile publishes the picture it holds locally')

  // 5. For any local picture that differs, is it already ON the server?
  console.log('\nARE THE LOCAL PICTURES ON THE SERVER?')
  const localPictures = [...new Set(locRows.flatMap(r => r.pictures))]
  for (const sig of localPictures) {
    const r = await fetch(`${SITE}/${sig}`, { method: 'HEAD' })
    console.log(`  ${sig.slice(0, 12)} ${r.ok ? `served (${r.headers.get('content-length') ?? '?'} bytes)` : `MISSING (${r.status})`}`)
  }
}

main().catch(e => { console.error('failed:', e.message || e); process.exit(1) })
