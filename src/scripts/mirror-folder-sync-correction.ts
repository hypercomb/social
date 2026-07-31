// Corrective note pass on the `folder-sync` mirror.
//
// mirror-folder-sync.ts describes the behaviour as it stands NOW, but it may
// not overwrite what is already in the hive — a cell that carries a note is
// skipped. The first run wrote five cells; the behaviour has since grown a
// `verify` command, honest `verifiedAt` semantics, and a closure that follows
// chains and pool records. Those five cells therefore hold text that is no
// longer the whole truth.
//
// This pass stacks the DELTA onto each of them. It does not restate the
// original note and it does not rewrite it — notes stack, so the cell keeps
// both what was true and what changed, which is the record worth having.
//
// The sixth cell (folder-sync-closure-spec) is new and gets its full note from
// mirror-folder-sync.ts. Run that pass FIRST, then this one.

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

const S = 'hypercomb-essentials/src/diamondcoreprocessor.com/sharing'
const B = ['behaviors', 'structure', 'folder-sync']

const CORRECTIONS: { segments: string[]; text: string }[] = [
  {
    segments: B,
    text: [
      'UPDATE, stacked on the note above. Two things it does not say yet.',
      '',
      'A HARD COPY MEANS EVERYTHING, and the walk had been stopping short. A layer is a contract — it names content by signature — and so do many resources: a thread manifest names its message bodies, presets and manifests name what they configure. A walk that fetches the contracts and stops looks exactly like success while the bytes they name are still somewhere else. That is how a backup can report complete and restore to almost nothing. The closure now follows those chains to the end, and it also follows content named by pool records that no layer points at at all.',
      '',
      'COPYING AND PROVING ARE SEPARATE ACTS, and the note above blurred them. A pass copies what is new or changed and claims nothing about the rest. `/folder-sync verify` re-hashes every backed-up file against its recorded signature, and it is the only thing that may say the backup was checked.',
      '',
      `source: ${S}/folder-sync.queen.ts, ${S}/folder-sync.service.ts, ${S}/folder-sync.view.ts`,
    ].join('\n'),
  },
  {
    segments: [...B, 'folder-sync-queen'],
    text: [
      'UPDATE, stacked on the note above: the command grew a `verify`.',
      '',
      'It is the one that costs something — it re-reads and re-hashes every file the backup claims to hold. It exists precisely because a copy pass deliberately does not: content is named by its own hash, so a file present at the right name and size is already correct, and re-reading the whole mirror on every drain proved nothing. What the participant can no longer be told is that a copy pass verified anything. It did not. Verify does.',
      '',
      `source: ${S}/folder-sync.queen.ts`,
    ].join('\n'),
  },
  {
    segments: [...B, 'folder-sync-service'],
    text: [
      'UPDATE, stacked on the note above. The closure grew, and one timestamp learned to stop lying.',
      '',
      '`verifiedAt` is now a claim only a real re-hash may make. A copy pass moves `updatedAt` and leaves it alone. A timestamp that advances every time bytes are written says nothing about whether those bytes are still there and still right — and it was being advanced by the copy.',
      '',
      'The closure follows CHAINS, not one hop. Any fetched resource that parses as a JSON record is read again for further signatures until nothing new appears. Records ONLY: bytes that are not JSON are leaves, because scanning binary content for 64-hex runs would drag in whatever unrelated resource happened to be spelled inside an image. Cycles terminate on the visited set.',
      '',
      'Pool records are closure sources too. Threads, clipboard and manifests name content that no layer references; their record files were being copied verbatim while the bytes they pointed at stayed remote. Unfetchable content counts as missing, and a set with no resource-rooted entry point counts as missing entirely — an unaudited closure is not a clean pass.',
      '',
      'The deep walk is OPT-IN, and the backup is its only caller. Interactive adopt stays slim on purpose: eager resource pulls are what once dragged hundreds of files into a single adopt.',
      '',
      `source: ${S}/folder-sync.service.ts`,
    ].join('\n'),
  },
  {
    segments: [...B, 'folder-sync-view'],
    text: [
      'UPDATE, stacked on the note above: the surface reports more, because there is more that can go quietly wrong.',
      '',
      'Alongside files, bytes, closure roots and roots that produced no layer, it now shows items named by pool records, and — after a verify — how many files were re-hashed and how many did not match. The principle is unchanged: counts, not reassurance.',
      '',
      `source: ${S}/folder-sync.view.ts`,
    ].join('\n'),
  },
  {
    segments: [...B, 'folder-sync-spec'],
    text: [
      'UPDATE, stacked on the note above: four more invariants pinned.',
      '',
      'A second full pass over unchanged content-addressed files copies nothing. A root that produced no layer leaves the copy unmeasured and unimportable. Content named only by a pool record is still followed, and still blocks a portable claim when it cannot be fetched.',
      '',
      'And the one that is really a confession: a file tampered with in the mirror is INVISIBLE to a copy pass and is caught only by verify. That is exactly the trade the fast path makes. It is written down here so nobody has to rediscover it the hard way.',
      '',
      `source: ${S}/folder-sync.spec.ts`,
    ].join('\n'),
  },
]

async function main(): Promise<void> {
  let ok = 0, fail = 0
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
    if (res.ok) { ok++; console.log('ok') } else { fail++; console.log(`FAIL: ${res.error}`) }
  }
  console.log(`[folder-sync-correction] DONE — ${ok} corrective notes${fail ? `, ${fail} failed` : ''}`)
}

main().catch(err => { console.error(err); process.exit(1) })
