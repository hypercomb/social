// @vitest-environment node
//
// publish.spec.ts — a publish says what the public install host still owes.
//
// From 2026-09-30 to 10-09 hypercomb.com's packages pool lagged the signed
// `install:essentials`, and nothing in the publish said so. These pin the
// check that now runs after the stamp: read hypercomb.com's pool head the way
// a cold client does, and print the exact restage step when it is not the
// root just stamped. Nothing here deploys anything.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { PUBLIC_INSTALL_HOST, RESTAGE_STEP, hostPoolHead, seedVerdict } from './publish.js'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
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

describe('hostPoolHead — read the way a cold client reads it', () => {
  it('finds the head under /content past an apex that answers with its page', async () => {
    expect(await hostPoolHead('hypercomb.com', hypercombCom(STALE))).toEqual({ answered: true, head: STALE })
  })

  it('says the host did not answer when no base responds', async () => {
    const offline = vi.fn(async () => { throw new TypeError('fetch failed') })
    expect(await hostPoolHead('hypercomb.com', offline)).toEqual({ answered: false, head: null })
  })
})

describe('seedVerdict — the restage step a publish owes', () => {
  it('is quiet when the host already offers the stamped root', () => {
    const verdict = seedVerdict(STAMPED, { answered: true, head: STAMPED })
    expect(verdict.state).toBe('current')
    expect(verdict.lines.join('\n')).not.toMatch(/RESTAGE/)
  })

  it('names the stale head, the new root and the exact step when the host lags', () => {
    const verdict = seedVerdict(STAMPED, { answered: true, head: STALE })
    const text = verdict.lines.join('\n')
    expect(verdict.state).toBe('behind')
    expect(text).toMatch(/RESTAGE OWED/)
    expect(text).toContain(STALE.slice(0, 12))
    expect(text).toContain(`install:essentials is now ${STAMPED.slice(0, 12)}`)
    expect(text).toContain(RESTAGE_STEP)
  })

  it('still prints the step when the host could not be read', () => {
    const verdict = seedVerdict(STAMPED, { answered: false, head: null })
    expect(verdict.state).toBe('unknown')
    expect(verdict.lines.join('\n')).toMatch(/RESTAGE UNCONFIRMED[\s\S]*npm run deploy:hypercomb\.com/)
  })
})

describe('the step and the host are the real ones', () => {
  it('checks the host a cold install reads — the public install\'s one host', () => {
    // Read as text: the scripts compile without the browser globals runtime declares.
    const zones = readFileSync(resolve(SRC, 'hypercomb-runtime', 'src', 'host-zones.ts'), 'utf8')
      .match(/export const DEFAULT_HOST_ZONES: readonly string\[\] = \[([^\]]*)\]/)?.[1]
    expect(zones?.split(',').map(zone => zone.trim().replace(/^'|'$/g, ''))).toEqual([PUBLIC_INSTALL_HOST])
  })

  it('prints a script that exists and stages the SIGNED root', () => {
    const scripts = JSON.parse(readFileSync(resolve(SRC, 'package.json'), 'utf8')).scripts as Record<string, string>
    const script = RESTAGE_STEP.replace(/^npm run /, '')
    expect(scripts[script]).toMatch(/deploy-azure\.cjs/)
    const deploy = readFileSync(resolve(SRC, 'scripts', 'presentation', 'deploy-azure.cjs'), 'utf8')
    expect(deploy).toMatch(/stage-signed-package\.mjs/)
  })
})
