import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandShellElement } from './command-shell.element'

const settle = async (): Promise<void> => { await Promise.resolve() }

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe('hc-command-shell', () => {
  it('owns input normalization and emits the parent-facing value and commit events', async () => {
    expect(customElements.get('hc-command-shell')).toBe(CommandShellElement)
    const shell = document.createElement('hc-command-shell') as CommandShellElement
    expect(shell).toBeInstanceOf(CommandShellElement)
    document.body.appendChild(shell)
    const values: string[] = []
    const commits: string[] = []
    shell.addEventListener('valueChange', event => values.push((event as CustomEvent<string>).detail))
    shell.addEventListener('commit', event => commits.push((event as CustomEvent<string>).detail))

    const input = shell.querySelector<HTMLInputElement>('.command-input')!
    input.value = '  honey'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

    expect(shell.value()).toBe('honey')
    expect(values).toEqual(['honey'])
    expect(commits).toEqual(['honey'])
  })

  it('renders suggestions and delegates keyboard acceptance using the active row index', async () => {
    const shell = document.createElement('hc-command-shell') as CommandShellElement
    document.body.appendChild(shell)
    shell.suggestions = ['amber', 'apiary']
    shell.typedPrefix = 'a'
    shell.showSuggestions = true
    await settle()

    const input = shell.querySelector<HTMLInputElement>('.command-input')!
    input.value = 'a'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))

    const requested: number[] = []
    shell.addEventListener('completionAcceptRequested', event => requested.push((event as CustomEvent<number>).detail))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))

    expect(shell.activeIndex()).toBe(1)
    expect(shell.querySelectorAll('.command-results li')).toHaveLength(2)
    expect(shell.querySelector('.command-results li.active')?.textContent).toContain('apiary')
    expect(requested).toEqual([1])
  })

  it('preserves the controller API and routes prompt and rail gestures as DOM events', async () => {
    const shell = document.createElement('hc-command-shell') as CommandShellElement
    document.body.appendChild(shell)
    shell.promptSigil = 'slash'
    shell.featuresPanelOpen = true
    shell.viewToggles = [{ view: 'website', icon: 'language', label: 'Website', active: false }]
    await settle()

    const promptToggle = vi.fn()
    const featuresToggle = vi.fn()
    const viewToggle = vi.fn()
    shell.addEventListener('promptSigilToggle', promptToggle)
    shell.addEventListener('featuresToggle', featuresToggle)
    shell.addEventListener('viewToggle', viewToggle)

    shell.querySelector<HTMLElement>('.prompt-glyph')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    shell.querySelector<HTMLElement>('.features-toggle-btn')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    const view = shell.querySelector<HTMLElement>('.view-toggle-btn')!
    view.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    view.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

    shell.setValue('nectar')
    shell.selectRange(1, 4)
    await settle()
    expect(shell.value()).toBe('nectar')
    expect(promptToggle).toHaveBeenCalledOnce()
    expect(featuresToggle).toHaveBeenCalledOnce()
    expect((viewToggle.mock.calls[0][0] as CustomEvent).detail).toEqual({ view: 'website', disable: false })
  })
})
