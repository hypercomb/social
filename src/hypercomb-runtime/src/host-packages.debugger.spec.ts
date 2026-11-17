// host-packages.debugger.spec.ts — the debugger's package is never a door's head.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerPoolMeaning } from '@hypercomb/core'
import { _resetSettledBases, debuggerPoolPackage, headPackage, isDebuggerPackage } from './host-packages'
import { HOST_PACKAGES_MEANING, poolEntryName } from './host-pool'

const SIG_A = 'a'.repeat(64)
const SIG_B = 'b'.repeat(64)
const SIG_C = 'c'.repeat(64)

const serving = (routes: Record<string, string>) =>
  vi.fn(async (url: string) => {
    const body = routes[String(url).replace(/\?held$/, '')]
    if (body === undefined) return { ok: false, status: 404, headers: new Headers() } as unknown as Response
    return { ok: true, status: 200, headers: new Headers(), text: async () => body } as unknown as Response
  })

/** Members as `<root>\n<label>`, oldest first. */
const poolAt = async (base: string, members: string[]): Promise<Record<string, string>> => {
  const pool = await registerPoolMeaning(HOST_PACKAGES_MEANING)
  return {
    [`${base}/${pool}/`]: members.map((_, i) => poolEntryName(i)).join('\n'),
    ...Object.fromEntries(members.map((member, i) => [`${base}/${pool}/${poolEntryName(i)}`, member])),
  }
}

beforeEach(() => { _resetSettledBases(); vi.unstubAllGlobals() })

describe('the debugger package', () => {
  it('is named by its member label, folded', () => {
    expect(isDebuggerPackage({ label: 'debugger' })).toBe(true)
    expect(isDebuggerPackage({ label: ' Debugger ' })).toBe(true)
    expect(isDebuggerPackage({ label: 'essentials' })).toBe(false)
    expect(isDebuggerPackage(null)).toBe(false)
  })

  it('is passed by when it is the newest member: the head is the newest other one', async () => {
    vi.stubGlobal('fetch', serving(await poolAt('https://host.example', [
      `${SIG_A}\nessentials`, `${SIG_B}\nessentials`, `${SIG_C}\ndebugger`,
    ])))
    expect((await headPackage('host.example'))?.packageSig).toBe(SIG_B)
  })

  it('leaves the head alone when the newest member is not the debugger', async () => {
    vi.stubGlobal('fetch', serving(await poolAt('https://host.example', [`${SIG_C}\ndebugger`, `${SIG_A}\nessentials`])))
    expect((await headPackage('host.example'))?.packageSig).toBe(SIG_A)
  })

  it('a pool holding only debugger members has no head', async () => {
    vi.stubGlobal('fetch', serving(await poolAt('https://host.example', [`${SIG_C}\ndebugger`])))
    expect(await headPackage('host.example')).toBeNull()
  })

  it('the debugger door finds the newest debugger member', async () => {
    vi.stubGlobal('fetch', serving(await poolAt('https://host.example', [
      `${SIG_A}\ndebugger`, `${SIG_C}\ndebugger`, `${SIG_B}\nessentials`,
    ])))
    expect((await debuggerPoolPackage('host.example'))?.packageSig).toBe(SIG_C)
  })

  it('a pool with no debugger member names none', async () => {
    vi.stubGlobal('fetch', serving(await poolAt('https://host.example', [`${SIG_A}\nessentials`])))
    expect(await debuggerPoolPackage('host.example')).toBeNull()
  })
})
