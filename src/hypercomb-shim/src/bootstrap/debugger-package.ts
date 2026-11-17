// hypercomb-shim/src/bootstrap/debugger-package.ts
//
// THE PACKAGE A MANAGED SITE DOOR RUNS (jwize, 2026-11-17: "the package we
// start off with should be slim as we can … in hosts we can drill down and
// create a package and then we can have that as the framework for the
// development experience"). The door is the debugger: the site's card, the
// chat and the code. It installs the package its publisher keeps under the
// name `debugger`, not the host's whole package.
//
// Where that name is read, in order:
//   1. the publisher's signed index, `install:debugger`, read at the zone —
//      what the Hosts desk's Serve moves, and the one record only the
//      publisher's key can move;
//   2. the newest member of the zone's `host:packages` pool labelled
//      `debugger`;
//   3. nothing — the door installs the host's head, as it always has.
//
// A forged index (a door serving an index that is not the publisher's) names
// nothing here: the door falls back to the head, never to a substitute.

import { verifyEvent } from 'nostr-tools/pure'
import {
  DEBUGGER_PACKAGE, debuggerPoolPackage, hostBases, readInstallChannel,
  type ChannelRead, type HostPackage, type VerifyIndexEvent,
} from '@hypercomb/runtime/host-packages'
import type { ManageRecord } from './manage-record'

export type DebuggerDeps = {
  readChannel?: (pubkey: string, zone: string) => Promise<ChannelRead>
  readPool?: (zone: string) => Promise<HostPackage | null>
  basesOf?: (zone: string) => string[]
}

const verify: VerifyIndexEvent = event => {
  try { return verifyEvent(structuredClone(event) as never) } catch { return false }
}

const defaults: Required<DebuggerDeps> = {
  readChannel: (pubkey, zone) => readInstallChannel({ pubkey, hosts: [zone], channel: DEBUGGER_PACKAGE }, verify),
  readPool: zone => debuggerPoolPackage(zone),
  basesOf: zone => hostBases(zone),
}

/** The debugger's package for this door, or null when none is named. Never throws. */
export async function debuggerPackage(
  record: Pick<ManageRecord, 'publisher'>,
  zone: string,
  deps: DebuggerDeps = {},
): Promise<HostPackage | null> {
  const { readChannel, readPool, basesOf } = { ...defaults, ...deps }
  if (!zone) return null
  if (record.publisher) {
    const channel = await readChannel(record.publisher, zone).catch(() => null)
    if (channel?.state === 'forged') return null
    if (channel?.state === 'named') {
      return {
        zone: channel.zone,
        base: basesOf(channel.zone)[0] ?? `https://${channel.zone}`,
        packageSig: channel.packageSig,
        label: DEBUGGER_PACKAGE,
        at: channel.createdAt ? new Date(channel.createdAt * 1000).toISOString() : '',
        generation: null,
        layers: [],
        bees: [],
        dependencies: [],
      }
    }
  }
  return readPool(zone).catch(() => null)
}
