// Build the "northern-exposure" hive — a Canadian civil-liberties watch,
// organized as a living taxonomy of the freedoms the channel covers.
//
// Sparse at the ROOT by design: two Charter beats (fundamental-freedoms,
// the-rule-of-law) leave room for more as the channel covers them. Episode
// substance is NEVER dumped at the top — it lives deep in the branch it
// belongs to. This first episode (the Justice Centre / City of Nanaimo
// recording & photography bans) lands three category levels down, under
// fundamental-freedoms → freedom-of-expression → freedom-to-record.
//
// Design rules (same as intel-build-revolucion.ts):
//   1. Cell names are pre-normalized (lowercase-hyphen) so bridge `segments`
//      (signed raw) == `children` keys (normalized) — one clean tree.
//   2. Readable descriptive text lives in NOTES (free text, not normalized).
//
// Sibling-safe: one atomic root `update` = existing top cells + 'northern-
// exposure'. Structure re-runs are idempotent; NOTES are not (note-add
// appends) — the script aborts if the build sentinel is already present.
//
// Usage:
//   npx tsx scripts/intel-build-northern-exposure.ts --dry-run   # preflight + plan, no writes
//   npx tsx scripts/intel-build-northern-exposure.ts             # build

import WebSocket from 'ws'

const BRIDGE_PORT = 2401
const TIMEOUT = 60_000
const DRY_RUN = process.argv.includes('--dry-run')

let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }

function sendOnce(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `cli-${Date.now()}-${++counter}` }
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

async function send(request: Record<string, unknown>): Promise<BridgeRes> {
  const res = await sendOnce(request)
  if (!res.ok && res.error === 'no renderer connected') {
    await new Promise(r => setTimeout(r, 4000))
    return sendOnce(request)
  }
  return res
}

// Mirror of @hypercomb/core normalizeCell so segments == children keys.
function norm(s: string): string {
  return s.trim().toLocaleLowerCase()
    .replace(/[._\s]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '')
}

interface HiveTile { name: string; notes?: string[]; children?: HiveTile[] }

const ROOT_LABEL = 'northern-exposure'
const ROOT_KEY = norm(ROOT_LABEL)
// Re-run sentinel: this deep cell only exists once THIS build has run.
const SENTINEL_PATH = ['the-rule-of-law']

const TREE: HiveTile = {
  name: ROOT_LABEL,
  notes: [
    'Northern Exposure — a Canadian civil-liberties watch. This hive organizes the freedoms the channel covers into a living taxonomy: each branch is a principle, each leaf a story from the field.',
    'The name is the mission — Northern (Canada) and Exposure (bringing what happens in council chambers and committee rooms into the open, where the public can see it).',
    'Sparse by design at the root. The two beats below — the fundamental freedoms, and the rule of law — leave room for more as the channel covers them. Episode content lives deep in the branch it belongs to; nothing is dumped at the top.',
  ],
  children: [
    {
      name: 'fundamental-freedoms',
      notes: [
        'Section 2 of the Canadian Charter of Rights and Freedoms — the freedoms every Canadian holds against the state: conscience and religion, thought and expression, peaceful assembly, and association.',
        'These are the freedoms most often eroded quietly, at the municipal level, where few are watching. That is the beat.',
      ],
      children: [
        {
          name: 'freedom-of-expression',
          notes: [
            'Charter s.2(b): freedom of thought, belief, opinion and expression — including freedom of the press and other media.',
            'The right to record and to publish is how citizens hold power to account. Take away the recording and you take away the accountability.',
          ],
          children: [
            {
              name: 'freedom-to-record',
              notes: [
                'The right to film, photograph and audio-record public officials doing public business — and to simply be in a public space with a camera. Increasingly under municipal attack; the Justice Centre describes these bylaws as "popping up like mushrooms" across city councils and school boards.',
                'A carve-out for genuinely sensitive matters already exists: councils can go "in camera" (closed session) to speak candidly on confidential or privacy-sensitive topics. That existing tool is exactly why a blanket recording ban is unnecessary.',
              ],
              children: [
                {
                  name: 'nanaimo-recording-bans',
                  notes: [
                    'Nanaimo, BC. On 7 April 2025 the City Council amended two bylaws — the Council Procedure Bylaw and the Respectful Spaces Bylaw — to restrict the public from recording meetings and from photographing or filming on municipal property.',
                    'The Justice Centre for Constitutional Freedoms (JCCF) sent the City a legal warning letter; president John Carpay called the measures "outrageous" and an affront to democratic rights protected by the Charter.',
                    'Two distinct angles, kept separate below: the ban on recording council meetings, and the ban on photography and video across public spaces including parks.',
                    'Postscript (May 2026): the City\'s director of legislative services walked part of it back — with no code-of-conduct signs posted in parks and trails, the recording prohibition does not apply there.',
                  ],
                  children: [
                    {
                      name: 'council-meeting-ban',
                      notes: [
                        'Angle one: a bylaw barring the public from independently video- or audio-recording a city council meeting.',
                        'Why it matters: a council meeting is the democratic process in the open. Imagine a Parliament that met in secret and merely announced the bills it had passed — without who voted, or why. The end result without the deliberation is not accountability.',
                        'Not isolated: the Justice Centre reports roughly half a dozen city councils and school boards attempting the same. An Ontario school board reversed course after a legal warning letter and agreed the public could record its meetings.',
                      ],
                    },
                    {
                      name: 'public-space-ban',
                      notes: [
                        'Angle two: a blanket ban on photography and video in all public spaces, including city parks — the same public property residents pay taxes to maintain.',
                        'The mayor\'s stated pretext was preventing predators from photographing children in parks. The aim is hard to argue with, but a total ban is the wrong tool: you could not photograph a bird in a tree, or your own family at a picnic table, without technically breaching it.',
                        'Collective punishment, by analogy: you do not ban everyone\'s cars because some drivers crash, or revoke every licence because some drive impaired. A few bad actors do not justify stripping a right from everyone.',
                      ],
                    },
                    {
                      name: 'penalties',
                      notes: [
                        'The teeth of the bylaws: violators could face fines, ejection from council meetings, or suspension from accessing city property for up to 18 months.',
                        'An 18-month ban from the public property you fund as a taxpayer — for taking a photograph.',
                      ],
                    },
                    {
                      name: 'democracy-in-the-open',
                      notes: [
                        'The transparency principle: sunlight on government is the default; secrecy is the narrow exception, invoked deliberately (in camera) for genuinely sensitive matters — never imposed as a blanket rule.',
                        'The slippery-slope warning: if enough councils and school boards normalize "we don\'t record anything" and the public accepts it, provinces cite the precedent, and the federal government follows. A precedent set low travels upward.',
                        'A contradiction worth flagging: Parliament is televised, yet cameras are barred from the parliamentary gallery — a tension the panel notes without resolving.',
                      ],
                    },
                    {
                      name: 'privacy-give-and-take',
                      notes: [
                        'The honest nuance: in public you surrender some privacy. A far-away park shot may catch strangers at their picnic tables; a mall photo may catch a passer-by. There is give and take, and a point past which a reasonable expectation of privacy fades.',
                        'But "some give and take" is a case for calibration, not for a total ban. The remedy for a genuine creep photographing a child already exists in law (see the-rule-of-law) — it does not require abolishing everyone\'s camera.',
                      ],
                    },
                  ],
                },
                {
                  name: 'ontario-school-board',
                  notes: [
                    'Ontario, recent: a public school board tried to bar recording of its meetings. After a Justice Centre legal warning letter the board reversed course and confirmed the public may record proceedings — a template for how these overreaches fold under legal pressure.',
                  ],
                },
              ],
            },
          ],
        },
        {
          name: 'freedom-of-peaceful-assembly',
          notes: [
            'Charter s.2(c): the freedom to gather and to protest peacefully in public — the counterpart to expression, the right to be heard together.',
          ],
          children: [
            {
              name: 'protest-near-houses-of-worship',
              notes: [
                'A parallel proposal discussed on the episode: a law to ban protests outside houses of worship, prompted by pro-Palestinian / anti-Israel marches passing near synagogues and through Jewish neighbourhoods.',
                'The fear is understandable; the blanket ban is still the wrong instrument. Peaceful protest on a public sidewalk is protected — and the genuinely harmful conduct is already illegal (see bad-behaviour-already-illegal). Enforce those laws rather than criminalizing proximity.',
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'the-rule-of-law',
      notes: [
        'How laws ought to be made and enforced. The recurring lesson across these stories: the problem is rarely a missing law — it is an unenforced one.',
      ],
      children: [
        {
          name: 'laws-we-already-have',
          notes: [
            'Bad behaviour is already illegal. Before layering on a new ban, ask what the existing criminal law already covers.',
          ],
          children: [
            {
              name: 'bad-behaviour-already-illegal',
              notes: [
                'Uttering threats — criminal. Pushing, shoving, physically obstructing someone on the sidewalk — criminal. Causing a disturbance or making excessive noise — an offence. Wilful public promotion of hatred against an identifiable group, and advocating genocide — criminal.',
                'The point: the harms cited to justify recording bans, park-photography bans and protest bans are, for the most part, already unlawful. The tools exist.',
              ],
            },
          ],
        },
        {
          name: 'legislating-in-haste',
          notes: [
            'The pattern of reaching for a new law when the real gap is enforcement.',
          ],
          children: [
            {
              name: 'enforce-before-you-legislate',
              notes: [
                'Passing new laws because existing ones are not being enforced does not solve the problem — it just adds unenforced laws. Enforce what is on the books first; identify the genuine gap; only then legislate to fill it.',
                'Cited example: Bill C-63 (the federal Online Harms proposal of the last Parliament) as an instance of sweeping new legislation where enforcement of existing law was the real question.',
                'Design for the long run, not the moment: a rule that fits today\'s headline can corrode a freedom for all time.',
              ],
            },
          ],
        },
      ],
    },
  ],
}

interface TileSpec { segments: string[]; name: string; children: string[]; notes: string[] }

function collectTiles(node: HiveTile, segments: string[], out: TileSpec[]): void {
  out.push({
    segments: segments.slice(),
    name: norm(node.name),
    children: (node.children ?? []).map(c => norm(c.name)),
    notes: node.notes ?? [],
  })
  for (const child of node.children ?? []) {
    collectTiles(child, [...segments, norm(child.name)], out)
  }
}

async function preflight(attempts: number): Promise<{ rootName: string; topNames: string[] } | undefined> {
  for (let i = 1; i <= attempts; i++) {
    const inf = await send({ op: 'inflate', segments: [] }).catch((e: Error) => ({
      ok: false as const, error: e.message, id: '', data: undefined,
    }))
    if (inf.ok) {
      const root = (inf.data ?? {}) as { name?: string; children?: { name?: string }[] }
      return {
        rootName: root.name ?? '/',
        topNames: (root.children ?? []).map(c => String(c.name ?? '')).filter(Boolean),
      }
    }
    console.log(`[northern-exposure] preflight ${i}/${attempts} — bridge not ready (${inf.error}), retrying...`)
    await new Promise(r => setTimeout(r, 3000))
  }
  return undefined
}

async function main(): Promise<void> {
  const pre = await preflight(5)
  if (!pre) {
    console.error('[northern-exposure] ABORT: no renderer. Open the app on localhost:4250 with ?claudeBridge=1, then re-run.')
    process.exit(1)
  }
  console.log(`[northern-exposure] live root "${pre.rootName}" holds: ${pre.topNames.join(', ') || '(none)'}`)

  // MERGE MODE: if 'northern-exposure' already exists, union my children into
  // its membership and touch nothing else. `update` sets only the slots in the
  // payload, so a children-only update preserves properties (tile imagery).
  const existingChildren = new Map<string, string[]>()
  if (pre.topNames.includes(ROOT_KEY)) {
    const ex = await send({ op: 'inflate', segments: [ROOT_KEY] })
    if (!ex.ok) {
      console.error(`[northern-exposure] ABORT: cannot inflate existing "${ROOT_KEY}": ${ex.error}`)
      process.exit(1)
    }
    const walkEx = (node: any, path: string[]): void => {
      const kids = Array.isArray(node?.children) ? node.children : []
      existingChildren.set(path.join('/'), kids.map((k: any) => String(k?.name ?? '')).filter(Boolean))
      for (const k of kids) if (k?.name) walkEx(k, [...path, String(k.name)])
    }
    walkEx(ex.data, [ROOT_KEY])
    const sentinelParent = [ROOT_KEY, ...SENTINEL_PATH.slice(0, -1)].join('/')
    if ((existingChildren.get(sentinelParent) ?? []).includes(SENTINEL_PATH[SENTINEL_PATH.length - 1])) {
      console.warn(`[northern-exposure] ABORT: already built (sentinel "${SENTINEL_PATH.join('/')}" present) — re-run would duplicate notes.`)
      process.exit(1)
    }
    console.log(`[northern-exposure] merging into existing tree: ${(existingChildren.get(ROOT_KEY) ?? []).join(', ')}`)
  }

  const tiles: TileSpec[] = []
  collectTiles(TREE, [ROOT_KEY], tiles)
  const totalNotes = tiles.reduce((n, t) => n + t.notes.length, 0)
  console.log(`[northern-exposure] plan: ${tiles.length} cells + ${totalNotes} notes under "${ROOT_KEY}"`)

  if (DRY_RUN) {
    console.log('\n[northern-exposure] --dry-run — tree preview (no writes):\n')
    for (const t of tiles) {
      const depth = t.segments.length - 1
      const indent = '  '.repeat(depth)
      const leaf = t.segments[t.segments.length - 1]
      console.log(`${indent}${leaf}${t.children.length ? `  ›${t.children.length}` : ''}${t.notes.length ? `  [${t.notes.length} note${t.notes.length > 1 ? 's' : ''}]` : ''}`)
    }
    console.log('\n[northern-exposure] dry-run complete — re-run without --dry-run to build.')
    return
  }

  if (!pre.topNames.includes(ROOT_KEY)) {
    // Fresh case — atomic root layer: existing top cells + new sibling.
    const nextRoot = [...pre.topNames, ROOT_KEY]
    process.stdout.write(`[northern-exposure] root layer <- [${nextRoot.join(', ')}] ... `)
    const rootRes = await send({ op: 'update', segments: [], layer: { name: pre.rootName, children: nextRoot } })
    console.log(rootRes.ok ? 'ok' : `FAIL: ${rootRes.error}`)
    if (!rootRes.ok) process.exit(1)
  }

  // Phase 1: structure (normalized names; segments == children keys).
  // Membership = existing children first (tile order stays still), then mine.
  let okStruct = 0, failStruct = 0
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]
    const have = existingChildren.get(t.segments.join('/')) ?? []
    const merged = [...have, ...t.children.filter(c => !have.includes(c))]
    process.stdout.write(`[struct ${i + 1}/${tiles.length}] ${t.segments.join('/')} <- ${merged.length} children${have.length ? ` (${have.length} kept)` : ''} ... `)
    const layer: { name: string; children?: string[] } = { name: t.name }
    if (merged.length) layer.children = merged
    const res = await send({ op: 'update', segments: t.segments, layer })
    if (res.ok) { okStruct++; console.log('ok') }
    else { failStruct++; console.log(`FAIL: ${res.error}`) }
  }
  console.log(`[northern-exposure] phase 1: ${okStruct} ok, ${failStruct} failed`)

  // Phase 2: notes (free text) on their owning cell.
  let okNotes = 0, failNotes = 0, noteIdx = 0
  for (const t of tiles) {
    if (!t.notes.length) continue
    const parentSegments = t.segments.slice(0, -1)
    const cellLabel = t.segments[t.segments.length - 1]
    for (const text of t.notes) {
      noteIdx++
      process.stdout.write(`[note ${noteIdx}/${totalNotes}] ${t.segments.join('/')} ... `)
      const res = await send({ op: 'note-add', segments: parentSegments, cell: cellLabel, text })
      if (res.ok) { okNotes++; console.log('ok') }
      else { failNotes++; console.log(`FAIL: ${res.error}`) }
    }
  }
  console.log(`[northern-exposure] phase 2: ${okNotes} ok, ${failNotes} failed`)
  console.log(`[northern-exposure] DONE — ${okStruct} cells + ${okNotes} notes under "${ROOT_KEY}"`)
}

main().catch(err => { console.error(err); process.exit(1) })
