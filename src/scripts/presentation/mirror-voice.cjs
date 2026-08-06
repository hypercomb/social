// Mirror the narration pipeline into the hive (requires a live bridge).
//
//   node scripts/presentation/mirror-voice.cjs [--dry]
//
// mirror-to-hive.cjs mirrors what the presentation SAYS — one tile per scene.
// This mirrors how it gets SAID: the two ways a line becomes audio (read into a
// microphone, or spoken by a clone of the same voice), the one chain they share,
// and the local toolchain that makes the clone possible.
//
// One tile per source resource, per rule 6. `voice/README.md` is deliberately
// NOT a part tile — the mirror's whole point is that the explanation lives on
// the tile as a note rather than only in a markdown file, so its content is the
// notes here. `pronunciations.json` is likewise not a part: it is shared with
// build.cjs and record.cjs, and a shared subsystem is nobody's internals. What
// this creation added to it — the `hear` rule — is explained on the collection.
//
// Idempotent: structure, notes and marks are each checked before they are
// written, so an interrupted run resumes rather than duplicating.
const crypto = require('crypto')
const WebSocket = require('ws')

const BRIDGE = 'ws://127.0.0.1:2401'
const TIMEOUT = 180_000            // a commit burst can stall the renderer for minutes
const DRY = process.argv.includes('--dry')
const SRC = 'src/scripts/presentation'

const KEYWORD = 'presentation'     // declared here, registered at the end of the run
const COLOR = '#8f8231'
const PART = 'part'                // already declared by mirror-behavior-parts.ts

// The hive stores a cell under its normalized name, so a wanted name must be
// compared in that form or it looks missing forever and re-adds on every run.
// Mirrors normalizeCell() in hypercomb-core/src/cell.ts.
const norm = s => String(s).trim().toLocaleLowerCase()
  .replace(/[._\s]+/g, '-').replace(/[^\p{L}\p{N}\-]/gu, '')
  .replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 64).replace(/-$/, '')

let counter = 0
const send = req => new Promise((resolve, reject) => {
  const ws = new WebSocket(BRIDGE)
  const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, TIMEOUT)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id: `mv-${Date.now()}-${++counter}` })))
  ws.on('message', raw => { clearTimeout(timer); ws.close(); resolve(JSON.parse(String(raw))) })
  ws.on('error', err => { clearTimeout(timer); reject(err) })
})

const PARTS = [
  {
    cell: 'voice',
    note: `voice.cjs — the driver: clone, master, seed

Reads one prepared reference and speaks lines you never read, then puts every
one through the shared mastering chain before it is allowed near the reel.

The whole trick is where the audio lands. A spoken line is written into the
EXACT cache slot a recorded take would occupy — same key, same directory — so
teaser.cjs and build.cjs need no flag and no branch. They find the audio already
there and skip the neural narrator. Cloning is not a mode; it is another way to
produce a take.

voice/spoken.json is the ledger of which slots are spoken rather than read. It
is the one place that distinction is kept, so it has to stay honest.

source: ${SRC}/voice.cjs`,
  },
  {
    cell: 'master',
    note: `master.cjs — one chain, so every voice sits at one level

The broadcast chain: rumble filter, gentle de-noise, de-esser, light
compression, then TWO-PASS EBU R128 loudness normalisation to -16 LUFS. The
second pass is what makes separately-produced takes match, and matching is the
thing that actually reads as "produced".

It was lifted out of record.cjs when the clone arrived, because the moment there
are two ways to make a take there must still be only one way to master one. A
read line and a spoken line are indistinguishable in level by construction.

The silence trim touches the run-up only and keeps 0.2s of it. It must never use
stop_periods: that would cut at the first pause INSIDE a line, and the pauses are
the performance.

source: ${SRC}/master.cjs`,
  },
  {
    cell: 'record',
    note: `record.cjs — you at a microphone

The other half of the pair, and the older one. Drop scene-05.wav into record/ and
scene 5 is you while the rest are untouched; the reel converts one scene at a
time. --script writes a teleprompter to read from, --check says which takes have
drifted from a script that changed since you recorded it.

Read one passage and voice.cjs can have the rest without you reading them.

source: ${SRC}/record.cjs`,
  },
  {
    cell: 'clone',
    note: `clone.py — speak it, then check that it said it

Zero-shot cloning (Chatterbox, MIT, local, free) conditions on ~20 seconds of
reference and samples several takes per line, because takes fail in two
unrelated ways.

One is DRIFT: the voice wanders off yours. The other is DICTION: it says
"hypercone", or drops a word entirely. A speaker encoder catches the first and is
completely blind to the second — which is exactly how the take that dropped a
word wins, since a missing word costs nothing in voice similarity. So every take
is also transcribed (Whisper) and scored against the words it was given.

Right comes first and right is a RANKING, not a threshold: a take that says every
word beats one that says all but one, however much closer the near-miss sounds.
Likeness only breaks ties between takes that are equally correct. If no take said
the line at all, the best is kept and FLAGGED — re-roll it, do not let it pass.

source: ${SRC}/voice/clone.py`,
  },
  {
    cell: 'numba-shim',
    note: `shim/numba/__init__.py — a stand-in for a blocked dependency

This machine's Application Control policy blocks numba's unsigned native
extension outright. That takes librosa down with it, and librosa takes down
essentially every Python speech stack — so the clone could not import at all.

Nothing on the speech path needs numba to be FAST; it needs librosa to IMPORT.
The decorators become pass-throughs and the type names become their numpy
equivalents. The one thing that cannot be honestly faked is guvectorize, whose
functions write into an out-parameter and are called as ufuncs: those raise
loudly rather than returning something quietly wrong.

If a machine can import the real numba, this never loads.

source: ${SRC}/voice/shim/numba/__init__.py`,
  },
]

const COLLECTION_NOTE = `Narration — how a line becomes audio

Two ways in, one way out. record.cjs is you at a microphone, one scene at a time.
voice.cjs clones a single take and speaks the lines you never read. Both go
through master.cjs, and both land in the same cache slot the neural narrator
would have filled — so the build cannot tell them apart and does not need to.

Everything runs locally and costs nothing: Chatterbox (MIT) clones, Whisper
checks it, ffmpeg masters. No GPU, no account, no upload.

WHEN EVERY TAKE LOOKS WRONG. pronunciations.json carries two kinds of rule.
\`say\` is for the mouth — how a word should be read. \`hear\` is for the ear —
spellings transcription is allowed to come back with. A coined noun has no
correct spelling as far as an ASR model is concerned: "Hypercomb" returns as
"Hypercom", and it does so from the neural narration already published, not just
from the clone. Without a \`hear\` rule every take of every line carrying the name
scores as wrong — and worse, the take that dropped the word ENTIRELY then wins,
because it is the only one whose error the encoder cannot see. If a whole line
flags with nothing obviously wrong in what it heard, that is the shape of it: add
the spellings, do not lower the threshold.

First use: the 46-second teaser, narrated end to end from one 19-second
reference. Likeness 0.87-0.95, every line at 0% word error, -16.5 LUFS.

Setup and the machine-specific traps: ${SRC}/voice/README.md`

const PRODUCTION_NOTE = `The presentation — a production, not a video file

Every scene is an instruction compiled into one self-playing page, so any piece
can change without touching the rest. Narration audio is a cache keyed by the
words, which is why a human take can simply be dropped into it.

This tile gathers the production's parts. What it SAYS is one tile per scene;
how it gets SAID is under narration.

source: ${SRC}/`

// ---------- reading what is already there ------------------------------------
async function childNamesOf(segments) {
  const layer = await send({ op: 'layer-at', segments })
  if (!layer.ok) return null                       // no layer there yet
  const sigs = Array.isArray(layer.data && layer.data.children) ? layer.data.children.map(String) : []
  const names = []
  for (const sig of sigs) {
    const res = await send({ op: 'get-resource', sig })
    if (!res.ok) continue
    try {
      const name = JSON.parse(res.data.text).name
      if (typeof name === 'string' && name.trim()) names.push(name.trim())
    } catch { /* not a layer */ }
  }
  return names
}

const decorationSig = name => crypto.createHash('sha256')
  .update(JSON.stringify({ kind: 'tag', appliesTo: [], payload: { name } })).digest('hex')

async function ensureCells(parent, cells) {
  const have = ((await childNamesOf(parent)) ?? []).map(norm)
  const missing = cells.filter(c => !have.includes(norm(c)))
  if (!missing.length) { console.log(`  = /${parent.join('/')} — ${cells.length} already present`); return }
  if (DRY) { console.log(`  + /${parent.join('/')} would add ${missing.join(', ')}`); return }
  const r = await send({ op: 'add', cells: missing, segments: parent })
  console.log(`  ${r.ok ? '+' : '!'} /${parent.join('/')} <- ${missing.join(', ')}${r.ok ? '' : ' ' + r.error}`)
  if (!r.ok) throw new Error(`could not add under /${parent.join('/')}: ${r.error}`)
}

/** note-add is not idempotent — only write when no note with this first line exists. */
async function ensureNote(parent, cell, text) {
  const segments = [...parent, cell]
  const first = text.split('\n')[0].trim()
  const existing = await send({ op: 'note-list', segments })
  const items = existing.ok && Array.isArray(existing.data) ? existing.data : []
  if (items.some(n => String((n && n.text) || '').split('\n')[0].trim() === first)) {
    console.log(`  = note ${segments.join('/')}`); return
  }
  if (DRY) { console.log(`  + note ${segments.join('/')} would be written`); return }
  const r = await send({ op: 'note-add', segments: parent, cell, text })
  console.log(`  ${r.ok ? '+' : '!'} note ${segments.join('/')}${r.ok ? '' : ' ' + r.error}`)
}

async function ensureMark(segments, name) {
  const sig = decorationSig(name)
  const layer = await send({ op: 'layer-at', segments })
  const decs = (layer.ok && Array.isArray(layer.data.decorations)) ? layer.data.decorations.map(String) : []
  if (decs.includes(sig)) { console.log(`  = mark ${segments.join('/')} ${name}`); return }
  if (DRY) { console.log(`  + mark ${segments.join('/')} <- ${name}`); return }
  const r = await send({ op: 'decoration-add', segments, kind: 'tag', appliesTo: [], payload: { name } })
  console.log(`  ${r.ok ? '+' : '!'} mark ${segments.join('/')} <- ${name}${r.ok ? '' : ' ' + r.error}`)
}

// ---------- run --------------------------------------------------------------
;(async () => {
  console.log(DRY ? '[mirror-voice] DRY RUN\n' : '[mirror-voice] mirroring the narration pipeline\n')

  console.log('structure:')
  await ensureCells([], ['presentation'])
  await ensureCells(['presentation'], ['narration'])
  await ensureCells(['presentation', 'narration'], PARTS.map(p => p.cell))

  console.log('\nnotes:')
  await ensureNote([], 'presentation', PRODUCTION_NOTE)
  await ensureNote(['presentation'], 'narration', COLLECTION_NOTE)
  for (const p of PARTS) await ensureNote(['presentation', 'narration'], p.cell, p.note)

  console.log('\nmarks:')
  await ensureMark(['presentation'], KEYWORD)
  await ensureMark(['presentation', 'narration'], KEYWORD)
  for (const p of PARTS) {
    await ensureMark(['presentation', 'narration', p.cell], PART)
    await ensureMark(['presentation', 'narration', p.cell], KEYWORD)
  }

  if (!DRY) {
    // Declare the vocabulary (registry-only /keyword, then neutralize replay).
    process.stdout.write(`\nvocabulary: ${KEYWORD}(${COLOR}) ... `)
    const reg = await send({ op: 'submit', text: `/keyword [${KEYWORD}(${COLOR})]` })
    console.log(reg.ok ? 'ok' : `FAIL: ${reg.error}`)
    await send({ op: 'submit', text: '' })
  }

  console.log('\n[mirror-voice] done')
})().catch(e => { console.error(`mirror failed: ${e.message}`); process.exit(1) })
