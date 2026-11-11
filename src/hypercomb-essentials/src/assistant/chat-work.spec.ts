// chat-work.spec.ts — one question worked in rounds, with no framework in it.
// A model is taught only what the participant granted; a block is parsed
// whole before anything waits; what waits is run or skipped by the queue's
// answer; and what happened is the model's next message.

import { beforeEach, describe, expect, it } from 'vitest'
import { DO_FENCE_LANG, READ_FENCE_LANG, MACHINE_ROSTER_KEY, type HypercombBehaviour } from '@hypercomb/core'
import { chatCanChange, runChatWork, type ChatWorkDeps, type ChatWorkEvent } from './chat-work.js'

const create: HypercombBehaviour = {
  name: 'create', description: 'Make a tile',
  machine: { forms: '<name>', example: '/create roadmap', reach: 'additive', scope: 'page' },
}
const follow: HypercombBehaviour = {
  name: 'follow', description: 'Follow a domain',
  machine: { forms: '<domain>', example: '/follow hypercomb.com', reach: 'additive', scope: 'network' },
}
const remove: HypercombBehaviour = {
  name: 'remove', description: 'Remove a tile',
  machine: { forms: '<name>', example: '/remove drafts', reach: 'destructive', scope: 'page' },
}
const grant = (...verbs: HypercombBehaviour[]): void => {
  localStorage.setItem(MACHINE_ROSTER_KEY, JSON.stringify(verbs.map(verb => ({
    name: verb.name, reach: verb.machine!.reach, scope: verb.machine!.scope, forms: verb.machine!.forms,
  }))))
}
const block = (lang: string, ...lines: string[]): string => `\`\`\`${lang}\n${lines.join('\n')}\n\`\`\``

type Asked = { system?: string; messages: readonly { role: string; content: string }[] }

const world = (replies: string[], decisions: ('run' | 'skip')[] = []) => {
  const asked: Asked[] = []
  const ran: string[] = []
  const requests: { kind: string; lines: readonly string[]; leaves?: boolean; providerId: string; model: string }[] = []
  const settled: string[] = []
  let place = 'work'
  const deps: ChatWorkDeps = {
    stream: async function* (call) {
      asked.push({ system: call.system, messages: call.messages.map(message => ({ role: message.role, content: String(message.content) })) })
      yield { text: replies.shift() ?? 'Done.', providerId: 'local', model: 'test-model' }
    },
    behaviours: () => [create, follow, remove],
    execute: (command, args) => {
      if (args === 'broken') throw new Error('that name is taken')
      ran.push(`/${command} ${args}`)
    },
    queue: {
      request: ask => {
        requests.push(ask)
        return { id: `r${requests.length}`, decision: Promise.resolve(decisions.shift() ?? 'run') }
      },
      settle: (id, state, outcome) => { settled.push(`${id}:${state}${outcome ? `:${outcome}` : ''}`) },
    },
    place: () => place,
  }
  return { deps, asked, ran, requests, settled, move: (to: string) => { place = to } }
}

const work = async (deps: ChatWorkDeps, question = 'make a roadmap tile'): Promise<ChatWorkEvent[]> => {
  const events: ChatWorkEvent[] = []
  for await (const event of runChatWork({ convoId: 'chat:1', messages: [{ role: 'user', content: question }], question }, deps)) {
    if (event.kind !== 'live') events.push(event)
  }
  return events
}

beforeEach(() => { localStorage.clear() })

describe('a question worked in rounds', () => {
  it('teaches only what the participant granted, and says a hive cannot be read here', async () => {
    grant(create)
    const { deps, asked } = world(['Hello.'])
    expect(await work(deps)).toEqual([{ kind: 'said', text: 'Hello.' }])
    expect(asked[0].system).toContain('/create')
    expect(asked[0].system).not.toContain('/follow')
    // Destructive is past the default ceiling: never taught, granted or not.
    expect(asked[0].system).not.toContain('/remove')
    expect(asked[0].system).toContain('You cannot read the hive in this conversation.')
    expect(chatCanChange(deps)).toBe(true)
  })

  it('with nothing granted a model is told it can change nothing, and a block it writes anyway is sent back', async () => {
    const { deps, asked, requests } = world([`Making it.\n\n${block(DO_FENCE_LANG, '/create roadmap')}`, 'I cannot do that here.'])
    expect(chatCanChange(deps)).toBe(false)
    const events = await work(deps)
    expect(asked[0].system).toContain('You cannot read or change the hive in this conversation.')
    expect(events.map(event => event.kind)).toEqual(['said', 'refused', 'said'])
    expect(requests).toEqual([])
  })

  it('a block waits, runs on the queue\'s answer, and what ran is the model\'s next message', async () => {
    grant(create)
    const { deps, asked, ran, requests, settled } = world([`Making it.\n\n${block(DO_FENCE_LANG, '/create roadmap', 'create notes')}`, 'Both are made.'])
    expect(await work(deps)).toEqual([
      { kind: 'said', text: 'Making it.' },
      { kind: 'waiting', lines: ['/create roadmap', '/create notes'] },
      { kind: 'ran', lines: ['/create roadmap', '/create notes'] },
      { kind: 'said', text: 'Both are made.' },
    ])
    expect(ran).toEqual(['/create roadmap', '/create notes'])
    expect(requests).toEqual([expect.objectContaining({ kind: 'additive', lines: ['/create roadmap', '/create notes'], leaves: false, providerId: 'local', model: 'test-model', needsGrant: false })])
    expect(settled).toEqual(['r1:ran'])
    // The second round carries the model's own reply and the hive's answer to it.
    expect(asked[1].messages.map(message => message.role)).toEqual(['user', 'assistant', 'user'])
    expect(asked[1].messages[2].content).toContain('The hive ran:\n- /create roadmap\n- /create notes')
    expect(asked[1].messages[2].content).toContain('«make a roadmap tile»')
  })

  it('a line that leaves the machine is marked so it waits for a hand', async () => {
    grant(follow)
    const { deps, requests } = world([block(DO_FENCE_LANG, '/follow hypercomb.com'), 'Following.'])
    await work(deps)
    expect(requests[0]).toEqual(expect.objectContaining({ leaves: true, lines: ['/follow hypercomb.com'] }))
  })

  it('a skipped block runs nothing, and the model is told not to propose it again', async () => {
    grant(create)
    const { deps, asked, ran, settled } = world([block(DO_FENCE_LANG, '/create roadmap'), 'Understood.'], ['skip'])
    const events = await work(deps)
    expect(events.map(event => event.kind)).toEqual(['waiting', 'skipped', 'said'])
    expect(ran).toEqual([])
    expect(settled).toEqual([])
    expect(asked[1].messages[2].content).toContain('skipped your')
  })

  it('one bad line refuses the whole block before anything waits', async () => {
    grant(create)
    const { deps, asked, ran, requests } = world([block(DO_FENCE_LANG, '/create roadmap', '/remove drafts'), 'I will leave it.'])
    const events = await work(deps)
    expect(events[0]).toEqual({ kind: 'refused', reason: expect.stringContaining('/remove') })
    expect(requests).toEqual([])
    expect(ran).toEqual([])
    expect(asked[1].messages[2].content).toContain('was not used')
  })

  it('a line that fails stops the block, and says what ran before it', async () => {
    grant(create)
    const { deps, asked, ran, settled } = world([block(DO_FENCE_LANG, '/create roadmap', '/create broken', '/create later'), 'One was taken.'])
    const events = await work(deps)
    expect(events.filter(event => event.kind !== 'said')).toEqual([
      { kind: 'waiting', lines: ['/create roadmap', '/create broken', '/create later'] },
      { kind: 'ran', lines: ['/create roadmap'] },
      { kind: 'failed', lines: ['/create broken'], reason: 'that name is taken' },
    ])
    expect(ran).toEqual(['/create roadmap'])
    expect(settled).toEqual(['r1:failed:that name is taken'])
    expect(asked[1].messages[2].content).toContain('stopped at /create broken: that name is taken')
  })

  it('a block written for one page is not run on another', async () => {
    grant(create)
    const scene = world([block(DO_FENCE_LANG, '/create roadmap'), 'Ask me again there.'])
    const request = scene.deps.queue!.request
    scene.deps.queue!.request = ask => { const entry = request(ask); scene.move('elsewhere'); return entry }
    const events = await work(scene.deps)
    expect(scene.ran).toEqual([])
    expect(events.find(event => event.kind === 'failed')).toEqual(expect.objectContaining({ reason: expect.stringContaining('moved to another page') }))
  })

  it('a read block is sent back: this chat cannot read yet', async () => {
    grant(create)
    const { deps, asked, requests } = world([block(READ_FENCE_LANG, 'read here'), 'I cannot see the page.'])
    const events = await work(deps)
    expect(events[0]).toEqual({ kind: 'refused', reason: 'this chat cannot read the hive yet' })
    expect(requests).toEqual([])
    expect(asked[1].messages[2].content).toContain('this chat cannot read the hive yet')
  })

  it('stops after a stretch of rounds even if the model never stops asking', async () => {
    grant(create)
    const replies = Array.from({ length: 40 }, () => block(DO_FENCE_LANG, '/create again'))
    const { deps, asked } = world(replies)
    await work(deps)
    expect(asked.length).toBe(12)
  })
})
