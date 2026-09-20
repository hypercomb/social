import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CAVE_COLUMNS, CAVE_ROWS } from './dos-geometry.js'
import { BUILTIN_LEVELS } from './levels.js'
import {
  BUBBLE_DOS_BRANCH, BUBBLE_DOS_SOURCE_SHA256, BubbleTileSurface,
  type BubbleTileCommitter, type BubbleTileHistory, type BubbleTileLayer,
} from './tile-surface.js'

/** Content-addressed child signatures plus mutable location heads reproduce the
 * two ways a native hive tree can be read. Parent signatures intentionally stay
 * stale after an authored child edit so the live-head rule is exercised. */
function nativeHive() {
  const pool = new Map<string, BubbleTileLayer>()
  const heads = new Map<string, string>()
  let writes = 0
  let cold = false
  const key = (segments: readonly string[]) => segments.join('/')
  const put = (segments: readonly string[], layer: BubbleTileLayer) => {
    const sig = createHash('sha256').update(JSON.stringify(layer)).digest('hex')
    pool.set(sig, structuredClone(layer))
    heads.set(key(segments), sig)
    return sig
  }
  const read = (segments: readonly string[]) => pool.get(heads.get(key(segments)) ?? '')
  const history: BubbleTileHistory = {
    sign: async lineage => key(lineage.explorerSegments()),
    currentLayerAt: async (sig, stats) => {
      if (stats && cold) stats.cold = true
      return cold ? null : structuredClone(pool.get(heads.get(sig) ?? '') ?? null)
    },
    getLayerBySig: async sig => structuredClone(pool.get(sig) ?? null),
  }
  const committer: BubbleTileCommitter = {
    importTree: async updates => {
      writes++
      for (const update of [...updates].sort((a, b) => b.segments.length - a.segments.length)) {
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
  const surface = () => new BubbleTileSurface({ history, committer, parentSegments: [] })
  return { surface, history, pool, heads, put, read, writes: () => writes, setCold: () => { cold = true } }
}

const roundSegments = (index = 0) => [BUBBLE_DOS_BRANCH, `round-${String(index + 1).padStart(3, '0')}`]

describe('Bubble Bobble native DOS round surface', () => {
  it('seeds one child layer per visible DOS cell and hydrates gameplay from those children', async () => {
    const hive = nativeHive()
    const expected = BUILTIN_LEVELS[0]
    const loaded = await hive.surface().ensureRound(0)
    expect(loaded.level).toEqual(expected)
    expect(loaded.tiles).toHaveLength(CAVE_COLUMNS * CAVE_ROWS)
    const branch = hive.read([BUBBLE_DOS_BRANCH])!
    expect(branch.bubbleCampaign).toEqual({ version: 1, sourceSha256: BUBBLE_DOS_SOURCE_SHA256 })
    const round = hive.read(roundSegments())!
    expect(round.children).toHaveLength(CAVE_COLUMNS * CAVE_ROWS)
    expect(round.children!.every(sig => /^[a-f0-9]{64}$/.test(sig))).toBe(true)
    expect(round.bubbleRound).not.toHaveProperty('tiles')
    expect(round.bubbleRound).not.toHaveProperty('nativeCells')
    expect(round.bubbleRound).not.toHaveProperty('enemies')
    expect(round.bubbleRound).not.toHaveProperty('spawn')
    expect(loaded.tiles[9 * CAVE_COLUMNS + 12].segments).toEqual([
      ...roundSegments(), 'cell-12-09',
    ])
    expect(hive.writes()).toBe(1)
  })

  it('uses an authored live cell head on reopen and never restores the bundled seed over it', async () => {
    const hive = nativeHive()
    const first = await hive.surface().ensureRound(0)
    const edited = first.tiles.find(tile => tile.layer.bubbleCell
      && (tile.layer.bubbleCell as { enemies?: unknown[] }).enemies?.length)!
    const old = hive.read(edited.segments)!
    hive.put(edited.segments, {
      ...old,
      bubbleCell: { ...(old.bubbleCell as object), value: 7, enemies: [] },
    })
    const reopened = await hive.surface().ensureRound(0)
    expect(reopened.level.nativeCells![edited.row][edited.col]).toBe(7)
    expect(reopened.level.enemies).toHaveLength(BUILTIN_LEVELS[0].enemies.length
      - (old.bubbleCell as { enemies: unknown[] }).enemies.length)
    expect(hive.writes()).toBe(1)
  })

  it('preserves native descriptor order when several enemies occupy one cell', async () => {
    const hive = nativeHive()
    const loaded = await hive.surface().ensureRound(0)
    expect(loaded.level.enemies.map(enemy => enemy.spawnDelay)).toEqual([10, 17, 24])
    expect(loaded.level.enemies.map(enemy => enemy.kind)).toEqual(['zenchan', 'zenchan', 'zenchan'])
  })

  it('hydrates a published content-addressed tree whose descendants have no local heads', async () => {
    const hive = nativeHive()
    await hive.surface().ensureRound(0)
    for (const path of [...hive.heads.keys()]) if (path !== '') hive.heads.delete(path)
    const loaded = await hive.surface().ensureRound(0)
    expect(loaded.level).toEqual(BUILTIN_LEVELS[0])
    expect(hive.writes()).toBe(1)
  })

  it('preserves unrelated siblings and refuses to repurpose conflicting authored content', async () => {
    const hive = nativeHive()
    const note = hive.put(['notes'], { name: 'notes', text: 'Keep me' })
    hive.put([], { name: 'root', children: [note] })
    await hive.surface().ensureRound(0)
    expect(hive.read([])!.children).toContain(note)

    const conflict = nativeHive()
    conflict.put([BUBBLE_DOS_BRANCH], { name: BUBBLE_DOS_BRANCH, text: 'Authored content' })
    await expect(conflict.surface().ensureRound(0)).rejects.toThrow('other content')
    expect(conflict.writes()).toBe(0)
  })

  it('refuses incomplete and cold surfaces without silently reseeding them', async () => {
    const hive = nativeHive()
    await hive.surface().ensureRound(0)
    const parent = hive.read(roundSegments())!
    hive.put(roundSegments(), { ...parent, children: parent.children!.slice(1) })
    await expect(hive.surface().ensureRound(0)).rejects.toThrow('incomplete')
    expect(hive.writes()).toBe(1)

    const cold = nativeHive()
    cold.setCold()
    await expect(cold.surface().ensureRound(0)).rejects.toThrow('still loading')
    expect(cold.writes()).toBe(0)
  })

  it('accepts every native DOS record as a seed and round-trips all 100 rounds', async () => {
    const hive = nativeHive()
    for (let index = 0; index < BUILTIN_LEVELS.length; index++) {
      const loaded = await hive.surface().ensureRound(index)
      expect(loaded.level).toEqual(BUILTIN_LEVELS[index])
      expect(loaded.tiles).toHaveLength(CAVE_COLUMNS * CAVE_ROWS)
      expect(hive.read(roundSegments(index))!.children).toHaveLength(CAVE_COLUMNS * CAVE_ROWS)
    }
    expect(hive.writes()).toBe(BUILTIN_LEVELS.length)
  }, 60_000)

  it('serializes concurrent first entry so the round is imported exactly once', async () => {
    const hive = nativeHive()
    const surface = hive.surface()
    const [first, second] = await Promise.all([
      surface.ensureRound(0),
      surface.ensureRound(0),
    ])
    expect(first.level).toEqual(second.level)
    expect(hive.writes()).toBe(1)
  })
})
