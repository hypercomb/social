import { describe, expect, it, vi } from 'vitest'
import './hint-bar.element'

describe('hc-hint-bar', () => {
  it('renders matching, chosen and coloured crumbs and emits the picked item', () => {
    const element = document.createElement('hc-hint-bar') as HTMLElement & {
      items: readonly string[]
      filter: string
      chosen: ReadonlySet<string>
      colorMap: ReadonlyMap<string, string>
    }
    document.body.appendChild(element)
    element.items = ['glacier', 'ember']
    element.filter = 'gl'
    element.chosen = new Set(['ember'])
    element.colorMap = new Map([['glacier', 'rgb(1, 2, 3)']])

    const buttons = [...element.querySelectorAll<HTMLButtonElement>('button')]
    expect(buttons).toHaveLength(2)
    expect(buttons[0].classList.contains('hint-matched')).toBe(true)
    expect(buttons[0].querySelector('.hint-dot')).not.toBeNull()
    expect(buttons[1].classList.contains('hint-matched')).toBe(false)
    expect(buttons[1].classList.contains('hint-chosen')).toBe(true)

    const picked = vi.fn()
    element.addEventListener('pick', picked)
    buttons[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect((picked.mock.calls[0][0] as CustomEvent<string>).detail).toBe('glacier')
    element.remove()
  })

  it('leaves no bar in the DOM when the item list is empty', () => {
    const element = document.createElement('hc-hint-bar') as HTMLElement & { items: readonly string[] }
    document.body.appendChild(element)
    element.items = ['one']
    expect(element.querySelector('.hint-bar')).not.toBeNull()
    element.items = []
    expect(element.querySelector('.hint-bar')).toBeNull()
    element.remove()
  })
})
