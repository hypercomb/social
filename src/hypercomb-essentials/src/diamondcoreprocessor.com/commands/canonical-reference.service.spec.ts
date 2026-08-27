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
  // Eight independently salted FNV lanes. The earlier character-cycle fake
  // collided when a root layer and its appearance shared a long notes sig,
  // overwriting the fixture's content map and manufacturing a root-clobber
  // that a real SHA-256 store cannot produce.
  return Array.from({ length: 8 }, (_, salt) => {
    let hash = (0x811c9dc5 ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0
    for (let i = 0; i < seed.length; i++) {
      hash = Math.imul(hash ^ seed.charCodeAt(i), 0x01000193) >>> 0
    }
    return hash.toString(16).padStart(8, '0')
  }).join('')
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
  let artifactMetas: Array<{ sig: string; kind: string; target: string; incidence: Record<string, unknown> }>

  beforeEach(async () => {
    services.clear()
    history = new FakeHistory()
    committer = new FakeCommitter(history)
    written = []
    pooled = []
    artifactMetas = []

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
        const record = JSON.parse(text) as { kind?: string; meta?: number; relation?: string }
        if (record.meta === 1 && record.relation === 'canonical:variant') return hex('variant:' + text)
        written.push(record)
        return hex('decoration:' + written.length)
      },
      putArtifactMeta: async (
        kind: 'layer' | 'resource' | 'dependency' | 'bee',
        target: string,
        incidence: Record<string, unknown> = {},
      ) => {
        const sig = hex(`meta:${kind}:${target}:${JSON.stringify(incidence)}`)
        artifactMetas.push({ sig, kind, target, incidence })
        if (kind === 'layer') {
          const layer = history.content.get(target)
          if (layer) history.content.set(sig, layer)
        }
        return sig
      },
      getPool: async () => ({
        getFileHandle: async (sig: string) => ({
          createWritable: async () => {
            let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array()
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
    expect(pooled.some(entry => (entry.record as { relation?: string }).relation === 'canonical:variant')).toBe(true)
    const sourceCandidate = pooled
      .map(entry => entry.record as { relation?: string; layer?: string })
      .find(record => (history.content.get(record.layer ?? '')?.notes as string[] | undefined)?.[0] === '1'.repeat(64))
    expect(history.content.get(sourceCandidate?.layer ?? '')).toMatchObject({
      name: 'people',
      properties: ['3'.repeat(64)],
      decorations: ['4'.repeat(64)],
      children: [expect.any(String)],
    })
  })

  it('places a lineage leaf with the original details and fixed-name root identity', async () => {
    const service = new CanonicalReferenceServiceImpl()
    await expect(service.place({
      name: 'people', sourceSegments: ['nest', 'people'], parentSegments: ['project'],
    })).resolves.toBe('people')
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      kind: 'reference',
      payload: { targetSegments: ['people'] },
    })
    expect(JSON.stringify(written[0])).not.toContain('nest')
    expect(artifactMetas).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'resource', incidence: expect.objectContaining({ relation: 'decorations', root: 'people' }) }),
      expect.objectContaining({ kind: 'layer', incidence: expect.objectContaining({ relation: 'children', root: 'people' }) }),
    ]))
    const appearance = await history.currentLayerAt(
      await history.sign({ explorerSegments: () => ['project', 'people'] }),
    )
    expect(appearance).toMatchObject({
      name: 'people',
      notes: ['1'.repeat(64)],
      properties: ['3'.repeat(64)],
      decorations: expect.arrayContaining(['4'.repeat(64), expect.any(String)]),
    })
    // Structure stays behind the root pointer. The activation snapshots its
    // atomic details but navigation still enters the canonical lineage.
    expect(appearance).not.toHaveProperty('children')
  })

  it('keeps a Portal default-authoring row slim and explicitly marked', async () => {
    const service = new CanonicalReferenceServiceImpl()
    await expect(service.place({
      name: 'people',
      sourceSegments: ['nest', 'people'],
      parentSegments: ['sets'],
      editsRootDefault: true,
    })).resolves.toBe('people')

    expect(written[0]).toMatchObject({
      kind: 'reference',
      payload: { targetSegments: ['people'], editsRootDefault: true },
    })
    const portal = await history.currentLayerAt(
      await history.sign({ explorerSegments: () => ['sets', 'people'] }),
    )
    expect(portal).toEqual({ name: 'people', decorations: [expect.any(String)] })
  })

  it('gives /people, /somewhere/people, and /business/people one primitive root', async () => {
    const service = new CanonicalReferenceServiceImpl()
    await expect(service.place({
      name: 'people', sourceSegments: ['nest', 'people'], parentSegments: ['somewhere'],
    })).resolves.toBe('people')
    await expect(service.place({
      name: 'people', sourceSegments: ['nest', 'people'], parentSegments: ['business'],
    })).resolves.toBe('people')

    const rootAddress = await history.sign({ explorerSegments: () => ['people'] })
    expect(written).toHaveLength(2)
    for (const record of written as Array<{
      kind?: string
      payload?: { targetSegments?: string[]; targetSig?: string }
    }>) {
      expect(record.kind).toBe('reference')
      expect(record.payload?.targetSegments).toEqual(['people'])
      expect(record.payload?.targetSig).toBe(rootAddress)
    }

    const root = await history.currentLayerAt(rootAddress)
    const somewhere = await history.currentLayerAt(
      await history.sign({ explorerSegments: () => ['somewhere', 'people'] }),
    )
    const business = await history.currentLayerAt(
      await history.sign({ explorerSegments: () => ['business', 'people'] }),
    )
    // The subtree remains whole at the root. Both appearances reuse the
    // immutable detail sigs but carry no copied child structure.
    expect(root).toMatchObject({
      name: 'people', notes: ['1'.repeat(64)], children: [expect.any(String)],
    })
    expect(somewhere).toMatchObject({
      name: 'people', notes: ['1'.repeat(64)], properties: ['3'.repeat(64)],
    })
    expect(business).toMatchObject({
      name: 'people', notes: ['1'.repeat(64)], properties: ['3'.repeat(64)],
    })
    expect(somewhere).not.toHaveProperty('children')
    expect(business).not.toHaveProperty('children')
  })

  it('does not repaint an existing jaime appearance when another jaime is added', async () => {
    const service = new CanonicalReferenceServiceImpl()
    await expect(service.ensureRoot('jaime', null)).resolves.toMatchObject({ name: 'jaime' })

    const rootLocation = await history.sign({ explorerSegments: () => ['jaime'] })
    const hiveLocation = await history.sign({ explorerSegments: () => [] })
    const setRootImage = async (propertiesSig: string): Promise<void> => {
      const markerSig = await history.commitLayer(rootLocation, {
        name: 'jaime', properties: [propertiesSig],
      })
      const hive = await history.currentLayerAt(hiveLocation) ?? { name: '', children: [] }
      const survivors: string[] = []
      for (const sig of hive.children ?? []) {
        if ((await history.getLayerBySig(sig))?.name !== 'jaime') survivors.push(sig)
      }
      await history.commitLayer(hiveLocation, {
        ...hive, children: [...survivors, markerSig],
      })
    }

    const portraitOfJaime = 'a'.repeat(64)
    const otherJaimeImage = 'b'.repeat(64)
    await setRootImage(portraitOfJaime)
    await expect(service.place({
      name: 'jaime', sourceSegments: ['jaime'], parentSegments: ['friends'],
    })).resolves.toBe('jaime')

    await setRootImage(otherJaimeImage)
    await expect(service.place({
      name: 'jaime', sourceSegments: ['jaime'], parentSegments: ['team'],
    })).resolves.toBe('jaime')

    const friendsJaime = await history.currentLayerAt(
      await history.sign({ explorerSegments: () => ['friends', 'jaime'] }),
    )
    const teamJaime = await history.currentLayerAt(
      await history.sign({ explorerSegments: () => ['team', 'jaime'] }),
    )
    expect(friendsJaime?.properties).toEqual([portraitOfJaime])
    expect(teamJaime?.properties).toEqual([otherJaimeImage])
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
      .map(entry => entry.record as { relation?: string; layer?: string })
      .filter(record => record.relation === 'canonical:variant')
    expect(candidates).toHaveLength(2)
    expect(new Set(candidates.map(record => record.layer)).size).toBe(2)
  })
})
