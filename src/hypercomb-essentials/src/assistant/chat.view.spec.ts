// chat.view.spec.ts — the chat as a framework-free element (jwize, 2026-11-11:
// "the chat needs to phase out angular so it can be compatible with the
// minimal debugger build"). It keeps a conversation in the chat's own
// threads, asks the router, shows the answer as it streams, and stays out of
// the way wherever the Angular window is still the chat.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const surfaces: { name: string }[] = []
vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: (key: string) => key === '@hypercomb.social/ShellSurfaceRegistry'
      ? { all: () => (globalThis as { __surfaces?: unknown[] }).__surfaces ?? [] }
      : undefined,
    has: () => false,
    list: () => [],
    whenReady: () => { /* noop */ },
  }
})
;(globalThis as { __surfaces?: unknown[] }).__surfaces = surfaces

const { EffectBus } = await import('@hypercomb/core')
const { ChatElement } = await import('./chat.view.js')
const { CHAT_SURFACE, ANGULAR_CHAT_SURFACE } = await import('./chat-surface.js')
type Model = InstanceType<typeof ChatElement>['model']

if (!customElements.get(CHAT_SURFACE)) customElements.define(CHAT_SURFACE, ChatElement)

let element: InstanceType<typeof ChatElement>
let stored: Record<string, { role: string; text: string }[]>
let asked: { messages: readonly { role: string; content: string }[] }[]
let minted: number

const model = (over: Partial<Model> = {}): Model => ({
  stream: async function* (call) { asked.push(call as never); yield { text: 'Hel' }; yield { text: 'lo.' } },
  host: () => undefined,
  behaviours: () => [],
  place: () => '',
  readTurns: async convoId => (stored[convoId] ?? []) as never,
  appendTurn: async (convoId, role, text) => { (stored[convoId] ??= []).push({ role, text }); return true },
  newConvoId: () => `chat:test-${++minted}`,
  ...over,
})

const turns = (): string[] => [...element.querySelectorAll('.hc-chat-turn')]
  .map(turn => `${turn.className.replace('hc-chat-turn ', '')}|${turn.textContent}`)

beforeEach(() => {
  localStorage.clear()
  // The lights are cached until they are said to have changed.
  EffectBus.emit('behavior:enablement-changed', {})
  surfaces.length = 0
  stored = {}
  asked = []
  minted = 0
  element = document.createElement(CHAT_SURFACE) as InstanceType<typeof ChatElement>
  element.model = model()
  document.body.appendChild(element)
})

afterEach(() => { element.remove() })

describe('the framework-free chat', () => {
  it('opens on a fresh request, never on a replayed one, and closes on Escape', async () => {
    expect(element.isOpen).toBe(false)
    EffectBus.emit('chat:open', {})
    await vi.waitFor(() => expect(element.isOpen).toBe(true))
    element.querySelector('.hc-chat')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(element.isOpen).toBe(false)
    // A second element connecting now is handed the bus's last value: it must
    // not open on a gesture made before it was listening.
    const late = document.createElement(CHAT_SURFACE) as InstanceType<typeof ChatElement>
    late.model = model()
    document.body.appendChild(late)
    await Promise.resolve()
    expect(late.isOpen).toBe(false)
    late.remove()
  })

  it('takes the one request the bee handed over while it was loading', async () => {
    ChatElement.pending = { prefill: 'what is here?' }
    const fresh = document.createElement(CHAT_SURFACE) as InstanceType<typeof ChatElement>
    fresh.model = model()
    document.body.appendChild(fresh)
    await vi.waitFor(() => expect(stored['chat:test-1']?.length).toBe(2))
    expect(ChatElement.pending).toBeNull()
    fresh.remove()
  })

  it('stores the question, streams the answer, and stores what arrived', async () => {
    await element.open({})
    const changed: unknown[] = []
    const off = EffectBus.on('chat:threads-changed', payload => { changed.push(payload) })
    changed.length = 0
    await element.send('  hello there  ')
    off()
    expect(stored['chat:test-1']).toEqual([{ role: 'user', text: 'hello there' }, { role: 'assistant', text: 'Hello.' }])
    expect(asked[0].messages).toEqual([{ role: 'user', content: 'hello there' }])
    expect(turns()).toEqual(['is-user|hello there', 'is-assistant|Hello.'])
    expect(changed).toEqual([{ convoId: 'chat:test-1' }, { convoId: 'chat:test-1' }])
    // The whole conversation goes with the next question.
    await element.send('and again')
    expect(asked[1].messages.map(message => message.role)).toEqual(['user', 'assistant', 'user'])
  })

  it('draws a model\'s words as text, never as markup', async () => {
    element.model = model({ stream: async function* () { yield { text: '<img src=x onerror=alert(1)>' } } })
    await element.open({})
    await element.send('hi')
    expect(element.querySelector('.hc-chat img')).toBeNull()
    expect(turns().at(-1)).toBe('is-assistant|<img src=x onerror=alert(1)>')
  })

  it('a prefill is a new conversation, sent at once; a bare open resumes the last', async () => {
    await element.open({ prefill: 'first' })
    expect(element.conversation).toBe('chat:test-1')
    element.close()
    await element.open({})
    expect(element.conversation).toBe('chat:test-1')
    expect(turns()).toEqual(['is-user|first', 'is-assistant|Hello.'])
    await element.open({ prefill: 'second' })
    expect(element.conversation).toBe('chat:test-2')
    expect(turns()).toEqual(['is-user|second', 'is-assistant|Hello.'])
  })

  it('opens a named conversation with the turns it already holds', async () => {
    stored['chat:kept'] = [{ role: 'user', text: 'earlier' }, { role: 'assistant', text: 'yes' }]
    await element.open({ convoId: 'chat:kept' })
    expect(turns()).toEqual(['is-user|earlier', 'is-assistant|yes'])
  })

  it('says why nothing came back beside the thread, and stores no such turn', async () => {
    element.model = model({ stream: async function* () { throw new Error('no AI provider is set up yet — open /providers to add one') } })
    await element.open({})
    await element.send('hello')
    expect(stored['chat:test-1']).toEqual([{ role: 'user', text: 'hello' }])
    expect(turns()).toEqual(['is-user|hello', 'is-note|no AI provider is set up yet — open /providers to add one'])
    expect(element.busy).toBe(false)
  })

  it('asks the host the participant named when the router has nobody to ask', async () => {
    const questions: string[] = []
    element.model = model({
      stream: async function* () { throw new Error('no AI provider is set up yet') },
      host: () => ({ configured: true, ask: async function* (question) { questions.push(question); yield 'From the host.' } }),
    })
    await element.open({})
    await element.send('hello')
    expect(questions).toEqual(['hello'])
    expect(stored['chat:test-1'].at(-1)).toEqual({ role: 'assistant', text: 'From the host.' })
  })

  it('never asks the host once the router has begun to answer', async () => {
    const questions: string[] = []
    element.model = model({
      stream: async function* () { yield { text: 'Half' }; throw new Error('the stream stalled') },
      host: () => ({ configured: true, ask: async function* (question) { questions.push(question); yield 'x' } }),
    })
    await element.open({})
    await element.send('hello')
    expect(questions).toEqual([])
    expect(stored['chat:test-1'].at(-1)).toEqual({ role: 'assistant', text: 'Half' })
    expect(turns().at(-1)).toBe('is-note|the stream stalled')
  })

  it('stop keeps what has arrived', async () => {
    let release: () => void = () => { /* set below */ }
    const gate = new Promise<void>(resolve => { release = resolve })
    element.model = model({ stream: async function* () { yield { text: 'Part' }; await gate; yield { text: 'never shown' } } })
    await element.open({})
    const sending = element.send('hello')
    await vi.waitFor(() => expect(turns().at(-1)).toBe('is-assistant is-live|Part'))
    expect(element.querySelector('.hc-chat-send')?.textContent).toBe('Stop')
    element.stop()
    release()
    await sending
    expect(stored['chat:test-1'].at(-1)).toEqual({ role: 'assistant', text: 'Part' })
    expect(element.querySelector('.hc-chat-send')?.textContent).toBe('Send')
  })

  it('stays closed where the Angular window is the chat', async () => {
    surfaces.push({ name: ANGULAR_CHAT_SURFACE })
    await element.open({ prefill: 'hello' })
    expect(element.isOpen).toBe(false)
    expect(stored).toEqual({})
  })

  it('refuses while the chat word is switched off, and closes when it goes dark', async () => {
    localStorage.setItem('hc:behavior-global-off', JSON.stringify(['word:chat']))
    EffectBus.emit('behavior:enablement-changed', {})
    await element.open({})
    expect(element.isOpen).toBe(false)
    localStorage.setItem('hc:behavior-global-off', '[]')
    EffectBus.emit('behavior:enablement-changed', {})
    await element.open({})
    expect(element.isOpen).toBe(true)
    localStorage.setItem('hc:behavior-global-off', JSON.stringify(['word:chat']))
    EffectBus.emit('behavior:enablement-changed', {})
    expect(element.isOpen).toBe(false)
  })
})

// STEP TWO: the chat can change the hive. A block a model writes waits in the
// execution queue, and this element lists it with the two answers.
describe('the Run list', () => {
  const create = { name: 'create', description: 'Make a tile', machine: { forms: '<name>', example: '/create roadmap', reach: 'additive' as const, scope: 'page' as const } }
  const fence = '`'.repeat(3)

  const queueOf = () => {
    const target = new EventTarget()
    const held: { id: string; convoId: string; state: string; lines: readonly string[]; leaves?: boolean; answer: (decision: 'run' | 'skip') => void }[] = []
    return {
      held,
      queue: {
        request: (ask: { convoId: string; lines: readonly string[]; leaves?: boolean }) => {
          let answer: (decision: 'run' | 'skip') => void = () => { /* set below */ }
          const decision = new Promise<'run' | 'skip'>(resolve => { answer = resolve })
          const entry = { id: `r${held.length + 1}`, convoId: ask.convoId, state: 'waiting', lines: ask.lines, leaves: ask.leaves, answer }
          held.push(entry)
          target.dispatchEvent(new Event('change'))
          return { id: entry.id, decision }
        },
        decide: (id: string, decision: 'run' | 'skip') => {
          const entry = held.find(item => item.id === id)!
          entry.state = decision === 'run' ? 'running' : 'skipped'
          entry.answer(decision)
          target.dispatchEvent(new Event('change'))
        },
        settle: (id: string, state: string) => { held.find(item => item.id === id)!.state = state },
        requests: () => held,
        addEventListener: (type: 'change', listener: () => void) => target.addEventListener(type, listener),
        removeEventListener: (type: 'change', listener: () => void) => target.removeEventListener(type, listener),
      },
    }
  }

  const acting = (replies: string[], ran: string[]) => {
    const { queue, held } = queueOf()
    localStorage.setItem('hc:machine-roster', JSON.stringify([{ name: 'create', reach: 'additive', scope: 'page', forms: '<name>' }]))
    const fresh = document.createElement(CHAT_SURFACE) as InstanceType<typeof ChatElement>
    fresh.model = model({
      stream: async function* () { yield { text: replies.shift() ?? 'Done.', providerId: 'local', model: 'm' } },
      behaviours: () => [create],
      execute: (command, args) => { ran.push(`/${command} ${args}`) },
      queue: queue as never,
    })
    document.body.appendChild(fresh)
    return { fresh, held }
  }

  it('lists a waiting block with exactly its lines, runs it on Run, and keeps what ran in the answer', async () => {
    const ran: string[] = []
    const { fresh } = acting([`Making it.\n\n${fence}hypercomb-do\n/create roadmap\n${fence}`, 'It is made.'], ran)
    expect(fresh.canChange).toBe(true)
    await fresh.open({})
    const sending = fresh.send('make a roadmap tile')
    await vi.waitFor(() => expect(fresh.querySelector('.hc-chat-run-lines')?.textContent).toBe('/create roadmap'))
    expect(fresh.querySelector('.hc-chat-run-label')?.textContent).toBe('The AI wants to run this:')
    expect(ran).toEqual([])
    fresh.querySelector<HTMLButtonElement>('.hc-chat-run-act.is-run')!.click()
    await sending
    expect(ran).toEqual(['/create roadmap'])
    expect(fresh.querySelector('.hc-chat-run')).toBeNull()
    expect(stored['chat:test-1'].at(-1)).toEqual({ role: 'assistant', text: 'Making it.\n\nRan:\n- /create roadmap\n\nIt is made.' })
    fresh.remove()
  })

  it('Skip runs nothing, and the answer says so', async () => {
    const ran: string[] = []
    const { fresh } = acting([`${fence}hypercomb-do\n/create roadmap\n${fence}`, 'Left as it is.'], ran)
    await fresh.open({})
    const sending = fresh.send('make a roadmap tile')
    await vi.waitFor(() => expect(fresh.querySelector('.hc-chat-run')).not.toBeNull())
    fresh.querySelector<HTMLButtonElement>('.hc-chat-run-act.is-skip')!.click()
    await sending
    expect(ran).toEqual([])
    expect(stored['chat:test-1'].at(-1)).toEqual({ role: 'assistant', text: 'Skipped, nothing changed:\n- /create roadmap\n\nLeft as it is.' })
    fresh.remove()
  })

  it('a block\'s lines are drawn as text, never as markup', async () => {
    const { fresh } = acting([`${fence}hypercomb-do\n/create <img src=x onerror=alert(1)>\n${fence}`], [])
    await fresh.open({})
    void fresh.send('make it')
    await vi.waitFor(() => expect(fresh.querySelector('.hc-chat-run-lines')?.textContent).toBe('/create <img src=x onerror=alert(1)>'))
    expect(fresh.querySelector('.hc-chat img')).toBeNull()
    fresh.stop()
    fresh.remove()
  })
})
