// hypercomb-shim/src/bootstrap/replicate.ts
//
// ACQUISITION, THROUGH THE HOST. The install itself lives in
// `@hypercomb/runtime/acquire` and keeps state (what is in flight, which
// attesters are loaded), so there must be exactly one of it: the host's. The
// console is a beehavior carried by the host package, and a bee that bundled
// its own copy would be a second installer. The same holds for the host
// directory's probe (`host-packages`, which registers the HostPackages
// service and remembers which base answered). So the host registers these
// entry points under HOST_ACQUIRE_KEY (main.ts) and the console calls them
// there. Reading which package is live is a localStorage read and needs no
// port.

import type { HostPackage, InstallOutcome } from '@hypercomb/runtime/acquire'
import type { askHostPackages as AskHostPackages } from '@hypercomb/runtime/host-packages'
export { installedPackageSig } from '@hypercomb/runtime/installed-package'
export type { HostPackage, InstallOutcome }

import { HOST_ACQUIRE_KEY } from './ports'
export { HOST_ACQUIRE_KEY }

type InstallOptions = { floor?: boolean; takeAll?: boolean; onHeld?: (sig: string) => void }

export type HostAcquire = {
  acquire(packageSig: string, zones: readonly string[], opts?: InstallOptions): Promise<InstallOutcome>
  installPackage(pkg: HostPackage, alsoFrom?: readonly string[], opts?: InstallOptions): Promise<InstallOutcome>
  askHostPackages: typeof AskHostPackages
}

const host = (): HostAcquire => {
  const port = window.ioc?.get?.<HostAcquire>(HOST_ACQUIRE_KEY)
  if (!port) throw new Error('this host does not offer installs')
  return port
}

export const acquire: HostAcquire['acquire'] = (packageSig, zones, opts) => host().acquire(packageSig, zones, opts)
export const installPackage: HostAcquire['installPackage'] = (pkg, alsoFrom, opts) => host().installPackage(pkg, alsoFrom, opts)
export const askHostPackages: HostAcquire['askHostPackages'] = (zone, options) => host().askHostPackages(zone, options)
