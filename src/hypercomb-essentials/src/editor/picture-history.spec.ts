// picture-history.spec.ts — every picture a name has worn, newest first:
// this alias, then the repo, then the variants kept with references.

import { describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { pictureHistory } from './picture-history.js'

const hex = (seed: string): string => {
  let out = ''
  for (let i = 0; i < 64; i++) out += ((seed.charCodeAt(i % seed.length) + i) % 16).toString(16)
  return out
}
const text = (value: string) => ({ text: async () => value }) as unknown as Blob

const hive = async (opts: {
  here?: Array<Record<string, unknown> | null>
  repo?: Array<Record<string, unknown> | null>
  variants?: Array<Record<string, unknown> | null>
}) => {
  const resources = new Map<string, string>()
  const layers = new Map<string, { properties?: string[] }>()
  const lists = new Map<string, Array<{ layerSig: string }>>()
  let n = 0
  const layerOf = (props: Record<string, unknown> | null): string => {
    const layerSig = hex('layer' + n++)
    if (props) {
      const propsSig = hex('props' + n++)
      resources.set(propsSig, JSON.stringify(props))
      layers.set(layerSig, { properties: [propsSig] })
    } else layers.set(layerSig, {})
    return layerSig
  }
  lists.set('team/zed', (opts.here ?? []).map(p => ({ layerSig: layerOf(p) })))
  lists.set('zed', (opts.repo ?? []).map(p => ({ layerSig: layerOf(p) })))
  const variantRecords = (opts.variants ?? []).map(p => JSON.stringify({ kind: 'canonical:variant', payload: { layerSig: layerOf(p) } }))
  const nameKey = await SignatureService.sign(new TextEncoder().encode('zed').buffer as ArrayBuffer)
  const bucket = {
    async *values() { for (const record of variantRecords) yield { kind: 'file', getFile: async () => text(record) } },
  }
  const history = {
    sign: async (l: { explorerSegments: () => readonly string[] }) => l.explorerSegments().join('/'),
    listLayers: async (sig: string) => lists.get(sig) ?? [],
    getLayerBySig: async (sig: string) => layers.get(sig) ?? null,
  }
  const store = {
    getResource: async (sig: string) => resources.has(sig) ? text(resources.get(sig)!) : null,
    openPool: async () => ({ getDirectoryHandle: async (key: string) => { if (key !== nameKey) throw new Error('none'); return bucket } }) as unknown as FileSystemDirectoryHandle,
  }
  return { history, store }
}

const pic = (small: string, large?: string) => ({ small: { image: hex(small) }, ...(large ? { large: { image: hex(large) } } : {}) })

describe('pictureHistory', () => {
  it('lists this alias, then the repo, then kept variants — each newest first', async () => {
    const { history, store } = await hive({
      here: [pic('h1'), pic('h2')],
      repo: [pic('r1', 'R1')],
      variants: [pic('v1')],
    })
    const entries = await pictureHistory(history, store, ['team'], 'zed')
    expect(entries.map(e => [e.from, e.thumb])).toEqual([
      ['here', hex('h2')], ['here', hex('h1')], ['repo', hex('r1')], ['variant', hex('v1')],
    ])
  })

  it('loads the original when one was kept, the small picture otherwise', async () => {
    const { history, store } = await hive({ repo: [pic('r1', 'R1'), pic('r2')] })
    const entries = await pictureHistory(history, store, [], 'zed')
    expect(entries.map(e => e.original)).toEqual([hex('r2'), hex('R1')])
  })

  it('shows each picture once and skips layers without one', async () => {
    const { history, store } = await hive({ here: [pic('same', 'SAME'), null], repo: [pic('same', 'SAME')] })
    const entries = await pictureHistory(history, store, ['team'], 'zed')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.from).toBe('here')
  })
})
