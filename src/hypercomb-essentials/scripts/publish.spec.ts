// @vitest-environment node
//
// publish.spec.ts — a publish leaves the public install host current, or says
// exactly what it still owes.
//
// From 2026-09-30 to 10-09, and twice more on 10-11, hypercomb.com's packages
// pool lagged the signed `install:essentials`: the stamp moved the index, but
// the bytes reached the host only when someone redeployed its whole site. These
// pin the steps that now run around the stamp — the host takes the new root's
// whole package BEFORE it (replicate-public-host.ts), and its pool is read back
// after — and what a publish says when either could not.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { EXIT_HOST_BEHIND, confirmOnPublicHost, pullToPublicHost, typescriptToPublicHost } from './publish.js'
import { PUBLIC_INSTALL_HOST, REPLICATE_STEP, hostPoolHead, type ReplicationReport, type TypescriptReport } from './replicate-public-host.js'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPTS = dirname(fileURLToPath(import.meta.url))
const POOL = createHash('sha256').update('host:packages', 'utf8').digest('hex')
const STAMPED = 'a'.repeat(64)
const STALE = 'b'.repeat(64)

/** hypercomb.com as it answers today: the apex is a static site that answers
 *  every unknown path with its page; the pool lives under /content. */
const hypercombCom = (head: string) => vi.fn(async (url: string) => {
  const routes: Record<string, string> = {
    [`https://hypercomb.com/content/${POOL}/`]: '00000000\n',
    [`https://hypercomb.com/content/${POOL}/00000000`]: `${head}\nessentials`,
  }
  const body = routes[url] ?? (url.startsWith('https://hypercomb.com/') ? '<!doctype html><html></html>' : undefined)
  return body === undefined
    ? { ok: false, status: 404, text: async () => '' }
    : { ok: true, status: 200, text: async () => body }
})

const report = (over: Partial<ReplicationReport> = {}): ReplicationReport => ({
  host: 'hypercomb.com', root: STAMPED, stage: 'done',
  local: { atoms: 3, holes: [], refused: [], limited: false },
  copied: [], held: 3, copiedBytes: 0, failed: [], head: STAMPED, answered: true, rootServed: true, ok: true,
  ...over,
})

describe('hostPoolHead — read the way a cold client reads it', () => {
  it('finds the head under /content past an apex that answers with its page', async () => {
    expect(await hostPoolHead('hypercomb.com', hypercombCom(STALE))).toEqual({ answered: true, head: STALE })
  })

  it('says the host did not answer when no base responds', async () => {
    const offline = vi.fn(async () => { throw new TypeError('fetch failed') })
    expect(await hostPoolHead('hypercomb.com', offline)).toEqual({ answered: false, head: null })
  })
})

describe('pullToPublicHost — before the stamp', () => {
  it('pulls the root about to be stamped onto the public install host, whole', async () => {
    const replicate = vi.fn(async () => report({ stage: 'pulled', head: null, rootServed: false }))
    const lines: string[] = []
    const pulled = await pullToPublicHost({ name: 'essentials', channel: 'essentials', root: STAMPED },
      { host: 'hypercomb.com', replicate, log: line => lines.push(line) })
    expect(pulled).toEqual({ host: 'hypercomb.com', ok: true })
    expect(replicate).toHaveBeenCalledWith({ root: STAMPED, host: 'hypercomb.com', stage: 'pull' })
    expect(lines.join('\n')).toMatch(/hypercomb\.com holds aaaaaaaaaaaa…'s whole package — the stamp may name it/)
  })

  it('a pull that does not finish means nothing is announced — never "the stamp stands"', async () => {
    const lines: string[] = []
    const behind = report({ stage: 'atoms', ok: false, held: 1, failed: [{ sig: 'c'.repeat(64), why: 'HTTP 404' }], head: null })
    const pulled = await pullToPublicHost({ name: 'essentials', channel: 'essentials', root: STAMPED },
      { host: 'hypercomb.com', replicate: async () => behind, log: line => lines.push(line) })
    expect(pulled.ok).toBe(false)
    const text = lines.join('\n')
    expect(text).toMatch(/NOTHING WAS ANNOUNCED — hypercomb\.com could not take the package first/)
    expect(text).toMatch(/could not take 1 atom\(s\) \(first: cccccccccccc… — HTTP 404\)/)
    expect(text).toMatch(/install:essentials still names the previous package/)
    expect(text).toMatch(/HYPERCOMB_PUBLIC_INSTALL_HOST=none/)
    expect(text).not.toMatch(/stamp stands/)
  })

  it('a host whose worker has no farm yet says where to look', async () => {
    const lines: string[] = []
    const none = report({ stage: 'atoms', ok: false, held: 0, failed: [{ sig: 'c'.repeat(64), why: 'HTTP 404' }], head: null })
    await pullToPublicHost({ name: 'essentials', channel: 'essentials', root: STAMPED },
      { host: 'hypercomb.com', replicate: async () => none, log: line => lines.push(line) })
    expect(lines.join('\n')).toMatch(/is its worker deployed with a farm\?/)
  })

  it('pulls only for the channel the host installs, and nothing when the host is configured away', async () => {
    const replicate = vi.fn(async () => report())
    expect(await pullToPublicHost({ name: 'beta', channel: 'essentials', root: STAMPED }, { host: 'hypercomb.com', replicate, log: () => {} })).toEqual({ host: null, ok: true })
    expect(await pullToPublicHost({ name: 'essentials', channel: 'essentials', root: null }, { host: 'hypercomb.com', replicate, log: () => {} })).toEqual({ host: null, ok: true })
    const lines: string[] = []
    expect(await pullToPublicHost({ name: 'essentials', channel: 'essentials', root: STAMPED }, { host: null, replicate, log: line => lines.push(line) })).toEqual({ host: null, ok: true })
    expect(replicate).not.toHaveBeenCalled()
    expect(lines.join('\n')).toMatch(/HYPERCOMB_PUBLIC_INSTALL_HOST names no host/)
  })
})

describe('confirmOnPublicHost — after the stamp', () => {
  it('reads the pool back and owes nothing when it names the stamped root', async () => {
    const replicate = vi.fn(async () => report())
    const lines: string[] = []
    expect(await confirmOnPublicHost({ host: 'hypercomb.com', root: STAMPED, channel: 'essentials' }, { replicate, log: line => lines.push(line) })).toBe(0)
    expect(replicate).toHaveBeenCalledWith({ root: STAMPED, host: 'hypercomb.com', stage: 'confirm' })
    expect(lines.join('\n')).toMatch(/hypercomb\.com offers aaaaaaaaaaaa… to cold installs — current/)
  })

  it('exits 3 with the retry when the pool has not moved — and the stamp stands', async () => {
    const lines: string[] = []
    const behind = report({ stage: 'pool', ok: false, head: STALE })
    expect(await confirmOnPublicHost({ host: 'hypercomb.com', root: STAMPED, channel: 'essentials' },
      { replicate: async () => behind, log: line => lines.push(line) })).toBe(EXIT_HOST_BEHIND)
    expect(EXIT_HOST_BEHIND).toBe(3)
    const text = lines.join('\n')
    expect(text).toMatch(/REPLICATION UNCONFIRMED — hypercomb\.com holds the package, but its pool still offers bbbbbbbbbbbb…/)
    expect(text).toContain(`install:essentials is ${STAMPED.slice(0, 12)}`)
    expect(text).toMatch(/The stamp stands/)
    expect(text).toContain(`${REPLICATE_STEP} -- --sig ${STAMPED}`)
  })

  it('confirms nothing when nothing was pulled', async () => {
    const replicate = vi.fn(async () => report())
    expect(await confirmOnPublicHost({ host: null, root: STAMPED, channel: 'essentials' }, { replicate, log: () => {} })).toBe(0)
    expect(replicate).not.toHaveBeenCalled()
  })
})

describe('typescriptToPublicHost — last, and never an exit code', () => {
  const typed = (over: Partial<TypescriptReport> = {}): TypescriptReport => ({
    host: 'hypercomb.com', root: STAMPED, named: 2, absentHere: [], copied: ['c'.repeat(64)], copiedBytes: 2048, held: 1, failed: [], head: null, headRead: false, answered: false, timedOut: 0, stopped: false, ok: true,
    ...over,
  })

  it('asks the host for the revision\'s source atoms and says what it holds', async () => {
    const typescript = vi.fn(async () => typed())
    const lines: string[] = []
    await typescriptToPublicHost({ host: 'hypercomb.com', root: STAMPED, current: true }, { typescript, log: line => lines.push(line) })
    expect(typescript).toHaveBeenCalledWith({ root: STAMPED, host: 'hypercomb.com', current: true })
    expect(lines).toEqual(['[replicate] TypeScript: hypercomb.com holds 2 of 2 source atom(s) of aaaaaaaaaaaa… — 1 copied from its farm (2.0 KB), 1 already held'])
  })

  it('a host that took none, or a step that throws, changes no exit code and throws nothing', async () => {
    const before = process.exitCode
    const lines: string[] = []
    const none = typed({ ok: false, copied: [], copiedBytes: 0, held: 0, failed: [{ sig: 'c'.repeat(64), why: 'HTTP 404' }, { sig: 'd'.repeat(64), why: 'HTTP 404' }] })
    await expect(typescriptToPublicHost({ host: 'hypercomb.com', root: STAMPED }, { typescript: async () => none, log: line => lines.push(line) })).resolves.toBeUndefined()
    expect(lines.join('\n')).toMatch(/TYPESCRIPT NOT HOSTED/)
    await expect(typescriptToPublicHost({ host: 'hypercomb.com', root: STAMPED }, { typescript: async () => { throw new Error('boom') }, log: () => {} })).resolves.toBeUndefined()
    await expect(typescriptToPublicHost({ host: 'hypercomb.com', root: STAMPED }, { typescript: async () => typed(), log: () => { throw new Error('no console') } })).resolves.toBeUndefined()
    expect(process.exitCode).toBe(before)
  })

  it('a host the confirm found behind is told so: the pass says the host is not on this root, not that its worker is missing', async () => {
    const refused = [{ sig: 'c'.repeat(64), why: 'HTTP 404' }, { sig: 'd'.repeat(64), why: 'HTTP 404' }]
    const typescript = vi.fn(async (options: { current?: boolean }) => typed({
      ok: false, copied: [], copiedBytes: 0, held: 0, failed: refused, head: 'b'.repeat(64), headRead: true, answered: true, current: options.current,
    }))
    const lines: string[] = []
    await typescriptToPublicHost({ host: 'hypercomb.com', root: STAMPED, current: false }, { typescript, log: line => lines.push(line) })
    expect(typescript).toHaveBeenCalledWith({ root: STAMPED, host: 'hypercomb.com', current: false })
    const text = lines.join('\n')
    expect(text).toMatch(/hypercomb\.com is not on this root yet \(its pool offers bbbbbbbbbbbb…\)/)
    expect(text).not.toMatch(/worker|Deploy/)
    // The publish hands over what its confirm read, and nothing it did not.
    const publish = readFileSync(resolve(SCRIPTS, 'publish.ts'), 'utf8')
    expect(publish).toContain('await typescriptToPublicHost({ host: pulled.host, root, current: owed === 0 })')
  })

  it('asks nothing when no public host took the revision, and says nothing when there is no root', async () => {
    const typescript = vi.fn(async () => typed())
    const lines: string[] = []
    await typescriptToPublicHost({ host: null, root: STAMPED }, { typescript, log: line => lines.push(line) })
    expect(lines).toEqual([expect.stringMatching(/its TypeScript is hosted on this machine's host only/)])
    await typescriptToPublicHost({ host: 'hypercomb.com', root: null }, { typescript, log: line => lines.push(line) })
    expect(lines).toHaveLength(1)
    expect(typescript).not.toHaveBeenCalled()
  })

  it('runs after everything that decides the publish\'s outcome', () => {
    const publish = readFileSync(resolve(SCRIPTS, 'publish.ts'), 'utf8')
    const main = publish.slice(publish.indexOf('async function main('))
    const last = main.indexOf('await typescriptToPublicHost(')
    expect(last).toBeGreaterThan(main.indexOf('process.exitCode = owed'))
    expect(last).toBeGreaterThan(main.indexOf('PUBLISHED under'))
    // Nothing after it but the end of main: no exit, no exit code.
    expect(main.slice(last, main.indexOf('/** Run only as a script'))).not.toMatch(/process\.exit/)
  })
})

describe('the step and the host are the real ones', () => {
  it('replicates to the host a cold install reads — the public install\'s one host', () => {
    // Read as text: the scripts compile without the browser globals runtime declares.
    const zones = readFileSync(resolve(SRC, 'hypercomb-runtime', 'src', 'host-zones.ts'), 'utf8')
      .match(/export const DEFAULT_HOST_ZONES: readonly string\[\] = \[([^\]]*)\]/)?.[1]
    expect(zones?.split(',').map(zone => zone.trim().replace(/^'|'$/g, ''))).toEqual([PUBLIC_INSTALL_HOST])
  })

  it('names that host in one place in the publish pipeline', () => {
    for (const file of ['publish.ts', 'stamp-install-channel.ts', 'copy-content.ts', 'replicate-public-host.ts']) {
      const code = readFileSync(resolve(SCRIPTS, file), 'utf8')
      const named = code.match(/['"`]hypercomb\.com['"`]/g) ?? []
      expect(named.length, file).toBe(file === 'replicate-public-host.ts' ? 1 : 0)
    }
  })

  it('prints a script that exists and replicates — never a deploy that builds from the working tree', () => {
    const scripts = JSON.parse(readFileSync(resolve(SRC, 'package.json'), 'utf8')).scripts as Record<string, string>
    const script = REPLICATE_STEP.replace(/^npm run /, '')
    expect(scripts[script]).toBe('npm --prefix hypercomb-essentials run replicate:revision --')
    const essentials = JSON.parse(readFileSync(resolve(SRC, 'hypercomb-essentials', 'package.json'), 'utf8')).scripts as Record<string, string>
    expect(essentials['replicate:revision']).toBe('tsx ./scripts/replicate-public-host.ts')
    const replicate = readFileSync(resolve(SCRIPTS, 'replicate-public-host.ts'), 'utf8')
    expect(replicate).not.toMatch(/spawnSync|execSync|deploy-azure|build-module/)
  })

  it('pulls before the stamp, stops before it when the pull fails, and only reads the pool after it', () => {
    const publish = readFileSync(resolve(SCRIPTS, 'publish.ts'), 'utf8')
    const main = publish.slice(publish.indexOf('async function main('))
    const ship = main.indexOf("run('ship', 'copy-content.ts'")
    const pull = main.indexOf('await pullToPublicHost(')
    const stop = main.indexOf('if (!pulled.ok)')
    const stamp = main.indexOf("run('announce', 'stamp-install-channel.ts'")
    const confirm = main.indexOf('await confirmOnPublicHost(')
    for (const at of [ship, pull, stop, stamp, confirm]) expect(at).toBeGreaterThan(-1)
    // ship → pull → (stop: nothing announced) → stamp → confirm
    expect([ship, pull, stop, stamp, confirm]).toEqual([...[ship, pull, stop, stamp, confirm]].sort((a, b) => a - b))
    expect(main.slice(stop, stamp)).toMatch(/nothing was announced[\s\S]*process\.exit\(1\)/)
    // A pool behind after the stamp is exit 3 — exit 1 stays "nothing was announced".
    expect(main).toMatch(/process\.exitCode = owed/)
    expect(main.indexOf('PUBLISHED under')).toBeLessThan(main.indexOf('process.exitCode = owed'))
  })
})
