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
    const current = await this.history.currentLayerAt(location) ?? {
      name: segments[segments.length - 1] ?? '',
    }
    const children = [...new Set([...(current.children ?? []), ...(changes.appends ?? [])])]
    return await this.history.commitLayer(location, { ...current, children })
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
    const roots = updates.filter(update =>
      !updates.some(other => other.segments.length === update.segments.length - 1
        && other.segments.every((segment, index) => segment === update.segments[index])))
    for (const update of roots) {
      if (update.segments.length === 0) continue
      const sig = sigAt.get(update.segments.join('/'))
      if (sig) await this.commitChildrenDeltas(update.segments.slice(0, -1), { appends: [sig] })
    }
  }
}

describe('CanonicalReferenceService', () => {
  let history: FakeHistory
  let committer: FakeCommitter
  let written: unknown[]
  let pooled: { sig: string; record: unknown }[]

  beforeEach(async () => {
    services.clear()
    history = new FakeHistory()
    committer = new FakeCommitter(history)
    written = []
    pooled = []

    const friendSig = await history.commitLayer(hex('unused-friend'), {
      name: 'friend', notes: ['2'.repeat(64)],
    })
    const peopleSig = await history.commitLayer(hex('unused-people'), {
      name: 'people',
      notes: ['1'.repeat(64)],
      children: [friendSig],
      properties: ['3'.repeat(64)],
      decorations: ['4'.repeat(64)], // includes mutable display-title state
    })
    const nestSig = await history.commitLayer(hex('unused-nest'), { name: 'nest', children: [peopleSig] })
    const setsSig = await history.commitLayer(await history.sign({ explorerSegments: () => ['sets'] }), {
      name: 'sets', children: [],
    })
    await history.commitLayer(await history.sign({ explorerSegments: () => [] }), {
      name: '', children: [nestSig, setsSig],
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
        if (record.kind === 'canonical:variant') return hex('variant:' + text)
        written.push(record)
        return hex('decoration:' + written.length)
      },
      getPool: async () => ({
        getFileHandle: async (sig: string) => ({
          createWritable: async () => {
            let bytes = new Uint8Array()
            return {
              write: async (value: BufferSource) => {
                bytes = value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer)
              },
              close: async () => {
                pooled.push({ sig, record: JSON.parse(new TextDecoder().decode(bytes)) })
              },
            }
          },
        }),
      }) as unknown as FileSystemDirectoryHandle,
    })
  })

  it('promotes a discovered leaf to the matching root and root complement', async () => {
    const service = new CanonicalReferenceServiceImpl()
    await expect(service.ensureRoot('people', ['nest', 'people'])).resolves.toMatchObject({
      name: 'people', segments: ['people'],
    })
    const root = await history.currentLayerAt(await history.sign({ explorerSegments: () => ['people'] }))
    expect(root).toMatchObject({ name: 'people', notes: ['1'.repeat(64)] })
    const descendant = await history.currentLayerAt(
      await history.sign({ explorerSegments: () => ['people', 'friend'] }),
    )
    expect(descendant).toMatchObject({ name: 'friend', notes: ['2'.repeat(64)] })
    const hive = await history.currentLayerAt(await history.sign({ explorerSegments: () => [] }))
    const names = await Promise.all((hive?.children ?? []).map(async sig => (await history.getLayerBySig(sig))?.name))
    expect(names).toContain('people')
    expect(pooled.some(entry => (entry.record as { kind?: string }).kind === 'canonical:variant')).toBe(true)
    const sourceCandidate = pooled
      .map(entry => entry.record as { kind?: string; payload?: { layerSig?: string } })
      .find(record => (history.content.get(record.payload?.layerSig ?? '')?.notes as string[] | undefined)?.[0] === '1'.repeat(64))
    expect(history.content.get(sourceCandidate?.payload?.layerSig ?? '')).toMatchObject({
      name: 'people',
      properties: ['3'.repeat(64)],
      decorations: ['4'.repeat(64)],
      children: [expect.any(String)],
    })
  })

  it('places a lineage leaf that points only at the fixed-name root', async () => {
    const service = new CanonicalReferenceServiceImpl()
    await expect(service.place({
      name: 'people', sourceSegments: ['nest', 'people'], parentSegments: ['sets'],
    })).resolves.toBe('people')
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      kind: 'reference',
      payload: { targetSegments: ['people'] },
    })
    expect(JSON.stringify(written[0])).not.toContain('nest')
  })

  it('keeps the chosen root authoritative and retains later discoveries as variants', async () => {
    const canonicalSig = await history.commitLayer(hex('canonical'), {
      name: 'people', notes: ['b'.repeat(64)],
    })
    const hiveSig = await history.sign({ explorerSegments: () => [] })
    const hive = await history.currentLayerAt(hiveSig)
    await history.commitLayer(hiveSig, {
      ...hive,
      children: [...(hive?.children ?? []), canonicalSig],
    })

    const service = new CanonicalReferenceServiceImpl()
    await expect(service.ensureRoot('people', ['nest', 'people'])).resolves.toMatchObject({
      name: 'people', segments: ['people'],
    })
    const root = await history.currentLayerAt(await history.sign({ explorerSegments: () => ['people'] }))
    expect(root).toMatchObject({ name: 'people', notes: ['b'.repeat(64)] })
    const candidates = pooled
      .map(entry => entry.record as { kind?: string; payload?: { layerSig?: string } })
      .filter(record => record.kind === 'canonical:variant')
    expect(candidates).toHaveLength(2)
    expect(new Set(candidates.map(record => record.payload?.layerSig)).size).toBe(2)
  })
})
