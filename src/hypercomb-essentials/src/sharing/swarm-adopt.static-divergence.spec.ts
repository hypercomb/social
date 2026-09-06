// sharing/swarm-adopt.static-divergence.spec.ts — a public host's offer is a
// peer to the divergence scan, and a dim held static tile refreshes ONE level.
//
// Source ratchets: the scan folds static entries into the same three rules the
// mesh peers are judged by; rule 3 asks the static source for the publisher's
// children; the sync gesture on a static tile never reaches the swarm's
// whole-branch sync — "every action is a step towards your permanence".

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(process.cwd(), 'hypercomb-essentials', 'src', 'sharing', 'swarm-adopt.drone.ts'), 'utf8')
const between = (start: string, end: string): string => {
  const a = src.indexOf(start)
  const b = src.indexOf(end, a)
  return a >= 0 && b > a ? src.slice(a, b) : ''
}

describe('the divergence scan and a static offer', () => {
  it('the scan judges static entries by the same rules as live peers', () => {
    const scan = between('#divergenceScanPass = async', '#staticOffersUnheldChildren = async')
    expect(scan.includes('statics?.peerEntriesAt?.(at)')).toBe(true)
    expect(scan.includes('static: true')).toBe(true)
    expect(scan.includes('this.#staticOffersUnheldChildren(statics, history, target, held.layer)')).toBe(true)
  })

  it('rule 3 for a static tile reads the publisher through the static source, never the mesh cache', () => {
    const rule = between('#staticOffersUnheldChildren = async', '#peerOffersUnheldChildren = async')
    expect(rule.includes('statics.childNamesAt(target)')).toBe(true)
    expect(rule.includes('peerTilesAtSig')).toBe(false)
  })

  it('a dim held static tile refreshes one level and never the whole branch', () => {
    const sync = between('#syncStaticTile = async', 'public syncResolvedBranch = async')
    expect(sync.includes('writeTilePropertiesAt(')).toBe(true)
    expect(sync.includes('#recordSyncReceipt(')).toBe(true)
    expect(sync.includes('#commitBranch(')).toBe(false)
    expect(sync.includes('syncResolvedBranch(')).toBe(false)
    const gesture = between('#syncPeerTile = async', '#syncStaticTile = async')
    expect(gesture.includes('this.#syncStaticTile(')).toBe(true)
  })
})
