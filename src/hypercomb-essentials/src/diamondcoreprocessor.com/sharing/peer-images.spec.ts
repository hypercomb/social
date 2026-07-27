// peer-images.spec.ts — the room's pictures, gathered without moving a byte.
//
// Two guarantees are pinned here:
//   1. What the affordance PROMISES is what the room actually carries — one
//      entry per distinct picture, every publisher of it named, nothing
//      invented when the mesh is quiet or a publisher sent no image.
//   2. Gathering is READ-ONLY on pointers. Nothing in this module may fetch,
//      write, or resolve bytes; a malformed sig is dropped, never followed.

import { beforeEach, describe, expect, it } from 'vitest'
import { hasPeerImages, imagePropsOf, peerImageCandidates, previewSigOf } from './peer-images.js'

const POINT = 'a'.repeat(64)
const FLAT = 'b'.repeat(64)
const OTHER = 'c'.repeat(64)
const DIRECT = 'd'.repeat(64)

type Visual = { name: string; peerPubkey: string } & Record<string, unknown>

const stubSwarm = (tiles: Visual[], labels: Record<string, string> = {}): void => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    get: (key: string) =>
      key === '@diamondcoreprocessor.com/SwarmDrone'
        ? { peerTilesAtCurrentSig: () => tiles, labelFor: (pk: string) => labels[pk] ?? '' }
        : undefined,
  }
}

describe('peer image candidates', () => {
  beforeEach(() => { (window as unknown as { ioc?: unknown }).ioc = undefined })

  it('offers nothing when the mesh is off', () => {
    expect(peerImageCandidates('tile')).toEqual([])
    expect(hasPeerImages('tile')).toBe(false)
  })

  it('offers nothing when the publisher sent no picture', () => {
    stubSwarm([{ name: 'tile', peerPubkey: 'p1', index: 3 }])
    expect(peerImageCandidates('tile')).toEqual([])
  })

  it('ignores tiles with another name', () => {
    stubSwarm([{ name: 'other', peerPubkey: 'p1', small: { image: POINT } }])
    expect(peerImageCandidates('tile')).toEqual([])
  })

  it('surfaces one candidate per publisher picture, named', () => {
    stubSwarm(
      [
        { name: 'tile', peerPubkey: 'p1', small: { image: POINT }, flat: { small: { image: FLAT } } },
        { name: 'tile', peerPubkey: 'p2', small: { image: OTHER } },
      ],
      { p1: 'ana' },
    )
    const found = peerImageCandidates('tile')
    expect(found.map(c => c.previewSig)).toEqual([POINT, OTHER])
    expect(found[0].peers).toEqual([{ pubkey: 'p1', label: 'ana' }])
    expect(found[0].props.flat).toEqual({ small: { image: FLAT } })
    // No announced label — the pubkey is the identity, never a fabricated name.
    expect(found[1].peers[0].label).toBe('')
    expect(hasPeerImages('tile')).toBe(true)
  })

  it('collapses the same picture from several peers into ONE choice', () => {
    stubSwarm([
      { name: 'tile', peerPubkey: 'p1', small: { image: POINT } },
      { name: 'tile', peerPubkey: 'p2', small: { image: POINT } },
    ])
    const found = peerImageCandidates('tile')
    expect(found).toHaveLength(1)
    expect(found[0].peers.map(p => p.pubkey)).toEqual(['p1', 'p2'])
  })

  it('drops values that are not signatures instead of following them', () => {
    stubSwarm([{
      name: 'tile',
      peerPubkey: 'p1',
      imageSig: 'https://example.com/x.png',
      small: { image: '../../etc/passwd' },
      flat: { small: { image: FLAT } },
    }])
    const found = peerImageCandidates('tile')
    expect(found).toHaveLength(1)
    expect(found[0].props.imageSig).toBeUndefined()
    expect(found[0].props.small).toBeUndefined()
    expect(found[0].previewSig).toBe(FLAT)
  })

  it('survives a swarm drone that throws', () => {
    ;(window as unknown as { ioc: unknown }).ioc = {
      get: () => ({ peerTilesAtCurrentSig: () => { throw new Error('mesh down') } }),
    }
    expect(peerImageCandidates('tile')).toEqual([])
  })

  it('prefers the point-top thumbnail for preview, then flat, then the bare pointer', () => {
    expect(previewSigOf({ small: { image: POINT }, flat: { small: { image: FLAT } }, imageSig: DIRECT })).toBe(POINT)
    expect(previewSigOf({ flat: { small: { image: FLAT } }, imageSig: DIRECT })).toBe(FLAT)
    expect(previewSigOf({ imageSig: DIRECT })).toBe(DIRECT)
    expect(previewSigOf({})).toBe('')
  })

  it('reads image pointers off a visual without copying anything else', () => {
    const props = imagePropsOf({ small: { image: POINT }, tags: ['x'], link: 'https://e.com', index: 2 })
    expect(props).toEqual({ small: { image: POINT } })
  })
})
