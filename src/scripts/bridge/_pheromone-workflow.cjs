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

// Read a cell's slot sigs. Used instead of `note-list` because note-list needs
// a non-empty `segments` (the PARENT path), so it cannot address a cell sitting
// at the hive root — the original guard here called it with `segments: []`,
// silently got `no segments provided`, treated the error as "no notes", and
// re-added the root note on every run. The workflow's `notes` slot had the same
// sig twice as a result. Reading the slot works at any depth.
const slotOf = async (segments, slot) => {
  const la = await ask({ op: 'layer-at', segments })
  const v = la.ok && la.data ? la.data[slot] : undefined
  return Array.isArray(v) ? v : []
}

const resourceText = async (sig) => {
  const r = await ask({ op: 'get-resource', sig })
  return r.ok && r.data ? String(r.data.text || '') : ''
}

// ── the marks ───────────────────────────────────────────────────────────────
//
// SYNCHRONIZATION, not addition: a mirror is cells + PHEROMONES + notes, and
// this workflow had been built with only cells and notes. The marks below say
// what each tile IS, so the collection resolves from the mark instead of from
// this script's cell list.
//
// Both words are already in the DECLARED vocabulary (`TUTORIAL_PHEROMONES` in
// tutorial-lesson.ts): `meaning` is the topic word for marks/pheromones,
// `guidance` is the census word for instructional material. Nothing new is
// minted here on purpose — there is no declared `workflow` or `step` keyword,
// and inventing one from a build script is exactly what the doctrine forbids.
// The workflow-ness is already carried structurally, by the `workflow` slot and
// the per-step `visual:workflow:step` decorations; it does not need a word.
const COLLECTION_MARKS = ['meaning', 'guidance']
const STEP_MARKS = ['meaning']

// A tag decoration is `appliesTo: []`, so its payload IS its identity: the same
// keyword is the same sig on every tile, which is what makes painting it a
// membership edge. `decoration-add` is append-or-noop on an identical sig, so
// this converges. NEVER pass `replaceKind` for a tag — kind is `tag` for every
// keyword, so replacing by kind would silently drop a tile's other marks.
const paintMark = async (segments, name) => {
  const r = await ask({
    op: 'decoration-add', segments, kind: 'tag', appliesTo: [], payload: { name },
  })
  // `decoration-add` does not report whether it appended or no-opped, so this
  // says only that the mark is now on the tile — verified append-or-noop by sig:
  // two consecutive runs leave exactly one `tag` decoration per keyword.
  return r.ok ? 'ok' : 'ERR ' + r.error
}

/** Add a note only if the cell does not already carry it — compared on the
 *  note text read out of the slot, so it holds for a cell at any depth. */
const ensureNote = async (cellSegments, addReq, text) => {
  for (const sig of await slotOf(cellSegments, 'notes')) {
    try {
      const have = String(JSON.parse(await resourceText(sig)).note || '')
      if (have.slice(0, 40) === text.slice(0, 40)) return 'already present'
    } catch { /* unreadable note — treat as absent */ }
  }
  const n = await ask({ ...addReq, text })
  return n.ok ? 'ok' : 'ERR ' + n.error
}

/** Collapse repeated sigs in a slot. A duplicate is never meaningful — the same
 *  sig is the same content — and it renders as two identical notes. */
const dedupeSlot = async (segments, slot) => {
  const sigs = await slotOf(segments, slot)
  const unique = [...new Set(sigs)]
  if (unique.length === sigs.length) return `clean (${sigs.length})`
  const r = await ask({ op: 'bag-set', segments, slot, cells: unique })
  return r.ok ? `deduped ${sigs.length} → ${unique.length}` : 'ERR ' + r.error
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

  // 1. the workflow cell — only if absent. `add` is NOT idempotent (it appends
  //    a child), so re-running this as a SYNC must never re-add: a second
  //    `8-the-open-piece` would be a second tile, not a noop.
  const rootLayer = await ask({ op: 'layer-at', segments: [ROOT] })
  if (rootLayer.ok) {
    log('root cell      exists')
  } else {
    const addRoot = await ask({ op: 'add', segments: [], cells: [ROOT] })
    log('add root      ', addRoot.ok ? 'ok' : '(' + addRoot.error + ')')
  }

  // 2. the step cells, in order — the parent's children order IS the step order.
  //    Existing names are read from the tree, so only genuinely missing steps
  //    are added and the order of what is already there is left alone.
  const inf = await ask({ op: 'inflate', segments: [ROOT] })
  const present = new Set(
    (inf.ok && inf.data && Array.isArray(inf.data.children) ? inf.data.children : [])
      .map(c => String((c && c.name) || '')),
  )
  const missing = STEPS.map(s => s.cell).filter(c => !present.has(c))
  if (missing.length === 0) {
    log(`step cells     all ${STEPS.length} present`)
  } else {
    const addSteps = await ask({ op: 'add', segments: [ROOT], cells: missing })
    log('add steps     ', addSteps.ok ? 'ok ' + missing.join(', ') : '(' + addSteps.error + ')')
  }

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
    log('     note     ', await ensureNote(segments, { op: 'note-add', segments: [ROOT], cell: s.cell }, s.note))

    // mirror: the mark says what the tile IS, so the collection resolves from
    // the mark rather than from this script's list of cells
    for (const name of STEP_MARKS) log(`     mark ${name.padEnd(9)}`, await paintMark(segments, name))
    log('     notes slot', await dedupeSlot(segments, 'notes'))
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

  // 5. mirror the workflow itself — note, marks, and a clean notes slot
  log('root note     ', await ensureNote([ROOT], { op: 'note-add', segments: [], cell: ROOT, text: WORKFLOW_NOTE }, WORKFLOW_NOTE))
  for (const name of COLLECTION_MARKS) log(`root mark ${name.padEnd(9)}`, await paintMark([ROOT], name))
  log('root notes slot', await dedupeSlot([ROOT], 'notes'))

  log('\ndone → /' + ROOT)

  // ONE BUILD REVISION FOR THE WHOLE PASS (documentation/build-revisions.md).
  //
  // [ROOT], not []. The pass does touch the hive root — `add` puts the
  // workflow cell in the root's children, and the root note is addressed
  // parent-plus-cell — but both of those are how a cell comes into being at
  // all, and `build-record` refuses empty segments by design, pointing at
  // /snapshot for the whole-hive case. Everything the pass MEANS is the
  // workflow tile and its steps, and a record seals that whole subtree.
  // Reported, never thrown — and that needs the guard, not just the shape of
  // the log. `ask` re-throws the transport error on its last attempt, so a
  // bridge that drops at the very end would exit(1) through main().catch
  // after every anchor in the pass had already committed.
  let rev
  try { rev = await ask({ op: 'build-record', segments: [ROOT], label: 'pheromone workflow build' }) }
  catch (err) { rev = { ok: false, error: err.message } }
  log('build revision', rev.ok
    ? `${rev.data.label} seal=${String(rev.data.seal).slice(0, 12)}${rev.data.unchanged ? ' (unchanged)' : ''}`
    : `FAILED: ${rev.error}`)
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
