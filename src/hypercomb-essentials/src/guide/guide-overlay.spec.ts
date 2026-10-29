import { afterEach, describe, expect, it, vi } from 'vitest'
import { GUIDE_SURFACE, GuideOverlayElement } from './guide-overlay.view.js'
import { beeDirections, placeFromElement, placeFromTile, tileSuggestions, type GuideTile } from './guide-place.js'

if (!customElements.get(GUIDE_SURFACE)) customElements.define(GUIDE_SURFACE, GuideOverlayElement)

const mount = (): GuideOverlayElement => {
  const overlay = document.createElement(GUIDE_SURFACE) as GuideOverlayElement
  document.body.appendChild(overlay)
  overlay.arm()
  return overlay
}

afterEach(() => {
  document.querySelector(GUIDE_SURFACE)?.remove()
})

describe('guide overlay', () => {
  it('drops a dialog of directions at the click and reports the one that is chosen', () => {
    const overlay = mount()
    const picked = vi.fn()
    overlay.onPick = picked
    const heading = document.createElement('h1')
    heading.textContent = 'Press kit'
    const place = placeFromElement(heading, { x: 40, y: 50 }, '/press-kit')
    const directions = beeDirections(place)
    overlay.show({ place, ...directions, from: 'bee', status: 'Asking the agent for directions.' })

    const buttons = [...overlay.shadowRoot!.querySelectorAll<HTMLButtonElement>('.options button')]
    expect(buttons.map(button => button.textContent)).toEqual([...directions.options])
    expect(overlay.shadowRoot!.querySelector('.chip')!.textContent).toBe('/press-kit')
    buttons[0]!.click()
    expect(picked).toHaveBeenCalledWith(directions.options[0])
  })

  it('dismiss puts the dialog away', () => {
    const overlay = mount()
    const dismissed = vi.fn()
    overlay.onDismiss = dismissed
    const heading = document.createElement('h1')
    heading.textContent = 'Press kit'
    const place = placeFromElement(heading, { x: 10, y: 10 }, '/')
    overlay.show({ place, ...beeDirections(place), from: 'bee', status: 'Asking.' })
    overlay.shadowRoot!.querySelector<HTMLButtonElement>('.dismiss')!.click()
    expect(overlay.dialogOpen).toBe(false)
    expect(dismissed).toHaveBeenCalledOnce()
  })

  it('names the beehaviors of a clicked tile', () => {
    const overlay = mount()
    const tile: GuideTile = {
      x: 20, y: 30, route: '/press-kit', label: 'press-kit', name: 'Press kit', behaviors: ['website', 'files'],
    }
    const suggestions = tileSuggestions(tile)
    overlay.show({ place: placeFromTile(tile), ...suggestions, from: 'bee', status: 'Asking the agent for a suggestion.' })
    expect(overlay.shadowRoot!.querySelector('.place')!.textContent).toBe('website · files')
    expect(overlay.shadowRoot!.querySelector('.chip')!.textContent).toBe('/press-kit')
    overlay.hint('Press kit\nwebsite · files\nPress and hold.')
    expect(overlay.shadowRoot!.querySelector('.hint')!.textContent).toContain('website · files')
    expect(overlay.shadowRoot!.querySelector('.hint')!.textContent).toContain('Press and hold.')
    overlay.ringChoices(200, 180, ['Change the page', 'Leave it as it is'], 80)
    const placed = [...overlay.shadowRoot!.querySelectorAll<HTMLButtonElement>('.choices button')]
    expect(placed.map(button => button.textContent)).toEqual(['Change the page', 'Leave it as it is'])
    expect(placed[0]!.style.left).toBe('280px')
    overlay.aimChoice(1)
    expect(placed[1]!.classList.contains('on')).toBe(true)
    overlay.aimChoice(-1)
    expect(placed[1]!.classList.contains('on')).toBe(false)
    expect(overlay.shadowRoot!.querySelector('.prompt')!.textContent).toBe('Some choices')
    const order = [...overlay.shadowRoot!.querySelector('.dialog')!.children].map(node => node.className)
    expect(order.indexOf('options')).toBeLessThan(order.indexOf('status'))
    overlay.show({ place: placeFromTile(tile), ...suggestions, from: 'bee', status: '' })
    expect((overlay.shadowRoot!.querySelector('.status') as HTMLElement).hidden).toBe(true)
    overlay.status('The agent offered these choices.')
    expect((overlay.shadowRoot!.querySelector('.status') as HTMLElement).hidden).toBe(false)
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
