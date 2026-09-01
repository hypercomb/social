// Re-link the /examples subtree bottom-up, then the root — cheap replacement
// for publish-content's re-link phase, which inflates every root child (a
// whole-branch merkle expand; revolucion alone blows the 45 s op timeout on a
// cold renderer). A re-link is a bridge `update` with the SAME child names in
// the SAME order: it moves pointers (parents re-resolve name → current head
// sig), never membership. Post-order matters — a parent must re-resolve AFTER
// its children's pointers are fresh.
//
//   npx tsx scripts/relink-example-hives.ts
//   then: npx tsx scripts/publish-content.ts examples/<name> --r2 --no-relink

import WebSocket from 'ws'
import { hiveChildren } from './lib/hive-children.mjs'

const BRIDGE_PORT = 2401
const TIMEOUT = 180_000
let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }

function send(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `cli-${Date.now()}-${++counter}` }
    const ws = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORT}`)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, TIMEOUT)
    ws.on('open', () => ws.send(JSON.stringify(msg)))
    ws.on('message', (raw: unknown) => {
      clearTimeout(timer)
      try { resolve(JSON.parse(String(raw)) as BridgeRes) } catch { reject(new Error('invalid response')) }
      ws.close()
    })
    ws.on('error', (err: Error) => { clearTimeout(timer); reject(new Error(`bridge connection failed: ${err.message}`)) })
  })
}

// Relink is the ONE pass that legitimately re-SETs a children slot: it writes
// the SAME names back so each parent re-resolves fresh child heads. That makes
// it entirely hostage to the read — and the read was broken. It decoded child
// names with `get-resource`, which CANNOT work: a parent's `children` slot
// holds LAYER sigs, and a layer sig is not a resource. Every call returned
// `[]`, so this script would have walked `/examples` writing `children: []`
// into every node and then done the same to the HIVE ROOT.
//
// The shared reader (scripts/lib/hive-children.mjs) throws rather than
// under-report, and `relink` below re-checks the count against the parent's
// own slot before writing. A relink that would shrink a parent is a bug, not
// an instruction.
const hive = hiveChildren(send)

/** Child NAMES, or `[]` when there is no layer at `segments` at all. */
async function childrenOf(segments: string[]): Promise<string[]> {
  return (await hive.childNamesOf(segments)) ?? []
}

/**
 * Refuse any relink that would not write back exactly what the parent already
 * holds. `slotCount` is the parent's own `children` array length; `names` is
 * what we decoded from it. A relink is a pointer move — same names, same
 * order, same count — so a mismatch means the READ failed, and writing the
 * short list would delete the difference.
 */
function assertSameShape(segments: string[], slotCount: number, names: string[]): void {
  if (names.length === slotCount) return
  console.error(
    `[relink] REFUSING to write /${segments.join('/') || '(root)'}: the layer holds ` +
    `${slotCount} children but only ${names.length} names decoded. A relink writes the ` +
    'slot back verbatim, so this would delete the difference. Fix the read, not this check.',
  )
  process.exit(1)
}

async function relink(segments: string[], expectedName: string): Promise<void> {
  const layer = await send({ op: 'layer-at', segments })
  if (!layer.ok) { console.error(`no layer at /${segments.join('/')}: ${layer.error}`); process.exit(1) }
  const slotCount = Array.isArray(layer.data?.children) ? layer.data.children.length : 0
  const names = await childrenOf(segments)
  assertSameShape(segments, slotCount, names)
  // Post-order: children first, so this node re-resolves fresh heads.
  for (const name of names) await relink([...segments, name], name)
  process.stdout.write(`[relink] /${segments.join('/') || ''} (${names.length} children) ... `)
  const res = await send({ op: 'update', segments, layer: { name: layer.data?.name ?? expectedName, children: names } })
  console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  if (!res.ok) process.exit(1)
}

async function main(): Promise<void> {
  await relink(['examples'], 'examples')
  // The root: same names, same order — pointer move only, no subtree descent.
  const rootLayer = await send({ op: 'layer-at', segments: [] })
  if (!rootLayer.ok) { console.error(`no root layer: ${rootLayer.error}`); process.exit(1) }
  const rootSlot = Array.isArray(rootLayer.data?.children) ? rootLayer.data.children.length : 0
  const rootNames = await childrenOf([])
  assertSameShape([], rootSlot, rootNames)
  process.stdout.write(`[relink] / (${rootNames.length} children) ... `)
  const res = await send({ op: 'update', segments: [], layer: { name: rootLayer.data?.name ?? '/', children: rootNames } })
  console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  if (!res.ok) process.exit(1)
  console.log('[relink] DONE — publish with --no-relink')
}

main().catch(err => { console.error(err); process.exit(1) })
