// Does /susan's branch layer still address the NEWEST generation of each tile?
//
// A tile edit commits into the TILE's own lineage bag. The branch only learns
// about it when the chain is re-linked. If the two disagree, the edit is
// stranded: the branch (and therefore every publish) keeps addressing the
// generation it last saw, and the new picture can never reach the site.
//
//   branch view : /susan's `children` → that child layer → its properties sig
//   tile view   : layer-at ['susan', <name>] → its properties sig  (bag head)
const WebSocket = require('ws')

const BRIDGE = 'ws://localhost:2401'
const SITE = 'https://susan.pluginthematrix.com'
const SIG = /^[0-9a-f]{64}$/
const NAMES = ['family-support', 'the-practical-work', 'what-recovery-is', 'its-allowed-heavy',
  'keeping-standing', 'finding-help', 'dont-start-static']

let counter = 0
const send = (req, timeoutMs = 15000) => new Promise((resolve, reject) => {
  const ws = new WebSocket(BRIDGE)
  const id = `tile-${Date.now()}-${++counter}`
  const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, timeoutMs)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', raw => {
    clearTimeout(timer)
    try { resolve(JSON.parse(String(raw))) } catch { reject(new Error('bad response')) }
    ws.close()
  })
  ws.on('error', err => { clearTimeout(timer); reject(err) })
})

const asJson = value => {
  if (value == null) return null
  if (typeof value === 'object') return value
  try { return JSON.parse(String(value)) } catch { return '(binary)' }
}

const localResource = async sig => {
  if (!SIG.test(String(sig ?? ''))) return null
  const r = await send({ op: 'get-resource', sig })
  return r.ok ? asJson(r.data) : null
}

const httpJson = async sig => {
  const r = await fetch(`${SITE}/${sig}`)
  if (!r.ok) return null
  try { return JSON.parse(await r.text()) } catch { return '(binary)' }
}

// properties slot → the real bag (one meta hop) → its picture signatures
const propsOf = async (readJson, layer) => {
  const sig = Array.isArray(layer?.properties) ? layer.properties[0] : null
  if (!SIG.test(String(sig ?? ''))) return { sig: null, pictures: [] }
  let props = await readJson(sig)
  if (props && props.meta === 1 && SIG.test(String(props.resource ?? ''))) props = await readJson(props.resource)
  const pictures = props && typeof props === 'object'
    ? [props.large?.image, props.small?.image, props.flat?.small?.image, props.imageSig]
        .filter(s => SIG.test(String(s ?? '')))
    : []
  return { sig, pictures }
}

async function main() {
  // The branch's own view: susan's children, resolved over HTTP (identical to
  // local — already proven — so this is the published AND branch-addressed set).
  const head = await httpJson('6164395db9207c204c773e59a62d3ffe49bd689785f2c6f197dd97a3f8efe5b9')
  const branchByName = new Map()
  for (const childSig of head.children ?? []) {
    let child = await httpJson(childSig)
    if (child && child.meta === 1) child = await httpJson(child.layer)
    if (child?.name) branchByName.set(child.name, await propsOf(httpJson, child))
  }

  console.log('tile                      branch-addressed props   tile-bag head props      verdict')
  let stranded = 0
  for (const name of NAMES) {
    const r = await send({ op: 'layer-at', segments: ['susan', name] })
    if (!r.ok) { console.log(`${name.padEnd(25)} layer-at failed: ${r.error}`); continue }
    const bag = await propsOf(localResource, r.data)
    const branch = branchByName.get(name) ?? { sig: null, pictures: [] }
    const same = bag.sig === branch.sig
    if (!same) stranded++
    console.log(
      `${name.padEnd(25)} ${String(branch.sig ?? '—').slice(0, 12).padEnd(24)} ${String(bag.sig ?? '—').slice(0, 12).padEnd(24)} ${same ? 'same' : 'STRANDED — branch is behind'}`,
    )
    if (!same) {
      console.log(`    branch pictures : ${branch.pictures.map(s => s.slice(0, 12)).join(' ') || '(none)'}`)
      console.log(`    newest pictures : ${bag.pictures.map(s => s.slice(0, 12)).join(' ') || '(none)'}`)
      for (const sig of bag.pictures) {
        const res = await fetch(`${SITE}/${sig}`, { method: 'HEAD' })
        console.log(`      ${sig.slice(0, 12)} on server: ${res.ok ? `yes (${res.headers.get('content-length') ?? '?'} bytes)` : `NO (${res.status})`}`)
      }
    }
  }
  console.log(stranded === 0
    ? '\nEvery tile: the branch addresses the newest generation. Nothing is stranded on susan.'
    : `\n${stranded} tile(s) have newer local generations the branch never picked up — a publish cannot carry them.`)
}

main().catch(e => { console.error('failed:', e.message || e); process.exit(1) })
