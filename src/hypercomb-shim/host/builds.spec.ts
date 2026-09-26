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
    const { pubkey } = await builds.signRevision(first.sig, 'reviewer')
    const pool = builds.poolDir(builds.SIGNATURES_MEANING)
    const file = resolve(pool, first.sig, 'reviewer', pubkey)
    const event = JSON.parse(await readFile(file, 'utf8'))
    await writeFile(file, JSON.stringify({ ...event, content: event.content.replace('reviewer', 'author') }))
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
