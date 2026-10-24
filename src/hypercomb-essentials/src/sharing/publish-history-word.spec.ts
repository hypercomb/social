// publish-history-word.spec.ts — `publish history` is a SUB-WORD of publish.
//
//   publish history          status only — never changes anything
//   publish history on       write the mark on the branch root, then republish
//   publish history off      clear it, then republish
//   publish /a/b history …   the same for a named tile
//
// A branch that is not published keeps the mark for its next publish and is
// not published by this word. Turning ON says plainly that what is served
// while history is public may be copied elsewhere and cannot be taken back.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const hostCurrentBranch = vi.fn(async () => undefined)
const publicHistoryAt = vi.fn(async (): Promise<boolean | null> => null)
const writePublicHistory = vi.fn(async () => 'sig')
const clearPublicHistory = vi.fn(async () => true)
let publishedKeys = new Set<string>()

vi.mock('./host-gesture.js', () => ({ hostCurrentBranch }))
vi.mock('../commands/publish-history.js', () => ({ publicHistoryAt, writePublicHistory, clearPublicHistory }))
vi.mock('./community-hosts.js', () => ({ hostZone: vi.fn(), hostsOfBranch: vi.fn(async () => []), setBranchHosts: vi.fn() }))
vi.mock('./publish-branch.js', () => ({ setBranchAddress: vi.fn(), setBranchDoors: vi.fn(), unpublishBranch: vi.fn() }))
vi.mock('./publish-heads.js', () => ({
  latestByLineageKey: vi.fn(async () => new Map([...publishedKeys].map(k => [k, {}]))),
}))

let standing: string[] = ['garden']
const registry: Record<string, unknown> = {
  '@hypercomb.social/Lineage': { explorerSegments: () => standing },
}
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registry[key] = value },
  get: (key: string) => registry[key],
  whenReady: () => undefined,
}

const { lineageKey } = await import('@hypercomb/core')
const { PublishQueenBee } = await import('./publish.queen.js')

const toasts = (): string[] =>
  (emit.mock.calls as unknown[][]).filter(c => c[0] === 'toast:show').map(c => String((c[1] as { message?: string })?.message ?? ''))

let emit: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  standing = ['garden']
  publishedKeys = new Set()
  hostCurrentBranch.mockClear()
  publicHistoryAt.mockReset(); publicHistoryAt.mockResolvedValue(null)
  writePublicHistory.mockClear()
  clearPublicHistory.mockClear()
  emit?.mockRestore()
  emit = vi.spyOn(EffectBus, 'emit')
})

const bee = new PublishQueenBee()

describe('publish history — status', () => {
  it('says head only when the branch carries no mark, and changes nothing', async () => {
    await bee.invoke('history')
    expect(toasts().join(' ')).toMatch(/"garden" publishes its head only/)
    expect(writePublicHistory).not.toHaveBeenCalled()
    expect(clearPublicHistory).not.toHaveBeenCalled()
    expect(hostCurrentBranch).not.toHaveBeenCalled()
  })

  it('says public when the mark is on', async () => {
    publicHistoryAt.mockResolvedValue(true)
    await bee.invoke('History')
    expect(toasts().join(' ')).toMatch(/"garden" publishes its history/)
    expect(hostCurrentBranch).not.toHaveBeenCalled()
  })

  it('takes a route first and reads that tile, not where you stand', async () => {
    await bee.invoke('/revolucion/lounge history')
    expect(publicHistoryAt).toHaveBeenCalledWith(['revolucion', 'lounge'])
    expect(toasts().join(' ')).toMatch(/"lounge"/)
  })

  it('answers a stray word with the usage and does nothing', async () => {
    await bee.invoke('history maybe')
    expect(toasts().join(' ')).toMatch(/publish history on/)
    expect(publicHistoryAt).not.toHaveBeenCalled()
  })

  it('does not swallow an unrelated word that merely starts with history', async () => {
    const toggle = vi.fn()
    const off = EffectBus.on('publish:view-toggle', toggle)
    await bee.invoke('historyx')
    expect(toggle).toHaveBeenCalled()
    off?.()
  })
})

describe('publish history on / off', () => {
  it('on writes the mark, warns it cannot be taken back, and republishes a published branch', async () => {
    publishedKeys.add(lineageKey(['garden']))
    await bee.invoke('history on')
    expect(writePublicHistory).toHaveBeenCalledWith(['garden'])
    expect(toasts().join(' ')).toMatch(/copied or cached elsewhere.*cannot take that back/)
    expect(hostCurrentBranch).toHaveBeenCalledWith(['garden'])
  })

  it('off clears the mark and republishes', async () => {
    publicHistoryAt.mockResolvedValue(true)
    publishedKeys.add(lineageKey(['garden']))
    await bee.invoke('history off')
    expect(clearPublicHistory).toHaveBeenCalledWith(['garden'])
    expect(writePublicHistory).not.toHaveBeenCalled()
    expect(toasts().join(' ')).toMatch(/now publishes its head only/)
    expect(hostCurrentBranch).toHaveBeenCalledWith(['garden'])
  })

  it('route-first: publish /a/b history on acts on that tile', async () => {
    publishedKeys.add(lineageKey(['a', 'b']))
    await bee.invoke('/a/b history on')
    expect(writePublicHistory).toHaveBeenCalledWith(['a', 'b'])
    expect(hostCurrentBranch).toHaveBeenCalledWith(['a', 'b'])
  })

  it('an unpublished branch keeps the mark for its next publish and is not published by this word', async () => {
    await bee.invoke('history on')
    expect(writePublicHistory).toHaveBeenCalledWith(['garden'])
    expect(hostCurrentBranch).not.toHaveBeenCalled()
    expect(toasts().join(' ')).toMatch(/not published yet/)
  })

  it('asking for the state it is already in commits nothing and only says the status', async () => {
    publicHistoryAt.mockResolvedValue(true)
    await bee.invoke('history on')
    publicHistoryAt.mockResolvedValue(null)
    await bee.invoke('history off')
    expect(writePublicHistory).not.toHaveBeenCalled()
    expect(clearPublicHistory).not.toHaveBeenCalled()
    expect(hostCurrentBranch).not.toHaveBeenCalled()
  })

  it('refuses at the hive root — the root is not a branch', async () => {
    standing = []
    await expect(bee.invoke('history on')).rejects.toThrow()
    expect(writePublicHistory).not.toHaveBeenCalled()
  })
})
