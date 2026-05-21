// Observe paired-channel (kind 29010) events to see what verbs are being
// published and when. Helps diagnose why ephemeral facades materialise.

import { WebSocket } from 'ws'

const RELAY = 'ws://localhost:7777'
const DURATION_MS = (Number(process.argv[2]) || 20) * 1000

const ws = new WebSocket(RELAY)
const start = Date.now()

ws.on('open', () => {
  console.log(`[paired-observer] connected, listening ${DURATION_MS / 1000}s for kind 29010`)
  ws.send(JSON.stringify(['REQ', 'observer', { kinds: [29010] }]))
})

const byVerbAndAge: Record<string, { count: number; freshest: number; oldest: number; samples: string[] }> = {}
const nowSec = () => Math.floor(Date.now() / 1000)

ws.on('message', (raw) => {
  try {
    const msg = JSON.parse(String(raw))
    if (!Array.isArray(msg)) return
    if (msg[0] !== 'EVENT') return
    const evt = msg[2] as { pubkey: string; created_at: number; tags?: string[][]; content?: string }
    const verb = (evt.tags ?? []).find(t => t[0] === 'verb')?.[1] ?? '?'
    const age = nowSec() - evt.created_at
    const pk = (evt.pubkey ?? '').slice(0, 8)
    const key = `${verb} (${pk})`
    let bucket = byVerbAndAge[key]
    if (!bucket) {
      bucket = { count: 0, freshest: 999999, oldest: 0, samples: [] }
      byVerbAndAge[key] = bucket
    }
    bucket.count++
    if (age < bucket.freshest) bucket.freshest = age
    if (age > bucket.oldest) bucket.oldest = age
    if (bucket.samples.length < 3) {
      try {
        const parsed = JSON.parse(evt.content ?? '{}')
        const summary = parsed?.share?.branchName ?? parsed?.branchName ?? parsed?.share?.name ?? Object.keys(parsed).slice(0, 3).join(',')
        bucket.samples.push(summary)
      } catch {
        bucket.samples.push('(non-JSON)')
      }
    }
  } catch {}
})

setTimeout(() => {
  console.log(`\n[paired-observer] === DONE after ${(Date.now() - start) / 1000}s ===\n`)
  const sorted = Object.entries(byVerbAndAge).sort((a, b) => b[1].count - a[1].count)
  for (const [key, info] of sorted) {
    console.log(`${key}  count=${info.count}  freshest=${info.freshest}s  oldest=${info.oldest}s  samples=[${info.samples.join(', ')}]`)
  }
  console.log(`\nTotal unique (verb, pubkey) pairs: ${sorted.length}`)
  ws.close()
  process.exit(0)
}, DURATION_MS)
