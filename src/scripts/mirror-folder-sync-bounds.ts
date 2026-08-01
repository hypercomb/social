// Addendum pass for /folder-sync — the safety bounds on deep resource descent.
//
// The behaviour is already mirrored, and `mirror-folder-sync.ts` deliberately
// never overwrites a cell that carries a note. That is the right default — a
// mirror pass may add to the hive, never reshape it — but it means a note that
// has fallen behind cannot be corrected by re-running it.
//
// So this pass STACKS. It appends one addendum note per cell and touches
// nothing else: no children, no layers, no marks. It is idempotent by marker:
// a cell whose notes already mention the addendum is skipped, so running it
// twice cannot double up.
//
// What is missing from the hive as of this pass: deep descent follows
// signatures found INSIDE fetched content, that content can be peer-authored,
// and the walk is therefore bounded. The bounds and their reporting are the
// security story, and nothing in the hive records them yet.
//
//   --dry-run   read everything, send nothing, print every intended write

import WebSocket from 'ws'

const BRIDGE_PORT = 2401
const TIMEOUT = 180_000
const DRY_RUN = process.argv.includes('--dry-run')
const BEHAVIOR_SEG = ['behaviors', 'structure', 'folder-sync']
const S = 'hypercomb-essentials/src/diamondcoreprocessor.com/sharing'

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
  if (DRY_RUN && request['op'] === 'note-add') {
    console.log(`  [dry-run] note-add ${String(request['cell'])} — ${String(request['text'] ?? '').split('\n')[0].slice(0, 70)}…`)
    return { id: 'dry-run', ok: true, data: 'dry-run' }
  }
  const res = await sendOnce(request)
  if (!res.ok && res.error === 'no renderer connected') {
    await new Promise(r => setTimeout(r, 4000))
    return sendOnce(request)
  }
  return res
}

/** Existing note text for a cell, or null when it cannot be read twice alike.
 *  Same reasoning as the structural guard: acting on a read we do not trust is
 *  how an "additive" pass produces duplicates. */
async function stableNotes(cell: string): Promise<string | null> {
  const read = async (): Promise<string | null> => {
    const res = await send({ op: 'note-list', segments: [...BEHAVIOR_SEG, cell] }).catch(() => null)
    if (!res?.ok || !Array.isArray(res.data)) return null
    return res.data.map((n: any) => String(n?.text ?? n?.note ?? '')).join('\n')
  }
  const first = await read()
  const second = await read()
  if (first === null || second === null || first !== second) {
    console.error(`[guard] "${cell}" notes did not read the same way twice — skipping`)
    return null
  }
  return first
}

// The idempotency marker is DERIVED from the text, never written by hand.
// A hand-picked marker is a second copy of the truth that can drift from the
// first: `safety bound` read as present in one addendum and absent in the
// other, so the "already covered" check passed for one cell and silently
// duplicated the other. The opening line cannot drift from the note it opens.
const markerOf = (text: string): string => text.split('\n')[0].trim()

const ADDENDA: { cell: string; text: string }[] = [
  {
    cell: 'folder-sync-service',
    text: [
      'UPDATE, stacked on the note above: the deep walk is BOUNDED, and a bound that is hit is reported.',
      '',
      'Descent follows signatures found inside fetched content, and that content can be peer-authored. Bytes are still signature-verified on arrival, so this was never about being handed the wrong content — it is about being made to do unbounded work. A hostile or simply corrupt record naming a huge set of signatures would otherwise turn one backup into a fetch storm: disk here, and an amplified request fan-out at whatever hosts those signatures resolve against, with this client as the amplifier.',
      '',
      'So the walk carries limits that cannot be derived from the content it is reading: a ceiling on how many resources one descent may pull, a maximum depth, and a size above which a record is not parsed at all — a huge hostile blob should cost a length check, not a full parse and a signature sweep over the result. References are also de-duplicated as they are QUEUED rather than as they are reached, so the same signature named a thousand times takes one slot instead of a thousand.',
      '',
      'The part that matters for trust: hitting a bound is never silently obeyed. The count of dropped references travels back out of the walk, is added to the missing total, and appears in the inventory. A bounded walk can therefore never be sealed as a portable hard copy — which is the only honest outcome, because a dropped reference is content the backup does not hold.',
      '',
      `source: ${S}/content-broker.drone.ts, ${S}/folder-sync.service.ts`,
    ].join('\n'),
  },
  {
    cell: 'folder-sync-closure-spec',
    text: [
      'UPDATE, stacked on the note above: two more specs, both about being made to do too much work rather than being handed bad content.',
      '',
      'A record naming a large set of signatures is followed only up to the safety bound, and what was dropped is REPORTED. Silently obeying the bound would be the dangerous outcome: the copy would be missing content and would still describe itself as portable.',
      '',
      'An oversized record is not parsed at all. The guard is a length check, so a huge blob cannot buy a full parse plus a signature sweep over whatever it decodes to.',
      '',
      'Both exist because the walk reads signatures out of content that may have been authored by someone else. Integrity was never the exposure here — every fetched byte is checked against the signature it was asked for — so these specs pin the other half: how much work an attacker can make this client do on their behalf.',
      '',
      `source: ${S}/resource-closure.spec.ts`,
    ].join('\n'),
  },
]

async function main(): Promise<void> {
  console.log(DRY_RUN
    ? '[bounds] DRY RUN — reads only; every note below is printed, not sent.'
    : '[bounds] LIVE — this appends notes to the hive. Re-run with --dry-run to preview.')

  let added = 0, skipped = 0, failed = 0
  for (const addendum of ADDENDA) {
    const existing = await stableNotes(addendum.cell)
    if (existing === null) { failed++; continue }
    if (existing.length === 0) {
      // No note at all means the base mirror has not run for this cell. Adding
      // an "UPDATE, stacked on the note above" with nothing above it would read
      // as nonsense — run mirror-folder-sync.ts first.
      console.log(`[bounds] ${addendum.cell} has NO base note — run mirror-folder-sync.ts first; skipping`)
      skipped++
      continue
    }
    const marker = markerOf(addendum.text)
    if (existing.includes(marker)) {
      console.log(`[bounds] ${addendum.cell} already carries this addendum — skipping`)
      skipped++
      continue
    }
    process.stdout.write(`[bounds] ${addendum.cell} ← addendum ... `)
    const res = await send({
      op: 'note-add',
      segments: BEHAVIOR_SEG,
      cell: addendum.cell,
      text: addendum.text,
    }).catch(e => ({ id: '', ok: false, error: String(e) } as BridgeRes))
    if (res.ok) { added++; console.log('ok') } else { failed++; console.log(`FAIL: ${res.error}`) }
  }

  console.log(`[bounds] DONE — ${added} added, ${skipped} skipped, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
