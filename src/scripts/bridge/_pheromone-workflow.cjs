// Build the "Pheromone workflow" in the hive, through the bridge.
//
// A workflow IS a tile whose child tiles are its steps (workflow-step.ts), so
// this creates one parent cell, one child per step, gives each child a
// `visual:workflow:step` decoration pointing at its step resource, declares the
// parent a workflow via the `workflow` slot, and mirrors the whole thing with
// notes — tiles + pheromones + notes in the same pass (CLAUDE.md mirror rule).
//
//   node _pheromone-workflow.cjs

const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'
const ROOT = 'pheromone-workflow'
const STAMP = Number(process.env.PW_STAMP || 1785000000000)

let counter = 0
const nextId = () => `pw-${STAMP}-${++counter}`

function send(req) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE)
    const t = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, 20000)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id: nextId() })))
    ws.on('message', raw => {
      clearTimeout(t)
      try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) }
      ws.close()
    })
    ws.on('error', e => { clearTimeout(t); reject(e) })
  })
}

async function ask(req, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await send(req)
      if (r.ok || r.error !== 'no renderer connected') return r
    } catch (e) { if (i === attempts - 1) throw e }
    await new Promise(r => setTimeout(r, 1500))
  }
  return { ok: false, error: 'renderer never connected' }
}

const putResource = async (text) => {
  const r = await ask({ op: 'put-resource', text })
  if (!r.ok) throw new Error('put-resource failed: ' + r.error)
  return (r.data && (r.data.sig || r.data.signature)) || r.sig
}

// ── the workflow ────────────────────────────────────────────────────────────
//
// `note` steps carry prose and leave a trail as the run passes through them;
// `command` steps run a real slash behaviour that exists today.

const STEPS = [
  {
    cell: '1-drop-the-reference',
    step: { v: 1, kind: 'command', command: 'reference', args: '{scope}' },
    note: 'A reference is a live pointer to another place — not a copy. Drop one with '
      + '/reference <path>, or drag a row out of the Organizer onto empty hive. '
      + 'The tile you get IS the reference; everything after this happens ON it.',
  },
  {
    cell: '2-stand-on-the-reference',
    step: { v: 1, kind: 'note', text: 'Walk onto the reference tile itself.' },
    note: 'Marks belong to the thing you are standing on. This is the whole reason there '
      + 'is no mark palette in the Organizer any more: you do not describe a reference '
      + 'from a list somewhere else, you go to it and mark it.',
  },
  {
    cell: '3-open-the-pheromones',
    step: { v: 1, kind: 'command', command: 'tags' },
    note: 'The ONE pheromone surface. Every other window that grew its own copy of this '
      + 'palette has been removed — same gesture, one place.',
  },
  {
    cell: '4-paint-what-it-is-for',
    step: { v: 1, kind: 'note', text: 'Paint the marks that say what this reference is FOR.' },
    note: 'Marks are chosen from the declared vocabulary, never minted on the fly — a '
      + 'typo matches nothing and reads as "this is empty". Two references to the SAME '
      + 'place with different marks are two genuinely different references: People(family) '
      + 'and People(work) are not one pointer that changed its mind.',
  },
  {
    cell: '5-enter-the-reference',
    step: { v: 1, kind: 'note', text: 'Open the reference to portal through it.' },
    note: 'Portalling ARMS the reference marks. reference-requirement.drone broadcasts '
      + 'them as `tags:required` — deliberately NOT `tags:filter`, because your own lens '
      + 'is sticky and considered, and entering through a reference must never overwrite it.',
  },
  {
    cell: '6-the-next-page-arrives-filtered',
    step: { v: 1, kind: 'note', text: 'The target page shows only what satisfies the marks.' },
    note: 'show-cell ANDs the two: a cell must satisfy YOUR filter (if any) AND the '
      + "reference's requirement (if any). The requirement is not listed as chips and "
      + 'cannot be switched off — the lock is structural, not a rule to remember. '
      + 'Switching it off would not be relaxing a filter, it would be editing the reference.',
  },
  {
    cell: '7-walk-out-to-disarm',
    step: { v: 1, kind: 'note', text: 'Step outside the target subtree; the requirement lifts.' },
    note: 'Disarmed the moment you stand outside that subtree, restoring exactly the lens '
      + 'you had — no save/restore bookkeeping to get wrong, because the standing location '
      + 'IS the state. A reference with no marks arms nothing.',
  },
  {
    cell: '8-the-open-piece',
    step: { v: 1, kind: 'note', text: 'Painting does not yet write the requirement. One wire missing.' },
    note: 'HONEST STATUS. Steps 5-7 are BUILT and working today: the marks live in the '
      + "reference decoration's `requiredMarks` payload, set by /requires <cell> = <marks>. "
      + 'What is NOT built is step 4 writing there: the pheromone painter writes ordinary '
      + '`tag` decorations, which is a different store. Wiring paint -> requiredMarks is the '
      + 'remaining work, and it has one consequence worth deciding on purpose: on a reference, '
      + '"what this is about" and "what this shows" collapse into one set of marks.',
  },
]

const WORKFLOW_NOTE =
  'How a pheromone on a reference filters the page it opens. A reference points at a place; '
  + 'the marks you paint ON the reference are what it DEMANDS of that place. Marked "family", '
  + 'a reference to People opens People-but-only-family — without moving, copying or changing '
  + 'People itself. The same tile referenced twice with different marks is two different views '
  + 'of one place. Steps are the child tiles below, in order.'

async function main() {
  const log = (...a) => console.log(...a)

  // 1. the workflow cell
  const addRoot = await ask({ op: 'add', segments: [], cells: [ROOT] })
  log('add root      ', addRoot.ok ? 'ok' : '(' + (addRoot.error || 'exists') + ')')

  // 2. the step cells, in order — the parent's children order IS the step order
  const addSteps = await ask({ op: 'add', segments: [ROOT], cells: STEPS.map(s => s.cell) })
  log('add steps     ', addSteps.ok ? 'ok' : '(' + (addSteps.error || 'exists') + ')')

  // 3. each step: mint the step resource, point a decoration at it
  for (const s of STEPS) {
    const segments = [ROOT, s.cell]
    const stepSig = await putResource(JSON.stringify(s.step))
    const dec = await ask({
      op: 'decoration-add', segments, kind: 'visual:workflow:step', appliesTo: segments,
      payload: { stepSig }, mark: 'persistent', replaceKind: true,
    })
    log('step', s.cell.padEnd(30), dec.ok ? (dec.unchanged ? 'unchanged' : 'ok ' + stepSig.slice(0, 12)) : dec.error)

    // mirror: the explanation lives on the tile, not only in a file
    const have = await ask({ op: 'note-list', segments: [ROOT], cell: s.cell })
    const notes = (have.ok && Array.isArray(have.data)) ? have.data : []
    if (notes.some(n => String(n.text || '').slice(0, 40) === s.note.slice(0, 40))) {
      log('     note     already present')
    } else {
      const n = await ask({ op: 'note-add', segments: [ROOT], cell: s.cell, text: s.note })
      log('     note     ', n.ok ? 'ok' : n.error)
    }
  }

  // 4. declare the parent a workflow — the `workflow` slot makes it runnable
  //    and adoptable as a skill. Steps stay the child tiles; the record only
  //    says "this cell is a workflow, and this is what it is called".
  const recordSig = await putResource(JSON.stringify({
    v: 1, name: 'pheromone workflow',
    description: 'How marks on a reference filter the page it opens.',
    at: STAMP,
  }))
  const slot = await ask({ op: 'bag-set', segments: [ROOT], slot: 'workflow', cells: [recordSig] })
  log('declare       ', slot.ok ? 'ok ' + recordSig.slice(0, 12) : slot.error)

  // 5. mirror the workflow itself
  const rootNotes = await ask({ op: 'note-list', segments: [], cell: ROOT })
  const rn = (rootNotes.ok && Array.isArray(rootNotes.data)) ? rootNotes.data : []
  if (rn.some(n => String(n.text || '').startsWith('How a pheromone on a reference'))) {
    log('root note      already present')
  } else {
    const n = await ask({ op: 'note-add', segments: [], cell: ROOT, text: WORKFLOW_NOTE })
    log('root note     ', n.ok ? 'ok' : n.error)
  }

  log('\ndone → /' + ROOT)
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
