// sandbox-change.view.spec.ts — the what-changed panel, rendered. It opens on
// a fresh `module:changes` (never on a replay), draws the change file by file
// with the host AI's reading and people's notes as TEXT, steps through the
// zone's trials, and closes on Escape.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    has: () => false,
    list: () => [],
    whenReady: () => { /* noop */ },
  }
})

const { EffectBus, SignatureService } = await import('@hypercomb/core')
const { SandboxChangeElement, SANDBOX_CHANGE_EFFECT, SANDBOX_CHANGE_SURFACE } = await import('./sandbox-change.view.js')

if (!customElements.get(SANDBOX_CHANGE_SURFACE)) customElements.define(SANDBOX_CHANGE_SURFACE, SandboxChangeElement)

const heap = new Map<string, string>()
const put = async (text: string): Promise<string> => {
  const sig = await SignatureService.sign(new TextEncoder().encode(text).buffer as ArrayBuffer)
  heap.set(sig, text)
  return sig
}

const trialSite = async () => {
  const root = 'e'.repeat(64)
  const [before, after] = await Promise.all([put('export const zoom = 1;\n'), put('export const zoom = 2;\n')])
  const change = await put(JSON.stringify({ kind: 'module-change', sandbox: 'try-zoom', root, off: ['games/pong'], at: 1_700_000_000_000, changes: [{ path: 'p', section: 'src/a.ts', from: 'x', to: 'y', before, after }] }))
  const findings = await put('Looks fine.\nVERDICT: accept')
  const review = await put(JSON.stringify({ kind: 'module-review', verdict: 'accept', model: 'm', findings }))
  const note = await put('<img src=x onerror=alert(1)> raises zoom')
  const record = await put(JSON.stringify({ kind: 'module-assessment', root, verdict: 'refuse', note }))
  return {
    sandbox: true as const, title: 'try-zoom', package: root, pubkey: 'b'.repeat(64), publisher: 'Jaime', change, review,
    reviewVerdict: 'accept' as const, assessments: [{ pubkey: 'c'.repeat(64), record, verdict: 'refuse' as const, at: 1 }],
  }
}

const listing = (names: string[]) => ({
  trials: names.map((name, i) => ({ name, door: `https://${name}.hypercomb.com`, package: 'e'.repeat(64), pubkey: 'b'.repeat(64), publisher: 'Jaime', at: 10 - i, sections: [], off: [] })),
})

let element: InstanceType<typeof SandboxChangeElement>
const realFetch = globalThis.fetch

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const address = String(url)
    if (address === 'https://hypercomb.com/trials.json') return new Response(JSON.stringify(listing(['try-zoom', 'try-other'])))
    return new Response('nothing', { status: 404 })
  }) as typeof fetch
  element = document.createElement(SANDBOX_CHANGE_SURFACE) as InstanceType<typeof SandboxChangeElement>
  element.reader = () => async sig => heap.get(sig) ?? null
  document.body.appendChild(element)
})

afterEach(() => {
  element.remove()
  globalThis.fetch = realFetch
})

const panelText = (): string => element.querySelector('.hc-trial')?.textContent ?? ''

describe('the what-changed panel', () => {
  it('draws the change, the host AI reading and people\'s notes, and says where it stands among the trials', async () => {
    const site = await trialSite()
    await element.show({ name: 'try-zoom', door: 'https://try-zoom.hypercomb.com', site, at: Date.now() })
    const rows = [...element.querySelectorAll('.hc-trial-row')].map(row => `${row.className.replace('hc-trial-row ', '')}|${row.textContent}`)
    expect(rows).toEqual(['is-remove|− export const zoom = 1;', 'is-add|+ export const zoom = 2;'])
    expect(panelText()).toContain('src/a.ts')
    expect(panelText()).toContain('+1 −1')
    expect(panelText()).toContain('Looks fine.')
    expect(panelText()).toContain('games/pong')
    expect(panelText()).toContain('1 of 2')
    // A note is somebody's words: drawn as text, never as markup.
    expect(element.querySelector('.hc-trial img')).toBeNull()
    expect(panelText()).toContain('<img src=x onerror=alert(1)> raises zoom')
    expect(element.querySelector<HTMLAnchorElement>('.hc-trial-door')?.href).toBe('https://try-zoom.hypercomb.com/')
  })

  it('opens on a fresh request only, and closes on Escape', async () => {
    const site = await trialSite()
    EffectBus.emit(SANDBOX_CHANGE_EFFECT, { name: 'try-zoom', door: 'https://try-zoom.hypercomb.com', site, at: 0 })
    expect(element.isOpen).toBe(false)
    EffectBus.emit(SANDBOX_CHANGE_EFFECT, { name: 'try-zoom', door: 'https://try-zoom.hypercomb.com', site, at: Date.now() })
    expect(element.isOpen).toBe(true)
    element.querySelector('.hc-trial')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(element.isOpen).toBe(false)
  })
})
