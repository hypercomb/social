import { afterEach, describe, expect, it, vi } from 'vitest'
import { GUIDE_SURFACE, GuideOverlayElement, type GuideBoard } from './guide-overlay.view.js'
import type { GuideIdea } from './guide-place.js'

if (!customElements.get(GUIDE_SURFACE)) customElements.define(GUIDE_SURFACE, GuideOverlayElement)

const mount = (): GuideOverlayElement => {
  const overlay = document.createElement(GUIDE_SURFACE) as GuideOverlayElement
  document.body.appendChild(overlay)
  overlay.arm()
  return overlay
}

const ideas: readonly GuideIdea[] = [
  { id: 'a', icon: 'description', word: 'purpose', label: 'Say what this tile is for' },
  { id: 'b', icon: 'lightbulb', word: 'next', label: 'Suggest one next change' },
]

const board = (over: Partial<GuideBoard> = {}): GuideBoard => ({
  route: '/press-kit',
  name: 'Press kit',
  reading: '',
  ideas,
  chosen: new Set(),
  mode: 'tiles',
  box: { left: 900, width: 320, middle: 400 },
  ...over,
})

const q = (overlay: GuideOverlayElement, selector: string): HTMLElement =>
  overlay.shadowRoot!.querySelector<HTMLElement>(selector)!

afterEach(() => {
  document.querySelector(GUIDE_SURFACE)?.remove()
})

describe('guide overlay', () => {
  it('beside the tiles the board lists only what is chosen and cannot accept nothing', () => {
    const overlay = mount()
    overlay.board(board())
    expect(q(overlay, '.route').textContent).toBe('/press-kit')
    expect(q(overlay, '.name').textContent).toBe('Press kit')
    expect(q(overlay, '.empty').textContent).toBe('Pick what you want done.')
    expect((q(overlay, '.accept') as HTMLButtonElement).disabled).toBe(true)

    overlay.board(board({ chosen: new Set(['b']) }))
    const rows = [...overlay.shadowRoot!.querySelectorAll('.item')]
    expect(rows.map(row => row.textContent)).toEqual(['checkSuggest one next change'])
    expect(q(overlay, '.accept').textContent).toBe('Accept 1')
  })

  it('stands beside the middle: tiles centre on the tile, a list fills the free height', () => {
    const overlay = mount()
    overlay.board(board())
    expect(q(overlay, '.board').style.left).toBe('900px')
    expect(q(overlay, '.board').style.transform).toBe('translateY(-50%)')
    overlay.board(board({ mode: 'list', box: { left: 760, width: 560, top: 72, height: 700 } }))
    expect(q(overlay, '.board').style.height).toBe('700px')
    expect(q(overlay, '.board').style.transform).toBe('')
  })

  it('as a list it holds every idea, and a row reports its own toggle', () => {
    const overlay = mount()
    const toggled = vi.fn()
    overlay.onToggle = toggled
    overlay.board(board({ mode: 'list' }))
    const rows = [...overlay.shadowRoot!.querySelectorAll<HTMLButtonElement>('.item')]
    expect(rows).toHaveLength(2)
    rows[1]!.click()
    expect(toggled).toHaveBeenCalledWith('b')
  })

  it('reports the mode words, accept and close', () => {
    const overlay = mount()
    const mode = vi.fn()
    const accept = vi.fn()
    const close = vi.fn()
    overlay.onMode = mode
    overlay.onAccept = accept
    overlay.onClose = close
    overlay.board(board({ chosen: new Set(['a']) }))
    const words = [...overlay.shadowRoot!.querySelectorAll<HTMLButtonElement>('.word')]
    expect(words.map(word => word.textContent)).toEqual(['Tiles', 'List', 'Close'])
    expect(words[0]!.classList.contains('on')).toBe(true)
    words[1]!.click()
    expect(mode).toHaveBeenCalledWith('list')
    words[2]!.click()
    expect(close).toHaveBeenCalledOnce()
    q(overlay, '.accept').click()
    expect(accept).toHaveBeenCalledOnce()
  })

  it('keeps the list where it was scrolled when a pick redraws it', () => {
    const overlay = mount()
    overlay.board(board({ mode: 'list' }))
    q(overlay, '.items').scrollTop = 40
    const before = q(overlay, '.items').scrollTop
    overlay.board(board({ mode: 'list', chosen: new Set(['a']) }))
    expect(q(overlay, '.items').scrollTop).toBe(before)
  })

  it('the shield takes the pointer, and seating gives the real cursor back', () => {
    const overlay = mount()
    const aimed = vi.fn()
    const pressed = vi.fn()
    overlay.onAim = aimed
    overlay.onPress = pressed
    expect(q(overlay, '.shield').hidden).toBe(true)
    overlay.shield()
    expect(q(overlay, '.shield').hidden).toBe(false)
    q(overlay, '.shield').dispatchEvent(new MouseEvent('click', { clientX: 12, clientY: 34, bubbles: true }))
    expect(pressed).toHaveBeenCalledWith(12, 34)
    overlay.seat()
    expect(overlay.classList.contains('seated')).toBe(true)
    overlay.board(board())
    expect(overlay.boardOpen).toBe(true)
    overlay.unseat()
    expect(overlay.classList.contains('seated')).toBe(false)
    expect(overlay.boardOpen).toBe(false)
    expect(q(overlay, '.shield').hidden).toBe(true)
  })

  it('rollover shows a label over the tile, and empty text takes it away', () => {
    const overlay = mount()
    overlay.shield()
    overlay.label('Say what this tile is for', 300, 200)
    expect(q(overlay, '.label').textContent).toBe('Say what this tile is for')
    expect(q(overlay, '.label').classList.contains('show')).toBe(true)
    expect(q(overlay, '.shield').classList.contains('over')).toBe(true)
    overlay.label('', 0, 0)
    expect(q(overlay, '.label').classList.contains('show')).toBe(false)
    expect(q(overlay, '.shield').classList.contains('over')).toBe(false)
  })

  it('waggles in place when motion is allowed, and disarm stops the dance', () => {
    const overlay = mount()
    overlay.classList.add('motion')
    overlay.waggle(true)
    expect(overlay.classList.contains('waggle')).toBe(true)
    overlay.waggle(false)
    expect(overlay.classList.contains('waggle')).toBe(false)
    overlay.waggle(true)
    overlay.disarm()
    expect(overlay.classList.contains('waggle')).toBe(false)
    overlay.classList.remove('motion')
    overlay.waggle(true)
    expect(overlay.classList.contains('waggle')).toBe(false)
  })
})
