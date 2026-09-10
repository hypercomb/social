import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { canonicalLayerJson, type CanonicalLayerContent } from '../../history/canonical-layer.js'
import type { RoomDef } from './labyrinth.js'
import { SOLOMON_MAZE_BRANCH, SolomonTileSurface } from './tile-surface.js'

// Storage and notification delivery are the only substitutes. The test calls
// the real public importTree/update APIs and real LayerMachine implementation.
vi.mock('@hypercomb/core', () => ({ EffectBus: { on: vi.fn(), emit: vi.fn() } }))
vi.mock('../../history/history.service.js', () => ({ ROOT_NAME: '/' }))
afterEach(() => { vi.unstubAllGlobals() })

it('imports addressed native squares through the real committer and retains their content through an ordinary tile edit', async () => {
  const pool = new Map<string, CanonicalLayerContent>()
  const heads = new Map<string, string>()
  const commitLayer = async (address: string, layer: CanonicalLayerContent) => {
    const bytes = canonicalLayerJson(layer)
    const sig = createHash('sha256').update(bytes).digest('hex')
    pool.set(sig, JSON.parse(bytes) as CanonicalLayerContent)
    heads.set(address, sig)
    return sig
  }
  const history = {
    sign: async (lineage: { explorerSegments(): readonly string[] }) => lineage.explorerSegments().join('/'),
    currentLayerAt: async (address: string) => pool.get(heads.get(address) ?? '') ?? null,
    getLayerBySig: async (sig: string) => pool.get(sig) ?? null,
    latestMarkerSigFor: async (address: string, name: string) => heads.get(address) ?? commitLayer(address, { name }),
    commitLayer,
  }
  const services = new Map<string, unknown>([
    ['@diamondcoreprocessor.com/HistoryService', history],
    ['@hypercomb.social/Lineage', { explorerSegments: () => [], domain: () => 'game.test' }],
  ])
  const get = (key: string) => services.get(key)
  vi.stubGlobal('get', get)
  vi.stubGlobal('window', { ioc: { get, whenReady: vi.fn(), register: (key: string, service: unknown) => services.set(key, service) } })
  const { LayerCommitter } = await import('../../history/layer-committer.drone.js')
  const committer = new LayerCommitter()
  const notesSig = await commitLayer('notes', { name: 'notes', text: 'A pre-existing tile' })
  await commitLayer('', { name: '/', children: [notesSig] })
  const level = {
    name: 'Native fixture', cols: 4, rows: 3,
    tiles: [1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1],
    player: { col: 1, row: 1 }, door: { col: 2, row: 1 }, enemies: [], items: [], mirrors: [],
  }
  const room: RoomDef = {
    id: 'entry', labyrinthId: 'native-test', depth: 0, level,
    doors: [{ id: 'in', col: 2, row: 1, targetRoomId: 'inside', targetDoorId: 'out' }],
    relics: [{ id: 'point-one', col: 1, row: 1, kind: 'triangle', point: 0 }], gates: [],
  }
  const surface = new SolomonTileSurface({ history, committer, parentSegments: [] })
  const loaded = await surface.ensureRoom(room)
  expect(loaded.room).toEqual(room)
  expect((await history.currentLayerAt(''))!.children).toContain(notesSig)
  const nativeRoom = await history.currentLayerAt(`${SOLOMON_MAZE_BRANCH}/entry`)
  expect(nativeRoom!.children).toHaveLength(12)
  const square = loaded.tiles[5]
  const before = await history.currentLayerAt(square.segments.join('/'))
  const note = 'a'.repeat(64)
  await committer.update(square.segments, { notes: [note] })
  const after = await history.currentLayerAt(square.segments.join('/'))
  expect(after!.solomonTile).toEqual(before!.solomonTile)
  expect(after!.notes).toEqual([note])
  expect((await surface.readRoom('entry'))!.room).toEqual(room)
  expect((await surface.readRoom('entry'))!.tiles[5].layer.notes).toEqual([note])
})
