// scripts/hive-say-door.spec.ts — a sentence said at a door with no command
// line, from the function hive-say evaluates in the door's page to the door's
// own listener and back.
//
// The page function is run here against the real bus and the real headless
// door (hypercomb-shared/ui/command-line/remote-door.headless.ts), so the two
// halves are proven to speak one contract. The browser between them is not.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('@hypercomb/core', async original => ({
  ...(await original<typeof import('@hypercomb/core')>()),
  hypercomb: class { act = vi.fn(async () => {}) },
}))

await import('@hypercomb/core')
const { installHeadlessRemoteDoor } = await import('../hypercomb-shared/ui/command-line/remote-door.headless')
const { sayAtDoor } = createRequire(import.meta.url)('./hive-say-door.cjs') as {
  sayAtDoor(input: { text: string; deadlineMs: number }): Promise<{ kind: string; reason?: string; actions?: unknown[] }>
}

let ran: Array<[string, string]>
let off: (() => void) | undefined

beforeEach(() => {
  ran = []
  const behaviours = {
    entries: () => [
      { name: 'go' },
      { name: 'slow' },
      { name: 'remove', machine: { reach: 'destructive', scope: 'page' } },
    ],
    has: (name: string) => ['go', 'slow', 'remove'].includes(name),
    execute: async (name: string, args: string) => {
      if (name === 'slow') await new Promise(() => {})
      ran.push([name, args])
    },
  }
  ;(globalThis as { ioc?: unknown }).ioc = {
    get: (key: string) => key === '@diamondcoreprocessor.com/SlashBehaviourDrone' ? behaviours : undefined,
  }
})

afterEach(() => {
  off?.()
  off = undefined
  delete (globalThis as { ioc?: unknown }).ioc
})

describe('a sentence said at a door', () => {
  it('runs a behaviour word and comes back with what ran', async () => {
    off = installHeadlessRemoteDoor()
    expect(await sayAtDoor({ text: '/go /meetings', deadlineMs: 2000 })).toEqual({
      kind: 'ran', actions: [{ command: 'go', args: '/meetings', ok: true }],
    })
    expect(ran).toEqual([['go', '/meetings']])
  })

  it('carries the gate’s refusal back, and nothing runs', async () => {
    off = installHeadlessRemoteDoor()
    expect((await sayAtDoor({ text: '/remove drafts', deadlineMs: 2000 })).kind).toBe('refused')
    expect(ran).toEqual([])
  })

  it('says so when nothing on the page hears a machine’s sentence', async () => {
    const outcome = await sayAtDoor({ text: '/go /x', deadlineMs: 2000 })
    expect(outcome.kind).toBe('refused')
    expect(outcome.reason).toContain('no door listener')
  })

  it('answers unknown, never hangs, when a behaviour does not finish', async () => {
    off = installHeadlessRemoteDoor()
    expect(await sayAtDoor({ text: '/slow', deadlineMs: 50 })).toEqual({
      kind: 'unknown', reason: 'the door did not answer in time',
    })
  })
})

describe('hive-say --door', () => {
  const read = (...p: string[]): string => readFileSync(join(process.cwd(), ...p), 'utf8')

  it('says each sentence through the page function, and asks nobody', () => {
    const service = read('scripts', 'hive-say.cjs')
    expect(service).toContain("const DOOR = args.includes('--door')")
    expect(service).toContain('page.evaluate(sayAtDoor, {')
  })

  it('speaks the event the door’s listener hears', () => {
    // The page function cannot import core, so the name is written out there.
    const core = read('hypercomb-core', 'src', 'remote-submit.types.ts')
    expect(core).toContain("export const REMOTE_SUBMIT = 'command-line:remote-submit'")
    expect(read('scripts', 'hive-say-door.cjs')).toContain("bus.emitTransient('command-line:remote-submit'")
  })
})
