// manager.cjs — the hive managers' hands.
//
// A manager is an agent with ONE area of the hive to keep in order
// (documentation/hive-management-org.md). It never opens the chat window and
// never drives the participant's screen: every call here is one bridge
// request answered by its own id, so any number of managers can work at the
// same time without reading each other's answers.
//
//   node scripts/bridge/manager.cjs tree [/route]            the tiles under a route
//   node scripts/bridge/manager.cjs read /route              one tile: properties and notes
//   node scripts/bridge/manager.cjs notes /route             the notes on a tile
//   node scripts/bridge/manager.cjs note /route "<text>"     add a note to a tile
//   node scripts/bridge/manager.cjs thread <manager|convoId> [n]   the last n turns
//   node scripts/bridge/manager.cjs report <manager> "<text>"      write into the manager's own conversation
//   node scripts/bridge/manager.cjs ask <manager|convoId> "<request>"   hand work to the hive's own models, wait, print the result
//   node scripts/bridge/manager.cjs held                     what waits on the participant in Execution
//   node scripts/bridge/manager.cjs do "<behaviour sentence>"      one line through the command line
//   node scripts/bridge/manager.cjs op '<request json>'      a raw bridge request
//
// A MANAGER'S CONVERSATION is where it reports and where the participant
// answers it: one per manager, at a fixed id, so the same manager is the same
// conversation on every hive. `report` creates it on first use.
//
// BRIDGE_URL overrides the broker (default ws://localhost:2401).
const WebSocket = require('ws')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const TOKEN = String(process.env.HYPERCOMB_BRIDGE_TOKEN || '').trim()
const WS_OPTS = TOKEN ? { headers: { Authorization: `Bearer ${TOKEN}` } } : undefined

/** The managers, and the conversation each one keeps. Adding a manager is
 *  adding a line here and a charter in the org document. */
const MANAGERS = {
  orchestrator: 'chat:tile:/::1790900000001-orches',
  games: 'chat:tile:/::1790900000002-gamesm',
  housekeeping: 'chat:tile:/::1790900000003-housek',
  harness: 'chat:tile:/::1790900000004-harnes',
}

const send = (req, waitMs = 30_000) => new Promise(resolve => {
  const id = `mgr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const ws = new WebSocket(BRIDGE, WS_OPTS)
  const timer = setTimeout(() => { try { ws.close() } catch { /* gone */ } resolve({ ok: false, error: 'bridge timeout' }) }, waitMs)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', raw => {
    let message
    try { message = JSON.parse(String(raw)) } catch { return }
    if (message.id !== id) return
    clearTimeout(timer)
    try { ws.close() } catch { /* gone */ }
    resolve(message)
  })
  ws.on('error', error => { clearTimeout(timer); resolve({ ok: false, error: String(error.message) }) })
})

const segmentsOf = route => String(route ?? '/').split('/').map(part => part.trim()).filter(Boolean)
const convoOf = name => MANAGERS[name] ?? name
const fail = message => { console.error(message); process.exit(1) }
const print = value => console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 1))

const main = async () => {
  const [verb, first, ...rest] = process.argv.slice(2)
  const second = rest.join(' ')
  switch (verb) {
    case 'tree': {
      const reply = await send({ op: 'list-at', segments: segmentsOf(first) })
      return reply.ok ? print(reply.data) : fail(reply.error)
    }
    case 'read': {
      const segments = segmentsOf(first)
      if (!segments.length) return fail('read needs a tile route; the root has no notes of its own')
      const [tile, notes] = await Promise.all([
        send({ op: 'inspect', segments }),
        send({ op: 'note-list', segments }),
      ])
      return print({ tile: tile.ok ? tile.data : tile.error, notes: notes.ok ? notes.data : notes.error })
    }
    case 'notes': {
      const reply = await send({ op: 'note-list', segments: segmentsOf(first) })
      return reply.ok ? print(reply.data) : fail(reply.error)
    }
    case 'note': {
      const segments = segmentsOf(first)
      if (!segments.length || !second.trim()) return fail('note needs a tile route and the text')
      const reply = await send({ op: 'note-add', segments: segments.slice(0, -1), cell: segments.at(-1), text: second })
      return reply.ok ? print(reply.data ?? 'filed') : fail(reply.error)
    }
    case 'thread': {
      if (!first) return fail(`thread needs a manager (${Object.keys(MANAGERS).join(', ')}) or a convoId`)
      const reply = await send({ op: 'thread-read', cell: convoOf(first) })
      if (!reply.ok) return fail(reply.error)
      const turns = reply.data?.turns ?? []
      return print(turns.slice(-Math.max(1, Number(second) || 6)))
    }
    case 'report': {
      if (!MANAGERS[first]) return fail(`report needs a manager: ${Object.keys(MANAGERS).join(', ')}`)
      if (!second.trim()) return fail('report needs the text')
      const reply = await send({ op: 'chat-reply', cell: MANAGERS[first], text: second })
      return reply.ok ? print(`reported in ${MANAGERS[first]}`) : fail(reply.error)
    }
    case 'ask': {
      // DELEGATE. The request runs in that conversation on the hive's own
      // models (DeepSeek and whatever else is on the list), which read and
      // change the hive themselves; this waits and prints that ask's result.
      // The conversation runs what it asks for without a press: the manager
      // is the one who answers for it.
      if (!first || !second.trim()) return fail('ask needs a manager or convoId, and the request')
      const convoId = convoOf(first)
      const asked = await send({ op: 'chat-ask', cell: convoId, text: second, payload: { trust: process.env.MANAGER_NO_TRUST ? false : true } })
      if (!asked.ok) return fail(asked.error)
      const askId = asked.data.askId
      const deadline = Date.now() + Number(process.env.MANAGER_ASK_MS || 900_000)
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 4_000))
        const reply = await send({ op: 'chat-asked', cell: askId })
        if (!reply.ok) return fail(reply.error)
        if (reply.data?.done) {
          const { outcome, rounds, tokens, answer, left, error } = reply.data
          return print({ convoId, outcome, rounds, tokens, ...(left ? { left: 'the work stopped at the end of a leg; ask "Continue." to carry it on' } : {}), ...(error ? { error } : {}), answer })
        }
      }
      return fail(`no result for ${askId} in time; the turn may still be running — manager.cjs thread ${first} shows where it got to`)
    }
    case 'held': {
      const reply = await send({ op: 'effect-last', cell: 'agent:held' })
      return reply.ok ? print(reply.data?.last?.waiting ?? []) : fail(reply.error)
    }
    case 'do': {
      const line = [first, second].filter(Boolean).join(' ').trim()
      if (!line) return fail('do needs one behaviour sentence')
      const reply = await send({ op: 'submit', text: line })
      return reply.ok ? print(reply.data?.summary ?? reply.data) : fail(reply.error)
    }
    case 'op': {
      let request
      try { request = JSON.parse([first, second].filter(Boolean).join(' ')) } catch { return fail('op needs one JSON request') }
      return print(await send(request))
    }
    default:
      return fail('usage: manager.cjs tree|read|notes|note|thread|report|ask|held|do|op — see the header of this file')
  }
}

main()
