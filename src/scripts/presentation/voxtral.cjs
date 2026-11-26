// Your voice, from Voxtral on OpenRouter, on any tile of the living presentation.
//
// voice.cjs clones you locally with Chatterbox. This is the hosted way to do the
// same thing: Mistral's Voxtral Mini TTS through OpenRouter, given the same
// ~20 seconds of you (voice/reference/reference.wav) and a line it has never
// heard you say. What comes back goes through the SAME mastering chain a real
// take does (master.cjs), so it sits at the reel's level beside everything else.
//
//   node voxtral.cjs                       # the first tile (protocol) → a preview file
//   node voxtral.cjs --tile protocol/simple
//   node voxtral.cjs --scenes 2,4,7        # tour scenes by number
//   node voxtral.cjs --all                 # every scene that has a tile
//   node voxtral.cjs --check               # what would be spoken and what it costs; no network
//
// By default a take lands in voice/voxtral/<id>.mp3 to be listened to, and the
// page is untouched. Add --seed to put it in the scene's audio-cache slot, the
// one build.cjs and the living presentation already read, and note it in
// voice/spoken.json the way voice.cjs does. Rebuild the page and it plays yours.
//
//   node voxtral.cjs --tile protocol --seed
//
// Cloning is sent as an input_references clip of the reference. OpenRouter's
// Voxtral route takes text only (checked 2026-11-24: "No endpoints supporting
// voice cloning found for this model"), so on Voxtral it is preset voices for
// now. Seed Audio 1.0 takes up to three clips and clones from them:
//
//   node voxtral.cjs --model seed                    # your voice, through Seed Audio
//   node voxtral.cjs --voice en_paul_neutral         # a Voxtral preset voice
//
// Needs OPENROUTER_API_KEY in the environment. Voxtral is billed per character
// ($16 per million: a scene is under a cent); Seed per minute of audio ($0.15,
// at most 120 seconds a request: a scene is about seven cents).
const fs = require('fs')
const path = require('path')
const T = require('./build.cjs')
const { master, durationOf } = require('./master.cjs')

const ROOT = __dirname
const ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech'
// cost is an estimate before the call; ~15 characters of narration a second
const MODELS = {
  voxtral: { id: 'mistralai/voxtral-mini-tts-2603', cost: chars => chars * 16 / 1e6 },
  seed: { id: 'bytedance-seed/seed-audio-1-0', cost: chars => chars / 15 / 60 * 0.15 },
}
const REFERENCE = path.join(ROOT, 'voice', 'reference', 'reference.wav')
const PREVIEW = path.join(ROOT, 'voice', 'voxtral')
const SPOKEN = path.join(ROOT, 'voice', 'spoken.json')

const arg = name => {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return undefined
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : ''
}
const has = name => arg(name) !== undefined

// The reader hears a [pause]; the voice would try to say it. Pronunciation
// rules (pronunciations.json) are applied by T.spokenOf, as for every voice.
const PAUSE = /\[pause(?::(\d+))?\]/g
const textOf = say => T.spokenOf(say).replace(PAUSE, ' ').replace(/\s+/g, ' ').trim()

const sceneFiles = () => fs.readdirSync(path.join(ROOT, 'scenes')).filter(f => /^scene-\d+\.json$/.test(f)).sort()
const scene = n => {
  const f = path.join(ROOT, 'scenes', `scene-${String(n).padStart(2, '0')}.json`)
  if (!fs.existsSync(f)) throw new Error(`no scene ${n}`)
  return JSON.parse(fs.readFileSync(f, 'utf8'))
}

// A tile shows at most one tour scene (blocks/tour.cjs): its words are the
// tile's narration, and its audio-cache slot is where the page looks.
function lines() {
  const tour = () => require('../bridge/living-presentation/blocks/tour.cjs')
  let picked
  if (has('scenes')) {
    picked = arg('scenes').split(',').map(n => parseInt(n, 10)).filter(Number.isFinite)
      .map(n => ({ n, tile: Object.entries(tour().SCENES_OF).find(([, s]) => s === n)?.[0] || null }))
  } else if (has('all')) {
    picked = Object.entries(tour().SCENES_OF).map(([tile, n]) => ({ n, tile })).sort((a, b) => a.n - b.n)
  } else {
    const tile = arg('tile') || 'protocol'          // the root: the first tile
    const n = tour().SCENES_OF[tile]
    if (!n) throw new Error(`no tour scene on the tile "${tile}" — tiles with one: ${Object.keys(tour().SCENES_OF).join(', ')}`)
    picked = [{ n, tile }]
  }
  return picked.map(({ n, tile }) => {
    const s = scene(n)
    return { id: `scene:${String(n).padStart(2, '0')}`, n, tile, name: s.name,
             say: s.say, text: textOf(s.say), slot: T.hashOf(s.say) }
  })
}

async function speak(line, model, voice) {
  const body = { model, input: line.text, response_format: 'mp3' }
  if (voice) body.voice = voice
  else body.input_references = [{ type: 'input_audio', input_audio: {
    data: `data:audio/wav;base64,${fs.readFileSync(REFERENCE).toString('base64')}`, format: 'wav' } }]

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    let msg = text
    try { msg = JSON.parse(text).error?.message || text } catch {}
    throw new Error(`OpenRouter ${res.status}: ${msg.slice(0, 400)}`)
  }
  return { bytes: Buffer.from(await res.arrayBuffer()), generation: res.headers.get('x-generation-id') }
}

async function main() {
  const todo = lines()
  const chars = todo.reduce((t, l) => t + l.text.length, 0)
  const voice = arg('voice') || null
  const seed = has('seed')
  const which = arg('model') || 'voxtral'
  if (!MODELS[which]) throw new Error(`no model "${which}" — one of: ${Object.keys(MODELS).join(', ')}`)
  const MODEL = MODELS[which].id

  for (const l of todo) console.log(`  ${l.id}  ${(l.tile || '(no tile)').padEnd(28)} ${l.text.length} chars  "${l.name}"`)
  console.log(`${todo.length} line(s), ${chars} chars, about $${MODELS[which].cost(chars).toFixed(4)} on ${MODEL} — ` +
    `${voice ? `preset voice ${voice}` : 'your voice (reference.wav)'} → ${seed ? 'audio-cache (seeded)' : 'voice/voxtral/ (preview)'}`)
  if (has('check')) return

  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not set')
  if (!voice && !fs.existsSync(REFERENCE)) throw new Error('no reference yet — node voice.cjs --reference "…" first')

  const ledger = fs.existsSync(SPOKEN) ? JSON.parse(fs.readFileSync(SPOKEN, 'utf8')) : {}
  const rawDir = path.join(PREVIEW, 'raw')
  fs.mkdirSync(rawDir, { recursive: true })
  for (const l of todo) {
    const { bytes, generation } = await speak(l, MODEL, voice)
    const file = `${l.id.replace(':', '-')}.${which}`
    const raw = path.join(rawDir, `${file}.mp3`)
    fs.writeFileSync(raw, bytes)
    const out = seed ? path.join(ROOT, 'audio-cache', `${l.slot}.mp3`) : path.join(PREVIEW, `${file}.mp3`)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    const m = master(raw, out)
    const secs = durationOf(out)
    console.log(`  ${l.id}  ${secs.toFixed(1)}s  ${(+m.input_i).toFixed(1)} → -16 LUFS  → ${path.relative(ROOT, out)}`)
    if (seed) ledger[l.id] = { slot: l.slot, via: 'voxtral', model: MODEL, voice: voice || 'reference.wav',
      generation, seconds: +secs.toFixed(2), at: new Date().toISOString().slice(0, 10), text: l.text }
  }
  if (seed) {
    fs.writeFileSync(SPOKEN, JSON.stringify(ledger, null, 2))
    console.log('seeded. Rebuild the page and it plays these.')
  }
}

main().catch(e => {
  console.error(`voxtral failed: ${e.message}`)
  if (/cloning|reference/i.test(e.message) && !arg('voice'))
    console.error('this route does not clone — try --model seed for your voice, or --voice en_paul_neutral for a preset')
  process.exitCode = 1                              // not process.exit: it aborts libuv mid-close on Windows
})
