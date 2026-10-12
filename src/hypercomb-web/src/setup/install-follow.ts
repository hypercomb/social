// hypercomb-web/src/setup/install-follow.ts
//
// WHOM A SHELL WITH NOTHING INSTALLED FOLLOWS.
//
// The update scout learns its publisher from the package it ships in
// (essentials sharing/install-publisher.json). A cold shell has no package
// yet, so it carries the same record itself — `install-publisher.json` beside
// this file, the shell's half of the pair. It is DATA, never edited by hand:
// `stamp-install-channel.ts` writes both copies together, and
// install-follow.spec.ts fails the suite the moment they differ.
//
// The participant's own `hc:install-follow` record still wins, exactly as it
// does for the scout (runtime host-packages.ts readInstallFollow).
//
// Verification is the one thing the shell adds: runtime does no schnorr, so
// the check is lazy-loaded here, only when an index is actually read — a cold
// install or a floor move, never an ordinary boot.

import { readInstallFollow, type InstallFollow, type VerifyIndexEvent } from '@hypercomb/runtime/host-packages'
import INSTALL_PUBLISHER from './install-publisher.json'

/** The follow a cold install and the package floor read the channel with. */
export const shellInstallFollow = (): InstallFollow | null => {
  let storage: Storage | null = null
  try { storage = localStorage } catch { /* no storage — the shell's publisher alone */ }
  return readInstallFollow(storage, INSTALL_PUBLISHER)
}

/** Schnorr-verify one signed index event (NIP-01). Loaded on first use. */
export const verifyIndexEvent: VerifyIndexEvent = async event => {
  const { verifyEvent } = await import('nostr-tools/pure')
  return verifyEvent(event as never)
}
