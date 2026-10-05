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
//   node scripts/bridge/manager.cjs unnote /route <noteId>   take a note off a tile (a list change; history keeps it)
//   node scripts/bridge/manager.cjs thread <manager|convoId> [n]   the last n turns
//   node scripts/bridge/manager.cjs report <manager> "<text>"      write into the manager's own conversation
//   node scripts/bridge/manager.cjs ask <manager|convoId> "<request>"   hand work to the hive's own models, wait, print the result
//   node scripts/bridge/manager.cjs convo                    a fresh conversation id, for one job of its own
//   node scripts/bridge/manager.cjs held                     what waits on the participant in Execution
//   node scripts/bridge/manager.cjs do "<behaviour sentence>"      one line through the command line
//   node scripts/bridge/manager.cjs op '<request json>'      a raw bridge request
//   node scripts/bridge/manager.cjs roster                   the managers, as the hive holds them
//   node scripts/bridge/manager.cjs install                  put the managers into the hive (idempotent)
//
// THE MANAGERS LIVE IN THE HIVE (jwize, 2026-10-01: "They don't show on the
// root, you just create them and keep a directory somewhere in a common
// pool"). Each manager is a tile under /managers; its charter and its
// conversation are notes on that tile. /managers is made by address and
// nobody enrols it on the home page, so it is a group of its own, reachable
// at its route and by reference, never on the root (documentation/
// root-entries.md: "on the root" and "on the home page" are two facts). A
// tile is committed at its own page only, so adding under /managers never
// touches the home page. The table below is the seed `install` writes and
// the fallback while a hive has no /managers yet.
//
// A MANAGER'S CONVERSATION is where it reports and where the participant
// answers it: one per manager, at a fixed id, so the same manager is the same
// conversation on every hive. `report` creates it on first use.
//
// BRIDGE_URL overrides the broker (default ws://localhost:2401).
const fs = require('fs')
const WebSocket = require('ws')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const TOKEN = String(process.env.HYPERCOMB_BRIDGE_TOKEN || '').trim()
const WS_OPTS = TOKEN ? { headers: { Authorization: `Bearer ${TOKEN}` } } : undefined

/** The managers, and the conversation each one keeps: the SEED. A hive that
 *  holds /managers is read instead (`roster`). */
const MANAGERS = {
  orchestrator: 'chat:tile:/::1790900000001-orches',
  games: 'chat:tile:/::1790900000002-gamesm',
  housekeeping: 'chat:tile:/::1790900000003-housek',
  harness: 'chat:tile:/::1790900000004-harnes',
}

/** One bridge request, ridden through a reload. The hive's tab drops off the
 *  bridge for a few seconds whenever the dev build reloads it, and a manager
 *  that took that for "the hive is gone" stopped its whole pass (housekeeping,
 *  2026-10-01: three asks at once all answered "no renderer connected"; the
 *  broker serves parallel requests fine). So "no renderer" is waited out —
 *  up to MANAGER_ATTACH_MS (default 60 s) — and only then reported. */
const ATTACH_WAIT_MS = Number(process.env.MANAGER_ATTACH_MS || 60_000)
const send = async (req, waitMs = 30_000) => {
  const until = Date.now() + ATTACH_WAIT_MS
  for (;;) {
    const reply = await sendOnce(req, waitMs)
    if (reply.ok || !/no renderer connected/.test(String(reply.error)) || Date.now() > until) return reply
    await new Promise(resolve => setTimeout(resolve, 3_000))
  }
}

const sendOnce = (req, waitMs) => new Promise(resolve => {
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
  // A REFUSED CONNECTION HAS NO MESSAGE: Node reports it as an AggregateError
  // whose .message is empty, so a dead broker printed nothing and looked like
  // a failed read (all three managers, 2026-10-04). Say what is down.
  ws.on('error', error => {
    clearTimeout(timer)
    const code = error.code || error.errors?.[0]?.code || ''
    const refused = code === 'ECONNREFUSED' || code === 'ECONNRESET'
    resolve({ ok: false, error: refused ? `bridge broker not running at ${BRIDGE} (${code}); start it with: node scripts/bridge/run-bridge.cjs` : (error.message || code || 'bridge connection failed') })
  })
})

// GIT BASH REWRITES A LEADING SLASH. Under MSYS an argument that starts with
// "/" is taken for a POSIX path and handed over as "C:/Program Files/Git/…",
// so `tree /games` asked the hive for a tile named "C:". The shell's own
// root is taken back off, here, once — a route is never a file path.
const BACKSLASH = String.fromCharCode(92)
const posixOf = text => String(text ?? '').split(BACKSLASH).join('/')
const MSYS_ROOT = (() => {
  const exe = posixOf(process.env.EXEPATH || '')
  for (const tail of ['/usr/bin', '/mingw64/bin', '/mingw32/bin', '/bin']) {
    if (exe.toLowerCase().endsWith(tail)) return exe.slice(0, -tail.length)
  }
  return exe || 'C:/Program Files/Git'
})()
const unshelled = value => {
  const text = String(value ?? '')
  const posix = posixOf(text)
  if (!posix.toLowerCase().startsWith(MSYS_ROOT.toLowerCase())) return text
  let rest = posix.slice(MSYS_ROOT.length)
  while (rest.startsWith('/')) rest = rest.slice(1)
  return `/${rest}`
}
const segmentsOf = route => unshelled(route ?? '/').split('/').map(part => part.trim()).filter(Boolean)
const GROUP = 'managers'
const CONVERSATION_NOTE = 'conversation: '
const CHARTER_NOTE = 'charter: '
const ORG_DOC = require('path').join(__dirname, '..', '..', 'documentation', 'hive-management-org.md')

/** A manager's charter, as the org document words it — the seed for the note. */
const charterOf = name => {
  const text = fs.readFileSync(ORG_DOC, 'utf8')
  const at = text.indexOf(`### ${name}\n`)
  if (at < 0) return ''
  const body = text.slice(at + name.length + 5)
  const end = body.search(/\n#{2,3} /)
  return (end < 0 ? body : body.slice(0, end)).replace(/\s+/g, ' ').trim()
}

/** The managers as the hive holds them: { name: conversationId }. Null when
 *  the hive has no /managers yet (or the bridge cannot say). */
const hiveRoster = async () => {
  const listed = await send({ op: 'list-at', segments: [GROUP] })
  if (!listed.ok || !Array.isArray(listed.data) || !listed.data.length) return null
  const roster = {}
  for (const name of listed.data) {
    const notes = await send({ op: 'note-list', segments: [GROUP, name] })
    const line = (notes.ok ? notes.data : []).map(note => String(note.text ?? '')).find(text => text.startsWith(CONVERSATION_NOTE))
    roster[name] = line ? line.slice(CONVERSATION_NOTE.length).trim() : MANAGERS[name] ?? ''
  }
  return roster
}

let rosterCache = null
const roster = async () => (rosterCache ??= (await hiveRoster()) ?? { ...MANAGERS })
const convoOf = name => MANAGERS[name] ?? name
const fail = message => { console.error(message); process.exit(1) }
const print = value => console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 1))

const main = async () => {
  const [verb, first, ...rest] = process.argv.slice(2)
  if (['thread', 'report', 'ask'].includes(verb) && first && !first.startsWith('chat:')) {
    const known = await roster()
    if (known[first]) MANAGERS[first] = known[first]
  }
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
      // Both failed: that is a failure, not an empty tile.
      if (!tile.ok && !notes.ok) return fail(tile.error || notes.error)
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
    case 'unnote': {
      // A LIST CHANGE, never a deletion: the note leaves the tile's notes
      // list as a new layer; its bytes stay and history holds the list it
      // left, so undo puts it back. Only on a yes, per the rules.
      const segments = segmentsOf(first)
      const noteId = second.trim()
      if (!segments.length || !/^[0-9a-f]{64}$/.test(noteId)) return fail('unnote needs a tile route and the note id (64 hex, from notes)')
      const reply = await send({ op: 'note-delete', segments: segments.slice(0, -1), cell: segments.at(-1), sig: noteId })
      return reply.ok ? print(`unlinked from /${segments.join('/')}; history keeps it`) : fail(reply.error)
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
          const { outcome, rounds, reads, tokens, answer, left, error } = reply.data
          return print({ convoId, outcome, rounds, reads, ...(reads === 0 ? { warning: 'nothing was read in this turn: check every claim about the hive yourself' } : {}), tokens, ...(left ? { left: 'the work stopped at the end of a leg; ask "Continue." to carry it on' } : {}), ...(error ? { error } : {}), answer })
        }
      }
      return fail(`no result for ${askId} in time; the turn may still be running — manager.cjs thread ${first} shows where it got to`)
    }
    case 'convo': {
      const letters = Array.from({ length: 6 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('')
      return print(`chat:tile:/::${Date.now()}-${letters}`)
    }
    case 'roster': {
      const fromHive = await hiveRoster()
      return print(fromHive ? { from: `/${GROUP}`, managers: fromHive } : { from: 'the seed table (the hive has no /managers yet; run install)', managers: MANAGERS })
    }
    case 'install': {
      // Idempotent: tiles that are there stay, notes that are there are not
      // written twice. Adds only.
      const listed = await send({ op: 'list-at', segments: [GROUP] })
      if (!listed.ok && /no renderer/.test(String(listed.error))) return fail(listed.error)
      const have = new Set(listed.ok && Array.isArray(listed.data) ? listed.data : [])
      const missing = Object.keys(MANAGERS).filter(name => !have.has(name))
      if (missing.length) {
        const added = await send({ op: 'add', segments: [GROUP], cells: missing })
        if (!added.ok) return fail(added.error)
      }
      const filed = []
      for (const [name, convoId] of Object.entries(MANAGERS)) {
        const notes = await send({ op: 'note-list', segments: [GROUP, name] })
        const texts = (notes.ok ? notes.data : []).map(note => String(note.text ?? ''))
        const want = [`${CONVERSATION_NOTE}${convoId}`]
        const charter = charterOf(name)
        if (charter) want.push(`${CHARTER_NOTE}${charter}`)
        for (const text of want) {
          const prefix = text.slice(0, text.indexOf(': ') + 2)
          if (texts.some(existing => existing.startsWith(prefix))) continue
          const reply = await send({ op: 'note-add', segments: [GROUP], cell: name, text })
          if (!reply.ok) return fail(`${name}: ${reply.error}`)
          filed.push(`${name} ${prefix.trim()}`)
        }
      }
      const home = await send({ op: 'list-at', segments: [] })
      return print({
        added: missing, filed,
        onHomePage: home.ok && Array.isArray(home.data) ? home.data.includes(GROUP) : 'unknown',
      })
    }
    case 'held': {
      const reply = await send({ op: 'effect-last', cell: 'agent:held' })
      return reply.ok ? print(reply.data?.last?.waiting ?? []) : fail(reply.error)
    }
    case 'do': {
      const line = unshelled([first, second].filter(Boolean).join(' ').trim())
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
      return fail('usage: manager.cjs tree|read|notes|note|unnote|thread|report|ask|convo|roster|install|held|do|op — see the header of this file')
  }
}

main()
