import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ShellSurfaceRegistry } from '../../core/shell-surface-registry'

const FIRST = 'hc-shell-surface-spec-first'
const SECOND = 'hc-shell-surface-spec-second'

if (!customElements.get(FIRST)) customElements.define(FIRST, class extends HTMLElement {})
if (!customElements.get(SECOND)) customElements.define(SECOND, class extends HTMLElement {})

const values = new Map<string, unknown>()
let registryKey = ''
let elementClass: CustomElementConstructor

beforeAll(async () => {
  const getValue = (key: string): unknown => values.get(key)
  const registerValue = (key: string, value: unknown): void => { values.set(key, value) }
  Object.assign(globalThis, { get: getValue, register: registerValue })
  ;(window as unknown as { ioc: unknown }).ioc = { get: getValue, register: registerValue }
  const registryModule = await import('../../core/shell-surface-registry')
  registryKey = registryModule.SHELL_SURFACE_REGISTRY_KEY
  const elementModule = await import('./shell-surfaces.element')
  elementClass = elementModule.ShellSurfacesElement
})

const registry = (): ShellSurfaceRegistry => values.get(registryKey) as ShellSurfaceRegistry

const settle = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  registry().remove(FIRST)
  registry().remove(SECOND)
  document.body.replaceChildren()
})

describe('hc-shell-surfaces', () => {
  it('reconciles element registrations by order without recreating survivors', async () => {
    expect(customElements.get('hc-shell-surfaces')).toBe(elementClass)
    const host = document.createElement('hc-shell-surfaces')
    document.body.appendChild(host)

    registry().add({ name: FIRST, element: FIRST, order: 20 })
    await settle()
    const survivor = host.querySelector(FIRST)
    expect(survivor).toBeInstanceOf(HTMLElement)

    registry().add({ name: SECOND, element: SECOND, order: 10 })
    await settle()
    expect([...host.children].map(node => node.tagName.toLowerCase())).toEqual([SECOND, FIRST])
    expect(host.querySelector(FIRST)).toBe(survivor)

    registry().remove(FIRST)
    await settle()
    expect(host.querySelector(FIRST)).toBeNull()
    expect(host.querySelector(SECOND)).toBeInstanceOf(HTMLElement)
  })
})
