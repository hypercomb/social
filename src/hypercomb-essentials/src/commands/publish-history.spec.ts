// publish-history.spec.ts — THE PUBLIC-HISTORY MARK.
//
// A branch publishes its history when its root carries ONE `publish:history`
// decoration with payload `{ public: true }`, mark 'persistent', written with
// replaceDecoration on the branch segments — the contract the worker and the
// Rust host read. No mark is head only, the default.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const listDecorations = vi.fn()
const removeDecorationAndWait = vi.fn(async () => undefined)
const replaceDecoration = vi.fn(async () => 'sig')

vi.mock('./decoration-manifest.js', () => ({ listDecorations, removeDecorationAndWait, replaceDecoration }))

const {
  PUBLISH_HISTORY_DECORATION_KIND,
  clearPublicHistory,
  publicHistoryAt,
  writePublicHistory,
} = await import('./publish-history.js')

beforeEach(() => {
  listDecorations.mockReset()
  removeDecorationAndWait.mockClear()
  replaceDecoration.mockClear()
})

describe('publish:history — the mark on the branch root', () => {
  it('names the shared kind', () => {
    expect(PUBLISH_HISTORY_DECORATION_KIND).toBe('publish:history')
  })

  it('reads no mark as null — head only, the default', async () => {
    listDecorations.mockResolvedValue([])
    expect(await publicHistoryAt(['garden'])).toBeNull()
    expect(listDecorations).toHaveBeenCalledWith({ kind: 'publish:history', segments: ['garden'] })
  })

  it('reads the payload\'s public flag', async () => {
    listDecorations.mockResolvedValue([{ sig: 's', record: { kind: 'publish:history', payload: { public: true } } }])
    expect(await publicHistoryAt(['garden'])).toBe(true)
    listDecorations.mockResolvedValue([{ sig: 's', record: { kind: 'publish:history', payload: { public: false } } }])
    expect(await publicHistoryAt(['garden'])).toBe(false)
  })

  it('treats a malformed payload or a failed read as no mark', async () => {
    listDecorations.mockResolvedValue([{ sig: 's', record: { kind: 'publish:history', payload: {} } }])
    expect(await publicHistoryAt(['garden'])).toBeNull()
    listDecorations.mockRejectedValue(new Error('cold'))
    expect(await publicHistoryAt(['garden'])).toBeNull()
  })

  it('writes exactly the contract: replaceDecoration, public: true, persistent, on the branch', async () => {
    await writePublicHistory(['garden', 'beds'])
    expect(replaceDecoration).toHaveBeenCalledWith({
      kind: 'publish:history',
      appliesTo: ['garden', 'beds'],
      segments: ['garden', 'beds'],
      payload: { public: true },
      mark: 'persistent',
    })
  })

  it('clears every record of the kind, awaited, and says whether there was one', async () => {
    listDecorations.mockResolvedValue([])
    expect(await clearPublicHistory(['garden'])).toBe(false)
    expect(removeDecorationAndWait).not.toHaveBeenCalled()

    listDecorations.mockResolvedValue([
      { sig: 'a', record: { payload: { public: true } } },
      { sig: 'b', record: { payload: { public: true } } },
    ])
    expect(await clearPublicHistory(['garden'])).toBe(true)
    expect(removeDecorationAndWait).toHaveBeenCalledWith({ sig: 'a', segments: ['garden'] })
    expect(removeDecorationAndWait).toHaveBeenCalledWith({ sig: 'b', segments: ['garden'] })
  })
})
