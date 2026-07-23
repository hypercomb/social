// Meaning-loop PHASE 1 (documentation/meaning-loop.md) — first live records:
//
//   1. Deposit the `jwize.com:website` intent pheromone (tag decoration,
//      appliesTo:[] dedup form) on every VERIFIED site root — a cell whose
//      decorations already hold a visual:website:page artifact.
//   2. Mint the first ai:request (three.js my-lounge generation) on
//      revolucion/journal/my-lounge, status 'asked', with its ask-gate
//      dashboard question (kind:'qa' optimization — same shape as fb.cjs ask).
//   3. Write the first ai:meta on revolucion/journal — references the
//      condensed conversation transcript (content-addressed) + the request.
//
// Idempotent: an existing ai:request decoration on my-lounge is the sentinel —
// re-run aborts before minting a duplicate question. decoration-add itself is
// sig-idempotent; tags dedupe by content.

import WebSocket from 'ws'

const BRIDGE_PORT = 2401
const TIMEOUT = 60_000
let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }

function send(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `ml1-${Date.now()}-${++counter}` }
    const ws = new WebSocket(`ws://localhost:${BRIDGE_PORT}`)
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

async function putText(text: string): Promise<string> {
  const r = await send({ op: 'put-resource', text })
  if (!r.ok) throw new Error(`put-resource failed: ${r.error}`)
  return String(r.data.sig)
}

// Resolve every decoration record on a cell: [{sig, record}]
async function decorationsAt(segments: string[]): Promise<{ sig: string; record: any }[]> {
  const at = await send({ op: 'layer-at', segments })
  if (!at.ok) return []
  const sigs: string[] = Array.isArray(at.data?.decorations) ? at.data.decorations.filter((s: unknown) => /^[0-9a-f]{64}$/.test(String(s))) : []
  const out: { sig: string; record: any }[] = []
  for (const sig of sigs) {
    const res = await send({ op: 'get-resource', sig })
    if (!res.ok || res.data?.encoding !== 'text') continue
    try { out.push({ sig, record: JSON.parse(res.data.text) }) } catch { /* non-JSON resource */ }
  }
  return out
}

const JOURNAL = ['revolucion', 'journal']
const LOUNGE = ['revolucion', 'journal', 'my-lounge']
const WEBSITE_PHEROMONE = 'jwize.com:website'
const SITE_ROOT_CANDIDATES: string[][] = [
  ['revolucion'], ['northern-exposure'], ['howard'], ['dolphin'],
  ['dolphin', 'site'], ['humanity-centres'], ['susan'],
]

const TRANSCRIPT = `Condensed transcript — Jaime, 2026-07-20 (meaning-loop origin conversation).

Three.js and Pixi.js run side by side: three.js loads SECOND and PASSIVELY while tiles show with Pixi — it must never interfere with tile rendering. Three.js powers the cigar lounge: a 3D room, or any 3D space (a beach works too), decorated to show the experience visually.

Journal entries are posts. A person can leave a code we give them, so we know it is a consistent person and they get the SAME journal address. Incentive loop: post journal entries → earn trophies and nice furniture → upgrade → the lounge becomes incredible the more you play.

The habit: use tiles, notes, hierarchy, and pheromone tags to create meaning within the hive. Don't look only in the assistant's own memory — load the pertinent branches. Any signature can be handed as context to the meta file, which lives in the history; next build reads the latest meta and all its history for accurate context. Build up as a plan, read down as a target, continue the cycle. Workflow: transcript from a conversation/meeting → interpret into tiles → when ready, a generation pass using whichever AI makes the most sense. A behavior attaches language-model requests to nodes; processing a node with a request means HANDING OFF — start a new session on that node and produce results there. Wire this into the three-hour routine; make it robust.

Website behavior becomes passive: choosing website (namespace jwize.com:website) deposits pheromones; child branches become logical website items unless turned off. Installing the behavior turns nothing on. Only an AI pass discovers the pheromone — "this is supposed to be a website" — and ASKS before building. A pheromone may simply not need creation yet. The passive library is available; features just turn pheromones on. The pheromone becomes the discovery for AI work.`

async function main(): Promise<void> {
  // Preflight: right hive, right renderer.
  const at = await send({ op: 'layer-at', segments: JOURNAL })
  if (!at.ok) {
    console.error(`[ml1] ABORT: cannot read /${JOURNAL.join('/')} (${at.error}) — wrong renderer or bridge down.`)
    process.exit(1)
  }

  // Sentinel: existing ai:request on my-lounge = phase already applied.
  const loungeDecos = await decorationsAt(LOUNGE)
  if (loungeDecos.some(d => d.record?.kind === 'ai:request')) {
    console.warn('[ml1] ABORT: my-lounge already carries an ai:request — phase 1 applied; re-run would duplicate the ask.')
    process.exit(1)
  }

  // ── 1. Pheromones on verified site roots ─────────────────────────────
  const stamped: string[] = []
  for (const path of SITE_ROOT_CANDIDATES) {
    const decos = await decorationsAt(path)
    if (!decos.length) continue
    const isSiteRoot = decos.some(d => d.record?.kind === 'visual:website:page')
    const hasPheromone = decos.some(d => d.record?.kind === 'tag' && d.record?.payload?.name === WEBSITE_PHEROMONE)
    if (!isSiteRoot || hasPheromone) {
      console.log(`[ml1] ${path.join('/')}: siteRoot=${isSiteRoot} pheromone=${hasPheromone} — ${isSiteRoot ? 'already stamped' : 'skip'}`)
      continue
    }
    const r = await send({ op: 'decoration-add', segments: path, kind: 'tag', appliesTo: [], payload: { name: WEBSITE_PHEROMONE } })
    console.log(`[ml1] pheromone ${WEBSITE_PHEROMONE} → /${path.join('/')} ... ${r.ok ? 'ok' : `FAIL: ${r.error}`}`)
    if (r.ok) stamped.push(path.join('/'))
  }

  // ── 2. Transcript → sig ──────────────────────────────────────────────
  const transcriptSig = await putText(TRANSCRIPT)
  console.log(`[ml1] transcript sig ${transcriptSig.slice(0, 12)}…`)

  // ── 3. Ask-gate question (same record shape as fb.cjs ask) ───────────
  const qId = `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const question = 'my-lounge carries an ai:request: build the three.js 3D lounge room (passive load AFTER the Pixi tile canvas; spaces classic-lounge + beach; renders earned furniture/trophies/upgrades). Approve building it?'
  const qa = await send({ op: 'optimization-add', text: JSON.stringify({ kind: 'qa', appliesTo: LOUNGE, payload: { qId, question } }) })
  if (!qa.ok) { console.error(`[ml1] ABORT: ask-gate question failed: ${qa.error}`); process.exit(1) }
  console.log(`[ml1] ask-gate question minted ${qId}`)

  // ── 4. ai:request on my-lounge ───────────────────────────────────────
  const requestSig = await putText(JSON.stringify({
    v: 1,
    target: LOUNGE.join('/'),
    request: 'Build the three.js 3D lounge room: loads second and passively after the Pixi tile canvas (never interferes with tile rendering); spaces classic-lounge and beach; renders earned furniture, trophies and upgrades from journal/rewards; decorate mode for placement; showcase view for sharing.',
    contextSigs: [transcriptSig],
    model: 'claude',
    status: 'asked',
    askedQId: qId,
    resultSigs: [],
  }, null, 2))
  const reqDeco = await send({ op: 'decoration-add', segments: LOUNGE, kind: 'ai:request', appliesTo: LOUNGE, payload: { requestSig }, replaceKind: true })
  console.log(`[ml1] ai:request → /${LOUNGE.join('/')} ... ${reqDeco.ok ? 'ok' : `FAIL: ${reqDeco.error}`}`)
  if (!reqDeco.ok) process.exit(1)

  // ── 5. ai:meta on the journal (written LAST — references everything) ─
  const journalDecos = await decorationsAt(JOURNAL)
  const priorMeta = journalDecos.find(d => d.record?.kind === 'ai:meta')
  const prevMetaSig = priorMeta ? String(priorMeta.record?.payload?.metaSig ?? '') || null : null
  const metaSig = await putText(JSON.stringify({
    v: 1,
    target: JOURNAL.join('/'),
    at: Date.now(),
    pass: 'lounge gamification tiles + meaning-loop phase 1',
    did: [
      'Built 13 cells + 15 notes under journal: journal-code; rewards{milestones,trophies,furniture,upgrades}; my-lounge{spaces{classic-lounge,beach},decorate,trophy-case,showcase}.',
      'Deposited jwize.com:website pheromones on verified site roots; minted the my-lounge ai:request (three.js lounge) with its ask-gate dashboard question.',
    ],
    contextSigs: [transcriptSig, requestSig],
    pending: [
      'Themed tile imagery for the 13 new journal cells (deterministic defaults currently).',
      'Journal website page update to reflect journal-code / rewards / my-lounge.',
      'three.js lounge generation — gated on the ask-gate answer (see ai:request on my-lounge).',
      'journal-code mechanics (code issuance → consistent journal address).',
      'Features window → pheromone-deposit toggles (meaning-loop phase 2, essentials code).',
    ],
    prevMetaSig,
  }, null, 2))
  const metaDeco = await send({ op: 'decoration-add', segments: JOURNAL, kind: 'ai:meta', appliesTo: JOURNAL, payload: { metaSig }, replaceKind: true })
  console.log(`[ml1] ai:meta → /${JOURNAL.join('/')} (prev=${prevMetaSig ? prevMetaSig.slice(0, 12) + '…' : 'null'}) ... ${metaDeco.ok ? 'ok' : `FAIL: ${metaDeco.error}`}`)
  if (!metaDeco.ok) process.exit(1)

  // ── 6. Read-backs (never eyeballs) ───────────────────────────────────
  const jNow = await decorationsAt(JOURNAL)
  const meta = jNow.find(d => d.record?.kind === 'ai:meta')
  const metaBody = meta ? await send({ op: 'get-resource', sig: String(meta.record.payload.metaSig) }) : { ok: false as const, data: undefined }
  const metaParsed = metaBody.ok ? JSON.parse(metaBody.data.text) : null
  const lNow = await decorationsAt(LOUNGE)
  const reqNow = lNow.find(d => d.record?.kind === 'ai:request')
  const reqBody = reqNow ? await send({ op: 'get-resource', sig: String(reqNow.record.payload.requestSig) }) : { ok: false as const, data: undefined }
  const reqParsed = reqBody.ok ? JSON.parse(reqBody.data.text) : null

  console.log('[verify] journal ai:meta:', metaParsed ? `ok (pass="${metaParsed.pass}", ${metaParsed.pending.length} pending, prev=${metaParsed.prevMetaSig})` : 'MISSING')
  console.log('[verify] my-lounge ai:request:', reqParsed ? `ok (status=${reqParsed.status}, qId=${reqParsed.askedQId})` : 'MISSING')
  console.log('[verify] transcript resolves:', (await send({ op: 'get-resource', sig: transcriptSig })).ok)
  console.log(`[ml1] DONE — pheromones on [${stamped.join(', ') || 'none new'}], meta ${metaSig.slice(0, 12)}…, request ${requestSig.slice(0, 12)}…, question ${qId}`)
}

main().catch(err => { console.error(err); process.exit(1) })
