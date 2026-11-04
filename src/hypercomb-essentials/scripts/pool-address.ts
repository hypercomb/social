// hypercomb-essentials/scripts/pool-address.ts
//
// THE ONE PLACE A BUILD SCRIPT TURNS A MEANING INTO A POOL ADDRESS (P2: derive
// pool addresses, never hardcode hex; and never hash a meaning by hand).
//
// `sign(meaning)` is sha256 of the meaning's UTF-8 bytes — byte for byte what
// core's `registerPoolMeaning` mints and what every client computes for
// itself. The scripts are synchronous Node, where core's WebCrypto signer is
// not, so this is the same derivation without the registry side effect.
//
// The MEANING itself is never spelled here: `HOST_PACKAGES_MEANING` comes from
// host-pool.ts, `TRANSFER_PACKS_MEANING` from transfer-pack.ts. A script that
// needs a pool imports that constant and passes it in; doctrine.spec.ts holds
// the line (no hash of a colon-meaning literal anywhere under `scripts/`).

import { createHash } from 'node:crypto'
import { HOST_PACKAGES_MEANING } from '../../hypercomb-runtime/src/host-pool.js'

export const poolAddress = (meaning: string): string =>
  createHash('sha256').update(meaning, 'utf8').digest('hex')

/** The address of a host's published-packages pool. */
export const hostPackagesPool = (): string => poolAddress(HOST_PACKAGES_MEANING)
