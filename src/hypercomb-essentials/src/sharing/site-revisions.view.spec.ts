// site-revisions.view.spec.ts — the revisions panel on a managed site door's
// bar: what the bar's button says, and what Save, a step and Discard do.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sig = (n: number): string => n.toString(16).padStart(64, '0')
const record = (label: string, seal: number, at: number) => ({ seal: sig(seal), label, at })

const acts = vi.hoisted(() => ({
  state: null as unknown,
  saved: [] as Array<[readonly string[], string | undefined]>,
  opened: [] as Array<[readonly string[], string]>,
  discarded: 0,
}))

vi.mock('../history/revision-lines.js', async importOriginal => {
  const real = await importOriginal<typeof import('../history/revision-lines.js')>()
  return {
    ...real,
    readRevisions: vi.fn(async () => acts.state),
    saveRevision: vi.fn(async (segments: readonly string[], name?: string) => {
      acts.saved.push([segments, name])
      return name === '' ? { ok: false, error: 'a first save needs a name', needsName: true } : { ok: true, name: name || 'red theme', step: 3, unchanged: false }
    }),
    openRevision: vi.fn(async (segments: readonly string[], target: { label: string }) => {
      acts.opened.push([segments, target.label])
      return { ok: true, name: target.label, changed: 2, failed: 0 }
    }),
    discardChanges: vi.fn(async () => { acts.discarded++; return { ok: true, name: 'red theme', changed: 1, failed: 0 } }),
  }
})

const { EffectBus } = await import('@hypercomb/core')
const { revisionLines } = await import('../history/revision-lines.js')
const strip = await import('./site-revisions.view.js')
const { SiteRevisionsPanel, revisionButtonWords } = strip

const stateOf = (records: ReturnType<typeof record>[], dirty = false) => ({
  records, lines: revisionLines(records), current: records.length ? records[records.length - 1]!.label : '', dirty,
})
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0)) }

const two = [record('red theme', 1, 100), record('red theme', 2, 200), record('blue theme', 3, 300), record('red theme', 2, 400)]

let panel: InstanceType<typeof SiteRevisionsPanel>
let opened = 0
const mount = async (): Promise<void> => {
  panel = new SiteRevisionsPanel({ segments: () => ['business-card'], onState: () => {}, onOpened: () => { opened++ } })
  document.body.replaceChildren(panel.element)
  panel.show()
  await settle()
}
const q = <T extends Element>(selector: string): T | null => panel.element.querySelector<T>(selector)
const all = (selector: string): string[] => [...panel.element.querySelectorAll(selector)].map(node => node.textContent ?? '')

beforeEach(() => {
  EffectBus.clear()
  acts.state = stateOf([])
  acts.saved.length = 0
  acts.opened.length = 0
  acts.discarded = 0
  opened = 0
})

describe('what the bar’s button says', () => {
  it('invites a first save, then names the line in hand and its step', () => {
    expect(revisionButtonWords(null)).toBe('Revisions')
    expect(revisionButtonWords(stateOf([]))).toBe('Revisions')
    expect(revisionButtonWords(stateOf(two.slice(0, 2)))).toBe('red theme · 2')
    expect(revisionButtonWords(stateOf(two.slice(0, 3)))).toBe('blue theme · 1')
    // red was opened again at its second step.
    expect(revisionButtonWords(stateOf(two))).toBe('red theme · 2')
  })

  it('marks a card that holds changes no step does', () => {
    expect(revisionButtonWords(stateOf(two.slice(0, 2), true))).toBe('red theme · 2 •')
  })
})

describe('the panel', () => {
  it('says how it works while nothing is saved, and asks for a name', async () => {
    await mount()
    expect(q('.sr-empty')?.textContent).toContain('Nothing saved yet')
    expect(q<HTMLInputElement>('.sr-name')?.value).toBe('')
    q<HTMLFormElement>('.sr-save')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await settle()
    expect(acts.saved).toEqual([[['business-card'], '']])
    expect(q('.sr-said')?.textContent).toBe('Give this revision a name.')
  })

  it('fills in the name in hand, so Save alone is the next step', async () => {
    acts.state = stateOf(two.slice(0, 2), true)
    await mount()
    expect(q<HTMLInputElement>('.sr-name')?.value).toBe('red theme')
    q<HTMLFormElement>('.sr-save')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await settle()
    expect(acts.saved).toEqual([[['business-card'], 'red theme']])
    expect(q('.sr-said')?.textContent).toBe('Saved red theme · 3.')
  })

  it('saves under a new name when one is typed, and tells the chat lists', async () => {
    acts.state = stateOf(two.slice(0, 2))
    await mount()
    const heard: unknown[] = []
    EffectBus.on('chat:threads-changed', payload => heard.push(payload))
    heard.length = 0
    q<HTMLInputElement>('.sr-name')!.value = '  blue theme '
    q<HTMLFormElement>('.sr-save')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await settle()
    expect(acts.saved).toEqual([[['business-card'], 'blue theme']])
    expect(heard).toEqual([{}])
  })

  it('lists every line, the one in hand open with its steps newest first', async () => {
    acts.state = stateOf(two)
    await mount()
    expect(all('.sr-line-name')).toEqual(['red theme', 'blue theme'])
    expect(all('.sr-line-count')).toEqual(['2 steps', '1 step'])
    expect(all('.sr-step-number')).toEqual(['2', '1'])
    expect(all('.sr-step-mark')).toEqual(['here', 'Open'])
    // The step the card is at needs no opening while nothing changed.
    expect([...panel.element.querySelectorAll<HTMLButtonElement>('.sr-step')].map(step => step.disabled)).toEqual([true, false])
  })

  it('opens a step of another line when it is pressed, and says a revision was opened', async () => {
    acts.state = stateOf(two)
    await mount()
    panel.element.querySelectorAll<HTMLButtonElement>('.sr-line-head')[1]!.click()
    expect(all('.sr-step-number')).toEqual(['1'])
    q<HTMLButtonElement>('.sr-step')!.click()
    await settle()
    expect(acts.opened).toEqual([[['business-card'], 'blue theme']])
    expect(opened).toBe(1)
    expect(q('.sr-said')?.textContent).toBe('Opened blue theme.')
  })

  it('offers Discard only while there are changes, and asks before it does', async () => {
    acts.state = stateOf(two.slice(0, 2))
    await mount()
    expect(q('.sr-changed')).toBeNull()

    acts.state = stateOf(two.slice(0, 2), true)
    await panel.refresh()
    expect(q('.sr-changed span')?.textContent).toBe('Changes not saved to red theme yet.')
    const asked: Array<{ id: string; title: string; danger?: boolean }> = []
    EffectBus.on<{ id: string; title: string; danger?: boolean }>('confirm:request', request => { asked.push(request) })
    asked.length = 0

    q<HTMLButtonElement>('.sr-link')!.click()
    await settle()
    expect(asked.map(request => [request.title, request.danger])).toEqual([['Discard your changes?', true]])
    EffectBus.emit('confirm:response', { id: asked[0]!.id, confirmed: false })
    await settle()
    expect(acts.discarded).toBe(0)

    q<HTMLButtonElement>('.sr-link')!.click()
    await settle()
    EffectBus.emit('confirm:response', { id: asked[1]!.id, confirmed: true })
    await settle()
    expect(acts.discarded).toBe(1)
    expect(q('.sr-said')?.textContent).toBe('Back to the last step of red theme.')
  })

  it('closes on Escape', async () => {
    await mount()
    panel.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(panel.open).toBe(false)
  })
})

// jwize, 2026-11-16: "Yes, add it". The chat fills the screen on a managed
// site door and covers the bar, so the revision sits at the top of its rail.
describe('the revision in the chat’s rail', () => {
  const { mountRevisionStrip } = strip
  let script: HTMLScriptElement | null = null
  const managed = (): void => {
    script = document.createElement('script')
    script.id = 'hc-manage'
    script.type = 'application/json'
    script.textContent = JSON.stringify({ lineage: 'business-card', title: 'business-card', head: null })
    document.head.appendChild(script)
  }
  const rail = (): { host: HTMLElement; list: HTMLElement } => {
    const host = document.createElement('div')
    const list = document.createElement('div')
    list.className = 'hc-rail-list'
    host.append(list)
    document.body.replaceChildren(host)
    return { host, list }
  }
  afterEach(() => { script?.remove(); script = null })

  it('adds nothing on a page that is not a managed site door', () => {
    const { host, list } = rail()
    expect(mountRevisionStrip(host, list)).toBeNull()
    expect(host.children).toHaveLength(1)
  })

  it('names the revision in hand above the list, and opens the same panel there', async () => {
    managed()
    acts.state = stateOf(two.slice(0, 2), true)
    const { host, list } = rail()
    const drop = mountRevisionStrip(host, list)
    await settle()
    expect(host.firstElementChild?.className).toBe('sr-strip')
    expect(host.lastElementChild).toBe(list)
    expect(host.querySelector('.sr-strip-words')?.textContent).toBe('red theme · 2 •')
    const button = host.querySelector<HTMLButtonElement>('.sr-strip-button')!
    button.click()
    await settle()
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector<HTMLInputElement>('.sr-strip .sr-name')?.value).toBe('red theme')
    expect([...host.querySelectorAll('.sr-strip .sr-line-name')].map(node => node.textContent)).toEqual(['red theme'])
    drop?.()
    expect(host.querySelector('.sr-strip')).toBeNull()
  })

  it('says so while nothing is saved', async () => {
    managed()
    const { host, list } = rail()
    mountRevisionStrip(host, list)
    await settle()
    expect(host.querySelector('.sr-strip-words')?.textContent).toBe('not saved yet')
  })

  it('follows what the bar’s panel reads, and the bar follows it', async () => {
    managed()
    acts.state = stateOf(two.slice(0, 2))
    const said: string[] = []
    const bar = new SiteRevisionsPanel({ segments: () => ['business-card'], onState: state => said.push(revisionButtonWords(state)), onOpened: () => {} })
    const { host, list } = rail()
    mountRevisionStrip(host, list)
    await settle()
    expect(host.querySelector('.sr-strip-words')?.textContent).toBe('red theme · 2')
    // The card changed; the bar's panel reads it.
    acts.state = stateOf(two.slice(0, 2), true)
    await bar.refresh()
    expect(host.querySelector('.sr-strip-words')?.textContent).toBe('red theme · 2 •')
    expect(said.at(-1)).toBe('red theme · 2 •')
    bar.dispose()
  })

  it('moves the chat to the conversation of the revision it opened', async () => {
    managed()
    acts.state = stateOf(two)
    const { host, list } = rail()
    mountRevisionStrip(host, list)
    await settle()
    const asked: unknown[] = []
    EffectBus.on('chat:open', payload => asked.push(payload))
    asked.length = 0
    host.querySelector<HTMLButtonElement>('.sr-strip-button')!.click()
    await settle()
    host.querySelectorAll<HTMLButtonElement>('.sr-strip .sr-line-head')[1]!.click()
    host.querySelector<HTMLButtonElement>('.sr-strip .sr-step')!.click()
    await settle()
    expect(acts.opened).toEqual([[['business-card'], 'blue theme']])
    expect(asked).toEqual([{ convoId: 'chat:tile:/business-card' }])
  })
})
