import { canonicalLayerJson, SignatureService } from '@hypercomb/core'
import { describe, expect, it } from 'vitest'
import {
  broadcastFace, diffBranches, loadAi, mintBranch, missionOrigin, packMint, publishInstanceHead, readBranch, unpackMint,
  type BranchRead,
} from './branch-files'

const encoder = new TextEncoder()

const sign = async (text: string): Promise<{ sig: string; bytes: Uint8Array }> => {
  const bytes = encoder.encode(text)
  const sig = await SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  return { sig, bytes }
}

const layer = async (name: string, fields: Record<string, unknown> = {}): Promise<{ sig: string; bytes: Uint8Array }> =>
  sign(canonicalLayerJson({ name, ...fields }))

const heap = (entries: { sig: string; bytes: Uint8Array }[]): BranchRead => {
  const files = new Map(entries.map(entry => [entry.sig, entry.bytes]))
  return async sig => files.get(sig) ?? null
}

const tree = async () => {
  const bee = await sign('export const bee = 1\n')
  const siblingBee = await sign('export const sibling = 1\n')
  const themes = await layer('themes')
  const arkanoid = await layer('arkanoid', { bees: [bee.sig], cells: [themes.sig] })
  const sharing = await layer('sharing', { bees: [siblingBee.sig] })
  const root = await layer('essentials', { cells: [arkanoid.sig, sharing.sig] })
  const read = heap([bee, siblingBee, themes, arkanoid, sharing, root])
  return { bee, siblingBee, themes, arkanoid, sharing, root, read }
}

describe('a branch read as files', () => {
  it('rebuilds the folders from the layers', async () => {
    const built = await tree()
    const branch = await readBranch(built.root.sig, built.read)
    expect(branch.complete).toBe(true)
    expect(branch.nodes.map(node => node.path).sort()).toEqual(['', 'arkanoid', 'arkanoid/themes', 'sharing'])
    const arkanoid = branch.nodes.find(node => node.path === 'arkanoid')
    expect(arkanoid?.bees).toEqual([built.bee.sig])
    expect(branch.files.some(file => file.kind === 'bee' && file.path === 'arkanoid' && file.sig === built.bee.sig)).toBe(true)
  })

  it('rewrites the merkle path when a file is turned off, and leaves the sibling', async () => {
    const built = await tree()
    const branch = await readBranch(built.root.sig, built.read)
    const minted = await mintBranch(branch, { offSigs: [built.bee.sig] })
    expect(minted.ok).toBe(true)
    if (!minted.ok) return
    expect(minted.rootSig).not.toBe(built.root.sig)
    expect(minted.moved.get(built.arkanoid.sig)).toBeTruthy()
    expect(minted.moved.has(built.sharing.sig)).toBe(false)
    expect(minted.moved.has(built.themes.sig)).toBe(false)
    const rootBytes = minted.layers.get(minted.rootSig)
    expect(rootBytes).toBeTruthy()
    const record = JSON.parse(new TextDecoder().decode(rootBytes)) as {
      cells: { path: string; sig: string }[]
      edits: { offFiles: string[] }
      face: string[]
    }
    const arkanoid = record.cells.find(cell => cell.path === 'arkanoid')
    const sharing = record.cells.find(cell => cell.path === 'sharing')
    expect(arkanoid?.sig).toBe(minted.moved.get(built.arkanoid.sig))
    expect(sharing?.sig).toBe(built.sharing.sig)
    expect(record.edits.offFiles).toEqual([built.bee.sig])
    expect(record.face).not.toContain(built.bee.sig)
    expect(record.face).toContain(built.siblingBee.sig)
    const child = JSON.parse(new TextDecoder().decode(minted.layers.get(arkanoid!.sig)!)) as {
      bees: { path: string; sig: string }[]
    }
    expect(child.bees).toBeUndefined()
  })

  it('a trait rewrites only the root', async () => {
    const built = await tree()
    const branch = await readBranch(built.root.sig, built.read)
    const minted = await mintBranch(branch, { traits: [{ path: 'arkanoid', word: 'soundtrack' }] })
    expect(minted.ok).toBe(true)
    if (!minted.ok) return
    expect([...minted.moved.keys()]).toEqual([built.root.sig])
    const record = JSON.parse(new TextDecoder().decode(minted.layers.get(minted.rootSig)!)) as {
      edits: { traits: { path: string; word: string }[] }
    }
    expect(record.edits.traits).toEqual([{ path: 'arkanoid', word: 'soundtrack' }])
  })

  it('a choice from another signature replaces that folder and keeps its bytes', async () => {
    const built = await tree()
    const branch = await readBranch(built.root.sig, built.read)
    const foreign = 'ab'.repeat(32)
    const minted = await mintBranch(branch, { choices: [{ path: 'sharing', sig: foreign, source: 'other.example' }] })
    expect(minted.ok).toBe(true)
    if (!minted.ok) return
    expect(minted.moved.has(built.sharing.sig)).toBe(false)
    expect(minted.layers.has(built.sharing.sig)).toBe(false)
    const record = JSON.parse(new TextDecoder().decode(minted.layers.get(minted.rootSig)!)) as {
      cells: { path: string; sig: string }[]
    }
    expect(record.cells.find(cell => cell.path === 'sharing')?.sig).toBe(foreign)
  })

  it('the same edits mint the same root', async () => {
    const built = await tree()
    const branch = await readBranch(built.root.sig, built.read)
    const edits = { offPaths: ['sharing'], traits: [{ path: '', word: 'portrait' }] }
    const first = await mintBranch(branch, edits)
    const second = await mintBranch(branch, edits)
    expect(first.ok && second.ok && first.rootSig === second.rootSig).toBe(true)
  })

  it('keeps boot slots, and drops a file from them when that file is turned off', async () => {
    const bee = await sign('export const boot = 1\n')
    const other = await sign('export const other = 1\n')
    const root = await layer('essentials', { bees: [bee.sig, other.sig], criticalBees: [bee.sig, other.sig], bootBees: [other.sig] })
    const branch = await readBranch(root.sig, heap([bee, other, root]))
    const minted = await mintBranch(branch, { offSigs: [bee.sig] })
    expect(minted.ok).toBe(true)
    if (!minted.ok) return
    const record = JSON.parse(new TextDecoder().decode(minted.layers.get(minted.rootSig)!)) as {
      criticalBees: string[]
      bootBees: string[]
      bees: { sig: string }[]
    }
    expect(record.criticalBees).toEqual([other.sig])
    expect(record.bootBees).toEqual([other.sig])
    expect(record.bees.map(file => file.sig)).toEqual([other.sig])
  })

  it('refuses a partial branch and a trait that is not one word', async () => {
    const built = await tree()
    const partial = await readBranch(built.root.sig, async () => null)
    expect((await mintBranch(partial)).ok).toBe(false)
    const branch = await readBranch(built.root.sig, built.read)
    expect((await mintBranch(branch, { traits: [{ path: 'arkanoid', word: 'two words' }] })).ok).toBe(false)
  })

  it('packs the new layers and reads them back', async () => {
    const built = await tree()
    const branch = await readBranch(built.root.sig, built.read)
    const minted = await mintBranch(branch, { offPaths: ['sharing'] })
    expect(minted.ok).toBe(true)
    if (!minted.ok) return
    const members = await unpackMint(await packMint(minted))
    expect(members?.map(([sig]) => sig).sort()).toEqual([...minted.layers.keys()].sort())
  })
})

describe('the mission the AI loads into', () => {
  it('names a sandbox subdomain and stays empty until the name can be one', () => {
    expect(missionOrigin('jwize.com', 'review')).toBe('https://try-review.jwize.com/')
    expect(missionOrigin('jwize.com', 'try-review')).toBe('https://try-review.jwize.com/')
    expect(missionOrigin('localhost:4270', 'review')).toBe('http://try-review.localhost:4270/')
    expect(missionOrigin('jwize.com', 'two words')).toBe('')
    expect(missionOrigin('jwize.com', '')).toBe('')
  })

  it('loads the AI only when asked, into that origin', () => {
    const host = document.createElement('div')
    const dormant = loadAi('', host)
    expect(dormant.loaded).toBe(false)
    expect(host.querySelector('iframe')).toBeNull()
    const live = loadAi('https://try-review.jwize.com/', host)
    expect(live.loaded).toBe(true)
    expect(host.querySelector('iframe')?.getAttribute('src')).toBe('https://try-review.jwize.com/')
    live.release()
    expect(host.querySelector('iframe')).toBeNull()
  })

  it('broadcasts the public face on this device', async () => {
    const heard: unknown[] = []
    const channel = new BroadcastChannel('hc:public-face')
    channel.addEventListener('message', event => { heard.push(event.data) })
    expect(broadcastFace(['b'.repeat(64), 'a'.repeat(64)])).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(heard).toEqual([{ face: ['b'.repeat(64), 'a'.repeat(64)] }])
    channel.close()
  })

  it('publishes one build as the head file and leaves later work alone', async () => {
    const pkg = 'a'.repeat(64)
    const derived = 'b'.repeat(64)
    const heard: unknown[] = []
    const channel = new BroadcastChannel('hc:instance-head')
    channel.addEventListener('message', event => { heard.push(event.data) })
    const published = await publishInstanceHead({ package: pkg, derivation: derived, face: [derived, 'nope', pkg] })
    expect(published?.head).toBe(`${pkg}\n${derived}\n`)
    expect(published?.head.split(/\n/).filter(Boolean)).toHaveLength(2)
    expect(published?.package).toBe(pkg)
    expect(published?.derivation).toBe(derived)
    expect(published?.face).toEqual([pkg, derived])
    const plain = await publishInstanceHead({ package: pkg.toUpperCase() })
    expect(plain?.head).toBe(`${pkg}\n`)
    expect(plain?.derivation).toBeNull()
    expect(await publishInstanceHead({ package: 'nope' })).toBeNull()
    expect(await publishInstanceHead({ package: pkg, derivation: 'nope' })).toBeNull()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(heard[0]).toEqual({ head: `${pkg}\n${derived}\n`, face: [pkg, derived] })
    channel.close()
  })
})

describe('two branches laid beside each other', () => {
  it('names the folders whose signatures differ', async () => {
    const built = await tree()
    const left = await readBranch(built.root.sig, built.read)
    const otherSharing = await layer('sharing')
    const otherRoot = await layer('essentials', { cells: [built.arkanoid.sig, otherSharing.sig] })
    const right = await readBranch(otherRoot.sig, heap([
      built.bee, built.siblingBee, built.themes, built.arkanoid, otherSharing, otherRoot,
    ]))
    expect(diffBranches(left, right)).toEqual([
      { path: 'root', left: built.root.sig, right: otherRoot.sig },
      { path: 'sharing', left: built.sharing.sig, right: otherSharing.sig },
    ])
  })
})
