// deliver-link.spec.ts — the ONE link-delivery ladder, in order.
//
//   navigator.share → navigator.clipboard → sticky toast whose button is a
//   FRESH TAP that re-runs the ladder inside its own click.
//
// The cases pin the two things a phone depends on: a cancelled sheet is a
// choice (nothing falls through after it), and the toast's re-run reaches
// the sheet SYNCHRONOUSLY from the emit — that synchronous distance from the
// tap is what makes the share sheet legal there.
//
// window.ioc is stubbed BEFORE the module import; the module subscribes the
// re-run handler at load, so the bus is never cleared here — the toasts are
// captured by one standing subscription instead.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: () => undefined,
}

const { deliverLink, SHARE_DELIVER_EFFECT } = await import('./deliver-link.js')

interface ToastRequest {
  message?: string
  duration?: number
  actionLabel?: string
  actionEffect?: string
  actionPayload?: unknown
}

const toasts: ToastRequest[] = []
EffectBus.on<ToastRequest>('toast:show', t => toasts.push(t))

const URL = 'https://example.test/0123456789abcdef'

// jsdom's navigator carries neither; both are installed per case and deleted
// after, so the type is the loose shape the deletes need.
const nav = navigator as unknown as { share?: unknown; clipboard?: unknown }

const installShare = (impl: () => Promise<void>): ReturnType<typeof vi.fn> => {
  const share = vi.fn(impl)
  Object.defineProperty(nav, 'share', { value: share, configurable: true, writable: true })
  return share
}

const installClipboard = (impl: () => Promise<void>): ReturnType<typeof vi.fn> => {
  const writeText = vi.fn(impl)
  Object.defineProperty(nav, 'clipboard', { value: { writeText }, configurable: true, writable: true })
  return writeText
}

const abort = (): Promise<void> => Promise.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
const refused = (): Promise<void> => Promise.reject(Object.assign(new Error('stale'), { name: 'NotAllowedError' }))
const ok = (): Promise<void> => Promise.resolve()

beforeEach(() => {
  toasts.length = 0
})

afterEach(() => {
  delete nav.share
  delete nav.clipboard
})

describe('deliverLink — the ladder', () => {
  it('1. the sheet: accepted = shared, and the clipboard is never touched', async () => {
    const share = installShare(ok)
    const writeText = installClipboard(ok)
    await expect(deliverLink(URL, 'intro')).resolves.toBe('shared')
    expect(share).toHaveBeenCalledWith({ url: URL, title: 'intro' })
    expect(writeText).not.toHaveBeenCalled()
    expect(toasts).toHaveLength(0)
  })

  it('1b. the sheet cancelled by the participant is a CHOICE — nothing falls through', async () => {
    installShare(abort)
    const writeText = installClipboard(ok)
    await expect(deliverLink(URL)).resolves.toBe('shared')
    expect(writeText).not.toHaveBeenCalled()
    expect(toasts).toHaveLength(0)
  })

  it('2. the sheet refused (stale activation) descends to the clipboard', async () => {
    installShare(refused)
    const writeText = installClipboard(ok)
    await expect(deliverLink(URL)).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalledWith(URL)
    expect(toasts).toHaveLength(0)
  })

  it('2b. no sheet at all (desktop) goes straight to the clipboard', async () => {
    const writeText = installClipboard(ok)
    await expect(deliverLink(URL)).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalledWith(URL)
  })

  it('3. everything refused → a STICKY toast carrying the URL and a fresh-tap Share button', async () => {
    installShare(refused)
    installClipboard(refused)
    await expect(deliverLink(URL, 'intro')).resolves.toBe('offered')
    expect(toasts).toHaveLength(1)
    const toast = toasts[0]!
    expect(toast.message).toBe(URL)
    expect(toast.duration).toBe(0)
    expect(toast.actionLabel).toBe('Share')
    expect(toast.actionEffect).toBe(SHARE_DELIVER_EFFECT)
    expect(toast.actionPayload).toEqual({ url: URL, title: 'intro' })
  })

  it('3b. no clipboard API at all is the same dead end — offered, never a throw', async () => {
    await expect(deliverLink(URL)).resolves.toBe('offered')
    expect(toasts).toHaveLength(1)
  })
})

describe('the fresh-tap re-run (share:deliver)', () => {
  it('reaches the sheet SYNCHRONOUSLY from the emit — inside the button click', () => {
    const share = installShare(ok)
    const writeText = installClipboard(ok)
    EffectBus.emitTransient(SHARE_DELIVER_EFFECT, { url: URL, title: 'intro' })
    expect(share).toHaveBeenCalledTimes(1)
    expect(share).toHaveBeenCalledWith({ url: URL, title: 'intro' })
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to the clipboard when the sheet refuses again', async () => {
    installShare(refused)
    const writeText = installClipboard(ok)
    EffectBus.emitTransient(SHARE_DELIVER_EFFECT, { url: URL })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(writeText).toHaveBeenCalledWith(URL)
  })

  it('with no sheet, writes the clipboard synchronously', () => {
    const writeText = installClipboard(ok)
    EffectBus.emitTransient(SHARE_DELIVER_EFFECT, { url: URL })
    expect(writeText).toHaveBeenCalledWith(URL)
  })

  it('ignores a payload without a URL', () => {
    const share = installShare(ok)
    EffectBus.emitTransient(SHARE_DELIVER_EFFECT, { title: 'intro' })
    EffectBus.emitTransient(SHARE_DELIVER_EFFECT, { url: 42 })
    expect(share).not.toHaveBeenCalled()
  })
})
