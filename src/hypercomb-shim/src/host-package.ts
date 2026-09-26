// hypercomb-shim/src/host-package.ts
//
// THE HOST PACKAGE. The host's own beehaviors (its console first) are a
// package like any other: a root layer, a `host` tile, and the bees it
// carries. build.mjs builds it and bakes its root signature into this bundle,
// so a cold host, with nothing installed, still knows one package to run.
//
// Held files are read as they are. Missing ones are fetched from this origin,
// then the default hosts, and hashed once, on the way in, by the Store's
// writers. The host package is never "the installed package": it runs beside
// whatever a person installs, and it updates when a host bundle names a new
// root.

import { fetchAcross, selfBases } from '@hypercomb/runtime/acquire'
import { hostBases } from '@hypercomb/runtime/host-packages'
import { DEFAULT_HOST_ZONES } from '@hypercomb/runtime/host-zones'

type HostPackageStore = {
  initialize?(): Promise<void>
  getLayerPoolBytes(sig: string): Promise<Uint8Array | null>
  writeLayerBytes(sig: string, bytes: ArrayBuffer): Promise<void>
  getBeeBytes(sig: string): Promise<Uint8Array | null>
  writeBeeBytes(sig: string, bytes: Uint8Array): Promise<void>
}

type Layer = { cells?: unknown; bees?: unknown; bootBees?: unknown }

const SIG = /^[a-f0-9]{64}$/
const sigsOf = (value: unknown): string[] =>
  (Array.isArray(value) ? value : []).map(String).map(sig => sig.replace(/\.js$/, '')).filter(sig => SIG.test(sig))

/** Hold the host package's root, its tiles and every bee they carry. */
export const holdHostPackage = async (root: string): Promise<boolean> => {
  const store = window.ioc?.get?.<HostPackageStore>('@hypercomb.social/Store')
  if (!store || !SIG.test(root)) return false
  await store.initialize?.()
  const fetchSig = fetchAcross([...selfBases(), ...DEFAULT_HOST_ZONES.flatMap(hostBases)])

  const layer = async (sig: string): Promise<Layer | null> => {
    let bytes = await store.getLayerPoolBytes(sig)
    if (!bytes) {
      const fetched = await fetchSig(sig)
      if (!fetched) return null
      await store.writeLayerBytes(sig, fetched.slice().buffer)
      bytes = await store.getLayerPoolBytes(sig)
    }
    try { return bytes ? JSON.parse(new TextDecoder().decode(bytes)) as Layer : null } catch { return null }
  }
  const bee = async (sig: string): Promise<boolean> => {
    if (await store.getBeeBytes(sig)) return true
    const fetched = await fetchSig(sig)
    if (!fetched) return false
    await store.writeBeeBytes(sig, fetched)
    return !!(await store.getBeeBytes(sig))
  }

  const top = await layer(root)
  if (!top) return false
  const bees = new Set(sigsOf(top.bootBees))
  for (const tile of await Promise.all(sigsOf(top.cells).map(layer))) {
    if (!tile) return false
    for (const sig of sigsOf(tile.bees)) bees.add(sig)
  }
  return (await Promise.all([...bees].map(bee))).every(Boolean)
}
