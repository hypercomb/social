import { afterEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure'
import { readHostCreations, SignatureService, textThemes } from '@hypercomb/core'
import { addOffering, addPublicCreation, listActiveOfferings, listActivePublicCreations,
  listRevisionCandidates, parseOffering, readOfferings, rememberPublicCreationCandidate, rememberRevisionCandidate,
  turnOffOffering, turnOffPublicCreation, type Adoption, type Offering } from './offerings'
import { currentLocationLayer, locationAddress } from '@hypercomb/runtime/location-layer'

const head = 'a'.repeat(64)
const index = finalizeEvent({
  kind: 30564,
  created_at: 1,
  tags: [],
  content: JSON.stringify({ roots: { garden: head }, doors: { garden: ['example.com'] } }),
}, new Uint8Array(32).fill(3))

const offering = () => ({
  kind: 'host:offering',
  title: 'Garden',
  route: 'https://garden.example.com/',
  lineage: 'garden',
  pubkey: index.pubkey,
  head,
  index,
})

const sha = (value: string): Promise<string> => SignatureService.sign(new TextEncoder().encode(value).buffer as ArrayBuffer)
afterEach(() => vi.unstubAllGlobals())

describe('signed offering admission', () => {
  it('accepts an offered root opened by its publisher', () => {
    expect(parseOffering(offering())?.head).toBe(head)
  })

  it('rejects an altered index, root, and door', () => {
    expect(parseOffering({ ...offering(), index: { ...index, content: '{}' } })).toBeNull()
    expect(parseOffering({ ...offering(), head: 'b'.repeat(64) })).toBeNull()
    expect(parseOffering({ ...offering(), route: 'https://garden.other.com/' })).toBeNull()
    const noDoor = finalizeEvent({ kind: 30564, created_at: 2, tags: [],
      content: JSON.stringify({ roots: { garden: head } }),
    }, new Uint8Array(32).fill(3))
    expect(parseOffering({ ...offering(), index: noDoor })).toBeNull()
    for (const content of ['null', '[]', '{"roots":null,"doors":{}}']) {
      const malformed = finalizeEvent({ kind: 30564, created_at: 2, tags: [], content },
        new Uint8Array(32).fill(3))
      expect(parseOffering({ ...offering(), index: malformed })).toBeNull()
    }
  })

  it('rejects an insecure or non-root route', () => {
    expect(parseOffering({ ...offering(), route: 'http://garden.example.com/' })).toBeNull()
    expect(parseOffering({ ...offering(), route: 'https://garden.example.com/code' })).toBeNull()
  })
})

describe('location offerings', () => {
  it('keeps the same pool member across revisions and reads the latest location marker', async () => {
    const location = await sha('garden.example.com')
    const entry = { kind: 'host:offering', title: 'Garden', route: 'https://garden.example.com/',
      lineage: 'garden', pubkey: index.pubkey, location }
    const bytes = JSON.stringify(entry)
    const member = await sha(bytes)
    const pool = await sha('host:offerings')
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = String(input)
      seen.push(url)
      if (url === `https://example.com/content/${pool}/`) return new Response(`${member}\n`)
      if (url === `https://example.com/content/${pool}/${member}`) return new Response(bytes)
      if (url === `https://garden.example.com/hive/${index.pubkey}`) return Response.json(index)
      if (url === `https://garden.example.com/content/${location}/`) return new Response('00000000\n00000002\n')
      if (url === `https://garden.example.com/content/${location}/00000002`) return Response.json({ layer: head })
      return new Response(null, { status: 404 })
    }))
    const found = await readOfferings('example.com')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ location, head, route: entry.route })
    expect(seen).toContain(`https://garden.example.com/content/${location}/00000002`)
    expect(await sha(JSON.stringify(entry))).toBe(member)
  })

  it('rejects a bag whose newest head disagrees with the publisher', async () => {
    const location = await sha('garden.example.com')
    const entry = { kind: 'host:offering', title: 'Garden', route: 'https://garden.example.com/',
      lineage: 'garden', pubkey: index.pubkey, location }
    const bytes = JSON.stringify(entry)
    const member = await sha(bytes)
    const pool = await sha('host:offerings')
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = String(input)
      if (url === `https://example.com/content/${pool}/`) return new Response(`${member}\n`)
      if (url === `https://example.com/content/${pool}/${member}`) return new Response(bytes)
      if (url === `https://garden.example.com/hive/${index.pubkey}`) return Response.json(index)
      if (url === `https://garden.example.com/content/${location}/`) return new Response('00000001\n')
      if (url === `https://garden.example.com/content/${location}/00000001`) return Response.json({ layer: 'b'.repeat(64) })
      return new Response(null, { status: 404 })
    }))
    expect(await readOfferings('example.com')).toEqual([])
  })

  it('does not substitute the signed index when a published location bag is missing', async () => {
    const location = await sha('garden.example.com')
    const entry = { kind: 'host:offering', title: 'Garden', route: 'https://garden.example.com/',
      lineage: 'garden', pubkey: index.pubkey, location }
    const bytes = JSON.stringify(entry)
    const member = await sha(bytes)
    const pool = await sha('host:offerings')
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = String(input)
      if (url === `https://example.com/content/${pool}/`) return new Response(`${member}\n`)
      if (url === `https://example.com/content/${pool}/${member}`) return new Response(bytes)
      if (url === `https://garden.example.com/hive/${index.pubkey}`) return Response.json(index)
      return new Response(null, { status: 404 })
    }))
    expect(await readOfferings('example.com')).toEqual([])
  })

  it('does not use an index-only legacy member as the gallery authority', async () => {
    const bytes = JSON.stringify(offering())
    const member = await sha(bytes)
    const pool = await sha('host:offerings')
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = String(input)
      if (url === `https://example.com/content/${pool}/`) return new Response(`${member}\n`)
      if (url === `https://example.com/content/${pool}/${member}`) return new Response(bytes)
      return new Response(null, { status: 404 })
    }))
    expect(await readOfferings('example.com')).toEqual([])
  })
})

describe('public creation locations', () => {
  it('reads a declared text theme through its latest meta head and typed payload', async () => {
    const meaning = 'themes:text'
    const key = 'professional'
    const host = 'example.com'
    const location = await sha(`${meaning}:${key}`)
    const layerText = JSON.stringify({ name: 'text-theme', label: 'Professional', read: 'hive', code: 'plex' })
    const payload = await sha(layerText)
    const metaText = JSON.stringify({ meta: 1, layer: payload, relation: meaning })
    const head = await sha(metaText)
    const declaration = { meaning, key, head, title: 'Professional', host }
    const signed = finalizeEvent({ kind: 30564, created_at: 3, tags: [],
      content: JSON.stringify({ roots: {}, doors: {}, offerings: { [location]: declaration } }),
    }, new Uint8Array(32).fill(3))
    const memberText = JSON.stringify({ kind: 'host:creation', meaning, key, location,
      pubkey: signed.pubkey, title: declaration.title, host })
    const member = await sha(memberText)
    const pool = await sha('host:offerings')
    let bagHead = head
    let servedIndex = signed
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = String(input)
      if (url === `https://${host}/content/${pool}/`) return new Response(`${member}\n`)
      if (url === `https://${host}/content/${pool}/${member}`) return new Response(memberText)
      if (url === `https://${host}/hive/${signed.pubkey}`) return Response.json(servedIndex)
      if (url === `https://${host}/content/${location}/`) return new Response('00000000\n')
      if (url === `https://${host}/content/${location}/00000000`) return Response.json({ layer: bagHead })
      if (url === `https://${host}/${head}`) return new Response(metaText)
      if (url === `https://${host}/${payload}`) return new Response(layerText)
      return new Response(null, { status: 404 })
    }))
    expect(await readHostCreations(host, index => verifyEvent(index as never)))
      .toMatchObject([{ kind: 'host:creation', location, head, payload, title: 'Professional' }])
    const fakeBlob = (bytes: Uint8Array): Blob => ({
      arrayBuffer: async () => bytes.slice().buffer,
      text: async () => new TextDecoder().decode(bytes),
    }) as Blob
    const blobBytes = (blob: Blob): Promise<ArrayBuffer> => new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(blob)
    })
    const file = (bytes: Uint8Array) => ({ kind: 'file', getFile: async () => fakeBlob(bytes) })
    const directory = () => {
      const files = new Map<string, Uint8Array>()
      const dirs = new Map<string, ReturnType<typeof directory>>()
      return {
        files,
        async getFileHandle(name: string, options?: { create?: boolean }) {
          if (!files.has(name)) {
            if (!options?.create) throw new DOMException('Missing', 'NotFoundError')
            files.set(name, new Uint8Array())
          }
          return {
            ...file(files.get(name)!),
            createWritable: async () => ({
              write: async (value: ArrayBuffer | Uint8Array) => { files.set(name, new Uint8Array(value).slice()) },
              close: async () => {},
            }),
            getFile: async () => fakeBlob(files.get(name)!),
          }
        },
        async getDirectoryHandle(name: string, options?: { create?: boolean }) {
          if (!dirs.has(name)) {
            if (!options?.create) throw new DOMException('Missing', 'NotFoundError')
            dirs.set(name, directory())
          }
          return dirs.get(name)!
        },
        async *entries() {
          for (const name of files.keys()) yield [name, await this.getFileHandle(name)] as const
          for (const [name, dir] of dirs) yield [name, dir] as const
        },
      }
    }
    const root = directory()
    const localBytes = new Map<string, Uint8Array>()
    const store = {
      initialize: async () => {},
      opfsRoot: root,
      getPool: async (meaning: string) => root.getDirectoryHandle(await sha(meaning), { create: true }),
      openPool: async (meaning: string) => root.getDirectoryHandle(await sha(meaning), { create: false }),
      putResource: async (blob: Blob) => {
        const bytes = new Uint8Array(await blobBytes(blob))
        const sig = await sha(new TextDecoder().decode(bytes))
        localBytes.set(sig, bytes)
        return sig
      },
      getResourceLocal: async (sig: string) => localBytes.has(sig) ? fakeBlob(localBytes.get(sig)!) : null,
      writeLayerBytes: async (sig: string, bytes: ArrayBuffer) => { localBytes.set(sig, new Uint8Array(bytes)) },
      getLayerPoolBytes: async (sig: string) => localBytes.get(sig) ?? null,
      putArtifactMeta: async () => '',
    }
    vi.stubGlobal('window', { ioc: { get: () => store } })
    const published = (await readHostCreations(host, index => verifyEvent(index as never)))[0]!
    expect(await addPublicCreation(published)).toBe(true)
    expect(await listActivePublicCreations()).toMatchObject([{ meaning, key, pubkey: signed.pubkey, head }])
    expect(textThemes().some(theme => theme.head === head)).toBe(true)
    expect(await turnOffPublicCreation(published)).toBe(true)
    expect(await listActivePublicCreations()).toEqual([])
    expect(textThemes().some(theme => theme.head === head)).toBe(false)
    bagHead = 'b'.repeat(64)
    expect(await readHostCreations(host, index => verifyEvent(index as never))).toEqual([])
    bagHead = head
    servedIndex = finalizeEvent({ kind: 30564, created_at: 4, tags: [],
      content: JSON.stringify({ roots: {}, doors: {} }),
    }, new Uint8Array(32).fill(3))
    expect(await readHostCreations(host, index => verifyEvent(index as never))).toEqual([])
  })
})

describe('revision candidates', () => {
  it('keeps the exact old and offered heads once in a content-addressed meaning pool', async () => {
    const members = new Map<string, Uint8Array>()
    const dir = {
      getFileHandle: async (name: string) => ({
        kind: 'file',
        createWritable: async () => ({ write: async (data: Uint8Array) => { members.set(name, data) }, close: async () => {} }),
        getFile: async () => ({ arrayBuffer: async () => members.get(name)!.buffer as ArrayBuffer }),
      }),
      async *entries() {
        for (const [name, bytes] of members) yield [name, { kind: 'file', getFile: async () => ({ arrayBuffer: async () => bytes.buffer as ArrayBuffer }) }]
      },
    }
    vi.stubGlobal('window', { ioc: { get: () => ({ initialize: async () => {}, getPool: async () => dir,
      openPool: async () => dir }) } })
    const offered = parseOffering(offering())!
    const held: Adoption = { kind: 'host:adoption', route: offered.route, lineage: offered.lineage,
      pubkey: offered.pubkey, head: 'b'.repeat(64), source: 'example.com', at: 1 }
    const first = await rememberRevisionCandidate(held, offered)
    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(await rememberRevisionCandidate(held, offered)).toBe(first)
    expect(members.size).toBe(1)
    expect(await listRevisionCandidates()).toMatchObject([{ from: held.head, to: head,
      pubkey: index.pubkey, lineage: 'garden', route: offered.route }])
    const location = await sha('themes:text:professional')
    const creation = { kind: 'host:creation' as const, meaning: 'themes:text', key: 'professional',
      title: 'Professional', host: 'example.com', location, pubkey: index.pubkey, head,
      payload: head, index: { ...index } }
    const selected = { meaning: creation.meaning, key: creation.key, pubkey: creation.pubkey,
      head: 'c'.repeat(64) }
    const candidate = await rememberPublicCreationCandidate(selected, creation, 'example.com')
    expect(candidate).toMatch(/^[a-f0-9]{64}$/)
    expect(await rememberPublicCreationCandidate(selected, creation, 'example.com')).toBe(candidate)
    expect(members.size).toBe(2)
    expect(await listRevisionCandidates()).toContainEqual(expect.objectContaining({
      meaning: 'themes:text', key: 'professional', from: selected.head, to: head,
      location, payload: head,
    }))
  })
})

describe('one-click activation', () => {
  it('advances the same hashed location bag with canonical layer markers for on and off', async () => {
    const buckets = new Map<string, ReturnType<typeof directory>>()
    function directory() {
      const files = new Map<string, Uint8Array>()
      return {
        files,
        async getFileHandle(name: string, options?: { create?: boolean }) {
          if (!files.has(name)) {
            if (!options?.create) throw new DOMException('Missing', 'NotFoundError')
            files.set(name, new Uint8Array())
          }
          return {
            kind: 'file',
            getFile: async () => ({
              arrayBuffer: async () => files.get(name)!.slice().buffer,
              text: async () => new TextDecoder().decode(files.get(name)!),
            }),
            createWritable: async () => ({
              write: async (value: ArrayBuffer | Uint8Array) => files.set(name, new Uint8Array(value).slice()),
              close: async () => {},
            }),
          }
        },
        async *entries() {
          for (const name of files.keys()) yield [name, await this.getFileHandle(name)] as const
        },
      }
    }
    const root = {
      async getDirectoryHandle(name: string, options?: { create?: boolean }) {
        if (!buckets.has(name)) {
          if (!options?.create) throw new DOMException('Missing', 'NotFoundError')
          buckets.set(name, directory())
        }
        return buckets.get(name)!
      },
    }
    const blobBytes = (blob: Blob): Promise<ArrayBuffer> => new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(blob)
    })
    const store = {
      initialize: async () => {},
      opfsRoot: root,
      getPool: async (meaning: string) => root.getDirectoryHandle(await sha(meaning), { create: true }),
      openPool: async (meaning: string) => root.getDirectoryHandle(await sha(meaning), { create: false }),
      putResource: async (blob: Blob) => {
        const bytes = new Uint8Array(await blobBytes(blob))
        const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
        resources.set(sig, bytes)
        return sig
      },
      getResourceLocal: async (sig: string) => {
        const bytes = resources.get(sig)
        return bytes ? { arrayBuffer: async () => bytes.slice().buffer } as Blob : null
      },
      writeLayerBytes: async (sig: string, bytes: ArrayBuffer) => { layers.set(sig, new Uint8Array(bytes)) },
      getLayerPoolBytes: async (sig: string) => layers.get(sig) ?? null,
      writeBeeBytes: async (sig: string, bytes: Uint8Array) => { bees.set(sig, bytes.slice()) },
      getBeeBytes: async (sig: string) => bees.get(sig) ?? null,
      writeDependencyBytes: async (sig: string, bytes: Uint8Array) => { dependencies.set(sig, bytes.slice()) },
      getDependencyBytes: async (sig: string) => dependencies.get(sig) ?? null,
    }
    const layers = new Map<string, Uint8Array>()
    const bees = new Map<string, Uint8Array>()
    const dependencies = new Map<string, Uint8Array>()
    const resources = new Map<string, Uint8Array>()
    vi.stubGlobal('window', { ioc: { get: () => store } })
    const child = '{"name":"Pane"}'
    const childSig = await sha(child)
    const bee = 'export const pan = () => true'
    const beeSig = await sha(bee)
    const dependency = 'export const zoom = () => true'
    const dependencySig = await sha(dependency)
    const payload = JSON.stringify({ name: 'Garden', cells: [childSig], bees: [beeSig],
      dependencies: [dependencySig] })
    const payloadHead = await sha(payload)
    const signed = finalizeEvent({ kind: 30564, created_at: 2, tags: [],
      content: JSON.stringify({ roots: { garden: payloadHead }, doors: { garden: ['example.com'] } }),
    }, new Uint8Array(32).fill(3))
    const offered = parseOffering({ ...offering(), head: payloadHead, pubkey: signed.pubkey,
      index: signed, location: await sha('garden.example.com') })!
    let omitDependency = true
    let omitAsset = false
    let assetSig = ''
    const remote = new Map([[payloadHead, payload], [childSig, child], [beeSig, bee],
      [dependencySig, dependency]])
    const mirror = 'mirror.example.net'
    let mirrorPublished = false
    let mirrorHead: string | null = null
    const fetched: string[] = []
    const pool = await sha('host:offerings')
    const publicMembers = new Map<string, string>()
    const publicHeads = new Map<string, string>()
    const publicIndexes = new Map<string, Record<string, unknown>>()
    const publish = async (selected: Offering) => {
      const member = JSON.stringify({ kind: 'host:offering', title: selected.title,
        route: selected.route, lineage: selected.lineage, pubkey: selected.pubkey,
        location: selected.location })
      publicMembers.set(await sha(member), member)
      publicHeads.set(selected.location!, selected.head)
      publicIndexes.set(`${new URL(selected.route).host}:${selected.pubkey}`, selected.index)
    }
    await publish(offered)
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(String(input))
      fetched.push(url.href)
      if (url.host === mirror && url.pathname.startsWith(`/content/${pool}/`)
        && !mirrorPublished) return new Response(null, { status: 404 })
      if (url.pathname === `/content/${pool}/`) return new Response([...publicMembers.keys()].join('\n'))
      if (url.pathname.startsWith(`/content/${pool}/`)) {
        const member = publicMembers.get(url.pathname.slice(`/content/${pool}/`.length))
        return member ? new Response(member) : new Response(null, { status: 404 })
      }
      if (url.pathname.startsWith('/content/')) {
        const segments = url.pathname.slice('/content/'.length).split('/').filter(Boolean)
        const current = url.host === mirror ? mirrorHead : publicHeads.get(segments[0]!)
        if (current && segments.length === 1) return new Response('00000000\n')
        if (current && segments[1] === '00000000') return Response.json({ layer: current })
      }
      if (url.pathname.startsWith('/hive/')) {
        const index = publicIndexes.get(`${url.host}:${url.pathname.slice('/hive/'.length)}`)
        return index ? Response.json(index) : new Response(null, { status: 404 })
      }
      const sig = url.pathname.slice(1)
      const bytes = url.host === mirror ? undefined : remote.get(sig)
      return bytes && !(omitDependency && sig === dependencySig) && !(omitAsset && sig === assetSig)
        ? new Response(bytes) : new Response(null, { status: 404 })
    }))
    const alternative = async (body: string, route = 'https://garden.example.com/',
      lineage = 'garden', secret = 3) => {
      const revision = await sha(body)
      remote.set(revision, body)
      const current = finalizeEvent({ kind: 30564, created_at: 3, tags: [],
        content: JSON.stringify({ roots: { [lineage]: revision }, doors: { [lineage]: ['example.com'] } }),
      }, new Uint8Array(32).fill(secret))
      const selected = parseOffering({ kind: 'host:offering', title: 'Garden', route, lineage,
        pubkey: current.pubkey, head: revision, index: current,
        location: await sha(new URL(route).hostname) })!
      await publish(selected)
      return selected
    }
    expect(await readOfferings('example.com')).toMatchObject([{ route: offered.route, head: offered.head }])
    expect(await addOffering(offered, 'garden.localhost')).toBe(false)
    expect(buckets.has(await sha('host:adoptions'))).toBe(false)
    omitDependency = false
    expect(await addOffering(offered, 'garden.localhost')).toBe(true)
    expect(layers.has(childSig)).toBe(true)
    expect(bees.has(beeSig)).toBe(true)
    expect(dependencies.has(dependencySig)).toBe(true)
    expect(await listActiveOfferings()).toMatchObject([{ enabled: true, head: payloadHead,
      localRoute: 'garden.localhost', sourceRoute: offered.route }])
    const rival = await alternative('{"name":"Rival"}', 'https://rival.example.com/', 'rival', 4)
    expect(await addOffering(rival, 'garden.localhost')).toBe(false)
    const adoptionDir = await root.getDirectoryHandle(await sha('host:adoptions'))
    expect(adoptionDir.files.size).toBe(1)
    // Old interrupted attempts can leave an adoption member newer than the
    // actual route layer. Listing must read the route's head, not trust the
    // first adoption record that names its hostname.
    const interrupted: Adoption = { kind: 'host:adoption', route: rival.route,
      localRoute: 'garden.localhost', lineage: rival.lineage, pubkey: rival.pubkey,
      head: rival.head, source: 'example.com', at: Date.now() + 1000 }
    const interruptedBytes = JSON.stringify(interrupted)
    const interruptedHandle = await adoptionDir.getFileHandle(await sha(interruptedBytes), { create: true })
    const interruptedWrite = await interruptedHandle.createWritable()
    await interruptedWrite.write(new TextEncoder().encode(interruptedBytes))
    await interruptedWrite.close()
    expect(await listActiveOfferings()).toMatchObject([{ enabled: true, head: payloadHead,
      localRoute: 'garden.localhost', sourceRoute: offered.route }])
    const location = await locationAddress('garden.localhost')
    const bag = await root.getDirectoryHandle(location)
    expect([...bag.files.keys()]).toEqual(['00000000', '00000001'])
    expect(await turnOffOffering(signed.pubkey, 'garden')).toBe(true)
    expect(await listActiveOfferings()).toEqual([])
    expect([...bag.files.keys()]).toEqual(['00000000', '00000001', '00000002'])
    const current = await currentLocationLayer(store as never, location)
    expect(current?.layer).toMatchObject({ name: 'host:activation', enabled: false, head: payloadHead })

    // A real branch uses children through a meta envelope, a tile-properties
    // resource with a nested image, and a page decoration with HTML assets.
    const image = 'image bytes'
    const imageSig = await sha(image)
    const asset = 'stylesheet bytes'
    assetSig = await sha(asset)
    const properties = JSON.stringify({ imageSig, targetSig: 'f'.repeat(64) })
    const propertiesSig = await sha(properties)
    const html = `<main><img src="resource:${assetSig}"></main>`
    const htmlSig = await sha(html)
    const decoration = JSON.stringify({ kind: 'website', payload: { htmlSig } })
    const decorationSig = await sha(decoration)
    const pane = JSON.stringify({ name: 'Pane', properties: [propertiesSig],
      decorations: [decorationSig] })
    const paneSig = await sha(pane)
    const envelope = JSON.stringify({ meta: 1, layer: paneSig, relation: 'children' })
    const envelopeSig = await sha(envelope)
    const branch = await alternative(JSON.stringify({ name: 'Garden', children: [envelopeSig],
      bees: [beeSig], dependencies: [dependencySig] }))
    expect(await addOffering(offered, 'stale.localhost')).toBe(false)
    for (const value of [image, asset, properties, html, decoration, pane, envelope]) {
      remote.set(await sha(value), value)
    }
    omitAsset = true
    expect(await addOffering(branch, 'branch.localhost')).toBe(false)
    expect(await listActiveOfferings()).toEqual([])
    omitAsset = false
    expect(await addOffering(branch, 'branch.localhost')).toBe(true)
    for (const sig of [paneSig, envelopeSig]) expect(layers.has(sig)).toBe(true)
    for (const sig of [imageSig, assetSig, propertiesSig, htmlSig, decorationSig]) {
      expect(resources.has(sig)).toBe(true)
    }
    expect(await listActiveOfferings()).toMatchObject([{ enabled: true, head: branch.head,
      localRoute: 'branch.localhost' }])
    const childList = JSON.stringify([envelopeSig])
    const childListSig = await sha(childList)
    const listEnvelope = JSON.stringify({ meta: 1, resource: childListSig, relation: 'children' })
    const listEnvelopeSig = await sha(listEnvelope)
    remote.set(childListSig, childList)
    remote.set(listEnvelopeSig, listEnvelope)
    const scalar = await alternative(JSON.stringify({ name: 'Garden', children: listEnvelopeSig }))
    expect(await addOffering(scalar, 'scalar.localhost')).toBe(true)
    expect(resources.has(childListSig)).toBe(true)
    expect(resources.has(listEnvelopeSig)).toBe(true)
    const unsupported = await alternative(JSON.stringify({ name: 'Garden', unknown: {
      reference: 'e'.repeat(64),
    } }))
    expect(await addOffering(unsupported, 'unknown.localhost')).toBe(false)

    // A mirror is the selected source even when the publisher's route supplies
    // the signed closure bytes. Its own public switch and latest bag remain
    // mandatory at the final local click.
    const mirrored = await alternative(JSON.stringify({ name: 'Mirror Fresh' }))
    mirrorHead = mirrored.head
    expect(await addOffering(mirrored, 'unlisted.localhost', mirror)).toBe(false)
    mirrorPublished = true
    mirrorHead = 'b'.repeat(64)
    expect(await addOffering(mirrored, 'stale-mirror.localhost', mirror)).toBe(false)
    mirrorHead = mirrored.head
    fetched.length = 0
    expect(await addOffering(mirrored, 'mirror.localhost', mirror)).toBe(true)
    expect(await listActiveOfferings()).toContainEqual(expect.objectContaining({
      localRoute: 'mirror.localhost', head: mirrored.head, source: mirror,
    }))
    expect(fetched).toContain(`https://${mirror}/content/${pool}/`)
    expect(fetched).toContain(`https://${mirror}/${mirrored.head}`)
    expect(fetched).toContain(`https://garden.example.com/${mirrored.head}`)
  })
})
