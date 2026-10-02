import { afterEach, describe, expect, it, vi } from 'vitest'
import { aliasPropertiesFor, gatheredRepo, readTilePropertiesAt, writeTilePropertiesAt, TILE_PROPERTY_PINS } from './tile-properties.js'

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
  root: Record<string, unknown> | null,
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
      // `root: null` = the repo's bytes are not readable yet (a cold read).
      if (sig === ROOT_PROPS) return root ? new Blob([JSON.stringify(root)], { type: 'application/json' }) : null
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

  // WRITES SINK (documentation/alias-properties.md): a key the alias does not
  // already override goes to the repo — the root tile of the name.
  describe('writes sink to the repo', () => {
    const parse = (blob: Blob): Promise<unknown> => blob.text().then(JSON.parse)

    it('sends a key the alias does not override to the repo, and keeps place keys here', async () => {
      const { written, commitSlotSet } = harness({ tags: ['root'] }, { index: 8 })

      await writeTilePropertiesAt(['team'], 'howard', { link: 'https://example.com', index: 8 })

      expect(commitSlotSet.mock.calls.map(call => call[0])).toEqual([['howard'], ['team', 'howard']])
      await expect(parse(written[0])).resolves.toEqual({ link: 'https://example.com', tags: ['root'] })
      await expect(parse(written[1])).resolves.toEqual({ index: 8 })
    })

    it('keeps the write at the alias when the caller says only here', async () => {
      const { written, commitSlotSet } = harness({ tags: ['root'] }, { index: 8 })

      await writeTilePropertiesAt(['team'], 'howard', { link: 'https://example.com', index: 8 }, { onlyHere: true })

      expect(commitSlotSet).toHaveBeenCalledOnce()
      await expect(parse(written[0])).resolves.toEqual({ link: 'https://example.com', index: 8 })
    })

    it('changes an override the alias already holds in place, never the repo', async () => {
      const { written, commitSlotSet } = harness(
        { border: { color: '#112233' } },
        { border: { color: '#abcdef' }, index: 8 },
      )

      await writeTilePropertiesAt(['team'], 'howard', { border: { color: '#000000' }, index: 8 })

      expect(commitSlotSet).toHaveBeenCalledOnce()
      await expect(parse(written[0])).resolves.toEqual({ border: { color: '#000000' }, index: 8 })
    })

    it('never sinks a theme default picture to the repo', async () => {
      const { written, commitSlotSet } = harness({ imageSig: ROOT_IMAGE, participant: true }, { index: 8 })

      await writeTilePropertiesAt(['team'], 'howard', { imageSig: 'e'.repeat(64), substrate: true, index: 8 })

      expect(commitSlotSet.mock.calls.map(call => call[0])).toEqual([['team', 'howard']])
      await expect(parse(written[0])).resolves.toMatchObject({ imageSig: 'e'.repeat(64), substrate: true })
    })

    it('sinks nothing while the repo cannot be read', async () => {
      const { written, commitSlotSet } = harness(null, { index: 8 })

      await writeTilePropertiesAt(['team'], 'howard', { link: 'https://example.com', index: 8 })

      expect(commitSlotSet.mock.calls.map(call => call[0])).toEqual([['team', 'howard']])
      await expect(parse(written[0])).resolves.toEqual({ link: 'https://example.com', index: 8 })
    })
  })
})

// A NEW ALIAS (alias-properties.md, step 2): what the tile it is made from
// shows, split into what fills the repo and what the alias must override.
describe('aliasPropertiesFor', () => {
  const picture = (sig: string) => ({ small: { image: sig }, flat: { small: { image: sig } }, participant: true })

  it('fills an empty repo with everything but place keys, and overrides nothing', () => {
    expect(aliasPropertiesFor({ ...picture('a'), link: 'L', index: 3, point: [1, 2] }, {}))
      .toEqual({ fill: { ...picture('a'), link: 'L' }, override: {} })
  })

  it('needs nothing when the repo already shows the same', () => {
    expect(aliasPropertiesFor({ ...picture('a'), link: 'L' }, { ...picture('a'), link: 'L' }))
      .toEqual({ fill: {}, override: {} })
  })

  it('never overwrites the repo: a differing value becomes the alias override', () => {
    expect(aliasPropertiesFor({ link: 'mine', accent: 'red' }, { link: 'theirs' }))
      .toEqual({ fill: { accent: 'red' }, override: { link: 'mine' } })
  })

  it('overrides a different picture as one value', () => {
    expect(aliasPropertiesFor(picture('a'), picture('b')))
      .toEqual({ fill: {}, override: picture('a') })
  })

  it('keeps a theme default picture as the alias own, never in the repo', () => {
    const themed = { small: { image: 'a' }, substrate: true }
    expect(aliasPropertiesFor(themed, {})).toEqual({ fill: {}, override: themed })
  })

  it('hides what the repo has that the tile does not show', () => {
    expect(aliasPropertiesFor({ link: 'L' }, { link: 'L', accent: 'red', ...picture('b') }))
      .toEqual({ fill: {}, override: { [TILE_PROPERTY_PINS]: ['accent', 'flat', 'participant', 'small'] } })
  })
})

// A GATHER MEETS TWO COPIES (alias-properties.md, step 3): the newer copy's
// values go to the repo, keys only the older copy has fill it.
describe('gatheredRepo', () => {
  const picture = (sig: string) => ({ small: { image: sig }, participant: true })

  it('takes the newer copy values and fills with what only the older has', () => {
    expect(gatheredRepo({ link: 'repo' }, { link: 'new', accent: 'red' }, { link: 'old', notes: 'n', index: 4 }))
      .toEqual({ link: 'new', accent: 'red', notes: 'n' })
  })

  it('moves the newer picture in whole, replacing the repo picture', () => {
    expect(gatheredRepo({ ...picture('r'), large: { image: 'R' } }, picture('n'), picture('o')))
      .toEqual(picture('n'))
  })

  it('fills the older picture only when the repo and the newer copy have none', () => {
    expect(gatheredRepo({}, { link: 'L' }, picture('o'))).toEqual({ link: 'L', ...picture('o') })
    expect(gatheredRepo(picture('r'), { link: 'L' }, picture('o'))).toEqual({ link: 'L', ...picture('r') })
  })

  it('never lets a theme default picture into the repo', () => {
    expect(gatheredRepo({}, { small: { image: 't' }, substrate: true }, picture('o'))).toEqual(picture('o'))
  })
})
