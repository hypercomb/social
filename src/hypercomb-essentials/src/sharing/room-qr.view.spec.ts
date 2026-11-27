// sharing/room-qr.view.spec.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import { KeyMapService } from '../keyboard/keymap.service.js'
import { QR_MAX_BYTES, qrSvg } from './qr-code.js'
import { closeRoomQr, showRoomQr, type RoomQrWords } from './room-qr.view.js'

// The real drawing, watched: what it is handed is part of the contract below.
vi.mock('./qr-code.js', async importOriginal => {
  const real = await importOriginal<typeof import('./qr-code.js')>()
  return { ...real, qrSvg: vi.fn(real.qrSvg) }
})

const WORDS: RoomQrWords = {
  title: 'Join kitchen',
  note: 'Point a phone at this.',
  copy: 'Copy the link',
  copied: 'Link copied',
  close: 'Close',
}
const LINK = 'https://swarm.example.com/#meet=kitchen/two-words'
const box = (): HTMLElement | null => document.querySelector('.hc-room-qr')
const buttons = (): HTMLButtonElement[] => [...box()!.querySelectorAll('button')]

// THE HIVE'S KEYMAP, LISTENING FIRST. It is on the window from boot, in the
// capture phase, so it hears every press before a window opened later does.
// One for the file: each one listens on the window for good.
new KeyMapService()
let invoked: string[] = []
let offInvoke: (() => void) | undefined

/** A press as the browser delivers it: on the focused control, bubbling. */
const press = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  ;(document.activeElement ?? document.body).dispatchEvent(event)
  return event
}

beforeEach(() => {
  invoked = []
  offInvoke = EffectBus.on<{ cmd: string }>('keymap:invoke', payload => { if (payload?.cmd) invoked.push(payload.cmd) })
  invoked = []
})

afterEach(() => {
  closeRoomQr()
  offInvoke?.()
  document.body.replaceChildren()
})

describe('the room code', () => {
  it('draws the link as a code, with the room named above it', () => {
    expect(showRoomQr(LINK, WORDS)).toBe(true)
    expect(box()?.getAttribute('role')).toBe('dialog')
    expect(box()?.querySelector('.hc-room-qr-title')?.textContent).toBe('Join kitchen')
    expect(box()?.querySelector('.hc-room-qr-note')?.textContent).toBe('Point a phone at this.')
    expect(box()?.querySelector('svg path')).not.toBeNull()
  })

  it('says no when the link is too long to draw, and shows nothing', () => {
    expect(showRoomQr(`https://example.com/#meet=${'a'.repeat(QR_MAX_BYTES)}`, WORDS)).toBe(false)
    expect(box()).toBeNull()
  })

  it('puts the room name on the page as words, never as markup', () => {
    showRoomQr(LINK, { ...WORDS, title: '<img src=x onerror=alert(1)>', note: '<b>bold</b>' })
    expect(box()?.querySelector('img')).toBeNull()
    expect(box()?.querySelector('b')).toBeNull()
    expect(box()?.querySelector('.hc-room-qr-title')?.textContent).toBe('<img src=x onerror=alert(1)>')
  })

  // A room's name arrives verbatim from a meeting link, so it is hostile text.
  it.each([
    ['a double quote, then markup', 'Join "><img src=x onerror=alert(1)>'],
    ['a single quote and an angle bracket', "Join '><script>alert(1)</script>"],
    ['a quote that closes the drawing', 'Join "/></svg><iframe src="javascript:alert(1)">'],
  ])('a room name with %s stays words and never becomes an element', (_what, title) => {
    expect(showRoomQr(LINK, { ...WORDS, title })).toBe(true)
    const art = box()!.querySelector('.hc-room-qr-code')!
    // The code box holds the drawing and nothing else: one svg of two shapes.
    expect([...art.children].map(node => node.tagName.toLowerCase())).toEqual(['svg'])
    expect([...art.querySelector('svg')!.children].map(node => node.tagName.toLowerCase())).toEqual(['rect', 'path'])
    expect(box()!.querySelector('img, script, iframe')).toBeNull()
    expect([...box()!.querySelectorAll('*')].flatMap(node => node.getAttributeNames()).filter(name => name.startsWith('on'))).toEqual([])
    // The name is whole, as an attribute value and as text.
    expect(art.querySelector('svg')!.getAttribute('aria-label')).toBe(title)
    expect(box()!.getAttribute('aria-label')).toBe(title)
    expect(box()!.querySelector('.hc-room-qr-title')!.textContent).toBe(title)
  })

  it('hands the drawing the link and nothing a person named', () => {
    showRoomQr(LINK, { ...WORDS, title: 'Join "><b>' })
    expect(vi.mocked(qrSvg).mock.calls.at(-1)).toEqual([LINK])
  })

  it('keeps one window: showing again replaces the first', () => {
    showRoomQr(LINK, WORDS)
    showRoomQr(LINK, { ...WORDS, title: 'Join garden' })
    expect(document.querySelectorAll('.hc-room-qr')).toHaveLength(1)
    expect(box()?.querySelector('.hc-room-qr-title')?.textContent).toBe('Join garden')
  })

  it('closes on its button, on Escape and on a press outside the card', () => {
    showRoomQr(LINK, WORDS)
    buttons().at(-1)!.click()
    expect(box()).toBeNull()

    showRoomQr(LINK, WORDS)
    const behind = vi.fn()
    window.addEventListener('keydown', behind)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    window.removeEventListener('keydown', behind)
    expect(box()).toBeNull()
    // Nothing behind the code also takes the key.
    expect(behind).not.toHaveBeenCalled()

    showRoomQr(LINK, WORDS)
    box()!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(box()).toBeNull()
  })

  it('offers the copy only when there is one to make, and says when it was made', async () => {
    showRoomQr(LINK, WORDS)
    expect(box()!.querySelectorAll('button')).toHaveLength(1)

    const copy = vi.fn(async () => 'copied')
    showRoomQr(LINK, WORDS, copy)
    const button = box()!.querySelectorAll('button')[0]!
    expect(button.textContent).toBe('Copy the link')
    button.click()
    await Promise.resolve()
    await Promise.resolve()
    expect(copy).toHaveBeenCalledTimes(1)
    expect(button.textContent).toBe('Link copied')
  })
})

// The code is a modal dialog. Opened over the room selector it owns Escape and
// Enter, nothing behind it hears either, focus stays inside it, and closing
// gives the focus back to the control that opened it.
describe('the room code over the room selector', () => {
  /** The selector's own Enter, as mesh-modal.component.ts installs it: on the
   *  window, before the code exists. Enter anywhere but one of its own buttons
   *  is START. */
  const selectorBehind = (): { save: ReturnType<typeof vi.fn>; off: () => void } => {
    const save = vi.fn()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter') return
      const active = document.activeElement as HTMLElement | null
      if (active?.tagName === 'BUTTON' && active.closest('.mesh-modal-panel')) return
      event.preventDefault()
      save()
    }
    window.addEventListener('keydown', onKey)
    return { save, off: () => window.removeEventListener('keydown', onKey) }
  }

  /** The selector's 'show code' button, focused as a press leaves it. */
  const opener = (): HTMLButtonElement => {
    const panel = document.createElement('div')
    panel.className = 'mesh-modal-panel'
    const button = document.createElement('button')
    button.type = 'button'
    panel.appendChild(button)
    document.body.appendChild(panel)
    button.focus()
    return button
  }

  it('Enter on its focused Close button is that button\'s own: the selector behind never starts', () => {
    const behind = selectorBehind()
    opener()
    showRoomQr(LINK, WORDS, async () => 'copied')
    expect(document.activeElement).toBe(buttons().at(-1))

    const onClose = press('Enter')
    buttons()[0]!.focus()
    const onCopy = press('Enter')
    behind.off()

    expect(behind.save).not.toHaveBeenCalled()
    // Not cancelled, so the browser presses the focused button itself.
    expect(onClose.defaultPrevented).toBe(false)
    expect(onCopy.defaultPrevented).toBe(false)
    expect(invoked).toEqual([])
  })

  it('Escape closes the code and stops there: the keymap that listened first fires nothing', () => {
    opener()
    showRoomQr(LINK, WORDS)
    press('Escape')
    expect(box()).toBeNull()
    // No global.escape: the selector behind is not dismissed, no cascade runs.
    expect(invoked).toEqual([])
  })

  it('gives Escape back once it is closed, whichever way it closed', () => {
    const closings: (() => void)[] = [
      () => press('Escape'),
      () => buttons().at(-1)!.click(),
      () => box()!.dispatchEvent(new MouseEvent('click', { bubbles: true })),
      () => { showRoomQr(LINK, { ...WORDS, title: 'Join garden' }); closeRoomQr() },
    ]
    for (const close of closings) {
      showRoomQr(LINK, WORDS)
      close()
      expect(box()).toBeNull()
      invoked = []
      press('Escape')
      expect(invoked).toEqual(['global.escape'])
    }
  })

  it('keeps every other key from the hive behind it too', () => {
    const behind = vi.fn()
    window.addEventListener('keydown', behind)
    document.addEventListener('keydown', behind)
    showRoomQr(LINK, WORDS)
    for (const key of ['Enter', ' ', 'a', 'ArrowLeft', 'Tab', 'Delete']) press(key)
    window.removeEventListener('keydown', behind)
    document.removeEventListener('keydown', behind)
    expect(behind).not.toHaveBeenCalled()
    expect(invoked).toEqual([])
    expect(box()).not.toBeNull()
  })

  it('keeps Tab inside the dialog, round its own buttons', () => {
    opener()
    showRoomQr(LINK, WORDS, async () => 'copied')
    const [copy, close] = buttons() as [HTMLButtonElement, HTMLButtonElement]
    expect(document.activeElement).toBe(close)

    // Forward off the last button comes round to the first.
    expect(press('Tab').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(copy)
    // Back off the first comes round to the last.
    expect(press('Tab', { shiftKey: true }).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close)
    // Between its own buttons the browser moves the focus.
    expect(press('Tab', { shiftKey: true }).defaultPrevented).toBe(false)
  })

  it('takes the focus back when it has left the dialog, and that press does nothing behind', () => {
    const behind = selectorBehind()
    const button = opener()
    showRoomQr(LINK, WORDS)
    button.focus()
    const event = press('Enter')
    behind.off()
    // Cancelled: Enter does not press the selector's button it was sitting on.
    expect(event.defaultPrevented).toBe(true)
    expect(behind.save).not.toHaveBeenCalled()
    expect(box()!.contains(document.activeElement)).toBe(true)
  })

  it('a press on the card leaves the focus in the dialog', () => {
    showRoomQr(LINK, WORDS)
    // The dialog itself can hold the focus, so a press on its words lands there and not on the page.
    expect(box()!.tabIndex).toBe(-1)
    box()!.focus()
    expect(document.activeElement).toBe(box())
    press('Tab')
    expect(document.activeElement).toBe(buttons()[0])
  })

  it('returns the focus to the control that opened it', () => {
    const button = opener()
    showRoomQr(LINK, WORDS)
    expect(box()!.contains(document.activeElement)).toBe(true)
    press('Escape')
    expect(document.activeElement).toBe(button)

    // Replacing the code keeps the first opener, not the old code's button.
    showRoomQr(LINK, WORDS)
    showRoomQr(LINK, { ...WORDS, title: 'Join garden' })
    buttons().at(-1)!.click()
    expect(document.activeElement).toBe(button)
  })
})

// The shell is versioned apart from the package: it offers its 'show code'
// button only to a queen that says she draws one, and never hands the word
// 'qr' to a queen that does not.
describe('the invite queen', () => {
  it('says she draws the room as a code, and has the door that draws it', async () => {
    const world = globalThis as unknown as { ioc?: unknown }
    world.ioc ??= { get: () => undefined, register: () => undefined, whenReady: () => undefined }
    const { InviteQueenBee } = await import('./invite.queen.js')
    const queen = new InviteQueenBee()
    expect(queen.meetingCode).toBe(true)
    expect(typeof queen.meetingLink).toBe('function')
  })
})
