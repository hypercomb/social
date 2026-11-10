// ui/command-line/remote-door.headless.spec.ts — a machine's sentence on a
// page that mounts no command line.
//
// A try- door carries no interface, and the command line was the only thing
// that heard `REMOTE_SUBMIT`. This door hears it without one. What is asserted:
// a behaviour word runs and is awaited; the gate is core's, asked for every
// verb; and a line of the command line's own grammar is refused, never run and
// never answered `unknown`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EffectBus, REMOTE_SUBMIT, type RemoteSubmitOutcome, type RemoteSubmitRequest } from '@hypercomb/core'

vi.mock('@hypercomb/core', async original => ({
  ...(await original<typeof import('@hypercomb/core')>()),
  // The processor is the shell's; here it is only asked to run.
  hypercomb: class { act = vi.fn(async () => {}) },
}))

const { NO_COMMAND_LINE, installHeadlessRemoteDoor, sayHeadless } = await import('./remote-door.headless')

type Row = {
  name: string; aliases?: readonly string[]
  machine?: { reach: string; scope: string; refuse?: (args: string) => string | undefined }
}

const census: Row[] = [
  { name: 'create', machine: { reach: 'additive', scope: 'page' } },
  { name: 'go' },
  { name: 'remove', aliases: ['rm'], machine: { reach: 'destructive', scope: 'page' } },
  { name: 'module', machine: { reach: 'additive', scope: 'local', refuse: args =>
    args.trim().split(/\s+/)[0] === 'list' ? undefined : "that form is the participant's" } },
  { name: 'models' },
]

let ran: Array<[string, string]>
let registry: Map<string, unknown>

beforeEach(() => {
  ran = []
  registry = new Map<string, unknown>([
    ['@diamondcoreprocessor.com/SlashBehaviourDrone', {
      entries: () => census,
      has: (name: string) => census.some(row => row.name === name),
      rawArgs: (name: string) => name === 'models',
      execute: async (name: string, args: string) => {
        if (args === 'boom') throw new Error('it broke')
        ran.push([name, args])
      },
    }],
  ])
  ;(globalThis as { ioc?: unknown }).ioc = { get: (key: string) => registry.get(key) }
})

afterEach(() => {
  delete (globalThis as { ioc?: unknown }).ioc
  delete (globalThis as { document?: unknown }).document
})

describe('a behaviour word runs with no command line', () => {
  it('runs a plain call through the behaviour drone and waits for it', async () => {
    expect(await sayHeadless('/go /meetings')).toEqual({
      kind: 'ran', actions: [{ command: 'go', args: '/meetings', ok: true }],
    })
    expect(ran).toEqual([['go', '/meetings']])
  })

  it('runs every action of a sentence the reader matched, in word order', async () => {
    registry.set('@diamondcoreprocessor.com/UtteranceReader', {
      read: () => ({ spans: [], actions: [{ command: 'create', args: 'notes' }, { command: 'go', args: 'notes' }] }),
    })
    const outcome = await sayHeadless('create notes then go notes')
    expect(outcome.kind).toBe('ran')
    expect(ran).toEqual([['create', 'notes'], ['go', 'notes']])
  })

  it('gives a word that keeps its arguments its slash, and skips the reader', async () => {
    const read = vi.fn(() => ({ spans: [], actions: [{ command: 'go', args: 'files' }] }))
    registry.set('@diamondcoreprocessor.com/UtteranceReader', { read })
    await sayHeadless('models request A Planner that holds forty files')
    expect(read).not.toHaveBeenCalled()
    expect(ran).toEqual([['models', 'request A Planner that holds forty files']])
  })

  it('reports a throw as that action failing, never as a success', async () => {
    expect(await sayHeadless('/go boom')).toEqual({
      kind: 'ran', actions: [{ command: 'go', args: 'boom', ok: false, error: 'it broke' }],
    })
  })
})

describe('the gate is asked, and nothing runs past a refusal', () => {
  it('refuses a destructive word in slash form and by its alias', async () => {
    expect((await sayHeadless('/remove drafts')).kind).toBe('refused')
    expect((await sayHeadless('/rm drafts')).kind).toBe('refused')
    expect(ran).toEqual([])
  })

  it('refuses a whole sentence when one of its verbs is refused', async () => {
    registry.set('@diamondcoreprocessor.com/UtteranceReader', {
      read: () => ({ spans: [], actions: [{ command: 'create', args: 'a' }, { command: 'remove', args: 'b' }] }),
    })
    expect((await sayHeadless('create a and remove b')).kind).toBe('refused')
    expect(ran).toEqual([])
  })

  it("runs the behaviour's own refuse on what it will be handed", async () => {
    expect(await sayHeadless('/module commit x')).toEqual({ kind: 'refused', reason: "that form is the participant's" })
    expect((await sayHeadless('/module list')).kind).toBe('ran')
  })

  it('names the claimants of an ambiguous word and runs nothing', async () => {
    registry.set('@diamondcoreprocessor.com/UtteranceReader', {
      read: () => ({
        spans: [{ role: 'ambiguity', text: 'open', candidates: [{ name: 'go' }, { name: 'create' }] }],
        actions: [{ command: 'go', args: '' }],
      }),
    })
    expect(await sayHeadless('open it')).toEqual({ kind: 'ambiguous', word: 'open', candidates: ['go', 'create'] })
    expect(ran).toEqual([])
  })
})

describe('the command line’s own grammar has no executor here', () => {
  it.each(['[a, b]/shelf', '~drafts', 'notes:todo', 'meetup@postit', 'a/b', '/nosuchword x'])(
    'refuses %s and runs nothing',
    async line => {
      const outcome = await sayHeadless(line)
      expect(outcome.kind).toBe('refused')
      expect(ran).toEqual([])
    },
  )

  it('says why, for a line no gate refused', async () => {
    expect(await sayHeadless('a/b')).toEqual({ kind: 'refused', reason: NO_COMMAND_LINE })
  })

  it('refuses prose that names no word, as the command line’s door does', async () => {
    const outcome = await sayHeadless('hello there') as { kind: string; reason: string }
    expect(outcome.kind).toBe('refused')
    expect(outcome.reason).toContain('create <name>')
  })
})

describe('the listener', () => {
  const say = (text: string): Promise<{ heard: boolean; outcome: RemoteSubmitOutcome }> =>
    new Promise(done => {
      let heard = false
      const request: RemoteSubmitRequest = {
        text, accept: () => { heard = true }, complete: outcome => done({ heard, outcome }),
      }
      EffectBus.emitTransient(REMOTE_SUBMIT, request)
      if (!heard) done({ heard, outcome: { kind: 'unknown', reason: 'nobody heard' } })
    })

  it('accepts at once and settles with the outcome', async () => {
    const off = installHeadlessRemoteDoor()
    try {
      const { heard, outcome } = await say('/go /x')
      expect(heard).toBe(true)
      expect(outcome.kind).toBe('ran')
    } finally { off() }
  })

  it('installs once, so a line is never run twice', async () => {
    const off = installHeadlessRemoteDoor()
    expect(installHeadlessRemoteDoor()).toBe(off)
    try {
      await say('/go /x')
      expect(ran).toEqual([['go', '/x']])
    } finally { off() }
  })

  it('stays silent where a command line is mounted: that one is the door', async () => {
    ;(globalThis as { document?: unknown }).document = { querySelector: (q: string) => q === 'hc-command-line' ? {} : null }
    const off = installHeadlessRemoteDoor()
    try {
      expect((await say('/go /x')).heard).toBe(false)
      expect(ran).toEqual([])
    } finally { off() }
  })
})

describe('this door asks the gate and does not judge for itself', () => {
  const source = readFileSync(
    join(process.cwd(), 'hypercomb-shared', 'ui', 'command-line', 'remote-door.headless.ts'), 'utf8')

  it('asks core as an operator, then the behaviour’s own refuse', () => {
    expect(source).toContain("admitMachineCall(verb, entry, 'operator', grant)")
    expect(source).toContain('spokenEntry(')
    expect(source.indexOf('admitMachineCall(')).toBeLessThan(source.indexOf('entry?.machine?.refuse?.(args)'))
    expect(source).not.toContain("reach === 'destructive'")
  })

  it('reads the verbs with the same reader the command line’s door uses', () => {
    expect(source).toContain('dispatchedCallsOf(line)')
  })

  it('is what the workbench door loads', () => {
    const barrel = readFileSync(
      join(process.cwd(), 'hypercomb-shared', 'ui', 'shell-surfaces', 'shell-surfaces.workbench.barrel.ts'), 'utf8')
    expect(barrel).toContain('installHeadlessRemoteDoor()')
  })
})
