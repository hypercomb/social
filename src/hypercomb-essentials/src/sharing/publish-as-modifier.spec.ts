// publish-as-modifier.spec.ts — the own address said at the END of the sentence.
//
//   publish /work/meetups on hypercomb.com              → its default address
//   publish /work/meetups on hypercomb.com as meet-ups  → meet-ups.hypercomb.com
//
// jwize, 2026-10-25: "as should just be the modifier at the end". The label is
// checked before anything is published, the consent is told the address, and
// the address is set only once the publish landed.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const hostCurrentBranch = vi.fn(async (_segments: readonly string[], _own?: Record<string, string>) => true)
let named: string[] = []
const setBranchHosts = vi.fn(async (_segments: readonly string[], zones: string[]) => { named = zones })
type AddressResult = { ok: true; host: string } | { ok: false; failure: string; reason?: string }
const setBranchAddress = vi.fn(async (_segments: readonly string[], zone: string, label: string, _options?: { replace?: boolean }): Promise<AddressResult> => ({ ok: true, host: `${label}.${zone}` }))
const requestConfirm = vi.fn(async (_opts: { message: string }) => true)
const listPublishRecords = vi.fn(async () => [] as Array<{ record: { lineageKey: string; segments: string[] } }>)

vi.mock('@hypercomb/core', async (original) => ({ ...(await original<Record<string, unknown>>()), requestConfirm }))
vi.mock('./host-gesture.js', () => ({ hostCurrentBranch }))
vi.mock('../commands/publish-history.js', () => ({ publicHistoryAt: vi.fn(), writePublicHistory: vi.fn(), clearPublicHistory: vi.fn() }))
vi.mock('./community-hosts.js', () => ({
  hostZone: (raw: string) => String(raw ?? '').trim().toLowerCase(),
  hostsOfBranch: vi.fn(async () => named),
  setBranchHosts,
}))
vi.mock('./publish-branch.js', () => ({ setBranchAddress, setBranchDoors: vi.fn(), unpublishBranch: vi.fn() }))
vi.mock('./publish-heads.js', () => ({ latestByLineageKey: vi.fn(async () => new Map()), listPublishRecords }))

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => undefined,
  get: (key: string) => key === '@hypercomb.social/Lineage' ? { explorerSegments: () => ['work'] } : undefined,
  whenReady: () => undefined,
}

const { PublishQueenBee } = await import('./publish.queen.js')
const bee = new PublishQueenBee()

beforeEach(() => {
  named = []
  hostCurrentBranch.mockClear(); hostCurrentBranch.mockResolvedValue(true)
  setBranchHosts.mockClear()
  setBranchAddress.mockClear()
  requestConfirm.mockClear(); requestConfirm.mockResolvedValue(true)
  listPublishRecords.mockClear(); listPublishRecords.mockResolvedValue([])
})

describe('publish … on <domain> as <label>', () => {
  it('publishes there, tells the consent the address, then gives the tile that address', async () => {
    await bee.invoke('/work/meetups on hypercomb.com as meet-ups')
    expect(setBranchHosts).toHaveBeenCalledWith(['work', 'meetups'], ['hypercomb.com'])
    expect(hostCurrentBranch).toHaveBeenCalledWith(['work', 'meetups'], { 'hypercomb.com': 'meet-ups.hypercomb.com' })
    expect(setBranchAddress).toHaveBeenCalledWith(['work', 'meetups'], 'hypercomb.com', 'meet-ups')
  })

  it('without as, the tree answers at its own name, at any depth', async () => {
    await bee.invoke('/work/Meet_Ups on hypercomb.com')
    expect(hostCurrentBranch).toHaveBeenCalledWith(['work', 'Meet_Ups'], {})
    expect(setBranchAddress).toHaveBeenCalledWith(['work', 'Meet_Ups'], 'hypercomb.com', 'meet-ups')
    expect(requestConfirm).not.toHaveBeenCalled()
  })

  it('a name that cannot be an address leaves the tile at the host door', async () => {
    await bee.invoke('/work/☕ on hypercomb.com')
    expect(setBranchAddress).not.toHaveBeenCalled()
    await bee.invoke('/work/host on hypercomb.com')
    expect(setBranchAddress).not.toHaveBeenCalled()
  })

  it('when another tree holds the name, you choose: taking it moves the address', async () => {
    listPublishRecords.mockResolvedValue([{ record: { lineageKey: 'other-key', segments: ['people', 'meetups'] } }])
    setBranchAddress.mockResolvedValueOnce({ ok: false, failure: 'taken', reason: 'other-key' })
    await bee.invoke('/work/meetups on hypercomb.com')
    expect(requestConfirm).toHaveBeenCalledTimes(1)
    expect(requestConfirm.mock.calls[0][0].message).toContain('/people/meetups')
    expect(setBranchAddress).toHaveBeenLastCalledWith(['work', 'meetups'], 'hypercomb.com', 'meetups', { replace: true })
  })

  it('declining leaves the other tree answering and this one published', async () => {
    setBranchAddress.mockResolvedValueOnce({ ok: false, failure: 'taken', reason: 'other-key' })
    requestConfirm.mockResolvedValueOnce(false)
    await bee.invoke('/work/meetups on hypercomb.com')
    expect(setBranchAddress).toHaveBeenCalledTimes(1)
  })

  it('refuses a name that is not an address before anything is published', async () => {
    await expect(bee.invoke('/work/meetups on hypercomb.com as -bad-')).rejects.toThrow(/letters, digits and hyphens/)
    await expect(bee.invoke('/work/meetups on hypercomb.com as')).rejects.toThrow(/Say the name/)
    await expect(bee.invoke('/work/meetups off hypercomb.com as x')).rejects.toThrow(/goes with on/)
    expect(setBranchHosts).not.toHaveBeenCalled()
    expect(hostCurrentBranch).not.toHaveBeenCalled()
  })

  it('a declined consent leaves the address alone', async () => {
    hostCurrentBranch.mockResolvedValueOnce(false)
    await bee.invoke('/work/meetups on hypercomb.com as meet-ups')
    expect(setBranchAddress).not.toHaveBeenCalled()
    hostCurrentBranch.mockResolvedValueOnce(false)
    await bee.invoke('/work/meetups on hypercomb.com')
    expect(setBranchAddress).not.toHaveBeenCalled()
  })

  it('still reads the older spelling, as <label> on <domain>', async () => {
    named = ['hypercomb.com']
    await bee.invoke('/work/meetups as meet-ups on hypercomb.com')
    expect(setBranchAddress).toHaveBeenCalledWith(['work', 'meetups'], 'hypercomb.com', 'meet-ups')
    expect(hostCurrentBranch).not.toHaveBeenCalled()
  })
})
