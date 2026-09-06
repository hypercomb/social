import { beforeEach, describe, expect, it, vi } from 'vitest'
import { moleculeAddress } from '@hypercomb/core'

const services = vi.hoisted(() => new Map<string, unknown>())
vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: (key: string) => services.get(key),
    register: (key: string, value: unknown) => services.set(key, value),
  }
})

import { CanonicalReferenceServiceImpl } from './canonical-reference.service.js'

type Layer = { name?: string; children?: string[]; [key: string]: unknown }
const hex = (seed: string): string => {
  let out = ''
  for (let i = 0; i < 64; i++) out += ((seed.charCodeAt(i % Math.max(seed.length, 1)) + i) % 16).toString(16)
  return out
}

class FakeHistory {
  readonly heads = new Map<string, Layer>()
  readonly content = new Map<string, Layer>()
  async sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string> {
    return hex('path:' + lineage.explorerSegments().join('/'))
  }
  async currentLayerAt(locationSig: string): Promise<Layer | null> {
    return this.heads.get(locationSig) ?? null
  }
  async getLayerBySig(sig: string): Promise<Layer | null> {
    return this.content.get(sig) ?? null
  }
  async commitLayer(locationSig: string, layer: Layer): Promise<string> {
    const sig = hex('layer:' + JSON.stringify(layer))
    const copy = structuredClone(layer)
    this.content.set(sig, copy)
    this.heads.set(locationSig, copy)
    return sig
  }
  async materializeLayer(layer: Layer): Promise<string> {
    const sig = hex('layer:' + JSON.stringify(layer))
    this.content.set(sig, structuredClone(layer))
    return sig
  }
}

class FakeCommitter {
  readonly rootAppends: string[] = []
  constructor(readonly history: FakeHistory) {}
  async commitChildrenDeltas(segments: readonly string[], changes: { appends?: readonly string[] }): Promise<string> {
    if (segments.length === 0) this.rootAppends.push(...(changes.appends ?? []))
    const location = await this.history.sign({ explorerSegments: () => segments })
    const current = await this.history.currentLayerAt(location) ?? { name: segments.at(-1) ?? '' }
    const children = [...new Set([...(current.children ?? []), ...(changes.appends ?? [])])]
    return this.history.commitLayer(location, { ...current, children })
  }
}

describe('CanonicalReferenceService', () => {
  let history: FakeHistory
  let committer: FakeCommitter
  let written: Array<{ kind?: string; payload?: Record<string, unknown> }>
  let pooled: unknown[]
  const at = async (segments: readonly string[]): Promise<Layer | null> =>
    history.currentLayerAt(await history.sign({ explorerSegments: () => segments }))

  beforeEach(async () => {
    services.clear()
    history = new FakeHistory()
    committer = new FakeCommitter(history)
    written = []
    pooled = []
    const friendSig = await history.commitLayer(hex('friend-location'), {
      name: 'friend', notes: ['2'.repeat(64)],
    })
    const peopleSig = await history.commitLayer(await history.sign({ explorerSegments: () => ['nest', 'people'] }), {
      name: 'people',
      notes: ['1'.repeat(64)],
      children: [friendSig],
      properties: ['3'.repeat(64)],
      decorations: ['4'.repeat(64)],
    })
    const nestSig = await history.commitLayer(await history.sign({ explorerSegments: () => ['nest'] }), {
      name: 'nest', children: [peopleSig],
    })
    await history.commitLayer(await history.sign({ explorerSegments: () => [] }), {
      name: '', children: [nestSig],
    })
    services.set('@diamondcoreprocessor.com/HistoryService', history)
    services.set('@diamondcoreprocessor.com/LayerCommitter', committer)
    services.set('@hypercomb.social/Lineage', { domain: undefined })
    services.set('@hypercomb.social/Store', {
      putResource: async (blob: Blob) => {
        const text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onerror = () => reject(reader.error)
          reader.onload = () => resolve(String(reader.result ?? ''))
          reader.readAsText(blob)
        })
        const record = JSON.parse(text) as { kind?: string }
        if (record.kind === 'canonical:variant') return hex('variant:' + JSON.stringify(record))
        written.push(record)
        return hex('decoration:' + written.length)
      },
      getPool: async () => {
        const bucket = {
          getFileHandle: async () => ({
            createWritable: async () => ({
              write: async (bytes: Uint8Array) => { pooled.push(JSON.parse(new TextDecoder().decode(bytes))) },
              close: async () => undefined,
            }),
          }),
        }
        return { ...bucket, getDirectoryHandle: async () => bucket } as unknown as FileSystemDirectoryHandle
      },
    })
  })

  it('points at WHERE THE TARGET LIVES and promotes nothing to the root hive', async () => {
    const service = new CanonicalReferenceServiceImpl()
    await expect(service.place({
      name: 'people', sourceSegments: ['nest', 'people'], parentSegments: ['project'],
    })).resolves.toBe('people')

    // The route is the source, the identity is the target's MOLECULE.
    expect(written[0]).toMatchObject({
      kind: 'reference',
      payload: { targetSegments: ['nest', 'people'], targetSig: await moleculeAddress('people') },
    })

    // The root hive is a STORE, not a collection: nothing was appended to it,
    // and no `/people` copy was minted at the root.
    expect(committer.rootAppends).toEqual([])
    const hive = await at([])
    expect(hive?.children).toHaveLength(1)
    expect(await at(['people'])).toBeNull()

    // The appearance snapshots the target's details (shared sigs, no bytes
    // copied) and carries no structure — navigation enters the target.
    const appearance = await at(['project', 'people'])
    expect(appearance).toMatchObject({
      name: 'people',
      notes: ['1'.repeat(64)],
      properties: ['3'.repeat(64)],
      decorations: expect.arrayContaining(['4'.repeat(64), expect.any(String)]),
    })
    expect(appearance).not.toHaveProperty('children')
    const project = await at(['project'])
    expect(project?.children).toHaveLength(1)
  })

  it('keeps the Portal default-authoring row slim, marked, and pointed at the source', async () => {
    const service = new CanonicalReferenceServiceImpl()
    await service.place({
      name: 'people',
      sourceSegments: ['nest', 'people'],
      parentSegments: ['sets'],
      editsRootDefault: true,
    })
    expect(written[0]).toMatchObject({
      kind: 'reference', payload: { targetSegments: ['nest', 'people'], editsRootDefault: true },
    })
    expect(await at(['sets', 'people'])).toEqual({ name: 'people', decorations: [expect.any(String)] })
    expect(committer.rootAppends).toEqual([])
  })

  it('refuses the hive root, a missing target, and a reference to itself', async () => {
    const service = new CanonicalReferenceServiceImpl()
    await expect(service.place({ name: 'x', sourceSegments: [], parentSegments: ['a'] })).resolves.toBeNull()
    await expect(service.place({ name: 'ghost', sourceSegments: ['nowhere', 'ghost'], parentSegments: ['a'] }))
      .resolves.toBeNull()
    await expect(service.place({ name: 'people', sourceSegments: ['nest', 'people'], parentSegments: ['nest'] }))
      .resolves.toBeNull()
    expect(written).toEqual([])
  })

  it('does not repaint an existing same-name appearance when the target changes', async () => {
    const service = new CanonicalReferenceServiceImpl()
    const source = await history.sign({ explorerSegments: () => ['nest', 'people'] })
    const dress = async (propertiesSig: string): Promise<void> => {
      const current = await history.currentLayerAt(source)
      await history.commitLayer(source, { ...current, name: 'people', properties: [propertiesSig] })
    }
    await dress('a'.repeat(64))
    await service.place({ name: 'people', sourceSegments: ['nest', 'people'], parentSegments: ['friends'] })
    await dress('b'.repeat(64))
    await service.place({ name: 'people', sourceSegments: ['nest', 'people'], parentSegments: ['team'] })
    expect((await at(['friends', 'people']))?.properties).toEqual(['a'.repeat(64)])
    expect((await at(['team', 'people']))?.properties).toEqual(['b'.repeat(64)])
  })

  it('retains what the target meant at the moment it was referenced', async () => {
    const service = new CanonicalReferenceServiceImpl()
    await service.place({ name: 'people', sourceSegments: ['nest', 'people'], parentSegments: ['project'] })
    const candidates = pooled
      .map(entry => entry as { kind?: string; name?: string; payload?: { layerSig?: string } })
      .filter(record => record.kind === 'canonical:variant')
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.name).toBe('people')
    expect(history.content.get(candidates[0]?.payload?.layerSig ?? '')).toMatchObject({
      name: 'people', notes: ['1'.repeat(64)],
    })
  })
})
