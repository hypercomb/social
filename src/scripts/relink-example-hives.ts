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

/** Child names via raw layer bytes — no recursive inflate. */
async function childrenOf(segments: string[]): Promise<string[]> {
  const layer = await send({ op: 'layer-at', segments })
  if (!layer.ok) return []
  const sigs: string[] = Array.isArray(layer.data?.children) ? layer.data.children.map(String) : []
  const names: string[] = []
  for (const sig of sigs) {
    const res = await send({ op: 'get-resource', sig })
    if (!res.ok) continue
    try {
      const name = JSON.parse(res.data.text)?.name
      if (typeof name === 'string' && name.trim()) names.push(name.trim())
    } catch { /* skip unreadable child */ }
  }
  return names
}

async function relink(segments: string[], expectedName: string): Promise<void> {
  const layer = await send({ op: 'layer-at', segments })
  if (!layer.ok) { console.error(`no layer at /${segments.join('/')}: ${layer.error}`); process.exit(1) }
  const names = await childrenOf(segments)
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
  const rootNames = await childrenOf([])
  process.stdout.write(`[relink] / (${rootNames.length} children) ... `)
  const res = await send({ op: 'update', segments: [], layer: { name: rootLayer.data?.name ?? '/', children: rootNames } })
  console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  if (!res.ok) process.exit(1)
  console.log('[relink] DONE — publish with --no-relink')
}

main().catch(err => { console.error(err); process.exit(1) })
