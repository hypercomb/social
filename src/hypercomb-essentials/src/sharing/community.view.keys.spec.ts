// @vitest-environment jsdom
// community.view.keys.spec.ts — the community window's undo and redo belong to
// the window, never to a field inside it. A Ctrl+Z typed in one of its boxes is
// the text's undo; the same press anywhere else in the window undoes the
// community (jwize 2026-11-26: "critical everywhere on all inputs that they
// don't activate the shortcuts while having focus").

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./key-list.client.js', () => ({ publisherKeyHex: async () => 'a'.repeat(64) }))
vi.mock('./showcase-record.js', async (actual) => ({
  ...(await actual<typeof import('./showcase-record.js')>()),
  readSignedShowcase: async (zone: string) => ({ zone, items: [], domains: [] }),
}))

import { CommunityDraft } from './community.draft.js'
import { communityView } from './community.view.js'

const press = (target: EventTarget, key: string, extra: KeyboardEventInit = {}): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true, ctrlKey: true, ...extra }))
}

let undo: ReturnType<typeof vi.spyOn>
let redo: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
  undo = vi.spyOn(CommunityDraft.prototype, 'undo').mockReturnValue(false)
  redo = vi.spyOn(CommunityDraft.prototype, 'redo').mockReturnValue(false)
  await communityView.open('example.com')
})

afterEach(() => {
  communityView.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const win = (): HTMLElement => document.querySelector('.hc-community-window') as HTMLElement

describe('undo and redo in the community window', () => {
  it('undo and redo the community from the window itself', () => {
    press(win(), 'z')
    press(win(), 'y')
    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).toHaveBeenCalledTimes(1)
  })

  it('leave a field in the window alone: Ctrl+Z and Ctrl+Y are the text\'s', () => {
    const field = document.createElement('input')
    win().appendChild(field)
    field.focus()
    press(field, 'z')
    press(field, 'y')
    press(field, 'z', { shiftKey: true })
    expect(undo).not.toHaveBeenCalled()
    expect(redo).not.toHaveBeenCalled()
  })

  it('leave a textarea and a field inside a shadow root alone too', () => {
    const area = document.createElement('textarea')
    win().appendChild(area)
    area.focus()
    press(area, 'z')
    const host = document.createElement('div')
    win().appendChild(host)
    const inner = document.createElement('input')
    host.attachShadow({ mode: 'open' }).appendChild(inner)
    inner.focus()
    press(inner, 'z')
    expect(undo).not.toHaveBeenCalled()
  })
})
