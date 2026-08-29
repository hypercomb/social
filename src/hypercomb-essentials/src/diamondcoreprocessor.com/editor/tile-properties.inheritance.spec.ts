import { afterEach, describe, expect, it, vi } from 'vitest'
import { readTilePropertiesAt, writeTilePropertiesAt, TILE_PROPERTY_PINS } from './tile-properties.js'

const ROOT_LOCATION = '1'.repeat(64)
const OUTER_LOCATION = '2'.repeat(64)
const ROOT_PROPS = 'a'.repeat(64)
const OUTER_PROPS = 'b'.repeat(64)
const ROOT_IMAGE = 'c'.repeat(64)

class TextBlob {
  readonly type: string
  readonly size: number
  readonly #text: string

  constructor(parts: readonly unknown[] = [], options: { type?: string } = {}) {
    this.#text = parts.map(part => String(part ?? '')).join('')
    this.size = this.#text.length
    this.type = options.type ?? ''
  }

  async text(): Promise<string> { return this.#text }
}

const harness = (
  root: Record<string, unknown>,
  outer: Record<string, unknown>,
): { written: Blob[]; commitSlotSet: ReturnType<typeof vi.fn> } => {
  vi.stubGlobal('Blob', TextBlob)
  const written: Blob[] = []
  const commitSlotSet = vi.fn(async () => {})
  const history = {
    sign: vi.fn(async (lineage: { explorerSegments?: () => readonly string[] }) => {
      const segments = [...(lineage.explorerSegments?.() ?? [])]
      return segments.length === 1 ? ROOT_LOCATION : OUTER_LOCATION
    }),
    currentLayerAt: vi.fn(async (sig: string) => sig === ROOT_LOCATION
      ? { properties: [ROOT_PROPS] }
      : { properties: [OUTER_PROPS] }),
  }
  const store = {
    getResource: vi.fn(async (sig: string) => {
      if (sig === ROOT_PROPS) return new Blob([JSON.stringify(root)], { type: 'application/json' })
      if (sig === OUTER_PROPS) return new Blob([JSON.stringify(outer)], { type: 'application/json' })
      return null
    }),
    putResource: vi.fn(async (blob: Blob) => { written.push(blob); return 'd'.repeat(64) }),
  }
  const services = new Map<string, unknown>([
    ['@diamondcoreprocessor.com/HistoryService', history],
    ['@hypercomb.social/Store', store],
    ['@diamondcoreprocessor.com/LayerCommitter', { commitSlotSet }],
  ])
  vi.stubGlobal('window', { ioc: { get: (key: string) => services.get(key) } })
  return { written, commitSlotSet }
}

afterEach(() => vi.unstubAllGlobals())

describe('canonical tile property inheritance', () => {
  it('shallow-merges root defaults and lets the outer object overwrite them', async () => {
    harness(
      { imageSig: ROOT_IMAGE, border: { color: '#112233' }, tags: ['root'] },
      { border: { color: '#abcdef' }, index: 8 },
    )

    await expect(readTilePropertiesAt(['team'], 'howard')).resolves.toEqual({
      imageSig: ROOT_IMAGE,
      border: { color: '#abcdef' },
      tags: ['root'],
      index: 8,
    })
  })

  it('stores only outer differences when an editor submits the composed object', async () => {
    const { written, commitSlotSet } = harness(
      { imageSig: ROOT_IMAGE, border: { color: '#112233' }, tags: ['root'], index: 1 },
      { index: 8 },
    )

    await writeTilePropertiesAt(['team'], 'howard', {
      imageSig: ROOT_IMAGE,
      border: { color: '#112233' },
      tags: ['root'],
      index: 8,
    })

    expect(commitSlotSet).toHaveBeenCalledOnce()
    expect(written).toHaveLength(1)
    await expect(written[0].text().then(JSON.parse)).resolves.toEqual({ index: 8 })
  })

  // CLEARING. The editor hands the writer a COMPLETE form, so a removal can
  // only ever arrive as a key present with `undefined` — an absent key is
  // "leave alone" and the old value survives the merge.

  it('removes an own property when the form carries the key as undefined', async () => {
    const { written } = harness(
      { link: 'https://example.com', tags: ['root'] },
      {},
    )

    await writeTilePropertiesAt([], 'howard', { link: undefined, tags: ['root'] })

    await expect(written[0].text().then(JSON.parse)).resolves.toEqual({ tags: ['root'] })
  })

  it('tombstones an inherited property the outer appearance cleared', async () => {
    const { written } = harness(
      { link: 'https://example.com', tags: ['root'] },
      { index: 8 },
    )

    await writeTilePropertiesAt(['team'], 'howard', {
      link: undefined,
      tags: ['root'],
      index: 8,
    })

    // Nothing local to remove — the pin is what suppresses the root default.
    await expect(written[0].text().then(JSON.parse)).resolves.toEqual({
      index: 8,
      [TILE_PROPERTY_PINS]: ['link'],
    })
  })

  it('reads a tombstoned property as absent at that appearance', async () => {
    harness(
      { link: 'https://example.com', tags: ['root'] },
      { index: 8, [TILE_PROPERTY_PINS]: ['link'] },
    )

    await expect(readTilePropertiesAt(['team'], 'howard')).resolves.toEqual({
      tags: ['root'],
      index: 8,
      [TILE_PROPERTY_PINS]: ['link'],
    })
  })

  it('retires the tombstone when the appearance supplies its own value again', async () => {
    const { written } = harness(
      { link: 'https://example.com', tags: ['root'] },
      { index: 8, [TILE_PROPERTY_PINS]: ['link'] },
    )

    await writeTilePropertiesAt(['team'], 'howard', {
      link: 'https://example.com/mine',
      tags: ['root'],
      index: 8,
      [TILE_PROPERTY_PINS]: ['link'],
    })

    await expect(written[0].text().then(JSON.parse)).resolves.toEqual({
      link: 'https://example.com/mine',
      index: 8,
    })
  })

  it('leaves a root-pinned key to the root when an outer clear arrives', async () => {
    const { written } = harness(
      { link: 'https://example.com', [TILE_PROPERTY_PINS]: ['link'] },
      { index: 8 },
    )

    await writeTilePropertiesAt(['team'], 'howard', {
      link: undefined,
      index: 8,
      [TILE_PROPERTY_PINS]: ['link'],
    })

    await expect(written[0].text().then(JSON.parse)).resolves.toEqual({ index: 8 })
  })

  it('refuses to store an outer write to a root-pinned property', async () => {
    const { written } = harness(
      { imageSig: ROOT_IMAGE, [TILE_PROPERTY_PINS]: ['imageSig'] },
      { index: 8 },
    )

    await writeTilePropertiesAt(['team'], 'howard', {
      imageSig: 'e'.repeat(64),
      index: 8,
      [TILE_PROPERTY_PINS]: ['imageSig'],
    })

    await expect(written[0].text().then(JSON.parse)).resolves.toEqual({ index: 8 })
  })
})
