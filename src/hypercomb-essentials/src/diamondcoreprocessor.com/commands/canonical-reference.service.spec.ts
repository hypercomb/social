import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  constructor(readonly history: FakeHistory) {}
  async commitChildrenDeltas(segments: readonly string[], changes: { appends?: readonly string[] }): Promise<string> {
    const location = await this.history.sign({ explorerSegments: () => segments })
    const current = await this.history.currentLayerAt(location) ?? { name: segments.at(-1) ?? '' }
    const children = [...new Set([...(current.children ?? []), ...(changes.appends ?? [])])]
    return this.history.commitLayer(location, { ...current, children })
  }
  async importTree(updates: { segments: readonly string[]; layer: Layer }[]): Promise<void> {
    const sigAt = new Map<string, string>()
    for (const update of [...updates].sort((a, b) => b.segments.length - a.segments.length)) {
      const layer = { ...update.layer }
      if (Array.isArray(layer.children)) {
        layer.children = layer.children.map(name => sigAt.get([...update.segments, name].join('/')) ?? name)
      }
      const location = await this.history.sign({ explorerSegments: () => update.segments })
      sigAt.set(update.segments.join('/'), await this.history.commitLayer(location, layer))
    }
    for (const update of updates) {
      if (update.segments.length === 0) continue
      const hasParent = updates.some(other => other.segments.length === update.segments.length - 1
        && other.segments.every((segment, index) => segment === update.segments[index]))
      if (hasParent) continue
      const sig = sigAt.get(update.segments.join('/'))
      if (sig) await this.commitChildrenDeltas(update.segments.slice(0, -1), { appends: [sig] })
    }
  }
}

describe('CanonicalReferenceService', () => {
  let history: FakeHistory
  let written: unknown[]
  let pooled: unknown[]

  beforeEach(async () => {
    services.clear()
    history = new FakeHistory()
    written = []
    pooled = []
    const friendSig = await history.commitLayer(hex('friend-location'), {
      name: 'friend', notes: ['2'.repeat(64)],
    })
    const peopleSig = await history.commitLayer(hex('people-location'), {
      name: 'people',
      notes: ['1'.repeat(64)],
      children: [friendSig],
      properties: ['3'.repeat(64)],
      decorations: ['4'.repeat(64)],
    })
    const nestSig = await history.commitLayer(hex('nest-location'), { name: 'nest', children: [peopleSig] })
    await history.commitLayer(await history.sign({ explorerSegments: () => [] }), {
      name: '', children: [nestSig],
    })
    services.set('@diamondcoreprocessor.com/HistoryService', history)
    services.set('@diamondcoreprocessor.com/LayerCommitter', new FakeCommitter(history))
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
      getPool: async () => ({
        getFileHandle: async () => ({
          createWritable: async () => ({
            write: async (bytes: Uint8Array) => { pooled.push(JSON.parse(new TextDecoder().decode(bytes))) },
            close: async () => undefined,
          }),
        }),
      }) as unknown as FileSystemDirectoryHandle,
    })
  })

  it('promotes a discovered subtree to the fixed-name root', async () => {
    const service = new CanonicalReferenceServiceImpl()
    await expect(service.ensureRoot('people', ['nest', 'people'])).resolves.toMatchObject({
      name: 'people', segments: ['people'],
    })
    const root = await history.currentLayerAt(await history.sign({ explorerSegments: () => ['people'] }))
    expect(root).toMatchObject({ name: 'people', notes: ['1'.repeat(64)] })
    const child = await history.currentLayerAt(await history.sign({ explorerSegments: () => ['people', 'friend'] }))
    expect(child).toMatchObject({ name: 'friend', notes: ['2'.repeat(64)] })
    expect(pooled).toContainEqual(expect.objectContaining({ kind: 'canonical:variant' }))
  })

  it('snapshots details but keeps structure at the canonical root', async () => {
    const service = new CanonicalReferenceServiceImpl()
    await expect(service.place({
      name: 'people', sourceSegments: ['nest', 'people'], parentSegments: ['project'],
    })).resolves.toBe('people')
    expect(written[0]).toMatchObject({ kind: 'reference', payload: { targetSegments: ['people'] } })
    expect(JSON.stringify(written[0])).not.toContain('nest')
    const appearance = await history.currentLayerAt(
      await history.sign({ explorerSegments: () => ['project', 'people'] }),
    )
    expect(appearance).toMatchObject({
      name: 'people',
      notes: ['1'.repeat(64)],
      properties: ['3'.repeat(64)],
      decorations: expect.arrayContaining(['4'.repeat(64), expect.any(String)]),
    })
    expect(appearance).not.toHaveProperty('children')
  })

  it('keeps the Portal default-authoring row slim and marked', async () => {
    const service = new CanonicalReferenceServiceImpl()
    await service.place({
      name: 'people',
      sourceSegments: ['nest', 'people'],
      parentSegments: ['sets'],
      editsRootDefault: true,
    })
    expect(written[0]).toMatchObject({
      kind: 'reference', payload: { targetSegments: ['people'], editsRootDefault: true },
    })
    const portal = await history.currentLayerAt(
      await history.sign({ explorerSegments: () => ['sets', 'people'] }),
    )
    expect(portal).toEqual({ name: 'people', decorations: [expect.any(String)] })
  })

  it('does not repaint an existing same-name appearance', async () => {
    const service = new CanonicalReferenceServiceImpl()
    await service.ensureRoot('jaime', null)
    const rootLocation = await history.sign({ explorerSegments: () => ['jaime'] })
    const hiveLocation = await history.sign({ explorerSegments: () => [] })
    const setRootImage = async (propertiesSig: string): Promise<void> => {
      const markerSig = await history.commitLayer(rootLocation, { name: 'jaime', properties: [propertiesSig] })
      const hive = await history.currentLayerAt(hiveLocation) ?? { name: '', children: [] }
      const survivors: string[] = []
      for (const sig of hive.children ?? []) {
        if ((await history.getLayerBySig(sig))?.name !== 'jaime') survivors.push(sig)
      }
      await history.commitLayer(hiveLocation, { ...hive, children: [...survivors, markerSig] })
    }
    await setRootImage('a'.repeat(64))
    await service.place({ name: 'jaime', sourceSegments: ['jaime'], parentSegments: ['friends'] })
    await setRootImage('b'.repeat(64))
    await service.place({ name: 'jaime', sourceSegments: ['jaime'], parentSegments: ['team'] })
    const friends = await history.currentLayerAt(
      await history.sign({ explorerSegments: () => ['friends', 'jaime'] }),
    )
    const team = await history.currentLayerAt(
      await history.sign({ explorerSegments: () => ['team', 'jaime'] }),
    )
    expect(friends?.properties).toEqual(['a'.repeat(64)])
    expect(team?.properties).toEqual(['b'.repeat(64)])
  })
})
