// scripts/bridge/breaks.cjs
//
// THE BREAK REPAIR LOOP from outside the hive (documentation/break-repair-loop.md).
// The hive keeps the queue and the issue list; this is how the tick, an agent,
// or anyone at a terminal reads them and writes back what was made of them.
//
//   status                          reachable? how much is queued, how many per status
//   compact                         fold breaks:queue into breaks:log, inside the hive
//   list [--all]                    the list, top first, one JSON line per issue
//                                   (default: new, open and chosen)
//   show <id>                       one issue, whole: stack, notes, everything
//   interpret <id> --title T --text I [--area A] [--files a,b]
//                                   what the review made of a NEW issue; new → open.
//                                   Refused for any other status — the hive enforces
//                                   it inside its own write — so nothing can rewrite
//                                   what a person already chose. Later findings are notes.
//   choose [--mode fix|investigate] [--tackle ids] [--release ids]
//          [--top ids] [--bottom ids] [--dismiss ids] [--shown ids]
//                                   what the participant decided in triage; --shown
//                                   records every issue the checklist put in front of them
//   resolve <id> fixed|open|dismissed [--note T]
//   note <id> <text…>
//   triage [--out file]             the triage checklist — an HTML fragment for the
//                                   desktop app's widget — over the open list
//   tick [--dry]                    ONE tick of the loop, for Task Scheduler (below)
//
// <id> is any unique prefix (6+ hex) of an issue's fingerprint. A failure prints
// one JSON line {ok:false, error, detail} and exits 2, where error is one of
// bridge-unreachable · renderer-missing · bridge-timeout · op-failed · bad-id ·
// bad-args.
//
// THE TICK has drain-tick.cjs's cost shape — model time only when there is work:
//
//   1. compact + list. Node and a round trip. No broker, or no hive tab, is a
//      normal resting state: one log line, exit. Offered marks an earlier tick
//      could not take back are finished here, once the hive answers.
//   2. new BREAKS → a headless review, LOCKED (below). A lock file keeps two
//      ticks from reviewing at once. New warnings never start a review; they
//      are interpreted whenever one runs anyway.
//   3. open breaks nobody has been shown (a reopened one counts), or chosen
//      issues left unfinished longer than the gap → the breaks are marked
//      offered FIRST, then ONE repair conversation opens in a new Windows
//      Terminal, and the marks come back off if it cannot — a take-back the
//      bridge itself refuses is kept in a local file for the next tick. No
//      second one opens within the gap, so one batch of breaks is one
//      conversation. A warning never opens one unless a person chose it.
//   4. neither a review nor a conversation starts while `claude auth status`
//      says signed out, and a review that fails to sign in or is refused over
//      the account's usage limit opens no conversation: one that cannot run
//      would still mark its issues offered.
//
// THE LOCK. The review reads code and writes interpretations of NEW issues —
// nothing else. It spawns from the bridge's `readOnlyArgv` (agent-bridges.json).
// For Claude Code that is --restricted, so no user, project or local settings
// load: a machine's own settings can pre-approve Edit, Write or `git commit`,
// and an allowlist cannot take those back. Only Read, Grep, Glob and Bash
// exist, no MCP server loads, dontAsk denies whatever is not allowed, and Bash
// is narrowed to REVIEW_ALLOW. `choose`, `resolve` and `note` are not in it:
// they are the participant's, and a review that could say them could skip the
// one step a person has to take. A bridge with no read-only template is refused.
//
// NO API KEY UNLESS ASKED. The sign-in check, the review and the conversation
// run without ANTHROPIC_API_KEY (BREAKS_USE_API_KEY=1 keeps it): the loop runs
// on the CLI's own login, and a key left in the environment would otherwise win
// over that login — and bill it. Variables a host Claude session hands its
// children are dropped as well, so a tick started from inside a session still
// spawns sessions of its own.
//
// Env: BRIDGE_URL (default ws://localhost:2401) · HYPERCOMB_BRIDGE_TOKEN (remote
// broker only) · BREAKS_GAP_MIN (default 240) · BREAKS_REVIEW_MODEL (default
// sonnet) · BREAKS_LOG (append one line per tick; the scheduled tick defaults
// it to %TEMP%\hypercomb-breaks-tick.log) · BREAKS_TERMINAL (default wt.exe) ·
// BREAKS_USE_API_KEY (1 = let the review use ANTHROPIC_API_KEY).

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const WebSocket = require('ws')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const TOKEN = String(process.env.HYPERCOMB_BRIDGE_TOKEN || '').trim()
const WS_OPTS = TOKEN ? { headers: { Authorization: `Bearer ${TOKEN}` } } : undefined
const REPO = path.resolve(__dirname, '..', '..')
const GAP_MS = Math.max(1, Number(process.env.BREAKS_GAP_MIN) || 240) * 60_000
const REVIEW_MODEL = String(process.env.BREAKS_REVIEW_MODEL || 'sonnet').trim()
const LOG = process.env.BREAKS_LOG || ''
const TERMINAL = process.env.BREAKS_TERMINAL || 'wt.exe'
const USE_API_KEY = process.env.BREAKS_USE_API_KEY === '1'
// How long an issue whose code has moved stays out of the list that OPENS a
// conversation. It is still on every checklist that opens for another reason —
// the hold silences the summons, never the issue — and after this it is offered
// normally, so nothing is quiet indefinitely without a person having seen it.
const HOLD_MS = Math.max(1, Number(process.env.BREAKS_HOLD_DAYS) || 14) * 24 * 60 * 60_000
const MOVED = 'code moved:'
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/
const REVIEW_LOCK = path.join(os.tmpdir(), 'hypercomb-breaks-review.lock')
const REVIEW_LOCK_MS = 60 * 60_000
const PENDING_ROLLBACK = path.join(os.tmpdir(), 'hypercomb-breaks-pending-rollback.json')
const OPEN = new Set(['new', 'open', 'chosen'])

// The review's whole shell vocabulary, as Claude Code permission rules. Read,
// compact, and interpret a new issue — never choose, resolve or note.
const REVIEW_ALLOW = [
  'Bash(node scripts/bridge/breaks.cjs status)',
  'Bash(node scripts/bridge/breaks.cjs compact)',
  'Bash(node scripts/bridge/breaks.cjs list)',
  'Bash(node scripts/bridge/breaks.cjs list --all)',
  'Bash(node scripts/bridge/breaks.cjs show:*)',
  'Bash(node scripts/bridge/breaks.cjs interpret:*)',
]

// ─── the bridge ─────────────────────────────────────────────────────────

class Stop extends Error {
  constructor(code, detail) { super(detail); this.code = code; this.detail = detail }
}

let counter = 0
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Node tries every address `localhost` resolves to, and reports a refusal on
// all of them as one AggregateError whose message names no code.
const refusedConnection = err => !!err && (
  err.code === 'ECONNREFUSED'
  || (Array.isArray(err.errors) && err.errors.some(inner => inner && inner.code === 'ECONNREFUSED'))
  || /ECONNREFUSED/.test(String(err))
)

const send = req => new Promise((resolve, reject) => {
  const ws = new WebSocket(BRIDGE, WS_OPTS)
  const timer = setTimeout(() => { try { ws.terminate() } catch {} ; reject(new Stop('bridge-timeout', 'no reply in 20s')) }, 20_000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id: `breaks-${Date.now()}-${++counter}` })))
  ws.on('message', raw => {
    clearTimeout(timer)
    try { ws.close() } catch {}
    try { resolve(JSON.parse(String(raw))) } catch (err) { reject(err) }
  })
  ws.on('error', err => {
    clearTimeout(timer)
    reject(refusedConnection(err) ? new Stop('bridge-unreachable', `no broker on ${BRIDGE}`) : err)
  })
})

// Retries past "no renderer connected": the hive tab may be mid-reload.
async function call(req) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let reply
    try {
      reply = await send(req)
    } catch (err) {
      if (err instanceof Stop && err.code === 'bridge-unreachable') throw err
      if (attempt === 3) throw err instanceof Stop ? err : new Stop('bridge-timeout', String(err.message || err))
      await sleep(1500)
      continue
    }
    if (reply.ok) return reply.data
    if (reply.error !== 'no renderer connected') throw new Stop('op-failed', reply.error)
    if (attempt < 3) await sleep(1500)
  }
  throw new Stop('renderer-missing', 'no hive tab with ?claudeBridge=1 is connected')
}

const list = () => call({ op: 'breaks-list' })
const update = (issue, payload) => call({ op: 'break-issue-update', sig: issue.fingerprint, payload })

/**
 * The hive keeps a CLOSED set of statuses, and silently ignores one it does not
 * know — so a word this CLI has learned but the running bundle has not would
 * look like a click that did nothing at all. Say it instead. (`retired` needs
 * `npm run build:essentials` and a hive tab reload.)
 */
function took(reply, payload, issue) {
  const want = payload && payload.status
  const got = reply && reply.issue && reply.issue.status
  if (want && got && got !== want) {
    throw new Stop('hive-too-old', `the hive kept ${idOf(issue)} at "${got}" instead of "${want}" — run npm run build:essentials and reload the hive tab`)
  }
  return reply
}

// ─── ids and output ─────────────────────────────────────────────────────

function resolveId(issues, prefix) {
  const p = String(prefix || '').trim().toLowerCase()
  if (!/^[0-9a-f]{6,64}$/.test(p)) throw new Stop('bad-id', `not an issue id: ${prefix}`)
  const hits = issues.filter(i => i.fingerprint.startsWith(p))
  if (hits.length !== 1) throw new Stop('bad-id', hits.length ? `ambiguous id: ${prefix}` : `no issue: ${prefix}`)
  return hits[0]
}

const ids = value => (typeof value === 'string' ? value.split(',').map(s => s.trim()).filter(Boolean) : [])
const idOf = issue => issue.fingerprint.slice(0, 8)
const out = value => console.log(JSON.stringify(value))
const isWarning = issue => issue.type === 'warning'

const brief = i => ({
  id: idOf(i),
  type: i.type,
  status: i.status,
  rank: i.rank,
  count: i.count,
  sessions: i.sessions,
  lastSeen: new Date(i.lastAt).toISOString(),
  title: i.title || i.message.slice(0, 120),
  ...(i.area ? { area: i.area } : {}),
  ...(i.status === 'chosen' && i.mode ? { mode: i.mode } : {}),
  ...(movedNoteOf(i) ? { moved: true } : {}),
})

/** The tick's evidence note, if it has written one. One per issue, ever. */
const movedNoteOf = i => (i.notes || []).find(n => String(n.text).startsWith(MOVED))

// ─── what a tick does ───────────────────────────────────────────────────

/** New breaks start a review; new warnings wait for one. */
const reviewable = issues => issues.filter(i => i.status === 'new' && !isWarning(i))

/**
 * What a tick offers. Pure, so the spec can pin its promises: a warning never
 * opens a conversation on its own; a break nobody has been shown does; a
 * chosen issue left unfinished past the gap does again (a warning too — a
 * person chose it); and no conversation opens inside the gap of the last one.
 * `alsoShown` is the waiting warnings, marked offered once the conversation
 * that shows them has opened.
 *
 * `held` are fingerprints whose code has moved since they last happened. They
 * are dropped from the bucket that SUMMONS a conversation and from nothing
 * else: they stay on `list`, and on every checklist another issue opens. A
 * chosen issue is never held — a person put it there by hand.
 */
function planOffer(issues, now, gapMs, held = new Set()) {
  const unshown = i => (i.status === 'new' || i.status === 'open') && !i.offeredAt
  const due = [
    ...issues.filter(i => !isWarning(i) && unshown(i) && !held.has(i.fingerprint)),
    ...issues.filter(i => i.status === 'chosen' && now - (i.offeredAt || 0) > gapMs),
  ]
  const alsoShown = due.length ? issues.filter(i => isWarning(i) && unshown(i)) : []
  const lastOffer = issues.reduce((max, i) => Math.max(max, i.offeredAt || 0), 0)
  const waitMin = due.length && now - lastOffer < gapMs ? Math.ceil((gapMs - (now - lastOffer)) / 60_000) : 0
  return { due, alsoShown, waitMin }
}

/**
 * Which issues may carry an evidence note at all. Deliberately narrow: a break
 * (never a warning), blamed on named files, seen ONLY on a dev server — a break
 * a real reader hit on a deployed host is never a churn suspect — and not yet
 * annotated. One note per issue, ever: the moment anything has been said about
 * an issue, the tick stops reading it.
 */
const notable = i => (i.status === 'new' || i.status === 'open' || i.status === 'chosen')
  && !isWarning(i)
  && (i.files || []).length > 0
  && (i.origins || []).length > 0 && i.origins.every(o => LOCAL.test(o))
  && (i.notes || []).length === 0

const span = ms => {
  const min = Math.max(0, Math.round(ms / 60_000))
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${min % 60}m`
}

/**
 * The words the tick puts on the record. It states EVIDENCE and names the
 * competing explanation, because the participant decides — a note that read as
 * a verdict would launder a machine's reading through a human click.
 */
const movedNote = (issue, moved) =>
  `${MOVED} every file this break blames changed after its last occurrence — ${moved.file} at ${new Date(moved.at).toISOString()}, `
  + `${span(moved.at - issue.lastAt)} after the last of ${issue.count} occurrence${issue.count === 1 ? '' : 's'} at ${new Date(issue.lastAt).toISOString()}. `
  + `All ${issue.sessions} page load${issue.sessions === 1 ? '' : 's'} came from a localhost dev server. `
  + 'That is evidence the bytes that threw are gone; it is not proof the bug is gone — the same file may have changed for an unrelated reason. '
  + 'Retire it if the crashing code was replaced.'

/**
 * The tick's reading of git, per issue. Pure, so the spec can pin it. `notes`
 * are the evidence notes to write; `held` are the fingerprints that must not
 * summon a conversation of their own.
 *
 * Everything here is built to make a wrong reading cheap. One note ever, so the
 * cost is one delayed conversation rather than an unbounded silence; any
 * occurrence since the note, any note a person wrote, or HOLD_MS elapsing
 * releases the hold for good; an issue reopened by THIS tick is never touched;
 * and a chosen issue gains the note but keeps its conversation.
 */
function planMoved(issues, moved, now, holdMs, reopened = []) {
  const held = new Set()
  const notes = []
  for (const i of issues) {
    const prior = movedNoteOf(i)
    if (prior) {
      const human = (i.notes || []).some(n => !String(n.text).startsWith(MOVED))
      if (!human && i.status !== 'chosen' && i.lastAt <= prior.at && now - prior.at < holdMs) held.add(i.fingerprint)
      continue
    }
    if (reopened.includes(i.fingerprint) || !notable(i)) continue
    const m = moved.get(i.fingerprint)
    if (!m || m.at <= i.lastAt) continue
    if (i.status !== 'chosen') held.add(i.fingerprint)
    notes.push({ issue: i, payload: { onlyIfStatus: i.status, note: movedNote(i, m) } })
  }
  return { held, notes }
}

/**
 * A settled claim the evidence contradicts. Broader than the fold's own test:
 * the fold needs a page load that STARTED after the claim, and this hive runs
 * one long-lived tab, so a real bug can throw all day from a tab older than the
 * retirement. Any occurrence at all after the stamp brings it back. Pure.
 */
function planUnretire(issues) {
  return issues
    .filter(i => i.status === 'retired' && typeof i.fixedAt === 'number' && i.lastAt > i.fixedAt)
    .map(i => ({
      issue: i,
      payload: {
        status: 'open', onlyIfStatus: 'retired', offered: false,
        note: `broke again after it was retired — an occurrence at ${new Date(i.lastAt).toISOString()}, after the retirement at ${new Date(i.fixedAt).toISOString()}.`,
      },
    }))
}

/** Settled claims the record still contradicts — wrong retirements AND wrong
 *  fixes, which have the same hole today and no report at all. */
const stillBreaking = issues => issues
  .filter(i => (i.status === 'fixed' || i.status === 'retired') && typeof i.fixedAt === 'number' && i.lastAt > i.fixedAt)
  .map(i => ({ id: idOf(i), status: i.status, since: new Date(i.fixedAt).toISOString(), last: new Date(i.lastAt).toISOString() }))

/**
 * Which offered marks a failed conversation left behind can be taken back now.
 * Pure, so the spec can pin it. Each pending entry names a mark the bridge
 * refused to take back: `{ fingerprint, offeredAt?, since, until }`. A mark is
 * taken back only while it is still the one that tick stamped — the exact stamp
 * it saw, or, when the stamp was never seen, one made inside that tick — and
 * only while nobody has chosen, fixed or dismissed the issue since.
 */
function planRollback(pending, issues) {
  const plan = []
  for (const entry of pending) {
    const issue = issues.find(i => i.fingerprint === entry.fingerprint)
    if (!issue || !issue.offeredAt || (issue.status !== 'new' && issue.status !== 'open')) continue
    const stillThatMark = typeof entry.offeredAt === 'number'
      ? issue.offeredAt === entry.offeredAt
      : issue.offeredAt >= entry.since && issue.offeredAt <= entry.until
    if (stillThatMark) plan.push({ issue, entry })
  }
  return plan
}

/**
 * What a triage decision writes, per issue. Pure, so the spec can pin it. Every
 * id resolves before anything is written — a typo must not leave half a triage
 * applied. `--shown` marks what the checklist put in front of the participant,
 * so a place they chose to keep is not offered to them again after the gap.
 */
function planChoose(issues, flags) {
  const mode = flags.mode === 'investigate' ? 'investigate' : 'fix'
  const patches = new Map()
  const patch = (issue, fields) => patches.set(issue, { ...(patches.get(issue) || {}), ...fields })
  let top = issues.reduce((min, i) => Math.min(min, i.rank), 0)
  let bottom = issues.reduce((max, i) => Math.max(max, i.rank), 0)
  const tops = ids(flags.top).map(id => resolveId(issues, id))
  for (const issue of [...tops].reverse()) patch(issue, { rank: --top })
  for (const id of ids(flags.bottom)) patch(resolveId(issues, id), { rank: ++bottom })
  for (const id of ids(flags.shown)) patch(resolveId(issues, id), { offered: true })
  for (const id of ids(flags.release)) patch(resolveId(issues, id), { status: 'open' })
  // The conversation that chose them is working them — offered, so the tick
  // does not open a second one on top.
  for (const id of ids(flags.tackle)) patch(resolveId(issues, id), { status: 'chosen', mode, offered: true })
  for (const id of ids(flags.retire)) patch(resolveId(issues, id), { status: 'retired' })
  for (const id of ids(flags.dismiss)) patch(resolveId(issues, id), { status: 'dismissed' })
  if (!patches.size) throw new Stop('bad-args', 'choose needs one of --tackle --release --top --bottom --retire --dismiss --shown')
  return { mode, patches: [...patches].map(([issue, payload]) => ({ issue, payload })) }
}

/**
 * The environment a spawned review, sign-in check or conversation gets. No
 * ANTHROPIC_API_KEY unless BREAKS_USE_API_KEY=1, and — when this process runs
 * inside a host Claude session — none of the variables that session hands its
 * children, including its endpoint. Pure, so the spec can pin it.
 */
const HOST_SESSION_VAR = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_AGENT_SDK_VERSION|CLAUDE_PREVIEW_CLASSIFIER_FLOOR|CLAUDE_CODE_(?!GIT_BASH_PATH$).+)$/
function childEnv(env = process.env, useApiKey = USE_API_KEY) {
  const hosted = Object.keys(env).some(name => name.toUpperCase() === 'CLAUDECODE')
  const kept = {}
  for (const [name, value] of Object.entries(env)) {
    const upper = name.toUpperCase()
    if (upper === 'ANTHROPIC_API_KEY' && !useApiKey) continue
    if (hosted && (HOST_SESSION_VAR.test(upper) || upper === 'ANTHROPIC_BASE_URL')) continue
    kept[name] = value
  }
  return kept
}

/** The review's spawn plan: the bridge's read-only template with REVIEW_ALLOW,
 *  or `refused` when the bridge declares no way to lock it. */
function reviewInvocation(agent, prompt) {
  return require('./agent-roster.cjs').invocation(agent, prompt, REVIEW_MODEL, { readOnly: true, allow: REVIEW_ALLOW })
}

// ─── the triage checklist ───────────────────────────────────────────────

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const ago = at => {
  const min = Math.max(0, Math.round((Date.now() - at) / 60_000))
  return min < 60 ? `${min} min ago` : min < 48 * 60 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} days ago`
}

const brokeAgain = i => i.status === 'open' && (i.notes || []).some(n => String(n.text).startsWith('broke again'))

// A widget for the desktop app's visualize tool: every row a checkbox (tackle)
// and a place (keep, top, bottom, retire); Send posts the `choose` line back
// into the conversation, where the agent runs it verbatim. Breaks come first;
// warnings follow under a line of their own. A row that is already chosen and
// stays checked is left alone, so the page's mode never rewrites its own; and
// every row shown is recorded with --shown, so keeping a place is a decision.
function triageHtml(issues) {
  const ordered = [...issues.filter(i => !isWarning(i)), ...issues.filter(isWarning)]
  const warnings = ordered.filter(isWarning).length
  const badge = (text, role) =>
    `<span style="font-size:11px;font-weight:400;padding:1px 8px;margin-left:6px;border-radius:var(--radius);background:var(--bg-${role});color:var(--text-${role})">${text}</span>`
  const row = i => {
    const id = idOf(i)
    const head = esc(i.title || i.message.slice(0, 110))
    const mark = i.status === 'new' ? badge('new', 'accent')
      : brokeAgain(i) ? badge('broke again', 'danger')
        : i.status === 'chosen' ? badge(`chosen: ${esc(i.mode || 'fix')}`, 'warning') : ''
    const kind = isWarning(i) ? '<span style="font-size:11px;font-weight:400;margin-left:6px;color:var(--text-muted)">warning</span>' : ''
    // Plain words, never the jargon: the row states what was found, and the
    // note under it names the competing explanation. A badge that read as a
    // verdict would make "the participant chooses" nominal.
    const moved = movedNoteOf(i)
    const movedMark = moved && !brokeAgain(i) ? badge('code moved', 'warning') : ''
    const evidence = moved
      ? `<p style="margin:4px 0 0;font-size:12px;line-height:1.5;color:var(--text-muted)">${esc(moved.text)}</p>`
      : ''
    const meta = [id, `${i.count} ${i.count === 1 ? 'time' : 'times'}`, `${i.sessions} page ${i.sessions === 1 ? 'load' : 'loads'}`, `last ${ago(i.lastAt)}`, i.area]
      .filter(Boolean).map(esc).join(' · ')
    const why = i.interpretation
      ? `<p style="margin:4px 0 0;font-size:13px;line-height:1.5;color:var(--text-secondary)">${esc(i.interpretation)}</p>`
      : ''
    return `<div style="display:grid;grid-template-columns:20px minmax(0,1fr) 140px;gap:12px;align-items:start;padding:12px 0;border-top:0.5px solid var(--border)">`
      + `<input type="checkbox" data-id="${id}"${i.status === 'chosen' ? ' checked data-chosen="1"' : ''} aria-label="Tackle ${head}" style="margin-top:4px">`
      + `<div style="min-width:0"><p style="margin:0;font-size:14px;font-weight:500">${head}${mark}${movedMark}${kind}</p>`
      + `<p style="margin:2px 0 0;font-size:12px;color:var(--text-muted)">${meta}</p>${why}${evidence}</div>`
      + `<select data-move="${id}" aria-label="Place for ${head}" style="width:100%"><option value="">Keep place</option><option value="top">Move to top</option><option value="bottom">Move to bottom</option><option value="retire">Retire</option></select>`
      + `</div>`
  }
  const rows = ordered.map((i, n) => {
    const firstWarning = isWarning(i) && (n === 0 || !isWarning(ordered[n - 1]))
    return (firstWarning
      ? '<p style="margin:16px 0 4px;font-size:13px;color:var(--text-secondary)">Warnings wait here. They never open a conversation unless someone chooses them.</p>\n'
      : '') + row(i)
  }).join('\n')

  return `<h2 class="sr-only">${ordered.length - warnings} client breaks and ${warnings} warnings to triage. Check the ones to tackle, then move or dismiss the rest.</h2>
<div style="display:flex;flex-wrap:wrap;align-items:center;gap:16px;padding:0.5rem 0 12px;font-size:14px">
<span style="color:var(--text-secondary)">Tackle the newly checked ones by</span>
<label><input type="radio" name="mode" value="fix" checked> fixing them</label>
<label><input type="radio" name="mode" value="investigate"> investigating only</label>
</div>
${rows}
<div style="display:flex;align-items:center;gap:12px;padding:12px 0 0.5rem;border-top:0.5px solid var(--border)">
<button id="send">Send triage ↗</button>
</div>
<script>
const all = s => Array.from(document.querySelectorAll(s))
document.getElementById('send').addEventListener('click', () => {
  const moves = { top: [], bottom: [], retire: [] }
  all('select[data-move]').forEach(s => { if (s.value) moves[s.value].push(s.dataset.move) })
  const tackle = all('input[data-id]:checked:not([data-chosen])').map(x => x.dataset.id).filter(id => !moves.retire.includes(id))
  const release = all('input[data-chosen]:not(:checked)').map(x => x.dataset.id).filter(id => !moves.retire.includes(id))
  const shown = all('input[data-id]').map(x => x.dataset.id)
  const mode = document.querySelector('input[name=mode]:checked').value
  const flags = ['--mode ' + mode]
  const said = []
  if (tackle.length) { flags.push('--tackle ' + tackle.join(',')); said.push((mode === 'fix' ? 'fix ' : 'investigate ') + tackle.length) }
  if (release.length) { flags.push('--release ' + release.join(',')); said.push('put back ' + release.length) }
  if (moves.top.length) { flags.push('--top ' + moves.top.join(',')); said.push(moves.top.length + ' to the top') }
  if (moves.bottom.length) { flags.push('--bottom ' + moves.bottom.join(',')); said.push(moves.bottom.length + ' to the bottom') }
  if (moves.retire.length) { flags.push('--retire ' + moves.retire.join(',')); said.push('retire ' + moves.retire.length) }
  flags.push('--shown ' + shown.join(','))
  sendPrompt('Break triage: ' + (said.length ? said.join(', ') : 'keep everything where it is') + '.\\nnode scripts/bridge/breaks.cjs choose ' + flags.join(' '))
})
</script>`
}

// ─── has the code moved? ────────────────────────────────────────────────

// COMMITTED HISTORY ONLY. mtime is content-free — a checkout, a stash pop, a
// worktree switch or a formatter save all bump it, and this repo has dozens of
// worktrees. Dirtiness is worse: a dirty blamed file is a refactor IN FLIGHT,
// which is exactly when nothing should be quietened. git accepts the review's
// cwd-relative spelling as a pathspec, and `%ct` never prints a path, so no
// path of git's is ever parsed.
const commitAt = (() => {
  const seen = new Map()
  return file => {
    if (seen.has(file)) return seen.get(file)
    let at = 0
    if (/^[\w./-]+$/.test(file) && !file.startsWith('-') && !file.includes('..')) {
      const r = require('child_process').spawnSync('git', ['log', '-1', '--format=%ct', '--', file],
        { cwd: REPO, timeout: 10_000, shell: false, encoding: 'utf8' })
      const t = Number(String((r && r.stdout) || '').trim())
      if (Number.isFinite(t) && t > 0) at = t * 1000
    }
    seen.set(file, at)
    return at
  }
})()

/**
 * When every file an issue blames last changed — the OLDEST of them, so more
 * blamed files makes the claim harder, not easier, and a vaguer review can
 * never produce a stronger verdict. One unreadable file voids the claim
 * entirely. Only candidates are probed, so a quiet tick runs no git at all.
 */
function probeMoved(issues, at = commitAt) {
  const moved = new Map()
  for (const i of issues.filter(notable)) {
    let oldest = Infinity
    let file = ''
    for (const f of i.files) {
      const c = at(f)
      if (!c) { oldest = 0; break }
      if (c < oldest) { oldest = c; file = f }
    }
    if (oldest && oldest !== Infinity) moved.set(i.fingerprint, { at: oldest, file, files: i.files.length })
  }
  return moved
}

// ─── the tick ───────────────────────────────────────────────────────────

function log(line) {
  const stamped = `[${new Date().toISOString()}] breaks: ${line}`
  console.log(stamped)
  if (LOG) { try { fs.appendFileSync(LOG, stamped + '\n') } catch { /* logging is best-effort */ } }
}

// The lock is a timestamp, so a review that crashed cannot hold the loop forever.
const reviewLocked = () => {
  try { return Date.now() - Number(fs.readFileSync(REVIEW_LOCK, 'utf8')) < REVIEW_LOCK_MS } catch { return false }
}

// Marks a failed conversation could not take back, kept for the next tick.
const readPending = () => {
  try { const pending = JSON.parse(fs.readFileSync(PENDING_ROLLBACK, 'utf8')); return Array.isArray(pending) ? pending : [] } catch { return [] }
}
const writePending = pending => {
  try {
    if (pending.length) fs.writeFileSync(PENDING_ROLLBACK, JSON.stringify(pending))
    else fs.unlinkSync(PENDING_ROLLBACK)
  } catch { /* nothing to remove */ }
}

const reviewPrompt = count => [
  `${count} client break${count === 1 ? ' is' : 's are'} waiting for review on the Hypercomb bridge.`,
  'Read .claude/skills/break-repair/SKILL.md and do section 2 only: interpret every issue with status new, warnings included, then stop.',
  'This run is locked read-only. Its shell may run only these exact commands, one per call, with forward slashes and no chaining or redirection:',
  'node scripts/bridge/breaks.cjs status, compact, list, list --all, show ID, and interpret ID --title T --text I with optional --area A and --files a,b.',
  'Use Read, Grep and Glob for the source. Everything else is denied without asking, so record what you can and stop.',
].join(' ')

// A review or a conversation started while the CLI is signed out dies at once,
// and a conversation would still have marked its issues offered, so they would
// sit out a whole gap. Ask first: `claude auth status` spends no model time. It
// is asked in the same environment the review will get, so a key the review
// will not see cannot make it look signed in.
function claudeLoggedIn() {
  const roster = require('./agent-roster.cjs')
  const bin = roster.resolveBin('claude')
  if (!bin) return false
  const plan = roster.spawnPlan(bin, ['auth', 'status'])
  const outcome = require('child_process').spawnSync(plan.file, plan.args, {
    encoding: 'utf8', timeout: 30_000, shell: false, stdio: ['ignore', 'pipe', 'pipe'], ...plan.options, env: childEnv(),
  })
  const said = String(outcome.stdout || '')
  try { return JSON.parse(said.slice(said.indexOf('{'))).loggedIn === true } catch { return false }
}

// Headless, like drain-tick's runs: the review needs nobody, so it needs no
// window — and it runs locked, because nobody is watching it either.
function runReview(count) {
  const roster = require('./agent-roster.cjs')
  const agent = roster.installed().find(a => a.id === 'claude-bridge')
  if (!agent) return Promise.resolve({ code: -1, out: 'Claude Code is not installed here' })
  const { bin, model, file, spawnArgs, options, refused } = reviewInvocation(agent, reviewPrompt(count))
  if (refused) return Promise.resolve({ code: -1, out: `review refused: ${refused}`, model })
  if (!bin) return Promise.resolve({ code: -1, out: 'claude binary not found on PATH', model })
  return new Promise(resolve => {
    let child
    try {
      child = spawn(file, spawnArgs, { cwd: REPO, shell: false, ...options, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv() })
    } catch (err) {
      return resolve({ code: -1, out: String((err && err.message) || err), model })
    }
    let said = ''
    child.stdout.on('data', d => { said += String(d) })
    child.stderr.on('data', d => { said += String(d) })
    child.on('close', code => resolve({ code, out: said.trim().slice(-600), model }))
    child.on('error', err => resolve({ code: -1, out: String(err), model }))
  })
}

// The conversation is the one step that needs the participant, so it gets a
// window of its own. The command line carries no `;` on purpose: Windows
// Terminal splits its command line on `;`. A new tab may be created by a
// Terminal process that is already running, with that process's environment,
// so the key is cleared inside the tab itself rather than only in `env`.
function openConversation() {
  return new Promise(resolve => {
    const launch = USE_API_KEY ? 'claude /break-repair' : 'set ANTHROPIC_API_KEY=&& claude /break-repair'
    let child
    try {
      child = spawn(TERMINAL, ['-w', 'new', 'new-tab', '--title', 'Hypercomb breaks', '-d', REPO, 'cmd', '/k', launch], {
        cwd: REPO, shell: false, detached: true, stdio: 'ignore', windowsHide: false, env: childEnv(),
      })
    } catch (err) {
      return resolve(String((err && err.message) || err))
    }
    child.on('error', err => resolve(String(err)))
    child.on('spawn', () => { child.unref(); resolve(null) })
  })
}

async function tick(dry) {
  let issues
  let queued
  // What this very tick reopened. An issue that just came back is never read as
  // churn on the same pass — its `lastAt` is new and its evidence is stale.
  let reopenedThisTick = []
  try {
    if (!dry) {
      const folded = await call({ op: 'breaks-compact' })
      reopenedThisTick = folded.reopened || []
      if (folded.folded || folded.created.length || folded.reopened.length) {
        log(`folded ${folded.folded} records: ${folded.created.length} new, ${folded.reopened.length} broke again`)
      }
    }
    ;({ issues, queued } = await list())
  } catch (err) {
    if (err instanceof Stop) { log(`${err.code}, nothing to do`); return }
    throw err
  }
  if (dry && queued) log(`DRY: ${queued} queued records are not folded yet; a real tick folds them before it decides`)

  // Offered marks an earlier tick could not take back, finished now that the
  // hive answers — only the exact mark that tick made (see planRollback).
  const pending = readPending()
  if (pending.length) {
    if (dry) {
      log(`DRY: ${pending.length} offered marks wait to be taken back`)
    } else {
      const left = []
      for (const { issue, entry } of planRollback(pending, issues)) {
        try {
          await update(issue, { offered: false })
          delete issue.offeredAt
          log(`took back a stranded offered mark on ${idOf(issue)}`)
        } catch {
          left.push(entry)
        }
      }
      writePending(left)
    }
  }

  let signedIn
  const ready = () => {
    signedIn ??= claudeLoggedIn()
    if (!signedIn) log('claude is signed out (run: claude auth login), so the review and conversations wait')
    return signedIn
  }

  // A review that could not run means a conversation cannot either — and
  // opening one would still mark its issues offered, stranding them for a gap.
  // `auth status` can say "signed in" while the credential is dead or the
  // account is over its usage limit, so the review's own failure is decisive.
  const CANNOT_RUN = /failed to authenticate|oauth session expired|api key is invalid|invalid api key|not logged in|usage limit|rate limit|limit reached|limit exceeded/i
  let cannotRun = false

  const fresh = reviewable(issues)
  if (fresh.length) {
    if (dry) {
      log(`DRY: would review ${fresh.length} new: ${fresh.map(idOf).join(', ')}`)
    } else if (!ready()) {
      return
    } else if (reviewLocked()) {
      // The tick running that review offers when it is done.
      log(`${fresh.length} new, a review is already running`)
      return
    } else {
      fs.writeFileSync(REVIEW_LOCK, String(Date.now()))
      log(`${fresh.length} new, starting a locked review`)
      try {
        const { code, out: said, model } = await runReview(fresh.length)
        log(`review${model ? ` (${model})` : ''} exited ${code}${said ? `: ${said.split('\n').slice(-2).join(' / ')}` : ''}`)
        cannotRun = code !== 0 && CANNOT_RUN.test(said)
      } finally {
        try { fs.unlinkSync(REVIEW_LOCK) } catch { /* already gone */ }
      }
      try { ({ issues, queued } = await list()) } catch (err) {
        if (err instanceof Stop) { log(`${err.code} after the review`); return }
        throw err
      }
    }
  }

  // A settled claim the hive kept contradicting comes back before anything
  // else reads the list.
  for (const { issue, payload } of planUnretire(issues)) {
    if (dry) { log(`DRY: would un-retire ${idOf(issue)} — still breaking since it was retired`); continue }
    try {
      await update(issue, payload)
      issue.status = 'open'
      delete issue.offeredAt
      log(`un-retired ${idOf(issue)}: it kept breaking after it was retired`)
    } catch { /* the next tick tries again */ }
  }

  // Then the one question the free tick can answer: has the code each break
  // blames moved since it last happened? Asked AFTER the review, so a churn
  // break is still interpreted once — only the CONVERSATION is held.
  const { held, notes } = planMoved(issues, probeMoved(issues), Date.now(), HOLD_MS, reopenedThisTick)
  for (const { issue, payload } of notes) {
    if (dry) { log(`DRY: would note code moved on ${idOf(issue)}`); continue }
    try {
      await update(issue, payload)
      issue.notes = [...(issue.notes || []), { at: Date.now(), text: payload.note }]
      log(`code moved under ${idOf(issue)}${issue.status === 'chosen' ? '' : ' — held from opening a conversation'}`)
    } catch { /* the next tick tries again */ }
  }

  // Anything still `new` here is a review that failed; the conversation's own
  // review section picks it up, so it is offered like an open issue.
  const { due, alsoShown, waitMin } = planOffer(issues, Date.now(), GAP_MS, held)
  if (!due.length) {
    const onList = issues.filter(i => OPEN.has(i.status))
    log(`quiet: ${queued} queued, ${onList.filter(i => !isWarning(i)).length} breaks and ${onList.filter(isWarning).length} warnings on the list`)
    return
  }
  if (waitMin) { log(`${due.length} to offer, next conversation possible in ${waitMin} min`); return }
  if (dry) { log(`DRY: would open a conversation for ${due.map(idOf).join(', ')}`); return }
  if (cannotRun) {
    log('the review could not run (signed out, or over the account\'s usage limit), so no conversation opens either')
    return
  }
  if (!ready()) return

  // The breaks are marked offered FIRST: a conversation that opens but is not
  // recorded would be opened again on the very next tick. If it cannot open,
  // the marks come back off — a mark with no conversation behind it would hide
  // those breaks until something else happened to open one. Each issue joins
  // `marked` before its update is sent, because an update that timed out may
  // still have landed; the stamp the hive answers with is kept, so a take-back
  // the bridge refuses can be finished exactly by a later tick.
  const since = Date.now()
  const marked = []
  let failed = null
  try {
    for (const issue of due) {
      const mark = { issue, offeredAt: undefined }
      marked.push(mark)
      const reply = await update(issue, { offered: true })
      mark.offeredAt = reply && reply.issue ? reply.issue.offeredAt : undefined
    }
    failed = await openConversation()
  } catch (err) {
    failed = String((err && err.message) || err)
  }
  if (failed) {
    const refusedBack = []
    for (const mark of marked) {
      try { await update(mark.issue, { offered: false }) } catch { refusedBack.push(mark) }
    }
    if (refusedBack.length) {
      const until = Date.now()
      writePending([
        ...readPending(),
        ...refusedBack.map(m => ({ fingerprint: m.issue.fingerprint, ...(typeof m.offeredAt === 'number' ? { offeredAt: m.offeredAt } : {}), since, until })),
      ])
    }
    log(`could not open a conversation (${failed}); ${marked.length - refusedBack.length} offered marks taken back${refusedBack.length ? `, ${refusedBack.length} left for the next tick: ${refusedBack.map(m => idOf(m.issue)).join(', ')}` : ''}`)
    return
  }
  // The waiting warnings are shown by the conversation that just opened.
  for (const issue of alsoShown) { try { await update(issue, { offered: true }) } catch { /* shown either way */ } }
  log(`opened a conversation for ${due.length}${alsoShown.length ? ` (+${alsoShown.length} warnings)` : ''}: ${due.map(idOf).join(', ')}`)
}

// ─── commands ───────────────────────────────────────────────────────────

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const flags = {}
  const args = []
  for (let n = 0; n < rest.length; n++) {
    const arg = rest[n]
    if (!arg.startsWith('--')) { args.push(arg); continue }
    const next = rest[n + 1]
    if (next === undefined || next.startsWith('--')) flags[arg.slice(2)] = true
    else { flags[arg.slice(2)] = next; n++ }
  }

  switch (cmd) {
    case 'status': {
      const { issues, queued } = await list()
      const counts = { new: 0, open: 0, chosen: 0, fixed: 0, dismissed: 0, retired: 0 }
      for (const i of issues) counts[i.status] = (counts[i.status] ?? 0) + 1
      const warnings = issues.filter(i => isWarning(i) && OPEN.has(i.status)).length
      const wrong = stillBreaking(issues)
      return out({ ok: true, queued, issues: issues.length, ...counts, warnings, ...(wrong.length ? { stillBreaking: wrong } : {}) })
    }

    case 'compact': {
      const r = await call({ op: 'breaks-compact' })
      return out({ ok: true, ...r, created: r.created.map(f => f.slice(0, 8)), reopened: r.reopened.map(f => f.slice(0, 8)) })
    }

    case 'list': {
      const { issues } = await list()
      const shown = flags.all ? issues : issues.filter(i => OPEN.has(i.status))
      if (!shown.length) return out({ issues: 0 })
      for (const i of shown) out(brief(i))
      return
    }

    case 'show': {
      const { issues } = await list()
      return console.log(JSON.stringify(resolveId(issues, args[0]), null, 2))
    }

    case 'interpret': {
      if (typeof flags.title !== 'string' || typeof flags.text !== 'string') {
        throw new Stop('bad-args', 'interpret <id> --title T --text I [--area A] [--files a,b]')
      }
      const { issues } = await list()
      const issue = resolveId(issues, args[0])
      // Only a NEW issue is interpreted. What is already open or chosen is never
      // rewritten — later findings are notes. The hive checks the same thing
      // inside its own write (onlyIfStatus), so a `choose` that lands between
      // this list and the update still wins.
      if (issue.status !== 'new') {
        throw new Stop('bad-args', `interpret only takes new issues; ${idOf(issue)} is ${issue.status} (use note)`)
      }
      const payload = { title: flags.title, interpretation: flags.text, status: 'open', onlyIfStatus: 'new' }
      if (typeof flags.area === 'string') payload.area = flags.area
      if (typeof flags.files === 'string') payload.files = ids(flags.files)
      const r = await update(issue, payload)
      return out({ ok: true, ...brief(r.issue) })
    }

    case 'choose': {
      const { issues } = await list()
      const { mode, patches } = planChoose(issues, flags)
      for (const { issue, payload } of patches) took(await update(issue, payload), payload, issue)
      return out({
        ok: true, mode,
        tackle: ids(flags.tackle), release: ids(flags.release), top: ids(flags.top),
        bottom: ids(flags.bottom), retire: ids(flags.retire), dismiss: ids(flags.dismiss), shown: ids(flags.shown).length,
      })
    }

    case 'resolve': {
      const status = args[1]
      // `open` is the un-retire gesture, by hand: it needs no new verb.
      if (!['fixed', 'open', 'dismissed', 'retired'].includes(status)) throw new Stop('bad-args', 'resolve <id> fixed|open|dismissed|retired [--note T]')
      const { issues } = await list()
      const payload = { status, ...(typeof flags.note === 'string' ? { note: flags.note } : {}) }
      const issue = resolveId(issues, args[0])
      const r = took(await update(issue, payload), payload, issue)
      return out({ ok: true, ...brief(r.issue) })
    }

    case 'note': {
      const text = args.slice(1).join(' ').trim()
      if (!text) throw new Stop('bad-args', 'note <id> <text>')
      const { issues } = await list()
      const r = await update(resolveId(issues, args[0]), { note: text })
      return out({ ok: true, id: idOf(r.issue), notes: r.issue.notes.length })
    }

    case 'triage': {
      const { issues } = await list()
      const shown = issues.filter(i => OPEN.has(i.status))
      if (!shown.length) return out({ issues: 0 })
      const html = triageHtml(shown)
      if (typeof flags.out !== 'string') return console.log(html)
      fs.writeFileSync(flags.out, html)
      return out({ ok: true, out: flags.out, issues: shown.length })
    }

    case 'tick':
      try { return await tick(flags.dry === true) } catch (err) { log(`tick failed: ${String(err && err.message || err)}`); return }

    default:
      throw new Stop('bad-args', 'usage: breaks.cjs status|compact|list|show|interpret|choose|resolve|note|triage|tick (see the header)')
  }
}

module.exports = {
  REVIEW_ALLOW, Stop, reviewable, planOffer, planRollback, planChoose, childEnv,
  reviewInvocation, reviewPrompt, triageHtml,
  notable, probeMoved, planMoved, planUnretire, stillBreaking, took, MOVED,
}

if (require.main === module) {
  main().catch(err => {
    if (err instanceof Stop) { out({ ok: false, error: err.code, detail: err.detail }); process.exitCode = 2; return }
    out({ ok: false, error: 'failed', detail: String((err && err.stack) || err) })
    process.exitCode = 1
  })
}
