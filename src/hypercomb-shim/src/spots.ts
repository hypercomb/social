// hypercomb-shim/src/spots.ts
//
// THE SPOTS — the app's landing spots, on the living primitive
// (documentation/life-primitive.md). The host package's root layer names its
// spots as cells: meta envelopes { meta: 1, layer: <vertex>, root: <name> },
// the vertex a bare { name }. A spot's beehaviors are whatever the pool of
// meaning `<name>:beehaviors` holds — position answers membership — each an
// incidence { meta: 1, layer: <behaviour>, relation: 'beehavior' }:
//
//   behaviour { name, bee: M(bee), dependencies?: [sig], children: [M(layer → source file node)] }
//   source    { name: <repo path>, content: M(resource) }
//
// A behaviour carries what it needs, and its code: from any spot the hive can
// be drilled down to the source that runs there (the `Spots` port below).
// `dependencies` is the whole closure its bee reaches through the import map;
// a behaviour runs only when every one of them is live in this session
// (`runnable`), and otherwise waits while the package's flavour runs.
//
// Held records are read as they are; a missing one is fetched from this
// origin, then the default hosts, and written through the Store's writers,
// which refuse bytes that do not hash to their name — the one hash.

import { fetchAcross, selfBases } from '@hypercomb/runtime/acquire'
import { hostBases } from '@hypercomb/runtime/host-packages'
import { DEFAULT_HOST_ZONES } from '@hypercomb/runtime/host-zones'

type SpotStore = {
  initialize?(): Promise<void>
  getLayerPoolBytes(sig: string): Promise<Uint8Array | null>
  writeLayerBytes(sig: string, bytes: ArrayBuffer): Promise<void>
  getBeeBytes(sig: string): Promise<Uint8Array | null>
  bees?: FileSystemDirectoryHandle | null
  legacyBees?: FileSystemDirectoryHandle | null
  writeBeeBytes(sig: string, bytes: Uint8Array): Promise<void>
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
}
type Json = Record<string, unknown>
type Envelope = { meta: 1; layer?: string; bee?: string; resource?: string; relation?: string; root?: string }

export type Behaviour = { name: string; bee: string; node: string; dependencies: string[]; children: string[] }
export type Spot = { name: string; meaning: string; behaviours: Behaviour[] }

export const SPOTS_KEY = '@hypercomb.social/Spots'
const SIG = /^[a-f0-9]{64}$/
export const beehaviorsOf = (spot: string): string => `${spot}:beehaviors`

const decode = (bytes: Uint8Array): Json | null => {
  try { return JSON.parse(new TextDecoder().decode(bytes)) as Json } catch { return null }
}
const envelope = (value: Json | null): Envelope | null =>
  value && value['meta'] === 1 ? value as unknown as Envelope : null
const sha256 = async (bytes: Uint8Array): Promise<string> => {
  const exact = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', exact))].map(b => b.toString(16).padStart(2, '0')).join('')
}

const reader = (store: SpotStore) => {
  const bases = [...selfBases(), ...DEFAULT_HOST_ZONES.flatMap(hostBases)]
  const fetchSig = fetchAcross(bases)
  /** A signed record: held, or fetched and written through (hashed once). */
  const record = async (sig: string): Promise<Json | null> => {
    if (!SIG.test(sig)) return null
    let bytes = await store.getLayerPoolBytes(sig)
    if (!bytes) {
      const fetched = await fetchSig(sig)
      if (!fetched) return null
      await store.writeLayerBytes(sig, fetched.slice().buffer)
      bytes = await store.getLayerPoolBytes(sig)
    }
    return bytes ? decode(bytes) : null
  }
  /** Is a bee held? Its file answers without its bytes being read. */
  const held = async (sig: string): Promise<boolean> => {
    if (!store.bees && !store.legacyBees) return !!(await store.getBeeBytes(sig))
    for (const source of [store.bees, store.legacyBees]) {
      if (!source) continue
      for (const name of [`${sig}.js`, sig]) {
        try { if ((await (await source.getFileHandle(name)).getFile()).size) return true } catch { /* miss */ }
      }
    }
    return false
  }
  /** A bee: held, or fetched and written through (hashed once). */
  const bee = async (sig: string): Promise<boolean> => {
    if (await held(sig)) return true
    const fetched = await fetchSig(sig)
    if (!fetched) return false
    await store.writeBeeBytes(sig, fetched)
    return !!(await store.getBeeBytes(sig))
  }
  /** The members a pool holds here; a pool this device has never held is
   *  read from a host's listing, each member hashed as it arrives. */
  const members = async (meaning: string): Promise<Uint8Array[]> => {
    const dir = await store.getPool(meaning)
    if (!dir) return []
    const read = async (): Promise<Uint8Array[]> => {
      const out: Uint8Array[] = []
      for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (handle.kind !== 'file' || !SIG.test(name)) continue
        out.push(new Uint8Array(await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer()))
      }
      return out
    }
    const held = await read()
    if (held.length) return held
    const pool = await sha256(new TextEncoder().encode(meaning))
    for (const base of bases) {
      const listing = await fetch(`${base}/${pool}/`, { cache: 'no-store' }).catch(() => null)
      if (!listing?.ok) continue
      const names = (await listing.text()).split(/\r?\n/).map(n => n.trim()).filter(n => SIG.test(n))
      if (!names.length) continue
      for (const name of names) {
        const res = await fetch(`${base}/${pool}/${name}`).catch(() => null)
        if (!res?.ok) continue
        const bytes = new Uint8Array(await res.arrayBuffer())
        if (await sha256(bytes) !== name) continue
        const writable = await (await dir.getFileHandle(name, { create: true })).createWritable()
        try { await writable.write(bytes) } finally { await writable.close() }
      }
      return read()
    }
    return []
  }
  return { record, bee, members }
}

/** Resolve the spots a root names, and hold every behaviour's bee. */
export const holdSpots = async (root: string): Promise<Spot[]> => {
  const store = window.ioc?.get?.<SpotStore>('@hypercomb.social/Store')
  if (!store || !SIG.test(root)) return []
  await store.initialize?.()
  const io = reader(store)
  const top = await io.record(root)
  const cells = Array.isArray(top?.['cells']) ? (top['cells'] as unknown[]).map(String) : []
  // The spots resolve side by side; their order is the root's.
  const resolvedSpots = await Promise.all(cells.map(async (cell): Promise<Spot | null> => {
    const incidence = envelope(await io.record(cell))
    if (!incidence?.layer) return null
    const name = String((await io.record(incidence.layer))?.['name'] ?? '').trim()
    if (!name) return null
    const meaning = beehaviorsOf(name)
    // The members resolve side by side; their order is the pool's.
    const resolved = await Promise.all((await io.members(meaning)).map(async (bytes): Promise<Behaviour | null> => {
      const member = envelope(decode(bytes))
      if (!member?.layer) return null
      const node = await io.record(member.layer)
      const beeRef = envelope(node && typeof node['bee'] === 'string' ? await io.record(node['bee']) : null)
      if (!node || !beeRef?.bee || !await io.bee(beeRef.bee)) return null
      return {
        name: String(node['name'] ?? ''),
        bee: beeRef.bee,
        node: member.layer,
        dependencies: Array.isArray(node['dependencies']) ? (node['dependencies'] as unknown[]).map(String).filter(sig => SIG.test(sig)) : [],
        children: Array.isArray(node['children']) ? (node['children'] as unknown[]).map(String) : [],
      }
    }))
    const behaviours = resolved.filter((b): b is Behaviour => b !== null)
    return { name, meaning, behaviours }
  }))
  return resolvedSpots.filter((s): s is Spot => s !== null)
}

/** The dependency signatures live in this session's import map. */
export const liveDependencies = (): Set<string> => {
  const aliases = (globalThis as { __hypercombAliasMap?: Map<string, string> }).__hypercombAliasMap
  return new Set([...(aliases?.values() ?? [])].map(sig => String(sig).replace(/\.js$/i, '').toLowerCase()))
}

/** WHAT MAY RUN NOW. A behaviour whose closure is all live runs; any other
 *  waits, and the package's own flavour of it runs. */
export const runnable = (spots: Spot[], live: ReadonlySet<string>): { run: Behaviour[]; wait: string[] } => {
  const run: Behaviour[] = [], wait: string[] = []
  for (const spot of spots) for (const behaviour of spot.behaviours) {
    const missing = behaviour.dependencies.filter(sig => !live.has(sig)).length
    if (missing) { wait.push(`${spot.name}/${behaviour.name} (${missing} of ${behaviour.dependencies.length} dependencies not live)`); continue }
    run.push(behaviour)
  }
  return { run, wait }
}

/** THE DRILL-DOWN: from a spot to its behaviours, and from a behaviour to the
 *  source files it was built from, read from the hive itself. */
export const registerSpots = (spots: Spot[]): void => {
  const store = window.ioc?.get?.<SpotStore>('@hypercomb.social/Store')
  if (!store) return
  const io = reader(store)
  window.ioc?.register?.(SPOTS_KEY, {
    spots: (): Spot[] => spots,
    source: async (spot: string, behaviour: string): Promise<{ path: string; text: string }[]> => {
      const found = spots.find(s => s.name === spot)?.behaviours.find(b => b.name === behaviour)
      if (!found) return []
      const files: { path: string; text: string }[] = []
      for (const child of found.children) {
        const incidence = envelope(await io.record(child))
        const file = incidence?.layer ? await io.record(incidence.layer) : null
        const content = envelope(file && typeof file['content'] === 'string' ? await io.record(file['content']) : null)
        if (!file || !content?.resource) continue
        const bytes = await store.getLayerPoolBytes(content.resource) ?? await (async () => {
          const fetched = await fetchAcross([...selfBases(), ...DEFAULT_HOST_ZONES.flatMap(hostBases)])(content.resource!)
          if (!fetched) return null
          await store.writeLayerBytes(content.resource!, fetched.slice().buffer)
          return store.getLayerPoolBytes(content.resource!)
        })()
        if (bytes) files.push({ path: String(file['name'] ?? ''), text: new TextDecoder().decode(bytes) })
      }
      return files
    },
  })
}
