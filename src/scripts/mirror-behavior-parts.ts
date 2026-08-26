// 1:1 sync pass of the mirror paradigm: every implementation RESOURCE gets a
// tile. The first pass (mirror-behaviors.ts) built one tile per behaviour —
// but multi-file creations kept their internal dependencies hidden inside the
// code. This pass spreads those parts across child cells so the hive tree
// matches the source tree one-to-one.
//
//   behaviors/<collection>/<behavior>/<part>   ↔   one source file
//
// Rules:
//   - The behaviour tile itself stays 1:1 with its queen file (its note
//     already carries that source) — the queen is NOT duplicated as a part.
//   - `index.ts` barrels are packaging, not parts — excluded.
//   - Every part tile is marked with the declared `part` keyword (registered
//     in the TagRegistry here — never minted on the fly) and carries a note:
//     role + source path.
//   - history/ is deliberately NOT mirrored under /revise: it is a shared
//     subsystem (snapshot, restore, remove, host and two uncensused queens
//     also live on it), not internal parts of one behaviour.
//   - Merge mode + idempotent: parts already present as children are skipped,
//     and notes/marks are only written for parts newly created in this run.

import { createHash } from 'node:crypto'
import WebSocket from 'ws'

const BRIDGE_PORT = 2401
// Some commits (seen: the screensaver parent) legitimately take >60s in a
// background renderer — a short timeout misreads them as hangs.
const TIMEOUT = 180_000

let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }

function sendOnce(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `cli-${Date.now()}-${++counter}` }
    // Pin IPv4 loopback: a second listener on 2401 (0.0.0.0) swallows
    // `localhost` dials without answering — only 127.0.0.1 has the renderer.
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

// After a commit burst the renderer's optimize/idle pass can stall the op
// queue for minutes — a timeout does NOT mean the op failed (its response may
// simply be lost). Idempotent ops just retry; non-idempotent ops (note-add,
// decoration-add) verify whether they actually landed before retrying, so a
// lost response never becomes a duplicate write.
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

function norm(s: string): string {
  return s.trim().toLocaleLowerCase()
    .replace(/[._\s/]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '')
}

// ── part census ─────────────────────────────────────────────────────
// behavior path in the mirror → its parts. `file` is relative to the
// diamondcoreprocessor.com domain; `role` is the note text.

const E = 'hypercomb-essentials/src/diamondcoreprocessor.com'

type Part = [file: string, role: string]
interface Spread { collection: string; behavior: string; parts: Part[] }

const gameParts = (g: string, extra: Part[] = []): Part[] => [
  [`games/${g}/${g}.drone.ts`, 'lifecycle drone — senses the game decoration and mounts/unmounts play'],
  [`games/${g}/engine.ts`, 'simulation engine — the game state and rules, no rendering'],
  [`games/${g}/renderer.ts`, 'renderer — draws the engine state onto the overlay'],
  [`games/${g}/overlay.ts`, 'overlay — the play surface mounted over the tile area'],
  ...extra,
]

const SPREADS: Spread[] = [
  {
    collection: 'games', behavior: 'arkanoid',
    parts: gameParts('arkanoid', [
      ['games/arkanoid/levels.ts', 'level data — the shipped level set'],
      ['games/arkanoid/designer.ts', 'level designer — build and save custom levels'],
      ['games/arkanoid/selftest.ts', 'runtime self-test — sanity-checks the engine on demand'],
      ['games/arkanoid/theme.ts', 'theme contract — what a visual theme provides'],
      ['games/arkanoid/themes/register-themes.ts', 'theme registration — installs the shipped themes'],
      ['games/arkanoid/themes/neon-grid.ts', 'visual theme — neon grid'],
      ['games/arkanoid/themes/haunted-keep.ts', 'visual theme — haunted keep'],
      ['games/arkanoid/themes/space-madness.ts', 'visual theme — space madness'],
    ]),
  },
  {
    collection: 'games', behavior: 'bubble',
    parts: gameParts('bubble', [
      ['games/bubble/levels.ts', 'level data — the shipped level set'],
      ['games/bubble/designer.ts', 'level designer — build and save custom levels'],
      ['games/bubble/selftest.ts', 'runtime self-test — sanity-checks the engine on demand'],
    ]),
  },
  { collection: 'games', behavior: 'roper', parts: gameParts('roper') },
  {
    collection: 'games', behavior: 'solomon',
    parts: gameParts('solomon', [
      ['games/solomon/levels.ts', 'level data — the shipped level set'],
      ['games/solomon/designer.ts', 'level designer — build and save custom levels'],
      ['games/solomon/overworld.ts', 'overworld — the map between levels'],
      ['games/solomon/selftest.ts', 'runtime self-test — sanity-checks the engine on demand'],
    ]),
  },
  {
    collection: 'views', behavior: 'screensaver',
    parts: [
      ['presentation/screensaver/screensaver.drone.ts', 'lifecycle drone — idle detection, starts and stops the saver'],
      ['presentation/screensaver/styles.ts', 'style registry — the available saver styles'],
      ['presentation/screensaver/hexagon.style.ts', 'saver style — drifting hexagons'],
      ['presentation/screensaver/circle.style.ts', 'saver style — circles'],
      ['presentation/screensaver/thought.style.ts', 'saver style — thought bubbles'],
      ['presentation/screensaver/bubble-style.ts', 'saver style — bubbles'],
      ['presentation/screensaver/motions.ts', 'motion registry — the available motion patterns'],
      ['presentation/screensaver/motion.ts', 'motion contract — what a motion pattern provides'],
      ['presentation/screensaver/bounce.motion.ts', 'motion — bounce'],
      ['presentation/screensaver/shooting-stars.motion.ts', 'motion — shooting stars'],
    ],
  },
  {
    collection: 'views', behavior: 'tree',
    parts: [
      ['presentation/tiles/tree-view.drone.ts', 'view drone — renders the sideways tree (trunk left, one column per ring)'],
      ['presentation/tiles/tree-walk.ts', 'tree walk — resolves the branch into rows for the view'],
    ],
  },
  {
    collection: 'views', behavior: 'mobile',
    parts: [
      ['preferences/mobile-mode.service.ts', 'mode service — tracks and persists the mobile viewer state'],
      ['preferences/mobile-pheromones.ts', 'pheromone vocabulary — the declared mobile marks (mobile:friendly gate)'],
      ['preferences/mobile-roots.ts', 'mobile roots — which branches the mobile viewer offers'],
    ],
  },
  {
    collection: 'views', behavior: 'website',
    parts: [
      ['commands/website-instances.ts', 'instance registry — the live website views on screen'],
      ['commands/website-archive.queen.ts', 'archive sub-command — export the subtree as a standalone site'],
    ],
  },
  {
    collection: 'assistant', behavior: 'ask',
    parts: [
      ['assistant/host-ai.service.ts', 'host AI service — streams immediate-tier answers from the host'],
    ],
  },
  {
    collection: 'assistant', behavior: 'record',
    parts: [
      ['recording/recording.drone.ts', 'lifecycle drone — runs the recording session and compiles the hierarchy live'],
      ['recording/recording.types.ts', 'types — the recording session shapes'],
      ['recording/transcription.provider.ts', 'transcription provider — speech-to-text for the session'],
    ],
  },
  {
    collection: 'assistant', behavior: 'workflow',
    parts: [
      ['workflow/workflow-author.drone.ts', 'author drone — design a workflow out of tiles, one step per tile'],
      ['workflow/workflow-runner.drone.ts', 'runner drone — executes the designed workflow step by step'],
      ['workflow/workflow-view.drone.ts', 'view drone — renders the workflow over its tiles'],
      ['workflow/workflow-step.ts', 'step contract — what one workflow step is'],
      ['workflow/workflow-step-registry.ts', 'step registry — the available step kinds'],
      ['workflow/workflow-slot.ts', 'slot — where a workflow lives on its cell'],
      ['workflow/workflow-ask.ts', 'ask integration — steps that ask the assistant'],
    ],
  },
  {
    collection: 'swarm', behavior: 'meeting',
    parts: [
      ['meeting/meeting.drone.ts', 'lifecycle drone — starts or joins the meeting on the selected tile'],
      ['meeting/hive-meeting.drone.ts', 'hive meeting drone — the meeting embedded in the tile area'],
      ['meeting/meeting-peer.ts', 'peer — one participant connection'],
      ['meeting/meeting-signaling.ts', 'signaling — how peers find and connect to each other'],
      ['meeting/meeting-audio.ts', 'audio — capture and playback'],
      ['meeting/meeting-video.drone.ts', 'video drone — renders participant video'],
      ['meeting/meeting-controls.worker.ts', 'controls worker — mute, camera, leave'],
    ],
  },
  {
    collection: 'appearance', behavior: 'format',
    parts: [
      ['format/format-painter.drone.ts', 'painter drone — applies the copied formatting to target tiles'],
      ['format/format.provider.ts', 'format provider — captures the visual formatting of the source tile'],
    ],
  },
  {
    collection: 'structure', behavior: 'sequence',
    parts: [
      ['sequence/sequence.service.ts', 'service — tracks the drop-target order (IoC)'],
      ['sequence/sequence-cycle.drone.ts', 'cycle drone — advances the sequence as tiles land'],
      ['sequence/sequence-editor.bee.ts', 'editor bee — the on-screen sequence editor'],
      ['sequence/sequence-target.ts', 'target — which cell the sequence fills next'],
      ['sequence/arrangements.ts', 'arrangements — the orders a sequence can follow'],
    ],
  },
  {
    collection: 'structure', behavior: 'layout',
    parts: [
      ['move/layout.service.ts', 'layout service — saves, lists, and applies layout templates (IoC)'],
    ],
  },
  {
    collection: 'structure', behavior: 'move',
    parts: [
      ['move/move.drone.ts', 'lifecycle drone — move mode: pick up and drop tiles to reorder'],
      ['move/desktop-move.input.ts', 'desktop input — mouse drag handling for move mode'],
      ['move/touch-move.input.ts', 'touch input — touch drag handling for move mode'],
      ['move/layer-transfer.service.ts', 'transfer service — rewrites layers when a tile changes parent'],
    ],
  },
  {
    collection: 'structure', behavior: 'contact',
    parts: [
      ['contact/contact.drone.ts', 'lifecycle drone — senses the contact decoration and renders cards'],
      ['contact/contact-card.ts', 'contact card — the card layout for one person'],
      ['contact/contact.service.ts', 'service — contact data on the tile (IoC)'],
    ],
  },
]

const ROOT_KEY = norm('behaviors')
const PART_KEYWORD = 'part'
const PART_COLOR = '#7d8471'

async function main(): Promise<void> {
  // Preflight + read the existing mirror for merge mode.
  const inf = await send({ op: 'inflate', segments: [ROOT_KEY] }).catch((e: Error) => ({
    ok: false as const, error: e.message, id: '', data: undefined,
  }))
  if (!inf.ok) {
    console.error(`[parts] ABORT: cannot read "${ROOT_KEY}" (${inf.error}). Open the app with ?claudeBridge=1 and ensure the mirror is built.`)
    process.exit(1)
  }
  // Read a cell's children AT ITS OWN PATH, and refuse to answer unless the
  // two readers agree. A single deep `inflate` of the whole mirror UNDER-
  // REPORTS children on freshly-written subtrees — merging into a short read
  // and writing it back is what silently ate part cells before (audited
  // 2026-08-25: 81 parts down to 32). `layer-at` returns child SIGS, `inflate`
  // returns NAMES; when the counts disagree we cannot see the whole array, so
  // we never rewrite it.
  const readChildren = async (segments: string[]): Promise<string[] | null> => {
    const one = await sendRetry({ op: 'inflate', segments })
    const seal = one?.data?.builds?.[0]?.seal ?? one?.data
    const names = ((seal?.children ?? []) as any[]).map(k => String(k?.name ?? '')).filter(Boolean)
    const layer = await sendRetry({ op: 'layer-at', segments })
    const sigs = (layer?.data?.children ?? []) as unknown[]
    return sigs.length === names.length ? names : null
  }

  const totalParts = SPREADS.reduce((n, s) => n + s.parts.length, 0)
  console.log(`[parts] plan: ${SPREADS.length} behaviours, ${totalParts} part tiles (1:1 with source files)`)

  let okStruct = 0, failStruct = 0, skipped = 0
  const created: { segments: string[]; file: string; role: string; behavior: string }[] = []

  for (const s of SPREADS) {
    const behaviorSeg = [ROOT_KEY, norm(s.collection), norm(s.behavior)]
    const behaviorPath = behaviorSeg.join('/')
    const have = await readChildren(behaviorSeg)
    if (have === null) {
      console.log(`[parts] SKIP ${behaviorPath} — readers disagree on its children; refusing to rewrite a list we cannot fully see`)
      failStruct += s.parts.length
      continue
    }
    const wanted = s.parts.map(([file]) => norm(file.split('/').pop()!.replace(/\.ts$/, '')))
    const merged = [...have, ...wanted.filter(w => !have.includes(w))]

    // parent update: merge part names into the behaviour tile's children.
    // An interrupted run can leave names in the parent with no part cell
    // behind them, so presence here is NOT a skip signal — the cell update
    // below is create-or-update and always runs.
    process.stdout.write(`[parts] ${behaviorPath} ← ${merged.length} children ... `)
    const up = await sendRetry({ op: 'update', segments: behaviorSeg, layer: { name: norm(s.behavior), children: merged } })
    console.log(up.ok ? 'ok' : `FAIL: ${up.error}`)
    if (!up.ok) { failStruct += s.parts.length; continue }

    for (const [file, role] of s.parts) {
      const key = norm(file.split('/').pop()!.replace(/\.ts$/, ''))
      const seg = [...behaviorSeg, key]
      process.stdout.write(`[parts]   ${key} ... `)
      const res = await sendRetry({ op: 'update', segments: seg, layer: { name: key } })
      if (!res.ok) { failStruct++; console.log(`FAIL: ${res.error}`); continue }
      // note presence = this part was already fully written by a prior run
      const existing = await sendRetry({ op: 'note-list', segments: seg })
      if (existing.ok && Array.isArray(existing.data) && existing.data.length > 0) {
        skipped++; console.log('ok (already noted — skip note+mark)')
      } else {
        okStruct++; created.push({ segments: seg, file, role, behavior: s.behavior }); console.log('ok')
      }
    }
  }

  // Notes — only on parts created in THIS run (note-add is not idempotent).
  let okNotes = 0, failNotes = 0
  for (let i = 0; i < created.length; i++) {
    const c = created[i]
    const text = `${c.file.split('/').pop()} — ${c.role}\n\npart of /${c.behavior}\nsource: ${E}/${c.file}`
    process.stdout.write(`[note ${i + 1}/${created.length}] ${c.segments.join('/')} ... `)
    const res = await sendRetry(
      { op: 'note-add', segments: c.segments.slice(0, -1), cell: c.segments[c.segments.length - 1], text },
      async () => {
        const check = await send({ op: 'note-list', segments: c.segments })
        return check.ok && Array.isArray(check.data) && check.data.some((x: any) => x?.text === text)
      },
    )
    if (res.ok) { okNotes++; console.log('ok') } else { failNotes++; console.log(`FAIL: ${res.error}`) }
  }

  // Pheromones — `part` on every newly created part tile. NO replaceKind.
  let okMarks = 0, failMarks = 0
  for (let i = 0; i < created.length; i++) {
    const c = created[i]
    process.stdout.write(`[mark ${i + 1}/${created.length}] ${c.segments.join('/')} ← ${PART_KEYWORD} ... `)
    const res = await sendRetry(
      { op: 'decoration-add', segments: c.segments, kind: 'tag', appliesTo: [], payload: { name: PART_KEYWORD } },
      async () => {
        // Decorations on a layer are SIGNATURE references — landed means the
        // canonical decoration content's sig appears in the list.
        const partDecorationSig = createHash('sha256')
          .update(JSON.stringify({ kind: 'tag', appliesTo: [], payload: { name: PART_KEYWORD } }))
          .digest('hex')
        const check = await send({ op: 'layer-at', segments: c.segments })
        const decs = (check.data?.decorations ?? []) as string[]
        return check.ok && decs.includes(partDecorationSig)
      },
    )
    if (res.ok) { okMarks++; console.log('ok') } else { failMarks++; console.log(`FAIL: ${res.error}`) }
  }

  // Declare the vocabulary (registry-only /keyword, then neutralize replay).
  if (created.length) {
    process.stdout.write(`[parts] registering vocabulary: ${PART_KEYWORD}(${PART_COLOR}) ... `)
    const reg = await send({ op: 'submit', text: `/keyword [${PART_KEYWORD}(${PART_COLOR})]` })
    console.log(reg.ok ? 'ok' : `FAIL: ${reg.error}`)
    await send({ op: 'submit', text: '' })
  }

  console.log(`[parts] DONE — ${okStruct} part cells, ${okNotes} notes, ${okMarks} marks (${skipped} already present)`)
  const failed = failStruct + failNotes + failMarks
  if (failed > 0) console.warn(`[parts] ${failed} operations failed — review the log above.`)
}

main().catch(err => { console.error(err); process.exit(1) })
