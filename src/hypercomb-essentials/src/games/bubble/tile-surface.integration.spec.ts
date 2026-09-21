import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { canonicalLayerJson, type CanonicalLayerContent } from '../../history/canonical-layer.js'
import { CAVE_COLUMNS, CAVE_ROWS } from './dos-geometry.js'
import { BUILTIN_LEVELS } from './levels.js'
import { BUBBLE_DOS_BRANCH, BubbleTileSurface } from './tile-surface.js'

// Storage and notification delivery are the only substitutes. The test drives
// the real public importTree API and the real LayerMachine implementation, the
// same harness Solomon's integration spec uses.

vi.mock('@hypercomb/core', () => ({ EffectBus: { on: vi.fn(), emit: vi.fn() } }))
vi.mock('../../history/history.service.js', () => ({ ROOT_NAME: '/' }))
afterEach(() => { vi.unstubAllGlobals() })

async function nativeHive() {
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
  vi.stubGlobal('window', {
    ioc: { get, whenReady: vi.fn(), register: (key: string, service: unknown) => services.set(key, service) },
  })
  const { LayerCommitter } = await import('../../history/layer-committer.drone.js')
  const committer = new LayerCommitter()
  const notesSig = await commitLayer('notes', { name: 'notes', text: 'A pre-existing tile' })
  await commitLayer('', { name: '/', children: [notesSig] })
  const surface = () => new BubbleTileSurface({ history, committer, parentSegments: [] })
  return {
    surface, committer, history, pool, heads, notesSig,
    read: (address: string) => pool.get(heads.get(address) ?? ''),
    // A round's location head is the live membership record for its cells;
    // only the cell heads may be absent while reopening several independently
    // imported rounds. Erasing branch and round heads as well loses the only
    // references to rounds added after root's immutable first branch sig.
    clearCellHeads: () => {
      for (const address of [...heads.keys()]) if (address.split('/').length >= 3) heads.delete(address)
    },
    // The first imported round is carried by root's immutable child sig, so
    // it remains a valid content-addressed fallback when every local head is
    // absent. This deliberately does not claim later per-page imports can be
    // recovered after deleting the branch and round membership records.
    clearNonRootHeads: () => { for (const address of [...heads.keys()]) if (address !== '') heads.delete(address) },
  }
}

const roundPath = (index = 0) => [BUBBLE_DOS_BRANCH, `round-${String(index + 1).padStart(3, '0')}`].join('/')

it('seeds a DOS round through the real committer and keeps an unrelated sibling', async () => {
  const hive = await nativeHive()
  const loaded = await hive.surface().ensureRound(0)
  expect(loaded.level).toEqual(BUILTIN_LEVELS[0])
  expect(loaded.tiles).toHaveLength(CAVE_COLUMNS * CAVE_ROWS)
  expect(hive.read('')!.children).toContain(hive.notesSig)
  const branch = hive.read(BUBBLE_DOS_BRANCH)!
  expect(branch.bubbleCampaign).toEqual({ version: 1, sourceSha256: (await import('./tile-surface.js')).BUBBLE_DOS_SOURCE_SHA256 })
  expect(hive.read(roundPath())!.children).toHaveLength(CAVE_COLUMNS * CAVE_ROWS)
  expect(loaded.tiles[9 * CAVE_COLUMNS + 12].segments).toEqual([...roundPath().split('/'), 'cell-12-09'])
})

it('seeds several DOS rounds through the real committer and reopens them with cold cell heads', async () => {
  const hive = await nativeHive()
  const COUNT = 3
  for (let index = 0; index < COUNT; index++) expect((await hive.surface().ensureRound(index)).level).toEqual(BUILTIN_LEVELS[index])
  expect(hive.read(roundPath())!.children).toHaveLength(CAVE_COLUMNS * CAVE_ROWS)
  hive.clearCellHeads()
  for (let index = 0; index < COUNT; index++) {
    expect((await hive.surface().ensureRound(index)).level).toEqual(BUILTIN_LEVELS[index])
  }
})

it('keeps an authored cell head while reopening several independently imported rounds', async () => {
  const hive = await nativeHive()
  const rounds = await Promise.all([0, 1, 2].map(index => hive.surface().ensureRound(index)))
  const edited = rounds[1].tiles[100]
  const old = edited.layer.bubbleCell as Record<string, unknown> & { value: number }
  const value = old.value ^ 1
  await hive.committer.update(edited.segments, { bubbleCell: { ...old, value } })

  // The round's stored child signature is intentionally stale after an edit.
  // Reopening must use the cell location's authored head, while the other
  // per-page rounds still resolve through their own live membership heads.
  const reopened = await Promise.all([0, 1, 2].map(index => hive.surface().ensureRound(index)))
  expect(reopened[0].level).toEqual(BUILTIN_LEVELS[0])
  expect(reopened[1].level.nativeCells![edited.row][edited.col]).toBe(value)
  expect(reopened[2].level).toEqual(BUILTIN_LEVELS[2])
})

it('rehydrates the first published DOS round with no non-root local heads', async () => {
  const hive = await nativeHive()
  await hive.surface().ensureRound(0)
  hive.clearNonRootHeads()

  // The returned projection, rather than a mock-head read, proves that the
  // content-addressed branch, round, and cells were all resolved from root.
  const reopened = await hive.surface().ensureRound(0)
  expect(reopened.level).toEqual(BUILTIN_LEVELS[0])
  expect(reopened.tiles).toHaveLength(CAVE_COLUMNS * CAVE_ROWS)
})
