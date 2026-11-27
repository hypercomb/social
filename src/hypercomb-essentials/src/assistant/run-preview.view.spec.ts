// run-preview.view.spec.ts — a waiting call is drawn over the hive, as code,
// with what each line will do, and answered with the line's own two keys.
//
// The external-call bee adds only the tag at boot and defines the view on the
// first waiting call; the element already in the page upgrades and takes the
// ask from the bus's replay. Each line's plan is the door's reading
// (line-plan.ts); here a fixed census stands in for the live one.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MACHINE_GRANT, EffectBus, EXTERNAL_ANSWER, EXTERNAL_ASK, type ExternalAnswer } from '@hypercomb/core'
import { readUtterance } from '../commands/utterance/utterance-reading.js'
import type { PlanEntry } from '../commands/utterance/line-plan.js'

vi.hoisted(() => {
  ;(globalThis as unknown as { __added: unknown[] }).__added = []
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: (key: string, callback: (registry: unknown) => void) => {
      if (key !== '@hypercomb.social/ShellSurfaceRegistry') return
      callback({ add: (surface: unknown) => { (globalThis as unknown as { __added: unknown[] }).__added.push(surface) } })
    },
  }
})

const TAG = 'hc-run-preview'
const CENSUS: readonly PlanEntry[] = [
  { name: 'go', description: 'Walk the hive to a path', options: ['<path>'] },
  { name: 'website', description: 'Dress a tile as a page', rawArgs: true },
  { name: 'record', description: '' },
]
const SIG = 'ab'.repeat(32)

beforeAll(async () => {
  await import('./external-call.drone.js')
})

describe('the run preview', () => {
  it('is added as a surface at boot and defined only by the first waiting call', async () => {
    expect((globalThis as unknown as { __added: unknown[] }).__added).toContainEqual(
      { name: TAG, owner: '@diamondcoreprocessor.com/RunPreviewView', element: TAG, order: 153 })
    expect(customElements.get(TAG)).toBeUndefined()
    const view = await import('./run-preview.view.js')
    expect(view.RUN_PREVIEW_SURFACE).toBe(TAG)
    expect(view.RUN_PREVIEW_OWNER).toBe('@diamondcoreprocessor.com/RunPreviewView')
  })

  it('draws every line as code with what it will do, and answers on Enter', async () => {
    const element = document.createElement(TAG) as HTMLElement & { deps?: unknown }
    document.body.appendChild(element)
    const answers: ExternalAnswer[] = []
    const off = EffectBus.on<ExternalAnswer>(EXTERNAL_ANSWER, answer => { if (answer) answers.push(answer) })
    answers.length = 0
    EffectBus.emit(EXTERNAL_ASK, { id: 'x1', from: 'living-blocks', lines: ['go /intro', `website page ${SIG}`, 'please be nice', 'record'], waiting: 0 })
    await vi.waitFor(() => expect(customElements.get(TAG)).toBeDefined(), { timeout: 10_000 })
    ;(element as unknown as { deps: () => unknown }).deps = () => ({
      census: CENSUS, read: (text: string) => readUtterance(text, CENSUS), grant: { ...DEFAULT_MACHINE_GRANT, granted: [] },
    })
    EffectBus.emit(EXTERNAL_ASK, { id: 'x1', from: 'living-blocks', lines: ['go /intro', `website page ${SIG}`, 'please be nice', 'record'], waiting: 0 })

    const rows = () => [...element.querySelectorAll('.hc-run-line')]
    expect(rows()).toHaveLength(4)
    expect(element.querySelector('.hc-run-from')?.textContent).toBe('living-blocks')
    expect(rows()[0]!.querySelector('.hc-tok-verb')?.textContent).toBe('go')
    // one list: no meaning shown until the term is clicked, then it breaks out
    expect(element.querySelector('.hc-run-breakout')).toBeNull()
    rows()[0]!.querySelector<HTMLElement>('[data-term="go"]')!.click()
    expect(rows()[0]!.querySelector('.hc-run-meaning')?.textContent?.trim()).toBe('Walk the hive to a path')
    // exactly what it is handed: the reader drops the path's slash
    expect(rows()[0]!.querySelector('.hc-run-handed-args')?.textContent).toBe('intro')
    rows()[0]!.querySelector<HTMLElement>('[data-term="go"]')!.click()
    expect(rows()[0]!.querySelector('.hc-run-breakout')).toBeNull()
    // a signature is drawn short and kept whole in its title
    const sig = rows()[1]!.querySelector<HTMLElement>('.hc-tok-sig')
    expect(sig?.title).toBe(SIG)
    // prose that names nothing is refused before it runs; its tag breaks out why
    expect(rows()[2]!.classList.contains('is-refused')).toBe(true)
    rows()[2]!.querySelector<HTMLElement>('.hc-run-tag')!.click()
    expect(rows()[2]!.querySelector('.hc-run-breakout.is-alert')?.textContent).toMatch(/nothing will run/)
    // a behaviour that says nothing about itself is shown as missing
    rows()[3]!.querySelector<HTMLElement>('[data-term="record"]')!.click()
    expect(rows()[3]!.querySelector('.hc-run-meaning')?.classList.contains('is-missing')).toBe(true)

    // armed after a second, as on the line
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(answers).toHaveLength(0)
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 1500)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    clock.mockRestore()
    expect(answers).toEqual([{ id: 'x1', decision: 'run' }])

    EffectBus.emit(EXTERNAL_ASK, null)
    expect(element.querySelector('.hc-run')).toBeNull()
    off()
  })

  it('debugs: F10 starts paused, results list under each line, stop ends it', async () => {
    const element = document.querySelector(TAG) as HTMLElement & { deps: () => unknown }
    element.deps = () => ({ census: CENSUS, read: (text: string) => readUtterance(text, CENSUS), grant: { ...DEFAULT_MACHINE_GRANT, granted: [] } })
    const sent: Array<{ effect: string; payload: unknown }> = []
    const offs = ['external-call:debug', 'external-call:resume', EXTERNAL_ANSWER].map(effect =>
      EffectBus.on(effect, payload => { if (payload) sent.push({ effect, payload }) }))
    sent.length = 0
    EffectBus.emit(EXTERNAL_ASK, { id: 'x3', from: 'agent', lines: ['go /a', 'go /b', 'go /c'], waiting: 0 })
    // a breakpoint by its line number
    element.querySelectorAll<HTMLElement>('.hc-run-gutter')[2]!.click()
    expect(element.querySelector('.hc-run-gutter.has-break')?.textContent).toBe('3')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1500)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', bubbles: true }))
    clock.mockRestore()
    expect(sent).toEqual([
      { effect: 'external-call:debug', payload: { id: 'x3', step: true, breakpoints: [2] } },
      { effect: EXTERNAL_ANSWER, payload: { id: 'x3', decision: 'run' } },
    ])
    // the bee answers: the ask leaves the line, the run pauses before line 1
    EffectBus.emit(EXTERNAL_ASK, null)
    EffectBus.emitTransient('external-call:paused', { id: 'x3', at: 0, total: 3 })
    expect(element.querySelector('.hc-run-line.is-here .hc-run-gutter')?.textContent).toBe('1')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', bubbles: true }))
    expect(sent.at(-1)).toEqual({ effect: 'external-call:resume', payload: { id: 'x3', mode: 'step' } })
    EffectBus.emitTransient('external-call:line', { id: 'x3', at: 0, text: 'go /a', verdict: 'ran /go', heard: ['Go: /a'] })
    const results = [...element.querySelectorAll('.hc-run-line')[0]!.querySelectorAll('.hc-run-result')].map(r => r.textContent)
    expect(results).toEqual(['ran /go', 'Go: /a'])
    EffectBus.emitTransient('external-call:paused', { id: 'x3', at: 1, total: 3 })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', shiftKey: true, bubbles: true }))
    expect(sent.at(-1)).toEqual({ effect: 'external-call:resume', payload: { id: 'x3', mode: 'stop' } })
    EffectBus.emitTransient('external-call:finished', { id: 'x3', kind: 'ran', stoppedAt: 1 })
    expect(element.querySelectorAll('.hc-run-line.is-unsaid')).toHaveLength(2)
    // finished: it stays to be read, Escape puts it away
    expect(element.querySelector('.hc-run')).not.toBeNull()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(element.querySelector('.hc-run')).toBeNull()
    offs.forEach(off => off())
  })

  it('shows your own line as you type it (F2), and puts it away', () => {
    const element = document.querySelector(TAG) as HTMLElement & { deps: () => unknown }
    element.deps = () => ({ census: CENSUS, read: (text: string) => readUtterance(text, CENSUS), grant: { ...DEFAULT_MACHINE_GRANT, granted: [] } })
    let closed = 0
    const off = EffectBus.on('run-preview:line-close', () => { closed++ })
    closed = 0
    EffectBus.emit('run-preview:line', { text: 'go /intro and record', line: '/go /intro and record', stance: 'command' })
    expect(element.querySelector('.hc-run-from')?.textContent).toBe('Your line')
    expect([...element.querySelectorAll('[data-term]')].map(n => n.textContent)).toEqual(['go', 'record'])
    EffectBus.emit('run-preview:line', { text: 'apple', line: 'apple', stance: 'tiles' })
    element.querySelector<HTMLElement>('.hc-run-tag')!.click()
    expect(element.querySelector('.hc-run-breakout')?.textContent).toMatch(/makes a tile/)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(closed).toBe(1)
    expect(element.querySelector('.hc-run')).toBeNull()
    EffectBus.emit('run-preview:line', { text: null })
    off()
  })

  it('leaves the keys to the command line while it has them', async () => {
    const element = document.querySelector(TAG)!
    const answers: ExternalAnswer[] = []
    const off = EffectBus.on<ExternalAnswer>(EXTERNAL_ANSWER, answer => { if (answer) answers.push(answer) })
    answers.length = 0
    EffectBus.emit(EXTERNAL_ASK, { id: 'x2', from: 'agent', lines: ['go /'], waiting: 0 })
    expect(element.querySelector('.hc-run')).not.toBeNull()
    const line = document.createElement('hc-command-line')
    const input = document.createElement('input')
    line.appendChild(input)
    document.body.appendChild(line)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(answers).toHaveLength(0)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(answers).toEqual([{ id: 'x2', decision: 'decline' }])
    EffectBus.emit(EXTERNAL_ASK, null)
    off()
  })
})
