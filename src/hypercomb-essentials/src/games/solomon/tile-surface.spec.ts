import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { RoomDef } from './labyrinth.js'
import {
  SOLOMON_MAZE_BRANCH, SolomonTileSurface, syncTerrain,
  type NativeTileLayer, type TileSurfaceHistory, type TileSurfaceCommitter,
} from './tile-surface.js'

/** A content-addressed store with independent location heads. Keeping parent
 *  sigs stale after edits exercises the same live-head rule as the real hive. */
function nativeHive() {
  const pool = new Map<string, NativeTileLayer>()
  const heads = new Map<string, string>()
  let writes = 0
  let cold = false
  const key = (segments: readonly string[]) => segments.join('/')
  const put = (segments: readonly string[], layer: NativeTileLayer) => {
    const sig = createHash('sha256').update(JSON.stringify(layer)).digest('hex')
    pool.set(sig, structuredClone(layer))
    heads.set(key(segments), sig)
    return sig
  }
  const read = (segments: readonly string[]) => pool.get(heads.get(key(segments)) ?? '')
  const history: TileSurfaceHistory = {
    sign: async lineage => key(lineage.explorerSegments()),
    currentLayerAt: async (sig, stats) => {
      if (stats && cold) stats.cold = true
      return cold ? null : structuredClone(pool.get(heads.get(sig) ?? '') ?? null)
    },
    getLayerBySig: async sig => structuredClone(pool.get(sig) ?? null),
  }
  const committer: TileSurfaceCommitter = {
    importTree: async updates => {
      writes++
      const ordered = [...updates].sort((a, b) => b.segments.length - a.segments.length)
      for (const update of ordered) {
        const layer = { ...read(update.segments), ...update.layer }
        const sig = put(update.segments, layer)
        const parentSegments = update.segments.slice(0, -1)
        const parent = read(parentSegments) ?? { name: parentSegments.at(-1) ?? 'root' }
        const children = (parent.children ?? []).filter(childSig => pool.get(childSig)?.name !== layer.name)
        put(parentSegments, { ...parent, children: [...children, sig] })
      }
    },
  }
  put([], { name: 'root', children: [] })
  const surface = () => new SolomonTileSurface({ history, committer, parentSegments: [] })
  return { surface, history, pool, heads, put, read, writes: () => writes, setCold: () => { cold = true } }
}

function room(): RoomDef {
  const cols = 16, rows = 12
  return {
    id: 'threshold', labyrinthId: 'first-comb', depth: 0,
    level: {
      name: 'Threshold', cols, rows,
      tiles: Array.from({ length: cols * rows }, (_, index) =>
        index < cols || index >= cols * (rows - 1) || index % cols === 0 || index % cols === cols - 1 ? 1 : 0),
      player: { col: 2, row: 10 }, door: { col: 14, row: 10 },
      enemies: [{ col: 8, row: 10, kind: 'goblin', dir: -1 }],
      items: [{ col: 4, row: 10, kind: 'key' }],
      mirrors: [{ col: 9, row: 10, kind: 'demonhead' }], theme: 'crystal',
    },
    doors: [{ id: 'deeper', col: 14, row: 10, targetRoomId: 'vault', targetDoorId: 'back' }],
    relics: [{ id: 'triangle-one', col: 5, row: 10, kind: 'triangle', point: 0 }],
    gates: [{ col: 12, row: 10, requires: { kind: 'hexagon' } }],
  }
}

describe('Solomon native tile playing surface', () => {
  it('makes one real child layer per square and hydrates all gameplay from those children', async () => {
    const hive = nativeHive()
    const expected = room()
    const loaded = await hive.surface().ensureRoom(expected)
    expect(loaded.room).toEqual(expected)
    expect(loaded.tiles).toHaveLength(16 * 12)
    const root = hive.read([SOLOMON_MAZE_BRANCH, expected.id])!
    expect(root.children).toHaveLength(192)
    expect(root.children!.every(sig => /^[a-f0-9]{64}$/.test(sig))).toBe(true)
    expect((root.solomonRoom as { level: object }).level).not.toHaveProperty('tiles')
    expect(loaded.tiles[10 * 16 + 14].segments).toEqual([SOLOMON_MAZE_BRANCH, 'threshold', 'cell-14-10'])
    expect((loaded.tiles[10 * 16 + 14].layer.solomonTile as { doors: unknown }).doors).toEqual(expected.doors)
    expect(hive.writes()).toBe(1)
  })

  it('uses authored live square heads on reopen, even when the room parent still lists old signatures', async () => {
    const hive = nativeHive()
    const loaded = await hive.surface().ensureRoom(room())
    const edited = loaded.tiles[10 * 16 + 4]
    const old = hive.read(edited.segments)!
    hive.put(edited.segments, {
      ...old, solomonTile: { ...(old.solomonTile as object), code: 2, items: [] },
    })
    const changedSeed = room()
    changedSeed.level.theme = 'abyss'
    const reopened = await hive.surface().ensureRoom(changedSeed)
    expect(reopened.level.tiles[10 * 16 + 4]).toBe(2)
    expect(reopened.level.items).toEqual([])
    expect(reopened.level.theme).toBe('crystal')
    expect(hive.writes()).toBe(1)
  })

  it('can hydrate a published tree whose children have no local location heads', async () => {
    const hive = nativeHive()
    await hive.surface().ensureRoom(room())
    for (const path of [...hive.heads.keys()]) if (path !== '') hive.heads.delete(path)
    const loaded = await hive.surface().ensureRoom(room())
    expect(loaded.room).toEqual(room())
    expect(hive.writes()).toBe(1)
  })

  it('preserves unrelated sibling tiles and refuses to repurpose a conflicting branch', async () => {
    const hive = nativeHive()
    const other = hive.put(['notes'], { name: 'notes', text: 'Keep me' })
    hive.put([], { name: 'root', children: [other] })
    await hive.surface().ensureRoom(room())
    expect(hive.read([])!.children).toContain(other)
    const conflict = nativeHive()
    conflict.put([SOLOMON_MAZE_BRANCH], { name: SOLOMON_MAZE_BRANCH, text: 'Authored content' })
    await expect(conflict.surface().ensureRoom(room())).rejects.toThrow('other content')
    expect(conflict.writes()).toBe(0)
  })

  it('uses the parent manifest to avoid blocking first entry on an unrelated cold sibling', async () => {
    const hive = nativeHive()
    const other = hive.put(['notes'], { name: 'notes', text: 'Still belongs here' })
    hive.put([], { name: 'root', children: [other] })
    hive.pool.delete(other)
    hive.history.childrenManifestFor = async layer => layer.name === 'root'
      ? [{ sig: other, layer: { name: 'notes', text: 'Still belongs here' } }] : null
    const loaded = await hive.surface().ensureRoom(room())
    expect(loaded.tiles).toHaveLength(192)
    expect(hive.read([])!.children).toContain(other)
    expect(hive.writes()).toBe(1)
  })

  it('refuses incomplete and cold rooms without rewriting the map', async () => {
    const hive = nativeHive()
    const loaded = await hive.surface().ensureRoom(room())
    const parent = hive.read(loaded.roomSegments)!
    hive.put(loaded.roomSegments, { ...parent, children: parent.children!.slice(1) })
    await expect(hive.surface().ensureRoom(room())).rejects.toThrow('incomplete')
    expect(hive.writes()).toBe(1)
    const cold = nativeHive()
    cold.setCold()
    await expect(cold.surface().ensureRoom(room())).rejects.toThrow('still loading')
    expect(cold.writes()).toBe(0)
  })

  it('projects conjuring onto addressed session tiles without authoring shared history', async () => {
    const hive = nativeHive()
    const loaded = await hive.surface().ensureRoom(room())
    const address = loaded.tiles[20].segments
    const changed = [...loaded.level.tiles]
    changed[20] = 2
    syncTerrain(loaded, changed)
    expect(loaded.tiles[20].code).toBe(2)
    expect(loaded.tiles[20].segments).toBe(address)
    expect((hive.read(address)!.solomonTile as { code: number }).code).toBe(0)
    expect(hive.writes()).toBe(1)
  })
})
