// tile-mesh.spec.ts — THE TILES THIS PAGE SHARES, AND THE PEERS' TILES HERE,
// on their own. The promises that matter most are privacy: nothing
// subscribes or publishes until the mesh is enabled AND a room and a secret
// are set; a private tile never leaves; a retraction lands at once.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./tile-public.js', () => ({ isCellPublic: (_where: string, name: string) => name !== 'diary' }))

import { TileMesh, type MeshApi, type MeshEvt } from './tile-mesh.js'

const SIG = 'a'.repeat(64)
type Published = { payload: unknown; tags: string[][] }

const fakeMesh = () => {
  const published: Published[] = []
  const items: MeshEvt[] = []
  let listener: ((e: MeshEvt) => void) | null = null
  const mesh: MeshApi & { published: Published[]; items: MeshEvt[]; subscribed: () => boolean; deliver: (e: MeshEvt) => void } = {
    published, items,
    subscribed: () => listener !== null,
    deliver: e => listener?.(e),
    ensureStartedForSig: () => {},
    getNonExpired: () => items,
    publish: async (_kind, _sig, payload, tags = []) => { published.push({ payload, tags }); return true },
    subscribe: (_sig, cb) => { listener = cb; return { close: () => { listener = null } } },
  }
  return mesh
}

const hostWith = (mesh: ReturnType<typeof fakeMesh>, children: string[]) => ({
  lineage: () => ({
    explorerLabel: () => '/home',
    currentLayer: async () => ({ children }),
  }),
  mesh: () => mesh,
  signatureOf: async () => ({ key: 'home', sig: SIG }),
  emit: () => {},
  requestRender: () => {},
})

beforeEach(() => {
  localStorage.clear()
  ;(window as any).ioc = { get: (key: string) => key === '@diamondcoreprocessor.com/HistoryService' ? { getLayerBySig: async (sig: string) => ({ name: sig }) } : undefined }
})
afterEach(() => { delete (window as any).ioc; localStorage.clear() })

const peerEvent = (publisher: string, mode: string, content: string, createdAt: number): MeshEvt => ({
  relay: 'r', sig: SIG, payload: null,
  event: { kind: 29010, created_at: createdAt, content, tags: [['publisher', publisher], ['mode', mode]] },
})

describe('the mesh, gated', () => {
  it('is dormant until the mesh is enabled: no subscription, no publish', async () => {
    const mesh = fakeMesh()
    const m = new TileMesh(hostWith(mesh, ['garden']))
    m.room = 'r'; m.secret = 's'
    await m.refresh()
    expect(mesh.subscribed()).toBe(false)
    expect(mesh.published).toEqual([])
  })

  it('enabled but without a room and a secret: seals, never subscribes or publishes', async () => {
    localStorage.setItem('hc:mesh-enabled', 'true')
    const mesh = fakeMesh()
    const m = new TileMesh(hostWith(mesh, ['garden']))
    m.room = 'r'
    await m.refresh()
    expect(m.credentialed).toBe(false)
    expect(mesh.subscribed()).toBe(false)
    expect(mesh.published).toEqual([])
    expect(m.cells).toEqual([])
  })
})

describe('publishing this page', () => {
  it('posts a snapshot of the PUBLIC tiles first, then only additions as deltas', async () => {
    localStorage.setItem('hc:mesh-enabled', 'true')
    const mesh = fakeMesh()
    const children = ['garden', 'diary']
    const m = new TileMesh(hostWith(mesh, children))
    m.room = 'r'; m.secret = 's'
    await m.refresh()
    expect(mesh.subscribed()).toBe(true)
    const snapshot = mesh.published[0]!
    expect((snapshot.payload as { cells: string[]; mode: string })).toMatchObject({ cells: ['garden'], mode: 'snapshot' })
    children.push('kitchen')
    await m.refresh()
    const mode = (p: Published) => p.tags.find(t => t[0] === 'mode')?.[1]
    // Having heard no one, it also asked the swarm once to republish.
    expect(mesh.published.filter(p => mode(p) === 'sync-request')).toHaveLength(1)
    expect(mesh.published.filter(p => mode(p) === 'delta').map(p => p.payload)).toEqual(['kitchen'])
  })

  it('a forced snapshot carries the reduced set — the only way to retract on this path', async () => {
    localStorage.setItem('hc:mesh-enabled', 'true')
    const mesh = fakeMesh()
    const children = ['garden', 'kitchen']
    const m = new TileMesh(hostWith(mesh, children))
    m.room = 'r'; m.secret = 's'
    await m.refresh()
    children.splice(1, 1)
    await m.refresh('', true)
    expect((mesh.published.at(-1)!.payload as { cells: string[]; mode: string })).toMatchObject({ cells: ['garden'], mode: 'snapshot' })
  })
})

describe('the peers\' tiles here', () => {
  it('newest snapshot per publisher wins, so a retracted tile leaves at once; deltas after it add', async () => {
    localStorage.setItem('hc:mesh-enabled', 'true')
    const mesh = fakeMesh()
    const m = new TileMesh(hostWith(mesh, []))
    m.room = 'r'; m.secret = 's'
    mesh.items.push(
      peerEvent('peer', 'snapshot', JSON.stringify({ cells: ['oak', 'elm'] }), 200),
      peerEvent('peer', 'snapshot', JSON.stringify({ cells: ['oak', 'elm', 'ash'] }), 100),
      peerEvent('peer', 'delta', 'fir', 300),
      peerEvent('peer', 'delta', 'yew', 50),
      peerEvent(m.publisherId, 'snapshot', 'mine', 400),
    )
    const before = m.rev
    await m.refresh()
    expect(m.cells).toEqual(['elm', 'fir', 'oak'])
    expect(m.rev).toBe(before + 2) // cleared on the new sig, then filled
    m.clearPeers()
    expect(m.cells).toEqual([])
  })

  it('answers a peer\'s sync request with a snapshot, at most once per cooldown', async () => {
    localStorage.setItem('hc:mesh-enabled', 'true')
    const mesh = fakeMesh()
    const m = new TileMesh(hostWith(mesh, ['garden']))
    m.room = 'r'; m.secret = 's'
    await m.refresh()
    const after = mesh.published.length
    const ask: MeshEvt = { relay: 'r', sig: SIG, payload: null, event: { kind: 29010, content: '', tags: [['mode', 'sync-request'], ['publisher', 'peer']] } }
    mesh.deliver(ask)
    mesh.deliver(ask)
    const answers = mesh.published.slice(after).filter(p => (p.payload as { mode?: string })?.mode === 'snapshot')
    expect(answers).toHaveLength(1)
    expect((answers[0]!.payload as { cells: string[] }).cells).toEqual(['garden'])
    m.close()
    expect(mesh.subscribed()).toBe(false)
  })
})
