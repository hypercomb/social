// community-lens.demo.spec.ts — the lens checked in process, against real local
// hosts that each misbehave in a different way.
//
// Nine HTTP servers stand in for nine domains, named as subdomains
// (`honest.localhost:<port>`). Node cannot resolve `*.localhost` here (browsers
// can), so a fetch shim in this file maps the name to 127.0.0.1 and keeps the
// port; the lens code under test sees the subdomain names and nothing else.
// Each host serves `/publications.json` (its ledger) and, where it has one, the
// publisher's signed hive index at `/<sign('hive:indexes')>/<pubkey>`. The
// indexes are REAL kind-30564 events signed with throwaway keys, so the check
// that runs is the shipped `fetchHiveIndex` verification, not a stub.
//
// VARIATIONS — what each host does, and what the lens must conclude:
//
//   honest     ledger and signed index agree                   -> verified
//   noindex    ledger only, no signed index (404)              -> kept, unverified
//   liar       ledger names a head the signed index does not   -> unverified
//   invented   ledger carries a row the signed index lacks     -> that row unverified
//   forged     index content altered after signing             -> unverified
//   impostor   index signed by a key that is not the publisher -> unverified
//   spa        answers every path with the app page            -> gap
//   silent     never answers                                   -> gap (timeout)
//   quiet      ledger omits a row the index holds              -> not seen (named limit)
//
// Set LENS_DEMO_OUT to a file path to write the result table as markdown.

import { createServer, type Server } from 'node:http'
import { writeFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { registerPoolMeaning } from '@hypercomb/core'
import { HIVE_INDEX_EVENT_KIND } from './hive-link.js'
import { readLedgerLens, type LensResult } from './community-lens.js'
import { defineDomainGroup, readPortal } from './community-portal.js'

const SIG = (seed: string): string => seed.repeat(64).slice(0, 64)
const JAZZ = SIG('1')
const MUSIC = SIG('2')
const BLUES = SIG('3')
const FAKE = SIG('9')

const publisherKey = generateSecretKey()
const publisher = getPublicKey(publisherKey)
const otherKey = generateSecretKey()

const site = (lineage: string, head: string) => ({
  host: 'demo.localhost', url: 'http://demo.localhost/', hosts: [], title: lineage, lineage,
  publishers: [{ pubkey: publisher, label: 'demo', primary: true, head, publishedAt: 1 }],
})
const ledgerOf = (...rows: [string, string][]) => JSON.stringify({ sites: rows.map(([lineage, head]) => site(lineage, head)) })

const signedIndex = (roots: Record<string, string>, secret = publisherKey) =>
  finalizeEvent({ kind: HIVE_INDEX_EVENT_KIND, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify({ roots }) }, secret)

const TRUTH = { 'music/jazz': JAZZ, music: MUSIC }
const tampered = (() => { const evt = signedIndex(TRUTH); return { ...evt, content: JSON.stringify({ roots: { ...TRUTH, music: FAKE } }) } })()

type Behaviour = { ledger?: string | 'hang' | 'page'; index?: object | 'absent' }

const BEHAVIOURS: Record<string, Behaviour> = {
  honest: { ledger: ledgerOf(['music/jazz', JAZZ], ['music', MUSIC]), index: signedIndex(TRUTH) },
  noindex: { ledger: ledgerOf(['music/jazz', JAZZ], ['music', MUSIC]), index: 'absent' },
  liar: { ledger: ledgerOf(['music/jazz', FAKE], ['music', MUSIC]), index: signedIndex(TRUTH) },
  invented: { ledger: ledgerOf(['music/jazz', JAZZ], ['music', MUSIC], ['music/blues', BLUES]), index: signedIndex(TRUTH) },
  forged: { ledger: ledgerOf(['music/jazz', JAZZ], ['music', MUSIC]), index: tampered },
  impostor: { ledger: ledgerOf(['music/jazz', JAZZ], ['music', MUSIC]), index: signedIndex(TRUTH, otherKey) },
  spa: { ledger: 'page', index: 'absent' },
  silent: { ledger: 'hang', index: 'absent' },
  quiet: { ledger: ledgerOf(['music/jazz', JAZZ]), index: signedIndex(TRUTH) },
}

const servers: Server[] = []
const hostOf: Record<string, string> = {}
let indexPath = ''
const realFetch = globalThis.fetch

beforeAll(async () => {
  indexPath = `/${await registerPoolMeaning('hive:indexes')}/${publisher}`
  for (const [name, behaviour] of Object.entries(BEHAVIOURS)) {
    const server = createServer((req, res) => {
      const url = req.url ?? ''
      if (url === '/publications.json') {
        if (behaviour.ledger === 'hang') return
        if (behaviour.ledger === 'page') { res.writeHead(200, { 'content-type': 'text/html' }); return void res.end('<!doctype html><html></html>') }
        res.writeHead(200, { 'content-type': 'application/json' }); return void res.end(behaviour.ledger ?? '{}')
      }
      if (url === indexPath && behaviour.index && behaviour.index !== 'absent') {
        res.writeHead(200, { 'content-type': 'application/json' }); return void res.end(JSON.stringify(behaviour.index))
      }
      if (behaviour.ledger === 'page') { res.writeHead(200, { 'content-type': 'text/html' }); return void res.end('<!doctype html><html></html>') }
      res.writeHead(404); res.end('not found')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    servers.push(server)
    hostOf[name] = `${name}.localhost:${(server.address() as { port: number }).port}`
  }
  // `*.localhost` does not resolve in Node here; browsers resolve it to loopback.
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    realFetch(String(input).replace(/^(https?:\/\/)[a-z0-9-]+\.localhost(:\d+)/, '$1127.0.0.1$2'), init)) as typeof fetch
})

afterAll(() => {
  globalThis.fetch = realFetch
  for (const server of servers) { server.closeAllConnections(); server.close() }
})

const WORDS = ['music', 'jazz']
const names = Object.keys(BEHAVIOURS)
const summary = (r: LensResult) =>
  r.points.map(p => `${p.paths?.join(',')}:${p.verified ? 'verified' : 'unverified'}`).sort()
const read = (name: string, verify = true): Promise<LensResult> =>
  readLedgerLens({ hosts: [hostOf[name]], words: WORDS, verify, timeoutMs: 400 })

describe('lens against variations (real local hosts)', () => {
  it('honest: every row verified', async () => {
    expect(summary(await read('honest'))).toEqual(['music/jazz:verified', 'music:verified'])
  })
  it('noindex: rows kept, none verified', async () => {
    expect(summary(await read('noindex'))).toEqual(['music/jazz:unverified', 'music:unverified'])
  })
  it('liar: the row whose head the signed index does not name is unverified', async () => {
    const r = await read('liar')
    expect(summary(r)).toEqual(['music/jazz:unverified', 'music:verified'])
    expect(r.points.find(p => p.paths?.includes('music/jazz'))?.sig).toBe(FAKE)
  })
  it('invented: only the extra row is unverified', async () => {
    expect(summary(await read('invented'))).toEqual(['music/blues:unverified', 'music/jazz:verified', 'music:verified'])
  })
  it('forged: an index altered after signing verifies nothing', async () => {
    expect(summary(await read('forged'))).toEqual(['music/jazz:unverified', 'music:unverified'])
  })
  it('impostor: an index signed by another key verifies nothing', async () => {
    expect(summary(await read('impostor'))).toEqual(['music/jazz:unverified', 'music:unverified'])
  })
  it('spa and silent hosts are gaps, not errors', async () => {
    for (const name of ['spa', 'silent']) {
      const r = await read(name)
      expect(r.points).toEqual([])
      expect(new Set(r.answers.map(a => a.status))).toEqual(new Set(['gap']))
    }
  })
  it('quiet: a row the ledger omits is not seen even though the index holds it (named limit)', async () => {
    expect(summary(await read('quiet'))).toEqual(['music/jazz:verified'])
  })
  it('without verify, no point carries a verdict', async () => {
    expect((await read('honest', false)).points.every(p => !('verified' in p))).toBe(true)
  })
})

describe('portals: fixed groups read through filtered lenses', () => {
  it('a group is the same however its hosts were typed', async () => {
    const a = await defineDomainGroup('Demo', [hostOf.honest, hostOf.liar])
    const b = await defineDomainGroup(' demo ', [`https://${hostOf.liar}/`, hostOf.honest.toUpperCase(), hostOf.honest])
    expect(b.signature).toBe(a.signature)
    expect(b.hosts).toEqual(a.hosts)
    expect(Object.isFrozen(a.hosts)).toBe(true)
    await expect(defineDomainGroup('', [hostOf.honest])).rejects.toThrow()
    await expect(defineDomainGroup('x', [])).rejects.toThrow()
  })

  it('a different name is a different group over the same domains', async () => {
    const a = await defineDomainGroup('one', [hostOf.honest])
    const b = await defineDomainGroup('two', [hostOf.honest])
    expect(a.signature).not.toBe(b.signature)
  })

  it('variations narrow the same group without changing it', async () => {
    const group = await defineDomainGroup('everyone', names.map(name => hostOf[name]))
    const all = await readPortal(group, { words: WORDS, timeoutMs: 400 })
    const trusted = await readPortal(group, { words: WORDS, timeoutMs: 400, filter: { verifiedOnly: true } })
    const both = await readPortal(group, { words: WORDS, timeoutMs: 400, filter: { verifiedOnly: true, minWords: 2 } })
    const without = await readPortal(group, { words: WORDS, timeoutMs: 400, filter: { except: [hostOf.honest] } })
    const only = await readPortal(group, { words: WORDS, timeoutMs: 400, filter: { only: [hostOf.honest, 'not-in-the-group.example'] } })

    expect(all.asked).toHaveLength(names.length)
    expect(trusted.points.every(p => p.verified === true)).toBe(true)
    expect(trusted.points.length).toBeLessThan(all.points.length)
    expect(trusted.hidden).toBe(all.points.length - trusted.points.length)
    expect(both.points.every(p => p.words.length === 2)).toBe(true)
    expect(without.asked).not.toContain(hostOf.honest)
    expect(only.asked).toEqual([hostOf.honest])
    expect(group.hosts).toHaveLength(names.length)

    if (process.env.LENS_DEMO_OUT) {
      const rows = await Promise.all(names.map(async name => {
        const r = await read(name)
        const verdicts = r.points.length ? summary(r).join('<br>') : '(nothing seen)'
        const status = [...new Set(r.answers.map(a => a.status))].join('/')
        return `| ${name} | ${status} | ${verdicts} |`
      }))
      writeFileSync(process.env.LENS_DEMO_OUT, [
        '| host | answer | rows the lens saw |', '|---|---|---|', ...rows, '',
        `portal "${group.name}" ${group.signature.slice(0, 12)}…: ${all.points.length} points over ${all.asked.length} hosts`,
        `verified only: ${trusted.points.length} (hidden ${trusted.hidden}) · both words + verified: ${both.points.length} · except honest: ${without.asked.length} hosts · only honest: ${only.points.length} points`,
      ].join('\n'))
    }
  })
})
