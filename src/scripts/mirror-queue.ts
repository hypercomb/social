// The MIRROR QUEUE — mirror work owed, written down so it cannot be forgotten.
//
// Mirroring is meant to happen in the same pass as the code, but the pass
// needs something the code change does not: a live renderer on the bridge.
// When the bridge is down, or the dev server is busy, or another session is
// mid-edit, the mirror gets deferred — and a deferral held only in a chat
// reply is a deferral that gets lost. So it goes here instead: the queue is a
// FILE IN THE REPO, writable with no bridge, no renderer, and no hive.
//
// The queue is the record; the hive is still the truth. An entry is a promise
// to run a mirror pass, not a substitute for having run it.
//
//   npm run mirror:queue -- list          what is owed
//   npm run mirror:queue -- add …         owe something
//   npm run mirror:queue:run              drain it (safe when idle)
//   npm run mirror:queue -- done <id>     mark one settled by hand
//
// `run` is IDLE-SAFE by design: with no broker or no renderer it reports and
// exits 0, so a scheduler that fires while the hive is closed is a quiet
// no-op rather than a failure. Entries run in order; a failure stops the
// drain and leaves that entry pending, because mirror passes commonly depend
// on the collection an earlier one creates.

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const QUEUE_PATH = join(HERE, 'mirror-queue.json')
/** Overridable so the idle-safe path can be exercised against a dead port. */
const BRIDGE_PORT = Number(process.env.HC_BRIDGE_PORT ?? 2401)
const PROBE_TIMEOUT = 15_000

interface Entry {
  id: string
  title: string
  /** Command that performs the pass. `null` = no script written yet; the
   *  entry still counts as owed, it just cannot be drained unattended. */
  run: string | null
  /** Why it is owed / what the mirror must cover. */
  note?: string
  /** The commit whose code this mirror belongs to, when known. */
  commit?: string
  created: string
  status: 'pending' | 'done'
  completed?: string
}
interface Queue { version: number; entries: Entry[] }

function load(): Queue {
  if (!existsSync(QUEUE_PATH)) return { version: 1, entries: [] }
  try {
    const q = JSON.parse(readFileSync(QUEUE_PATH, 'utf8')) as Queue
    return { version: q.version ?? 1, entries: Array.isArray(q.entries) ? q.entries : [] }
  } catch (e) {
    console.error(`[mirror-queue] ${QUEUE_PATH} is unreadable — refusing to overwrite it: ${(e as Error).message}`)
    process.exit(1)
  }
}

function save(q: Queue): void {
  writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2) + '\n')
}

const today = (): string => new Date().toISOString().slice(0, 10)

/** Is a renderer actually there? One probe, short timeout, never throws. */
function rendererReady(): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false
    const done = (v: boolean): void => { if (!settled) { settled = true; resolve(v) } }
    let ws: WebSocket
    try { ws = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORT}`) } catch { return done(false) }
    const timer = setTimeout(() => { try { ws.close() } catch { /* closing */ } done(false) }, PROBE_TIMEOUT)
    ws.on('open', () => ws.send(JSON.stringify({ op: 'layer-at', segments: [], id: `queue-probe-${Date.now()}` })))
    ws.on('message', raw => {
      clearTimeout(timer)
      let ok = false
      try { ok = !!JSON.parse(String(raw)).ok } catch { ok = false }
      try { ws.close() } catch { /* closing */ }
      done(ok)
    })
    ws.on('error', () => { clearTimeout(timer); done(false) })
  })
}

function list(q: Queue): void {
  const pending = q.entries.filter(e => e.status === 'pending')
  const done = q.entries.filter(e => e.status === 'done')
  if (!pending.length) console.log('[mirror-queue] nothing owed — the hive is level with the code')
  for (const e of pending) {
    console.log(`  ○ ${e.id} — ${e.title}`)
    if (e.commit) console.log(`      commit ${e.commit}  queued ${e.created}`)
    console.log(`      ${e.run ? `run: ${e.run}` : 'run: (no script yet — needs a mirror pass written)'}`)
    if (e.note) console.log(`      ${e.note}`)
  }
  if (done.length) console.log(`\n  ${done.length} settled: ${done.map(e => e.id).join(', ')}`)
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i > -1 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const q = load()
  const cmd = process.argv[2] ?? 'list'

  if (cmd === 'list') return list(q)

  if (cmd === 'add') {
    const id = arg('--id')
    const title = arg('--title')
    if (!id || !title) {
      console.error('usage: add --id <slug> --title "<what it owes>" [--run "<command>"] [--note "…"] [--commit <sha>]')
      process.exit(1)
    }
    if (q.entries.some(e => e.id === id && e.status === 'pending')) {
      console.log(`[mirror-queue] "${id}" is already owed — leaving it alone`)
      return
    }
    q.entries.push({
      id, title,
      run: arg('--run') ?? null,
      note: arg('--note'),
      commit: arg('--commit'),
      created: today(),
      status: 'pending',
    })
    save(q)
    console.log(`[mirror-queue] owed: ${id}`)
    return
  }

  if (cmd === 'done' || cmd === 'drop') {
    const id = process.argv[3]
    const e = q.entries.find(x => x.id === id && x.status === 'pending')
    if (!e) { console.error(`[mirror-queue] no pending entry "${id}"`); process.exit(1) }
    if (cmd === 'drop') q.entries = q.entries.filter(x => x !== e)
    else { e.status = 'done'; e.completed = today() }
    save(q)
    console.log(`[mirror-queue] ${cmd === 'drop' ? 'dropped' : 'settled'} ${id}`)
    return
  }

  if (cmd === 'run') {
    const only = arg('--id')
    const pending = q.entries.filter(e => e.status === 'pending' && (!only || e.id === only))
    if (!pending.length) { console.log('[mirror-queue] nothing owed'); return }

    // Idle-safe: no hive open is a normal outcome, not a failure.
    if (!(await rendererReady())) {
      console.log(`[mirror-queue] no renderer on the bridge — ${pending.length} still owed, nothing run.`)
      console.log('[mirror-queue] open the hive with ?claudeBridge=1 and run again.')
      return
    }

    let ran = 0, blocked = 0
    for (const e of pending) {
      if (!e.run) {
        blocked++
        console.log(`  ⊘ ${e.id} — no script yet, still owed`)
        continue
      }
      console.log(`\n  ▸ ${e.id} — ${e.title}`)
      try {
        execSync(e.run, { cwd: REPO, stdio: 'inherit' })
      } catch {
        // Stop the drain: later passes often need the collection an earlier
        // one creates, and a half-applied mirror is worse than a queued one.
        console.error(`\n[mirror-queue] "${e.id}" failed — left pending, stopping here.`)
        save(q)
        process.exitCode = 1
        return
      }
      e.status = 'done'
      e.completed = today()
      ran++
      save(q)
    }
    console.log(`\n[mirror-queue] ${ran} run, ${blocked} still owed (no script)`)
    if (ran > 0) console.log('[mirror-queue] NEXT: node scripts/behaviors-theme/sweep.cjs — mint cards for the new cells')
    return
  }

  console.error(`[mirror-queue] unknown command "${cmd}" — try list | add | run | done | drop`)
  process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
