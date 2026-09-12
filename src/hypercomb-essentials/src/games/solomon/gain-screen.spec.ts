// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GainScreen, type GainHooks, type GainRequest } from './gain-screen.js'

function makeHooks(overrides: Partial<GainHooks> = {}): { hooks: GainHooks; seenIds: Set<string> } {
  const seenIds = new Set<string>()
  const hooks: GainHooks = {
    seen: id => seenIds.has(id),
    markSeen: vi.fn((ids: readonly string[]) => { for (const id of ids) seenIds.add(id) }),
    board: () => null,
    closed: vi.fn(),
    ...overrides,
  }
  return { hooks, seenIds }
}

function request(overrides: Partial<GainRequest> = {}): GainRequest {
  return {
    id: 'piece:triangle-0',
    eyebrow: 'A RELIC PIECE',
    title: 'A Triangle Point',
    words: 'One of six.',
    art: { kind: 'piece', piece: 'triangle', point: 0 },
    fresh: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren() })

describe('GainScreen: the one reveal dialog for everything attained', () => {
  it('is hidden until shown, and a click on the sole × closes it', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const { hooks } = makeHooks()
    const screen = new GainScreen(host, hooks)
    const card = host.querySelector('.sol-gain') as HTMLElement
    expect(card.hidden).toBe(true)
    expect(screen.isOpen).toBe(false)

    screen.show(request())
    expect(screen.isOpen).toBe(true)
    expect(card.hidden).toBe(false)
    expect(card.querySelector('.sol-gain-title')?.textContent).toBe('A Triangle Point')
    expect(card.querySelector('.sol-gain-eyebrow')?.textContent).toBe('A RELIC PIECE')
    expect(card.querySelector('.sol-gain-words')?.textContent).toBe('One of six.')

    // No second dismiss control anywhere in the card (M3).
    const buttons = card.querySelectorAll('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]!.className).toBe('sol-gain-close')

    buttons[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(hooks.closed).toHaveBeenCalledTimes(1)
    expect(screen.isOpen).toBe(false)
    expect(card.hidden).toBe(true)
  })

  it('traps Tab on its own close button — the only focusable control', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const { hooks } = makeHooks()
    const screen = new GainScreen(host, hooks)
    screen.show(request())
    const card = host.querySelector('.sol-gain') as HTMLElement
    const close = card.querySelector('.sol-gain-close') as HTMLButtonElement
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    card.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close)
  })

  it('marks a fresh request seen before the scene plays, and drops a re-triggered "read again" outright', () => {
    const { hooks, seenIds } = makeHooks()
    const host = document.createElement('div')
    const screen = new GainScreen(host, hooks)
    screen.show(request({ id: 'piece:hexagon' }))
    expect(hooks.markSeen).toHaveBeenCalledWith(['piece:hexagon'])
    expect(seenIds.has('piece:hexagon')).toBe(true)

    screen.close()
    ;(hooks.markSeen as ReturnType<typeof vi.fn>).mockClear()
    // The shell only calls show() again for an already-seen id on a "read
    // again" — GainScreen.show is belt-and-suspenders against that (§3.8.2).
    screen.show(request({ id: 'piece:hexagon' }))
    expect(screen.isOpen).toBe(false)
    expect(hooks.markSeen).not.toHaveBeenCalled()
  })

  it('queues a second reveal behind an open one; pending counts it; closing advances to it and marks it seen only then', () => {
    const { hooks } = makeHooks()
    const host = document.createElement('div')
    const screen = new GainScreen(host, hooks)
    const first = request({ id: 'first', title: 'First' })
    const second = request({ id: 'second', title: 'Second' })

    screen.show(first)
    expect(screen.pending).toBe(0)
    screen.show(second)
    expect(screen.pending).toBe(1)
    expect(host.querySelector('.sol-gain-title')?.textContent).toBe('First')
    expect(hooks.markSeen).not.toHaveBeenCalledWith(['second'])

    // Showing the same still-queued id again does not double-enqueue it.
    screen.show(second)
    expect(screen.pending).toBe(1)

    screen.close()
    expect(screen.pending).toBe(0)
    expect(screen.isOpen).toBe(true)
    expect(host.querySelector('.sol-gain-title')?.textContent).toBe('Second')
    expect(hooks.markSeen).toHaveBeenCalledWith(['second'])
  })

  it('a duplicate show() of the request already open is a no-op, not a re-queue', () => {
    const { hooks } = makeHooks()
    const host = document.createElement('div')
    const screen = new GainScreen(host, hooks)
    screen.show(request({ id: 'same' }))
    screen.show(request({ id: 'same' }))
    expect(screen.pending).toBe(0)
    expect(hooks.markSeen).toHaveBeenCalledTimes(1)
  })

  it('renders an items list only when a request carries items', () => {
    const { hooks } = makeHooks()
    const host = document.createElement('div')
    const screen = new GainScreen(host, hooks)
    screen.show(request({
      id: 'chest-1',
      art: { kind: 'chest', items: ['gem', 'coins'] },
      items: [{ id: 'gem', name: 'A gem', kind: 'gem' }, { id: 'coins', name: 'Coins', kind: 'coins' }],
    }))
    const list = host.querySelector('.sol-gain-items') as HTMLElement
    expect(list.hidden).toBe(false)
    expect(list.querySelectorAll('li.sol-gain-item')).toHaveLength(2)
    expect(list.textContent).toContain('A gem')
    expect(list.textContent).toContain('Coins')

    screen.close()
    screen.show(request({ id: 'no-items' }))
    expect((host.querySelector('.sol-gain-items') as HTMLElement).hidden).toBe(true)
  })

  it('shows the filling board as a row of dots, the just-filled slot marked fresh, and hides it when the request carries no slot', () => {
    const { hooks } = makeHooks({
      board: id => id === 'star' ? { title: 'The Star', slots: [{ id: 'a', filled: true }, { id: 'b', filled: false }] } : null,
    })
    const host = document.createElement('div')
    const screen = new GainScreen(host, hooks)
    screen.show(request({ id: 'piece:a', slot: { board: 'star', slot: 'a' } }))
    const boardEl = host.querySelector('.sol-gain-board') as HTMLElement
    expect(boardEl.hidden).toBe(false)
    expect(boardEl.querySelector('.sol-gain-board-title')?.textContent).toBe('The Star · 1/2')
    const dots = boardEl.querySelectorAll('.sol-gain-dot')
    expect(dots).toHaveLength(2)
    expect(dots[0]!.classList.contains('is-filled')).toBe(true)
    expect(dots[0]!.classList.contains('is-fresh')).toBe(true)
    expect(dots[1]!.classList.contains('is-filled')).toBe(false)
    expect(dots[1]!.classList.contains('is-fresh')).toBe(false)

    screen.close()
    screen.show(request({ id: 'no-slot' }))
    expect((host.querySelector('.sol-gain-board') as HTMLElement).hidden).toBe(true)
  })

  it('renders a labyrinth combat-skill reveal exactly like any other fresh request — no special-casing', () => {
    const { hooks } = makeHooks()
    const host = document.createElement('div')
    const screen = new GainScreen(host, hooks)
    screen.show({
      id: 'skill:sickle',
      eyebrow: 'A COMBAT SKILL',
      title: 'Sickle of the Sun',
      words: 'A gold crescent, swift in close.',
      art: { kind: 'skill', skill: 'sickle' },
      fresh: true,
    })
    expect(screen.isOpen).toBe(true)
    expect(host.querySelector('.sol-gain-eyebrow')?.textContent).toBe('A COMBAT SKILL')
    expect(host.querySelector('.sol-gain-title')?.textContent).toBe('Sickle of the Sun')
    expect(hooks.markSeen).toHaveBeenCalledWith(['skill:sickle'])
    screen.close()
    expect(hooks.closed).toHaveBeenCalledTimes(1)
  })

  it('dispose() removes the card from the host', () => {
    const { hooks } = makeHooks()
    const host = document.createElement('div')
    const screen = new GainScreen(host, hooks)
    screen.show(request())
    screen.dispose()
    expect(host.querySelector('.sol-gain')).toBeNull()
  })
})
