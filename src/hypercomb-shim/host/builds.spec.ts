// @vitest-environment node
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { generateSecretKey } from 'nostr-tools/pure'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// @ts-ignore — plain ESM tooling, no declarations
import * as builds from './builds.mjs'

const b = (text: string) => Buffer.from(text)
const hex = (key: Uint8Array) => Buffer.from(key).toString('hex')
const DAY = new Date('2026-09-26T12:00:00Z')

let root = ''
beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), 'hc-builds-spec-'))
  process.env.HYPERCOMB_POOLS_DIR = resolve(root, 'pools')
  process.env.HYPERCOMB_SIGNER_KEY = hex(generateSecretKey())
})
afterEach(async () => {
  delete process.env.HYPERCOMB_POOLS_DIR
  delete process.env.HYPERCOMB_SIGNER_KEY
  await rm(root, { recursive: true, force: true })
})

const stage = (label: string | undefined, main: string) => {
  const atom = b('atom:' + main)
  return builds.recordBuild({
    label, signed: [atom],
    install: new Map([['main.js', b(main)], ['index.html', b('<html>')]]),
    units: [{ name: 'kernel', install: 'main.js', files: new Map([['src/main.ts', b('// ' + main)]]) }],
    host: builds.sign(atom), library: 'l'.repeat(64), hostPackage: 'p'.repeat(64),
  })
}
/** Stage, then promote: a revision in the lineage. */
const record = async (label: string | undefined, main: string, now = DAY) => {
  await stage(label, main)
  return builds.promote(label ?? 'host', { now, sync: false, sign: false })
}
/** Promoted and signed by its author: a revision that travels. */
const released = async (label: string | undefined, main: string, now = DAY) => {
  const done = await record(label, main, now)
  await builds.signRevision(done.sig, 'author')
  return done
}
const files = async (dir: string) => (await readdir(dir).catch(() => [])).filter((n: string) => /^[a-f0-9]{64}$/.test(n))

describe('stage, then promote', () => {
  it('a build stages; promotion appends the next version of the day, chained to the last', async () => {
    const staged = await stage(undefined, 'a')
    expect(staged.record.version).toBe('staged')
    expect(await builds.revisions()).toEqual([])
    const one = await builds.promote('host', { now: DAY, sync: false, sign: false })
    const two = await record(undefined, 'b')
    const three = await record('Beta Line', 'c')
    const four = await record(undefined, 'd', new Date('2026-10-01T00:00:00Z'))
    expect([one, two, three, four].map(r => `${r.record.label} ${r.record.version}`))
      .toEqual(['host 2026.9.26.1', 'host 2026.9.26.2', 'beta-line 2026.9.26.3', 'host 2026.10.1.1'])
    expect(one.record.parent).toBe(null)
    expect(two.record.parent).toBe(one.sig)
    expect(three.record.parent).toBe(two.sig)
    const { parts, files: changed } = await builds.changesOf(builds.poolDir(builds.BUILDS_MEANING), three.record)
    expect(parts).toEqual(['install', 'host', 'tree'])
    expect(changed.install).toEqual(['~ main.js'])
    expect(changed.source).toEqual(['~ src/main.ts'])
  })

  it('keeps one stage per story: a rebuild replaces it, and what only the old stage named is collected', async () => {
    const pool = builds.poolDir(builds.BUILDS_MEANING)
    const first = await stage(undefined, 'draft one')
    const second = await stage(undefined, 'draft two')
    const held = await files(pool)
    expect(held).not.toContain(first.sig)
    expect(held).toContain(second.sig)
    expect(held).not.toContain(builds.sign(b('draft one')))
    expect(Object.keys(await builds.readStage())).toEqual(['host'])
  })

  it('never lets staged work travel', async () => {
    const promoted = await released(undefined, 'released')
    const draft = await stage(undefined, 'unfinished')
    const host = resolve(root, 'host')
    await builds.carryPools(host, { atoms: true })
    const carried = await files(resolve(host, builds.sign(builds.BUILDS_MEANING)))
    expect(carried).toContain(promoted.sig)
    expect(carried).not.toContain(draft.sig)
    expect(carried).not.toContain(builds.sign(b('unfinished')))
    expect(await files(host)).toEqual([builds.sign(b('atom:released'))].concat([builds.sign(builds.BUILDS_MEANING), builds.sign(builds.SIGNATURES_MEANING)]).sort())
  })

  it('signs a promotion as its author when a key is at hand', async () => {
    await stage(undefined, 'a')
    const done = await builds.promote('host', { now: DAY, sync: false })
    expect(done.signed).toBe(true)
    expect((await builds.signaturesOf(done.sig, done.record.version)).map((s: { role: string; ok: boolean }) => [s.role, s.ok])).toEqual([['author', true]])
    await expect(builds.promote('host', { sync: false })).rejects.toThrow(/nothing staged/)
  })
})

describe('nothing travels unsigned', () => {
  it('an unsigned promotion stays home, sync says so, and signing it releases it', async () => {
    const follower = resolve(root, 'follower')
    await mkdir(follower)
    await builds.subscribe(follower)
    await stage(undefined, 'a')
    const done = await builds.promote('host', { now: DAY, sign: false })
    expect(done.signed).toBe(false)
    expect(done.synced[0].detail).toMatch(/held back, unsigned: 2026\.9\.26\.1/)
    const pool = resolve(follower, builds.sign(builds.BUILDS_MEANING))
    expect(await files(pool)).not.toContain(done.sig)
    expect(await files(follower)).not.toContain(builds.sign(b('atom:a')))
    await builds.signRevision(done.sig, 'author')
    expect((await builds.sync())[0].detail).not.toMatch(/held back/)
    expect(await files(pool)).toContain(done.sig)
    expect(await files(follower)).toContain(builds.sign(b('atom:a')))
  })

  it('a served snapshot taken with no key stays home until one is at hand', async () => {
    const origin = resolve(root, 'origin-host')
    await mkdir(origin)
    await writeFile(resolve(origin, 'index.html'), '<html>front</html>')
    await builds.serves(origin)
    const key = process.env.HYPERCOMB_SIGNER_KEY
    delete process.env.HYPERCOMB_SIGNER_KEY
    const snap = await builds.snapshotServed({ now: DAY })
    expect((await builds.published())[builds.BUILDS_MEANING].has(snap.sig)).toBe(false)
    process.env.HYPERCOMB_SIGNER_KEY = key
    expect((await builds.snapshotServed({ now: DAY })).sig).toBe(snap.sig)   // unchanged, now signed
    expect((await builds.published())[builds.BUILDS_MEANING].has(snap.sig)).toBe(true)
  })
})

describe('stories', () => {
  it('tells a story within a larger one; a retelling is newest', async () => {
    await builds.tellStory('minimal host', 'The platform in two small files', { now: DAY })
    await builds.tellStory('offline', 'An installed hive starts with the network cut', { within: 'minimal host', now: DAY })
    await builds.tellStory('offline', 'Starts, and renders, with the network cut', { within: 'minimal-host', now: new Date('2026-09-27T00:00:00Z') })
    const told = await builds.stories()
    expect(told.get('offline')).toMatchObject({ description: 'Starts, and renders, with the network cut', within: 'minimal-host' })
    expect(told.get('minimal-host')).toMatchObject({ within: null })
    await expect(builds.tellStory('loop', 'x', { within: 'loop' })).rejects.toThrow(/within itself/)
  })

  it('names the conversations that did the work, and carries them with the promotion', async () => {
    const transcript = resolve(root, 'chat.jsonl')
    await writeFile(transcript, '{"role":"user","text":"make it start offline"}')
    await stage('offline', 'a')
    const { sig: conversation } = await builds.attachConversation('offline', transcript)
    const done = await builds.promote('offline', { now: DAY, sync: false })
    expect(done.record.conversations).toEqual([conversation])
    const host = resolve(root, 'host')
    await builds.carryPools(host)
    expect(await files(resolve(host, builds.sign(builds.BUILDS_MEANING)))).toContain(conversation)
  })
})

describe('subscriptions', () => {
  it('carries every promotion to the subscribed hosts by itself, and retries what did not arrive', async () => {
    const relay = resolve(root, 'relay')
    await builds.subscribe(relay)
    await stage(undefined, 'a')
    const first = await builds.promote('host', { now: DAY })
    expect(first.synced).toEqual([{ to: relay, ok: false, detail: 'the directory is not there' }])
    expect((await builds.readSubscriptions())[0].synced).toBe(null)
    await mkdir(relay)
    const retried = await builds.sync()
    expect(retried[0].ok).toBe(true)
    expect(await files(resolve(relay, builds.sign(builds.BUILDS_MEANING)))).toContain(first.sig)
    await stage(undefined, 'b')
    const second = await builds.promote('host', { now: DAY })
    expect(second.synced[0].ok).toBe(true)
    expect((await builds.readSubscriptions())[0].synced).toBe(second.sig)
    expect(await files(resolve(relay, builds.sign(builds.BUILDS_MEANING)))).toContain(second.sig)
  })
})

describe('version pool', () => {
  it('writes any revision back out exactly, and takes it into another pool', async () => {
    const first = await record(undefined, 'a')
    await record(undefined, 'b')
    await builds.signRevision(first.record.version, 'author')
    const out = resolve(root, 'origin')
    await builds.writeOut(first.record.version, out)
    expect(await readFile(resolve(out, 'main.js'), 'utf8')).toBe('a')
    expect((await readFile(resolve(out, 'build'), 'utf8')).trim()).toBe(first.sig)

    process.env.HYPERCOMB_POOLS_DIR = resolve(root, 'elsewhere')
    const taken = await builds.takeIn(out)
    expect(taken.sig).toBe(first.sig)
    expect(taken.signatures.map((s: { role: string; ok: boolean }) => [s.role, s.ok])).toEqual([['author', true]])
    expect((await builds.revisions()).map((r: { sig: string }) => r.sig)).toEqual([first.sig])
  })

  it('refuses an origin whose files are not the ones its revision names', async () => {
    const first = await record(undefined, 'a')
    const out = resolve(root, 'origin')
    await builds.writeOut(first.record.version, out)
    await writeFile(resolve(out, 'main.js'), 'tampered')
    process.env.HYPERCOMB_POOLS_DIR = resolve(root, 'elsewhere')
    await expect(builds.takeIn(out)).rejects.toThrow(/not the install/)
  })
})

describe('participant signatures', () => {
  it('lets a witness sign only a build reproduced here', async () => {
    const first = await record(undefined, 'a')
    await expect(builds.signRevision(first.sig, 'witness')).rejects.toThrow(/reproduces/)
    await stage('rebuilt', 'a')
    const signed = await builds.signRevision(first.sig, 'witness')
    const found = await builds.signaturesOf(first.sig, first.record.version)
    expect(found).toEqual([{ role: 'witness', pubkey: signed.pubkey, ok: true }])
  })

  it('shows a forged signature as not verifying', async () => {
    const first = await record(undefined, 'a')
    const { pubkey, file } = await builds.signRevision(first.sig, 'reviewer')
    const pool = builds.poolDir(builds.SIGNATURES_MEANING)
    const event = JSON.parse(await readFile(resolve(pool, file), 'utf8'))
    const forged = Buffer.from(JSON.stringify({ ...event, content: event.content.replace('reviewer', 'author') }))
    await rm(resolve(pool, file))
    await writeFile(resolve(pool, builds.sign(forged)), forged)
    expect(await builds.signaturesOf(first.sig, first.record.version)).toEqual([{ role: 'reviewer', pubkey, ok: false }])
  })

  it('refuses a role it does not know and a missing key', async () => {
    const first = await record(undefined, 'a')
    await expect(builds.signRevision(first.sig, 'mayor')).rejects.toThrow(/--as wants/)
    delete process.env.HYPERCOMB_SIGNER_KEY
    await expect(builds.signRevision(first.sig, 'author')).rejects.toThrow(/no signing key/)
    expect(await readdir(builds.poolDir(builds.SIGNATURES_MEANING)).catch(() => [])).toEqual([])
  })
})

describe('what a host serves', () => {
  // A host's directory beyond its history: a package laid out for installs,
  // a discovery pool member, front files. Written as a host's tools would.
  const hostDir = async (dir: string, extra: Record<string, string> = {}) => {
    const all: Record<string, string> = {
      'index.html': '<html>front</html>', '.htaccess': 'Header set X 1',
      ['a'.repeat(64)]: 'leaf', [`${'b'.repeat(64)}/00000000`]: `${'a'.repeat(64)}\nessentials`, ...extra,
    }
    for (const [path, text] of Object.entries(all)) {
      await mkdir(resolve(dir, path, '..'), { recursive: true })
      await writeFile(resolve(dir, path), text)
    }
    return all
  }
  const tree = async (dir: string, out: Record<string, string> = {}, at = dir): Promise<Record<string, string>> => {
    for (const e of await readdir(at, { withFileTypes: true })) {
      const p = resolve(at, e.name)
      if (e.isDirectory()) await tree(dir, out, p)
      else out[p.slice(dir.length + 1)] = (await readFile(p)).toString()
    }
    return out
  }

  it('a follower serves everything its host serves, and so does any device that pulls it', async () => {
    const origin = resolve(root, 'origin-host')
    const want = await hostDir(origin)
    await builds.serves(origin)
    const follower = resolve(root, 'follower')
    await mkdir(follower)
    await builds.subscribe(follower)
    await record(undefined, 'a')
    const [report] = await builds.sync()
    expect(report.ok).toBe(true)
    expect(report.detail).toMatch(/serves 4 file\(s\) as the host does/)
    const held = await tree(follower)
    for (const [path, text] of Object.entries(want)) expect(held[path]).toBe(text)

    // A device with nothing pulls the follower and serves the same.
    const served = async (url: string) => {
      const path = new URL(url).pathname.replace(/^\/content/, '')
      const file = resolve(follower, '.' + (path.endsWith('/') ? path + 'index.html' : path))
      try { return new Response(await readFile(file)) } catch { return new Response('', { status: 404 }) }
    }
    process.env.HYPERCOMB_POOLS_DIR = resolve(root, 'device')
    await builds.pullPools(['https://follower.test'], { fetch: served })
    const device = resolve(root, 'device-host')
    const r = await builds.writeServed(device)
    expect(r.files).toBe(4)
    const again = await tree(device)
    for (const [path, text] of Object.entries(want)) expect(again[path]).toBe(text)
  })

  it('records a snapshot only when what is served changed, and keeps every one through collection', async () => {
    const origin = resolve(root, 'origin-host')
    await hostDir(origin)
    await builds.serves(origin)
    const first = await builds.snapshotServed({ now: DAY })
    expect((await builds.snapshotServed({ now: new Date('2026-09-27T00:00:00Z') })).sig).toBe(first.sig)
    await writeFile(resolve(origin, 'index.html'), '<html>new front</html>')
    const second = await builds.snapshotServed({ now: new Date('2026-09-28T00:00:00Z') })
    expect(second.sig).not.toBe(first.sig)
    await stage(undefined, 'a')
    await stage(undefined, 'b')          // replaces the stage: collection runs
    await builds.collect()
    const pool = resolve(root, 'pools', builds.sign(builds.BUILDS_MEANING))
    expect(await files(pool)).toEqual(expect.arrayContaining([first.sig, second.sig, first.record.files, second.record.files]))
  })

  it('refuses to serve a file that is not what the snapshot names', async () => {
    const origin = resolve(root, 'origin-host')
    await hostDir(origin)
    await builds.serves(origin)
    const { record: snap } = await builds.snapshotServed({ now: DAY })
    const pool = resolve(root, 'pools', builds.sign(builds.BUILDS_MEANING))
    const front = JSON.parse((await readFile(resolve(pool, snap.files))).toString()).files['index.html']
    await writeFile(resolve(pool, front), '<html>tampered</html>')
    await expect(builds.writeServed(resolve(root, 'out'))).rejects.toThrow(/does not hash/)
  })

  it('says plainly when a pool holds no snapshot to serve', async () => {
    await record(undefined, 'a')
    await expect(builds.writeServed(resolve(root, 'out'))).rejects.toThrow(/never declared what it serves/)
  })
})

describe('pools on hosts', () => {
  it('pushes both pools to a host and pulls them into another device', async () => {
    const first = await record(undefined, 'a')
    await released('beta', 'b')
    const { pubkey } = await builds.signRevision(first.sig, 'author')
    const host = resolve(root, 'host')
    await builds.carryPools(host)
    expect(await builds.carryPools(host)).toBe(0)

    // A static host: `/<pool>/` answers its index.html, `/<pool>/<sig>` the file.
    const served = async (url: string) => {
      const path = new URL(url).pathname.replace(/^\/content/, '')
      const file = resolve(host, '.' + (path.endsWith('/') ? path + 'index.html' : path))
      try { return new Response(await readFile(file)) } catch { return new Response('', { status: 404 }) }
    }
    process.env.HYPERCOMB_POOLS_DIR = resolve(root, 'device')
    const report = await builds.pullPools(['https://example.test'], { fetch: served })
    expect(report).toEqual([{ host: 'https://example.test', answered: true, taken: expect.any(Number), refused: 0 }])
    expect((await builds.revisions()).map((r: { record: { version: string } }) => r.record.version))
      .toEqual(['2026.9.26.2', '2026.9.26.1'])
    expect(await builds.signaturesOf(first.sig, first.record.version)).toEqual([{ role: 'author', pubkey, ok: true }])
    expect((await builds.pullPools(['https://example.test'], { fetch: served }))[0].taken).toBe(0)
  })

  it('refuses a pulled file that does not hash to its name, and keeps the rest', async () => {
    await released(undefined, 'a')
    const host = resolve(root, 'host')
    await builds.carryPools(host)
    const pool = resolve(host, builds.sign(builds.BUILDS_MEANING))
    const victim = (await readdir(pool)).find(n => n !== 'index.html')!
    await writeFile(resolve(pool, victim), 'tampered')
    const served = async (url: string) => {
      const file = resolve(host, '.' + new URL(url).pathname + (url.endsWith('/') ? 'index.html' : ''))
      try { return new Response(await readFile(file)) } catch { return new Response('', { status: 404 }) }
    }
    process.env.HYPERCOMB_POOLS_DIR = resolve(root, 'device')
    const [report] = await builds.pullPools(['https://example.test'], { fetch: served })
    expect(report.refused).toBe(1)
    expect(await readdir(builds.poolDir(builds.BUILDS_MEANING))).not.toContain(victim)
  })

  it('puts the atoms flat and both pools under the pool into R2, skipping what the CDN holds', async () => {
    const first = await record(undefined, 'a')
    await builds.signRevision(first.sig, 'author')
    const builtPool = builds.sign(builds.BUILDS_MEANING)
    const held = [...(await builds.published())[builds.BUILDS_MEANING]]
    const [atom] = first.record.atoms
    const listed = held.find((n: string) => n !== atom)!
    const cdn = async (url: string) => url.endsWith(`/${builtPool}/`) ? new Response(listed + '\n') : new Response('', { status: 404 })
    const puts: string[] = []
    const report = await builds.pushToR2({ fetch: cdn, put: async (key: string) => { puts.push(key) } })
    // every pool member but the listed one, one signature, and the atom flat
    expect(report).toEqual({ uploaded: held.length - 1 + 1 + 1, present: 1, failed: 0 })
    expect(puts).toContain(`hypercomb-content/${atom}`)
    expect(puts).not.toContain(`hypercomb-content/${builtPool}/${listed}`)
    expect(puts.filter(key => key.includes(builds.sign(builds.SIGNATURES_MEANING)))).toHaveLength(1)

    // An atom the CDN already answers is not uploaded again.
    const holds = async (url: string) => url.endsWith(`/${atom}`) ? new Response('') : cdn(url)
    const again = await builds.pushToR2({ fetch: holds, put: async () => {}, dryRun: true })
    expect(again.present).toBe(2)
  })

  it('carries every revision\'s atoms flat into a host directory, where a kernel asks', async () => {
    const one = await released(undefined, 'a')
    const two = await released(undefined, 'b')
    const host = resolve(root, 'host')
    await builds.carryPools(host, { atoms: true })
    for (const atom of [...one.record.atoms, ...two.record.atoms]) {
      expect(builds.sign(await readFile(resolve(host, atom)))).toBe(atom)
    }
    await builds.carryPools(resolve(root, 'bare'))
    expect((await readdir(resolve(root, 'bare'))).filter((n: string) => /^[a-f0-9]{64}$/.test(n)))
      .toEqual([builds.sign(builds.BUILDS_MEANING), builds.sign(builds.SIGNATURES_MEANING)].sort())
  })
})

describe('the offline copy', () => {
  it('backs up every pool and the stage to a folder, and restores a wiped device from it', async () => {
    await record(undefined, 'a')
    await stage('work-in-progress', 'b')
    const keep = resolve(root, 'disk')
    const first = await builds.backup(keep)
    expect(first.refused).toEqual([])
    expect(first.copied).toBeGreaterThan(0)
    // A second backup copies only what is new.
    expect((await builds.backup(keep)).copied).toBe(0)

    const before = { revisions: await builds.revisions(), stage: await builds.readStage() }
    await rm(process.env.HYPERCOMB_POOLS_DIR!, { recursive: true, force: true })
    expect(await builds.revisions()).toEqual([])

    const back = await builds.restore(keep)
    expect(back.refused).toEqual([])
    expect(back.local).toContain('stage.json restored')
    expect(await builds.revisions()).toEqual(before.revisions)
    expect(await builds.readStage()).toEqual(before.stage)
    // Staged work came back too: it is written out exactly.
    const out = resolve(root, 'out')
    await builds.writeOut('work-in-progress', out)
    expect(await readFile(resolve(out, 'main.js'), 'utf8')).toBe('b')
  })

  it('refuses a backed-up file that is not what it is named, and never overwrites newer local state', async () => {
    await record(undefined, 'a')
    const keep = resolve(root, 'disk')
    await builds.backup(keep)
    const pool = builds.sign(builds.BUILDS_MEANING)
    const [victim] = await files(resolve(keep, pool))
    await writeFile(resolve(keep, pool, victim!), 'tampered')
    await rm(resolve(process.env.HYPERCOMB_POOLS_DIR!, pool), { recursive: true, force: true })

    const back = await builds.restore(keep)
    expect(back.refused).toEqual([`${pool.slice(0, 12)}/${victim}`])
    expect(await files(resolve(process.env.HYPERCOMB_POOLS_DIR!, pool))).not.toContain(victim)
    expect(back.local).toEqual(['stage.json kept (this device has its own)'])
  })
})
