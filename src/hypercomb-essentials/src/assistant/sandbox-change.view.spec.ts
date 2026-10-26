// sandbox-change.view.spec.ts — the what-changed panel, rendered. It opens on
// a fresh `module:changes` (never on a replay), draws the change file by file
// with the host AI's reading and people's notes as TEXT, steps through the
// zone's trials, and closes on Escape.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The zone lists its trials at sign('host:trials') — never a named route.
const TRIALS = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('host:trials')))]
  .map(byte => byte.toString(16).padStart(2, '0')).join('')

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
  const change = await put(JSON.stringify({ kind: 'module-change', sandbox: 'try-zoom', root, off: ['games/pong'], at: 1_700_000_000_000, changes: [{ path: 'p', section: 'src/a.ts', from: 'x', to: 'y', before, after }], taken: [{ path: 'notes', root: 'f'.repeat(64) }] }))
  const findings = await put('Looks fine.\nVERDICT: accept')
  const review = await put(JSON.stringify({ kind: 'module-review', verdict: 'accept', model: 'm', findings }))
  const jev = await put(JSON.stringify({ kind: 'jev-reading', verdict: 'follows', model: 'jev', files: [{ section: 'src/a.ts', worst: { rule: 'The Life Primitive', breaks: 0.02 }, rules: [] }] }))
  const note = await put('<img src=x onerror=alert(1)> raises zoom')
  const record = await put(JSON.stringify({ kind: 'module-assessment', root, verdict: 'refuse', note }))
  return {
    sandbox: true as const, title: 'try-zoom', package: root, pubkey: 'b'.repeat(64), publisher: 'Jaime', change, review,
    reviewVerdict: 'accept' as const, jev, jevVerdict: 'follows' as const, assessments: [{ pubkey: 'c'.repeat(64), record, verdict: 'refuse' as const, at: 1 }],
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
    if (address === `https://hypercomb.com/${TRIALS}`) return new Response(JSON.stringify(listing(['try-zoom', 'try-other'])))
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
    // Jev's reading: the standing, and each file's rule closest to breaking.
    expect(panelText()).toContain('Jev — the doctrine, rule by rule')
    expect(panelText()).toContain('follows · jev')
    expect(panelText()).toContain('src/a.ts: closest to breaking "The Life Primitive" (2%)')
    expect(panelText()).toContain('games/pong')
    // What the build folded in from other builds, and where each came from.
    expect(panelText()).toContain('What it takes from other builds')
    expect(panelText()).toContain('notes — from ffffffffffff…')
    expect(panelText()).toContain('1 of 2')
    // A note is somebody's words: drawn as text, never as markup.
    expect(element.querySelector('.hc-trial img')).toBeNull()
    expect(panelText()).toContain('<img src=x onerror=alert(1)> raises zoom')
    expect(element.querySelector<HTMLAnchorElement>('.hc-trial-door')?.href).toBe('https://try-zoom.hypercomb.com/')
  })

  it('takes one file\'s change into this hive by hand, and points to the brood where it waits', async () => {
    const site = await trialSite()
    const picked: string[] = []
    element.taker = () => ({
      revisionsOf: async (_path, _zones, roots) => [{ layer: 'd'.repeat(64), sources: roots.map(root => ({ root })) }],
      pick: async (path, revision, zones, options) => { picked.push(`${path}|${revision.root.slice(0, 4)}|${zones.join()}|${options.byHand}`); return { ok: true } },
      held: async () => 1,
    })
    await element.show({ name: 'try-zoom', door: 'https://try-zoom.hypercomb.com', site, at: Date.now() })
    const take = element.querySelector<HTMLButtonElement>('.hc-trial-take')!
    expect(take.textContent).toBe('take')
    take.click()
    await vi.waitFor(() => expect(element.querySelector('.hc-trial-taken')?.textContent).toBe('taken — it waits in the brood until you accept it'))
    expect(picked).toEqual(['p|eeee|try-zoom.hypercomb.com|true'])
    let opened = false
    const off = EffectBus.on<{ at?: number }>('brood:open', payload => { if (Date.now() - (payload?.at ?? 0) < 1_000) opened = true })
    element.querySelector<HTMLButtonElement>('.hc-trial-take')!.click()
    off()
    expect(opened).toBe(true)
    expect(element.isOpen).toBe(false)
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

// jwize, 2026-10-25: "make sure the workflow is very clear what is happening
// or the participant will be lost".
describe('the steps on top — where you stand', () => {
  const steps = (): string[] => [...element.querySelectorAll('.hc-trial-step')]
    .map(step => `${step.classList.contains('is-done') ? 'done' : step.classList.contains('is-here') ? 'here' : '-'}|${step.querySelector('.hc-trial-step-title')?.textContent}`)
  const acts = (): string[] => [...element.querySelectorAll('.hc-trial-act')].map(act => act.textContent ?? '')

  it('draft and trial are done, the trial opens in its own tab, and the choice is where you stand', async () => {
    const site = await trialSite()
    await element.show({ name: 'try-zoom', door: 'https://try-zoom.hypercomb.com', site, at: Date.now() })
    expect(steps()).toEqual(['done|Draft', 'done|Trial', 'done|Reviewed', 'here|Your choice'])
    const open = element.querySelector<HTMLAnchorElement>('.hc-trial-step a')!
    expect(open.href).toBe('https://try-zoom.hypercomb.com/')
    expect(open.target).toBe('_blank')
    expect(open.rel).toBe('noopener')
    expect(element.querySelector('iframe')).toBeNull()
  })

  it('a trial nobody has read stands at Reviewed', async () => {
    const site = { ...await trialSite(), review: undefined, jev: undefined, assessments: [] }
    await element.show({ name: 'try-zoom', door: 'https://try-zoom.hypercomb.com', site, at: Date.now() })
    expect(steps()).toEqual(['done|Draft', 'done|Trial', 'here|Reviewed', '-|Your choice'])
    expect(panelText()).toContain('Nobody has read it yet.')
  })

  it('anyone may take it; only its publisher is offered promote and withdraw', async () => {
    const site = await trialSite()
    element.me = async () => 'c'.repeat(64)
    await element.show({ name: 'try-zoom', door: 'https://try-zoom.hypercomb.com', site, at: Date.now() })
    expect(acts()).toEqual(['Take'])
    element.me = async () => 'B'.repeat(64)
    await element.show({ name: 'try-zoom', door: 'https://try-zoom.hypercomb.com', site, at: Date.now() })
    expect(acts()).toEqual(['Take', 'Promote', 'Withdraw'])
    expect(panelText()).toContain('promote it to zoom.hypercomb.com')
  })

  it('promote is put on the command line for the participant to say — never said for them', async () => {
    const site = await trialSite()
    element.me = async () => 'b'.repeat(64)
    await element.show({ name: 'try-zoom', door: 'https://try-zoom.hypercomb.com', site, at: Date.now() })
    const filled: unknown[] = []
    const submitted: unknown[] = []
    const off = [
      EffectBus.on('search:prefill', payload => { filled.push(payload) }),
      EffectBus.on('command:submit', payload => { submitted.push(payload) }),
    ]
    filled.length = 0
    ;[...element.querySelectorAll<HTMLButtonElement>('.hc-trial-act')].find(act => act.textContent === 'Promote')!.click()
    for (const stop of off) stop()
    expect(filled.at(-1)).toEqual({ value: 'module promote zoom @hypercomb.com', focus: true })
    expect(submitted).toEqual([])
  })

  it('take takes every changed file, and the choice then says it waits in the brood', async () => {
    const site = await trialSite()
    const picked: string[] = []
    element.taker = () => ({
      revisionsOf: async (_path, _zones, roots) => [{ layer: 'd'.repeat(64), sources: roots.map(root => ({ root })) }],
      pick: async path => { picked.push(path); return { ok: true } },
      held: async () => 1,
    })
    await element.show({ name: 'try-zoom', door: 'https://try-zoom.hypercomb.com', site, at: Date.now() })
    ;[...element.querySelectorAll<HTMLButtonElement>('.hc-trial-act')].find(act => act.textContent === 'Take')!.click()
    await vi.waitFor(() => expect(panelText()).toContain('Taken. It waits in the brood until you accept it there.'))
    expect(picked).toEqual(['p'])
    expect(steps().at(-1)).toBe('done|Your choice')
  })
})
