// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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

const record = (label: string | undefined, main: string, now = DAY) => {
  const atom = b('atom:' + main)
  return builds.recordBuild({
    label, now, signed: [atom],
    install: new Map([['main.js', b(main)], ['index.html', b('<html>')]]),
    source: new Map([['src/main.ts', b('// ' + main)]]),
    host: builds.sign(atom), library: 'l'.repeat(64), hostPackage: 'p'.repeat(64),
  })
}

describe('version pool', () => {
  it('makes every build a revision, numbered by the day, under its name', async () => {
    const one = await record(undefined, 'a')
    const two = await record(undefined, 'a')
    const three = await record('Beta Line', 'b')
    const four = await record(undefined, 'b', new Date('2026-10-01T00:00:00Z'))
    expect([one, two, three, four].map(r => `${r.record.label} ${r.record.version}`))
      .toEqual(['host 2026.9.26.1', 'host 2026.9.26.2', 'beta-line 2026.9.26.3', 'host 2026.10.1.1'])
    expect(two.unchanged).toBe(true)
    expect(two.record.parent).toBe(one.sig)
    const { parts, files } = await builds.changesOf(builds.poolDir(builds.BUILDS_MEANING), three.record)
    expect(parts).toEqual(['install', 'host', 'source'])
    expect(files.install).toEqual(['~ main.js'])
  })

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
    await record('rebuilt', 'a')
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

describe('pools on hosts', () => {
  it('pushes both pools to a host and pulls them into another device', async () => {
    const first = await record(undefined, 'a')
    await record('beta', 'b')
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
    await record(undefined, 'a')
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
    const held = (await readdir(builds.poolDir(builds.BUILDS_MEANING))).filter((n: string) => /^[a-f0-9]{64}$/.test(n))
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
    const one = await record(undefined, 'a')
    const two = await record(undefined, 'b')
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
