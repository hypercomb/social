// hive-backup.spec.ts — the whole hive kept as ciphertext on hosts, and opened on a CLEARED browser with only the
// recovery file. The seal and NIP-44 are the real ones (core's ciphers, nostr-tools): the point under test is that a
// key which never lived in the browser opens what the browser's own key sealed.

import { describe, expect, it } from 'vitest'
import {
  BACKUP_ROOT_KEY, backupCarrierBytes, backupHive, mintRecoveryKey, nip44FromSecret, parseBackupCarrier,
  parseRecoveryFile, recoveryFileText, restoreHive, type BackupDeps, type RestoreDeps,
} from './hive-backup.js'
import { CLOSURE_ATOMS_MAX, signBytes } from './sealed-closure.js'

const enc = (text: string): Uint8Array => new TextEncoder().encode(text)
const bytesOf = (data: Uint8Array | undefined): number[] => data ? [...data] : []

type Host = { bytes: Map<string, Uint8Array>; roots: Record<string, string>; puts: number }

const makeWorld = async () => {
  // The device's own key, and the recovery key the participant keeps offline.
  const device = await mintRecoveryKey()
  const recovery = await mintRecoveryKey()

  // A hive of three atoms: a picture, a note, and the root layer that names both.
  const picture = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
  const pictureSig = await signBytes(picture)
  const note = enc('the bread rises overnight')
  const noteSig = await signBytes(note)
  const root = enc(JSON.stringify({ name: '', notes: [noteSig], resources: [pictureSig] }))
  const head = await signBytes(root)
  const local = new Map<string, Uint8Array>([[pictureSig, picture], [noteSig, note], [head, root]])
  const hosts: Record<string, Host> = {
    'one.example': { bytes: new Map(), roots: {}, puts: 0 },
    'two.example': { bytes: new Map(), roots: {}, puts: 0 },
  }
  const deviceNip44 = (await nip44FromSecret(device.secret))!

  let seal = head
  let clock = 1_000
  const backup = (over: Partial<BackupDeps> = {}): BackupDeps => ({
    hosts: async () => Object.keys(hosts),
    publisher: async () => device.recovery,
    own: async () => device.recovery,
    devices: async () => [],
    nip44: () => deviceNip44,
    seal: async () => seal,
    getBytes: async sig => local.get(sig) ?? null,
    recovery: async () => recovery.recovery,
    // A flat heap: an atom already held is not sent again (host-sync's HEAD).
    upload: host => async atoms => {
      for (const [sig, bytes] of atoms) if (!hosts[host]!.bytes.has(sig)) { hosts[host]!.bytes.set(sig, bytes); hosts[host]!.puts++ }
      return { ok: true }
    },
    setRoot: async (host, key, sig) => { hosts[host]!.roots[key] = sig; return { ok: true } },
    now: () => clock++,
    ...over,
  })

  // A cleared browser: an empty store and no key of its own.
  const cleared = () => {
    const store = new Map<string, Uint8Array>()
    const deps: RestoreDeps = {
      roots: async host => hosts[host]?.roots ?? null,
      fetcher: host => async sig => hosts[host]?.bytes.get(sig) ?? null,
      put: async (sig, bytes) => { store.set(sig, bytes); return true },
      nip44: nip44FromSecret,
    }
    return { store, deps }
  }
  const file = () => parseRecoveryFile(recoveryFileText({
    publisher: device.recovery, hosts: Object.keys(hosts), recovery: recovery.recovery, secret: recovery.secret, made: 'now',
  }))

  return {
    device, recovery, picture, pictureSig, note, noteSig, root, head, local, hosts, backup, cleared, file,
    setSeal: (next: string) => { seal = next },
  }
}

describe('a host backup of the whole hive', () => {
  it('is kept on every host as ciphertext only, under one colon root', async () => {
    const world = await makeWorld()
    const result = await backupHive(world.backup())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.head).toBe(world.head)
    expect(result.hosts).toEqual(['one.example', 'two.example'])
    for (const host of Object.values(world.hosts)) {
      expect(Object.keys(host.roots)).toEqual([BACKUP_ROOT_KEY])
      // No plaintext atom reaches a host.
      for (const sig of [world.head, world.noteSig, world.pictureSig]) expect(host.bytes.has(sig)).toBe(false)
      const everything = [...host.bytes.values()].map(bytes => new TextDecoder().decode(bytes)).join('\n')
      expect(everything).not.toContain('bread rises')
    }
  })

  it('opens on a cleared browser with the recovery file alone, every atom checked', async () => {
    const world = await makeWorld()
    await backupHive(world.backup())
    const { store, deps } = world.cleared()
    const restored = await restoreHive(world.file(), deps)
    expect(restored).toMatchObject({ ok: true, head: world.head, host: 'one.example' })
    expect(bytesOf(store.get(world.head))).toEqual(bytesOf(world.root))
    expect(bytesOf(store.get(world.noteSig))).toEqual(bytesOf(world.note))
    expect(bytesOf(store.get(world.pictureSig))).toEqual(bytesOf(world.picture))
  })

  it('sends only what changed on the next backup, and replaces the last one', async () => {
    const world = await makeWorld()
    await backupHive(world.backup())
    const first = world.hosts['one.example']!.puts
    const firstEnvelope = world.hosts['one.example']!.roots[BACKUP_ROOT_KEY]

    // One new note; the picture and the old note are unchanged.
    const added = enc('and is baked at dawn')
    const addedSig = await signBytes(added)
    const nextRoot = enc(JSON.stringify({ name: '', notes: [world.noteSig, addedSig], resources: [world.pictureSig] }))
    const nextHead = await signBytes(nextRoot)
    world.local.set(addedSig, added).set(nextHead, nextRoot)
    world.setSeal(nextHead)
    await backupHive(world.backup())

    // New: the added note, the new root, the carrier, the door and the envelope. The picture and old note are not sent.
    expect(world.hosts['one.example']!.puts - first).toBe(5)
    expect(world.hosts['one.example']!.roots[BACKUP_ROOT_KEY]).not.toBe(firstEnvelope)
    const { store, deps } = world.cleared()
    expect(await restoreHive(world.file(), deps)).toMatchObject({ ok: true, head: nextHead })
    expect(bytesOf(store.get(addedSig))).toEqual(bytesOf(added))
  })

  it('seals identical files to identical ciphertext, so two hives share one copy on a host', async () => {
    const one = await makeWorld()
    const two = await makeWorld()
    await backupHive(one.backup())
    await backupHive(two.backup({ upload: one.backup().upload, now: () => 5 }))
    // Same three plaintext atoms in both hives → the same three ciphertexts; only each one's carrier, door and envelope differ.
    expect(one.hosts['one.example']!.bytes.size).toBe(3 + 3 * 2)
  })

  it('backs up what this hive holds and leaves out what it reads from a host on demand', async () => {
    const world = await makeWorld()
    world.local.delete(world.pictureSig) // never fetched into this browser
    const result = await backupHive(world.backup())
    expect(result).toMatchObject({ ok: true, atoms: 3 }) // root, note, carrier
  })
})

describe('what a backup refuses', () => {
  it('refuses without a recovery key, so nothing is sealed only to a key a clear would lose', async () => {
    const world = await makeWorld()
    expect(await backupHive(world.backup({ recovery: async () => null }))).toEqual({ ok: false, reason: 'no-recovery' })
    expect(world.hosts['one.example']!.puts).toBe(0)
  })

  it('refuses with no host, no seal or no encryption', async () => {
    const world = await makeWorld()
    expect(await backupHive(world.backup({ hosts: async () => [] }))).toEqual({ ok: false, reason: 'no-host' })
    expect(await backupHive(world.backup({ seal: async () => null }))).toEqual({ ok: false, reason: 'no-seal' })
    expect(await backupHive(world.backup({ nip44: () => null }))).toEqual({ ok: false, reason: 'no-nip44' })
  })

  it('keeps a hive past the sharing ceiling whole, and it opens whole', async () => {
    const world = await makeWorld()
    // Real atoms, each named by its own signature: one more than a shared branch may carry.
    const notes = await Promise.all(Array.from({ length: CLOSURE_ATOMS_MAX }, async (_, i) => {
      const bytes = enc(`note ${i}`)
      const sig = await signBytes(bytes)
      world.local.set(sig, bytes)
      return sig
    }))
    const big = enc(JSON.stringify({ name: '', notes }))
    const bigSig = await signBytes(big)
    world.local.set(bigSig, big)
    world.setSeal(bigSig)
    const kept = await backupHive(world.backup({ hosts: async () => ['one.example'] }))
    expect(kept).toMatchObject({ ok: true, atoms: CLOSURE_ATOMS_MAX + 2 }) // the notes, the root, the carrier
    const { store, deps } = world.cleared()
    expect(await restoreHive(world.file(), deps)).toMatchObject({ ok: true, head: bigSig })
    expect(store.size).toBe(CLOSURE_ATOMS_MAX + 1) // the notes and the root; the carrier is not hive content
  }, 240_000)

  it('names one host failing and keeps on the rest', async () => {
    const world = await makeWorld()
    const result = await backupHive(world.backup({
      setRoot: async (host, key, sig) => host === 'one.example' ? { ok: false, reason: 'index-unsafe: unreachable' } : (world.hosts[host]!.roots[key] = sig, { ok: true }),
    }))
    expect(result).toMatchObject({ ok: true, hosts: ['two.example'], failed: [{ host: 'one.example' }] })
  })
})

describe('what a restore refuses', () => {
  it('does not open with a different recovery key', async () => {
    const world = await makeWorld()
    await backupHive(world.backup())
    const stranger = await mintRecoveryKey()
    const forged = parseRecoveryFile(recoveryFileText({
      publisher: world.device.recovery, hosts: ['one.example'], recovery: stranger.recovery, secret: stranger.secret, made: '',
    }))
    const { store, deps } = world.cleared()
    expect(await restoreHive(forged, deps)).toEqual({ ok: false, reason: 'unopened', unread: [] })
    expect(store.size).toBe(0)
  })

  it('writes nothing when a ciphertext is missing on the host', async () => {
    const world = await makeWorld()
    await backupHive(world.backup())
    for (const host of Object.values(world.hosts)) {
      const envelope = host.roots[BACKUP_ROOT_KEY]
      // Drop every atom but the envelope and the door: the key index opens, an atom does not.
      const door = JSON.parse(new TextDecoder().decode(host.bytes.get(envelope!)!)).door as string
      for (const sig of [...host.bytes.keys()]) if (sig !== envelope && sig !== door) { host.bytes.delete(sig); break }
    }
    const { store, deps } = world.cleared()
    const restored = await restoreHive(world.file(), deps)
    expect(restored.ok).toBe(false)
    expect(store.size).toBe(0)
  })

  it('says no backup when the hosts name none, and which hosts could not be read', async () => {
    const world = await makeWorld()
    const { deps } = world.cleared()
    const file = parseRecoveryFile(recoveryFileText({
      publisher: world.device.recovery, hosts: ['one.example', 'gone.example'], recovery: world.recovery.recovery, secret: world.recovery.secret, made: '',
    }))
    expect(await restoreHive(file, deps)).toEqual({ ok: false, reason: 'no-backup', unread: ['gone.example'] })
  })
})

describe('the files a backup is made of', () => {
  it('reads a carrier and nothing else as one', () => {
    const head = 'a'.repeat(64)
    expect(parseBackupCarrier(backupCarrierBytes(head, 5))).toEqual({ kind: 'hive-backup', head, at: 5 })
    expect(parseBackupCarrier(enc('{"kind":"private-tile","head":"' + head + '","at":1}'))).toBeNull()
    expect(parseBackupCarrier(enc('nope'))).toBeNull()
  })

  it('reads a recovery file only when every part of it is whole', async () => {
    const key = await mintRecoveryKey()
    const good = recoveryFileText({ publisher: key.recovery, hosts: ['Jwize.com', 'localhost:7777'], recovery: key.recovery, secret: key.secret, made: 'x' })
    expect(parseRecoveryFile(good)).toMatchObject({ hosts: ['jwize.com', 'localhost:7777'], secret: key.secret })
    expect(parseRecoveryFile(good.replace(key.secret, 'short'))).toBeNull()
    expect(parseRecoveryFile(recoveryFileText({ publisher: key.recovery, hosts: [], recovery: key.recovery, secret: key.secret, made: '' }))).toBeNull()
    expect(parseRecoveryFile('{}')).toBeNull()
    expect(parseRecoveryFile('not json')).toBeNull()
  })
})
