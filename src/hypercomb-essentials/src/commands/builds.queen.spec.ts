import { beforeEach, describe, expect, it, vi } from 'vitest'

const registrations = new Map<string, unknown>()
const ioc = {
  register: (key: string, value: unknown) => registrations.set(key, value),
  get: (key: string) => registrations.get(key),
}
// Queens register on `window.ioc`; core's `get` falls back to `globalThis.ioc`.
;(globalThis as unknown as { window: unknown }).window = { ioc }
;(globalThis as unknown as { ioc: unknown }).ioc = ioc

const minted: { segments: readonly string[]; label: string }[] = []
vi.mock('../history/builds-slot.js', () => ({
  BUILDS_SLOT: 'builds',
  readBuildsAt: vi.fn(async () => []),
  mintBuildRecord: vi.fn(async (segments: readonly string[], label: string) => {
    minted.push({ segments, label })
    return { label, seal: 'f'.repeat(64), unchanged: false }
  }),
}))
vi.mock('../history/seal-restore.js', () => ({ applySealAt: vi.fn(async () => ({ changed: 0, failed: 0 })) }))
vi.mock('../history/snapshots-slot.js', () => ({ SNAPSHOTS_SLOT: 'snapshots', readSnapshots: vi.fn(async () => []), findSnapshot: vi.fn(() => null) }))

const { EffectBus, I18N_IOC_KEY } = await import('@hypercomb/core')
const { BuildsQueenBee } = await import('./builds.queen.js')
const { RecordingQueenBee } = await import('../recording/recording.queen.js')
const { RestoreQueenBee } = await import('./restore.queen.js')
const { readUtterance } = await import('./utterance/utterance-reading.js')

const builds = new BuildsQueenBee()
const otherWords = [new RecordingQueenBee().command, new RestoreQueenBee().command]

/** A line as the hive reads it: `builds` and the two words its old sub-words
 *  collided with. `withForms` false is a hive whose reader does not take a
 *  word's forms (before 2026-10-18) — the hive that split the line live. */
const actionsOf = (line: string, withForms: boolean) => readUtterance(line, [
  { name: builds.command, ...(withForms ? { options: builds.options } : {}) },
  ...otherWords.map(name => ({ name })),
]).actions

const toasts: string[] = []
beforeEach(() => {
  EffectBus.clear()
  minted.length = 0
  toasts.length = 0
  registrations.set('@hypercomb.social/Lineage', { explorerSegments: () => ['hosting'] })
  registrations.delete(I18N_IOC_KEY)
  EffectBus.on<{ message: string }>('toast:show', ({ message }) => { toasts.push(message) })
})

describe('builds: no sub-word is a behaviour word of its own', () => {
  it('teaches no form whose sub-word another behaviour claims', () => {
    const subWords = [
      ...builds.options.map(form => form.trim().split(/\s+/)[0]),
      ...builds.examples.map(example => example.input.replace(/^\//, '').split(/\s+/)[1]),
    ].filter((word): word is string => !!word && !word.startsWith('<'))
    for (const word of subWords) expect(otherWords, word).not.toContain(word)
  })

  it('every taught line is one word with its argument, whichever reader hears it', () => {
    for (const example of builds.examples) {
      const line = example.input.replace(/^\//, '')
      for (const withForms of [true, false]) {
        const actions = actionsOf(line, withForms)
        expect(actions.map(a => a.command), `${line} (forms: ${withForms})`).toEqual(['builds'])
      }
    }
  })

  it('a current reader still reads the old forms as one word', () => {
    expect(actionsOf('builds record hosting-pages-99b8efc33957', true))
      .toEqual([{ command: 'builds', args: 'record hosting-pages-99b8efc33957' }])
    expect(actionsOf('builds restore build-3', true)).toEqual([{ command: 'builds', args: 'restore build-3' }])
  })
})

describe('builds: what it does with what it hears', () => {
  it('a name alone records the subtree under that name', async () => {
    await builds.invoke('hosting-pages-99b8efc33957')
    expect(minted).toEqual([{ segments: ['hosting'], label: 'hosting-pages-99b8efc33957' }])
  })

  it('the old `record` form still records', async () => {
    await builds.invoke('record before-redesign')
    expect(minted).toEqual([{ segments: ['hosting'], label: 'before-redesign' }])
  })

  it('`revert` and the old `restore` both look for the build to bring back, and record nothing', async () => {
    for (const line of ['revert build-3', 'restore build-3']) {
      toasts.length = 0
      await builds.invoke(line)
      expect(minted, line).toEqual([])
      expect(toasts, line).toEqual(['No build revisions here yet — run /builds <name>, or let a build pass mint one.'])
    }
  })

  it('says the English when a catalog lacks the key, never the key itself', async () => {
    registrations.set(I18N_IOC_KEY, { t: (key: string) => key })
    await builds.invoke('before-redesign')
    expect(toasts).toEqual(['Recorded "before-redesign" — ffffffff'])
  })
})
