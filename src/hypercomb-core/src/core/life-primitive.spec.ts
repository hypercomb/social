import { describe, expect, it } from 'vitest'
import {
  canonicalLifeLayer,
  healLegacyLayer,
  inspectLifeClosure,
  isLifeLayer,
  isMetaEnvelope,
  metaPayloadOf,
  mintMetaEnvelope,
  resolveMetaArtifact,
  type LifeMaterialization,
  type PassiveMetaHealer,
} from './life-primitive.js'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

const fakeSig = (bytes: Uint8Array): string => {
  let seed = 0x811c9dc5
  for (const byte of bytes) seed = Math.imul(seed ^ byte, 0x01000193) >>> 0
  const lanes: string[] = []
  for (let lane = 0; lane < 8; lane++) {
    seed = Math.imul(seed ^ (lane + 1), 0x01000193) >>> 0
    lanes.push(seed.toString(16).padStart(8, '0'))
  }
  return lanes.join('')
}

const recorder = (existing: Map<string, unknown> = new Map()) => {
  const records = new Map<string, LifeMaterialization>()
  const healer: PassiveMetaHealer = {
    sign: async bytes => fakeSig(bytes),
    readMeta: async sig => {
      const value = existing.get(sig)
      return isMetaEnvelope(value) ? value : null
    },
    materialize: async record => { records.set(record.sig, record) },
  }
  return { healer, records }
}

describe('life primitive — recursive closure', () => {
  it('keeps installed layer slot shapes while artifact refs become metadata', () => {
    expect(isLifeLayer({ name: 'people', children: [A], notes: B })).toBe(true)
    expect(isLifeLayer({ name: 'people', children: [A], notes: [B] })).toBe(true)
    expect(canonicalLifeLayer({ name: 'people', children: [], notes: [B] })).toEqual({ name: 'people', notes: [B] })
  })

  it('makes meta the universal envelope around a layer target', () => {
    expect(mintMetaEnvelope({ layer: A, relation: 'notes', root: 'people' })).toEqual({
      meta: 1,
      layer: A,
      relation: 'notes',
      root: 'people',
    })
  })

  it('uses the payload key as the type and permits exactly one', () => {
    expect(mintMetaEnvelope({ resource: A, relation: 'content' })).toEqual({
      meta: 1,
      resource: A,
      relation: 'content',
    })
    expect(metaPayloadOf({ meta: 1, dependency: B })).toEqual({ kind: 'dependency', sig: B })
    expect(isMetaEnvelope({ meta: 1, layer: A, resource: B })).toBe(false)
    expect(() => mintMetaEnvelope({ layer: A, resource: B })).toThrow(/exactly one/)
    expect(() => mintMetaEnvelope({ relation: 'notes' })).toThrow(/exactly one/)
  })

  it('stops recursion at typed raw-byte payloads without sniffing them', async () => {
    const graph = new Map<string, unknown>([
      [A, { meta: 1, layer: B }],
      [B, { name: 'image', children: [], content: C }],
      [C, { meta: 1, resource: 'd'.repeat(64), relation: 'content' }],
    ])
    const result = await inspectLifeClosure(A, async sig => graph.get(sig) ?? null)
    expect(result.issues).toEqual([])
    expect(result.atoms).toEqual(['d'.repeat(64)])
  })

  it('walks a tile whose notes are another hierarchy of the same primitive', async () => {
    const rootMeta = A
    const rootLayer = B
    const notesMeta = C
    const notesLayer = 'd'.repeat(64)
    const noteChildMeta = 'e'.repeat(64)
    const noteChildLayer = 'f'.repeat(64)
    const graph = new Map<string, unknown>([
      [rootMeta, { meta: 1, layer: rootLayer }],
      [rootLayer, { name: 'people', children: [], notes: notesMeta }],
      [notesMeta, { meta: 1, layer: notesLayer, relation: 'notes' }],
      [notesLayer, { name: 'notes', children: [noteChildMeta] }],
      [noteChildMeta, { meta: 1, layer: noteChildLayer, relation: 'children' }],
      [noteChildLayer, { name: 'first thought', children: [] }],
    ])

    const result = await inspectLifeClosure(rootMeta, async sig => graph.get(sig) ?? null)
    expect(result.issues).toEqual([])
    expect(new Set(result.metas)).toEqual(new Set([rootMeta, notesMeta, noteChildMeta]))
    expect(new Set(result.layers)).toEqual(new Set([rootLayer, notesLayer, noteChildLayer]))
  })

  it('keeps an active-stack cycle guard even though real signatures mint backward', async () => {
    const graph = new Map<string, unknown>([
      [A, { meta: 1, layer: B }],
      [B, { name: 'loop', children: [A] }],
    ])
    const result = await inspectLifeClosure(A, async sig => graph.get(sig) ?? null)
    expect(result.issues).toContainEqual({ sig: A, kind: 'cycle' })
  })
})

describe('passive meta healing', () => {
  it('projects legacy child sigs into deterministic envelopes without a history write', async () => {
    const { healer, records } = recorder()
    const healed = await healLegacyLayer({ name: 'people', children: [A] }, healer)
    expect(healed.incompatible).toEqual([])
    expect(healed.layer.children).toHaveLength(1)
    const childMeta = records.get(healed.layer.children[0])
    expect(childMeta?.kind).toBe('meta')
    expect(childMeta?.value).toEqual({ meta: 1, layer: A, relation: 'children' })
  })

  it('preserves a legacy notes array while wrapping every artifact', async () => {
    const { healer, records } = recorder()
    const healed = await healLegacyLayer({ name: 'people', children: [], notes: [A, B] }, healer)
    const refs = healed.layer.notes as string[]
    expect(refs).toHaveLength(2)
    expect(records.get(refs[0])?.value).toEqual({ meta: 1, resource: A, relation: 'notes' })
    expect(records.get(refs[1])?.value).toEqual({ meta: 1, resource: B, relation: 'notes' })
  })

  it('keeps the installed scalar child-list form typed as a resource', async () => {
    const { healer, records } = recorder()
    const healed = await healLegacyLayer({ name: 'module', layers: A }, healer)
    const ref = String(healed.layer.layers)
    expect(records.get(ref)?.value).toEqual({ meta: 1, resource: A, relation: 'layers' })
  })

  it('leaves an already-promoted reference alone', async () => {
    const existing = new Map<string, unknown>([[A, { meta: 1, layer: B, relation: 'children' }]])
    const { healer, records } = recorder(existing)
    const healed = await healLegacyLayer({ name: 'people', children: [A] }, healer)
    expect(healed.layer.children).toEqual([A])
    expect(records.size).toBe(0)
  })

  it('rejects metadata whose declared artifact kind conflicts with its slot', async () => {
    const existing = new Map<string, unknown>([[A, { meta: 1, resource: B, relation: 'children' }]])
    const { healer } = recorder(existing)
    await expect(healLegacyLayer({ name: 'people', children: [A] }, healer))
      .rejects.toThrow(/children expected layer metadata, got resource/)
  })

  it('retains inline legacy values because the artifact format is unchanged', async () => {
    const { healer } = recorder()
    const healed = await healLegacyLayer({ name: 'people', children: [], title: 'People' }, healer)
    expect(healed.incompatible).toEqual([])
    expect(healed.layer).toEqual({ name: 'people', title: 'People' })
  })
})

describe('HTTP-by-signature artifact resolution', () => {
  it('uses local verified meta and artifact bytes without HTTP', async () => {
    const artifact = new TextEncoder().encode('layer bytes')
    const artifactSig = fakeSig(artifact)
    const metaBytes = new TextEncoder().encode(JSON.stringify({ meta: 1, layer: artifactSig }))
    const metaSig = fakeSig(metaBytes)
    const local = new Map([[metaSig, metaBytes], [artifactSig, artifact]])
    const http: string[] = []

    const resolved = await resolveMetaArtifact(metaSig, {
      readLocal: async sig => local.get(sig) ?? null,
      fetchHttp: async sig => { http.push(sig); return null },
      sign: async bytes => fakeSig(bytes),
    })
    expect(resolved?.payload).toEqual({ kind: 'layer', sig: artifactSig })
    expect(resolved?.metaSource).toBe('local')
    expect(resolved?.artifactSource).toBe('local')
    expect(http).toEqual([])
  })

  it('HTTP-resolves and write-through caches both immutable hops', async () => {
    const artifact = new TextEncoder().encode('image bytes')
    const artifactSig = fakeSig(artifact)
    const metaBytes = new TextEncoder().encode(JSON.stringify({ meta: 1, resource: artifactSig }))
    const metaSig = fakeSig(metaBytes)
    const remote = new Map([[metaSig, metaBytes], [artifactSig, artifact]])
    const cached: Array<{ sig: string; kind: string }> = []

    const resolved = await resolveMetaArtifact(metaSig, {
      readLocal: async () => null,
      fetchHttp: async sig => remote.get(sig) ?? null,
      sign: async bytes => fakeSig(bytes),
      cacheLocal: async (sig, kind) => { cached.push({ sig, kind }) },
    })
    expect(resolved?.payload).toEqual({ kind: 'resource', sig: artifactSig })
    expect(resolved?.metaSource).toBe('http')
    expect(resolved?.artifactSource).toBe('http')
    expect(cached).toEqual([
      { sig: metaSig, kind: 'meta' },
      { sig: artifactSig, kind: 'resource' },
    ])
  })

  it('rejects wrong HTTP bytes before they can enter the cache', async () => {
    const cached: string[] = []
    const resolved = await resolveMetaArtifact(A, {
      readLocal: async () => null,
      fetchHttp: async () => new TextEncoder().encode('wrong'),
      sign: async bytes => fakeSig(bytes),
      cacheLocal: async sig => { cached.push(sig) },
    })
    expect(resolved).toBeNull()
    expect(cached).toEqual([])
  })
})
