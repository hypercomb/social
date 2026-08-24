// agent-roster.spec.ts — the bridge roster's contract.
//
// Three things here are worth a mechanical guard because their failure is
// SILENT: an argv template that leaks a literal "{model}" to a vendor, a
// Windows `.cmd` spawned in a way modern Node refuses (EINVAL) or that
// mangles a quoted prompt, and a model hint resolving to the wrong bridge —
// which would answer a `/gemini` question with a different company's model.

import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const roster = require_('./agent-roster.cjs') as typeof import('./agent-roster.cjs')

const agent = (over: Record<string, unknown> = {}) => ({
  id: 'probe-bridge',
  label: 'Probe',
  vendor: 'openai',
  bin: 'probe',
  argv: ['exec', '{prompt}', '-m', '{model}', '--sandbox', 'workspace-write'],
  models: [
    { name: 'probe-big', id: 'probe-1', tier: 'deep' },
    { name: 'probe-small', id: 'probe-mini', tier: 'fast' },
  ],
  defaultModel: 'probe-1',
  docsUrl: 'https://probe.example',
  ...over,
})

describe('the shipped roster', () => {
  it('declares bridges that are all well formed', () => {
    const declared = roster.declared()
    expect(declared.length).toBeGreaterThan(1)
    for (const a of declared) {
      expect(a.id, `${a.id} id`).toMatch(/^[a-z0-9-]+$/)
      expect(a.label, `${a.id} label`).toBeTruthy()
      expect(a.bin, `${a.id} bin`).toBeTruthy()
      expect(a.docsUrl, `${a.id} docsUrl`).toMatch(/^https:\/\//)
      expect(a.models?.length, `${a.id} models`).toBeGreaterThan(0)
      expect(a.models.some(m => m.id === a.defaultModel), `${a.id} defaultModel`).toBe(true)
      expect(a.argv.join(' '), `${a.id} argv`).toContain('{prompt}')
    }
  })

  it('ships Claude Code, and no two bridges claim the same model word', () => {
    const declared = roster.declared()
    expect(declared.map(a => a.id)).toContain('claude-bridge')
    const words = declared.flatMap(a => a.models.map(m => m.name.toLowerCase()))
    expect(new Set(words).size).toBe(words.length)
  })
})

describe('agentForModel', () => {
  const agents = [agent(), agent({ id: 'other-bridge', bin: 'other', models: [{ name: 'other', id: 'o-1' }] })]

  it('resolves a model word, a wire id, and a bridge id', () => {
    expect(roster.agentForModel('probe-small', agents)?.id).toBe('probe-bridge')
    expect(roster.agentForModel('probe-mini', agents)?.id).toBe('probe-bridge')
    expect(roster.agentForModel('other-bridge', agents)?.id).toBe('other-bridge')
  })

  it('returns undefined rather than guessing across vendors', () => {
    expect(roster.agentForModel('nothing-like-this', agents)).toBeUndefined()
    expect(roster.agentForModel('', agents)).toBeUndefined()
  })
})

describe('invocation', () => {
  it('substitutes the prompt and the model the hint names', () => {
    const { args } = roster.invocation(agent({ bin: 'node' }), 'answer this', 'probe-small')
    expect(args).toEqual(['exec', 'answer this', '-m', 'probe-mini', '--sandbox', 'workspace-write'])
  })

  it('falls back to the default model when the hint names none', () => {
    expect(roster.invocation(agent({ bin: 'node' }), 'x', '').args).toContain('probe-1')
  })

  it('drops a {model} placeholder AND its flag when nothing resolves', () => {
    const flagless = agent({ bin: 'node', models: [], defaultModel: '' })
    const { args } = roster.invocation(flagless, 'ask', '')
    expect(args.join(' ')).not.toContain('{model}')
    expect(args).toEqual(['exec', 'ask', '--sandbox', 'workspace-write'])
  })

  it('never leaks an unresolved placeholder into a vendor argument', () => {
    for (const declared of roster.declared()) {
      const { args } = roster.invocation({ ...declared, bin: 'node' }, 'a prompt', '')
      expect(args.join(' '), declared.id).not.toMatch(/\{(prompt|model)\}/)
      expect(args, declared.id).toContain('a prompt')
    }
  })
})

describe('spawnPlan', () => {
  const win = process.platform === 'win32'

  it('spawns a real executable directly', () => {
    const plan = roster.spawnPlan(win ? 'C:\\tools\\probe.exe' : '/usr/bin/probe', ['-p', 'hi'])
    expect(plan.file).toContain('probe')
    expect(plan.args).toEqual(['-p', 'hi'])
  })

  it.runIf(win)('routes a .cmd shim through ComSpec with one quoted line', () => {
    const plan = roster.spawnPlan('C:\\npm\\claude.cmd', ['-p', 'two words', '--model', 'x'])
    expect(plan.file.toLowerCase()).toContain('cmd')
    expect(plan.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(plan.options.windowsVerbatimArguments).toBe(true)
    expect(plan.args[3]).toContain('"two words"')
  })

  it.runIf(win)('quotes a prompt containing quotes and shell metacharacters', () => {
    const nasty = 'say "hi" & echo %PATH% | more'
    const line = roster.spawnPlan('C:\\npm\\claude.cmd', ['-p', nasty]).args[3]
    // The whole prompt stays ONE argument: quoted, with inner quotes escaped
    // and no bare metacharacter left for cmd.exe to act on.
    expect(line).toContain('\\"hi\\"')
    expect(line.split('"').length % 2).toBe(1)
  })
})

describe('toProviderSpec', () => {
  it('produces an agent-bridge spec: no endpoint, no key, reads the hive', () => {
    const spec = roster.toProviderSpec(agent())
    expect(spec).toMatchObject({
      format: 'llm-provider@1',
      id: 'probe-bridge',
      shape: 'agent-bridge',
      transport: 'agent-bridge',
      requiresKey: false,
      readsHive: true,
    })
    expect(spec).not.toHaveProperty('endpoint')
  })
})
