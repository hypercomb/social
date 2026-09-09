import { afterEach, describe, expect, it } from 'vitest'
import { gatheredFrom } from './gathered-from'

type Layer = { name?: string; children?: string[] }

/** A holder with reference children whose targets are the given routes. */
const hive = (children: Record<string, readonly string[] | null>) => {
  const layers = new Map<string, Layer>()
  const names = Object.keys(children)
  for (const name of names) layers.set('sig:' + name, { name })
  const holderSig = 'loc:dolphin/associates'
  layers.set(holderSig, { name: 'associates', children: names.map(n => 'sig:' + n) })
  ;(globalThis as { ioc?: unknown }).ioc = {
    get: (key: string) => {
      if (key === '@diamondcoreprocessor.com/HistoryService') return {
        sign: async (l: { explorerSegments: () => readonly string[] }) => 'loc:' + l.explorerSegments().join('/'),
        currentLayerAt: async (sig: string) => layers.get(sig) ?? null,
        getLayerBySig: async (sig: string) => layers.get(sig) ?? null,
      }
      if (key === '@diamondcoreprocessor.com/DecorationService') return {
        list: async (q: { kind: string; segments: readonly string[] }) => {
          const name = q.segments[q.segments.length - 1] ?? ''
          const target = children[name]
          return q.kind === 'reference' && target
            ? [{ record: { payload: { targetSegments: [...target] } } }]
            : []
        },
      }
      return undefined
    },
  }
}

describe('gatheredFrom — the way back to the group, derived from the children', () => {
  afterEach(() => { delete (globalThis as { ioc?: unknown }).ioc })

  it('names the parent the reference routes share', async () => {
    hive({ dylan: ['people', 'dylan'], ilana: ['people', 'ilana'], betz: ['people', 'betz'] })
    expect(await gatheredFrom(['dolphin', 'associates'])).toEqual(['people'])
  })

  it('ignores ordinary children and lets the most common parent win', async () => {
    hive({ note: null, dylan: ['people', 'dylan'], ilana: ['people', 'ilana'], susan: ['team', 'susan'] })
    expect(await gatheredFrom(['dolphin', 'associates'])).toEqual(['people'])
  })

  it('answers null for a holder with nothing gathered, and for the hive root', async () => {
    hive({ note: null })
    expect(await gatheredFrom(['dolphin', 'associates'])).toBeNull()
    expect(await gatheredFrom([])).toBeNull()
  })

  it('a top-level target has no group to go back to', async () => {
    hive({ dylan: ['dylan'] })
    expect(await gatheredFrom(['dolphin', 'associates'])).toBeNull()
  })
})
