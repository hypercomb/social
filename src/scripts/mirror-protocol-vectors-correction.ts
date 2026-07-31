// Corrective note pass on the `protocol` mirror.
//
// The first pass (mirror-protocol.ts) recorded two things that were true when
// it ran and are not true now:
//
//   1. It cited `hypercomb-net/conformance/` as the authoritative home of the
//      vectors and their generator, and noted that a second byte-identical
//      copy existed under `hypercomb-client/`. The duplicate has since been
//      resolved by deleting `hypercomb-net/` — `hypercomb-client/conformance/`
//      is now the only copy, and the documents have been updated to match.
//
//   2. It counted 71 vectors. The real number is 69. `markers` and
//      `beePayload` are single descriptive blocks, not arrays of cases, and
//      counting them as one vector each inflated the total.
//
// Notes STACK — nothing is rewritten and nothing is renamed. The cell keeps
// its own history, and the correction sits on top of what it corrects, which
// is the point: how a fact changed is worth as much as the fact.

import WebSocket from 'ws'

const BRIDGE_PORT = 2401
const TIMEOUT = 180_000

let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }

function sendOnce(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `cli-${Date.now()}-${++counter}` }
    const ws = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORT}`)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, TIMEOUT)
    ws.on('open', () => ws.send(JSON.stringify(msg)))
    ws.on('message', (raw: unknown) => {
      clearTimeout(timer)
      try { resolve(JSON.parse(String(raw)) as BridgeRes) } catch { reject(new Error('invalid response')) }
      ws.close()
    })
    ws.on('error', (err: Error) => { clearTimeout(timer); reject(new Error(`bridge connection failed: ${err.message}`)) })
  })
}

async function send(request: Record<string, unknown>): Promise<BridgeRes> {
  const res = await sendOnce(request)
  if (!res.ok && res.error === 'no renderer connected') {
    await new Promise(r => setTimeout(r, 4000))
    return sendOnce(request)
  }
  return res
}

async function sendRetry(
  request: Record<string, unknown>,
  landed?: () => Promise<boolean>,
): Promise<BridgeRes> {
  for (let attempt = 1; ; attempt++) {
    try { return await send(request) }
    catch (e) {
      if (landed && await landed().catch(() => false)) return { id: '', ok: true, data: 'landed after timeout' }
      if (attempt >= 3) throw e
      process.stdout.write(`(timeout — retry ${attempt}) `)
    }
  }
}

const CLIENT = 'hypercomb-client/conformance'

const CORRECTIONS: { segments: string[]; text: string }[] = [
  {
    segments: ['protocol', 'vectors'],
    text: [
      'CORRECTION, stacked on the note above. Two things in it were wrong.',
      '',
      'THE COUNT IS 69, NOT 71. The enumerated groups are 11 signatures, 21 lineage keys, 27 pool addresses and 10 layers. The marker and bee-payload entries are single descriptive blocks — a filename-width rule, a head rule, one pointer record, one insertion-order payload — not arrays of cases, and counting them as one vector each inflated the total. 69 is the number the design document already used, and it was right.',
      '',
      'THE DUPLICATE IS GONE. Two byte-identical copies of this file existed, one under hypercomb-net and one under hypercomb-client. The hypercomb-net tree has since been removed, so there is exactly one copy again and it is the one under hypercomb-client. The specification and the design document were updated to name it.',
      '',
      'Worth keeping the shape of the mistake: a protocol contract that lives in two places is not twice as safe, it is a fork with a delay on it. It was caught while it was still byte-identical, which is the only cheap moment to catch it.',
      '',
      `source: ${CLIENT}/vectors.json`,
    ].join('\n'),
  },
  {
    segments: ['protocol', 'vector-generator'],
    text: [
      'CORRECTION, stacked on the note above: the generator moved. It lived at hypercomb-net/conformance/generate-vectors.ts; that tree has been removed and the generator now lives beside the vectors it writes.',
      '',
      'Its own header comment and the generator path it stamps INTO the vectors still name the old location. Regenerating will rewrite that stamp — a metadata line, no vector values — and that is the moment to fix the header too.',
      '',
      `source: ${CLIENT}/generate-vectors.ts`,
    ].join('\n'),
  },
]

async function main(): Promise<void> {
  for (const c of CORRECTIONS) {
    const path = c.segments.join('/')
    process.stdout.write(`[note] ${path} ... `)
    const res = await sendRetry(
      { op: 'note-add', segments: c.segments.slice(0, -1), cell: c.segments[c.segments.length - 1], text: c.text },
      async () => {
        const check = await send({ op: 'note-list', segments: c.segments })
        return check.ok && Array.isArray(check.data) && check.data.some((x: any) => (x?.text ?? x?.note) === c.text)
      },
    )
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }
  console.log(`[protocol-correction] DONE — ${CORRECTIONS.length} corrective notes`)
}

main().catch(err => { console.error(err); process.exit(1) })
