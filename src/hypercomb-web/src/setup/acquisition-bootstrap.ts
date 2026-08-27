// Privileged, signature-addressed acquisition boundary. The module build
// bundles this entry, signs the exact bytes, includes the signature in the
// package descriptor, and the shim imports only that pinned signature.

import './install-prompt.element'

export {
  checkForUpdate,
  ensureInstall,
  opfsWritable,
  resyncFromSentinel,
  upgradeFromBundled,
} from './ensure-install'
export type { BootStatus } from './ensure-install'
export { initSentinel, SentinelBridge } from './sentinel-bridge'
