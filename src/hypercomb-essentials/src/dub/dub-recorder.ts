// dub/dub-recorder.ts
//
// THE RECORDER: one sentence, the microphone, and a cursor that walks the words.
//
// It opens when a sentence is pressed (dub.drone.ts), CENTERED ABOVE THE
// VIEWER and never over it (jwize, 2026-11-11: "this is in the way of the
// presentation ... when a host is editing it should be centered above the
// viewer"): it takes its place in the page's own flow, just before the scene,
// so the figure and the sentence stay in full view while a take is made. With
// no scene to sit above it floats at the top of the window. It is not a
// dialog: the page behind it stays usable. The
// sentence is laid out a word at a time; while a take is being recorded the
// cursor moves through the words at reading pace, karaoke style, so reading
// with it gives a take about as long as the scene expects. A press on any word
// puts the cursor there. The words themselves can be edited in place (jwize,
// 2026-11-11: "we should also be able to edit the text inline"): the sentence
// then shows and reads the new words. Nothing is kept until it is asked for.
//
// Framework-free DOM, loaded on the first press (never at boot).

import { foldSentence, karaoke, readingSeconds, wordAt, type KaraokeWord } from './dub-bank.js'

export interface DubRecorderAsk {
  /** The sentence as the page shows it now. */
  readonly say: string
  /** The words the page was built with (the same as `say` unless reworded). */
  readonly original: string
  /** Where the sentence stands in its scene, for the heading. */
  readonly at: number
  readonly of: number
  /** A take already kept for this sentence, to hear before replacing it. */
  readonly kept: string
  /** The viewer the editor sits above (the page's scene), when there is one. */
  readonly above: Element | null
  readonly t: (key: string, fallback: string, params?: Record<string, string | number>) => string
  /** Keep a take, with the words it was read from. */
  readonly keep: (take: Blob, seconds: number, text: string) => Promise<boolean>
  /** Keep new words for the sentence (the page's own words put them down). */
  readonly reword: (text: string) => Promise<boolean>
  /** Put the kept take down: the page plays the voice it was built with. */
  readonly originalVoice: () => Promise<boolean>
}

const STYLE_ID = 'hc-dub-style'
const STYLE = `
.hc-dub{display:flex;justify-content:center;margin:0 0 1rem;font:1rem/1.5 system-ui,sans-serif;color:#e8eef3;text-align:left}
.hc-dub.floating{position:fixed;top:.75rem;left:0;right:0;z-index:2147483000;margin:0;pointer-events:none}
.hc-dub.floating .hc-dub-card{pointer-events:auto;box-shadow:0 12px 40px rgba(0,0,0,.5)}
.hc-dub-card{box-sizing:border-box;width:min(46rem,100%);max-height:42vh;overflow:auto;padding:1rem 1.25rem;background:#0d141c;border:1px solid rgba(126,182,214,.35);border-radius:4px}
.hc-dub-head{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;margin:0 0 .5rem;font-size:.85rem;color:#9fb4c4}
.hc-dub-words{margin:0 0 .75rem;font-size:1.3rem;line-height:1.5}
.hc-dub-word{cursor:pointer;border-radius:3px;padding:0 .08em;color:#7d8f9d;transition:color .12s,background .12s}
.hc-dub-word.said{color:#e8eef3}
.hc-dub-word.now{color:#0d141c;background:#f2b84b}
.hc-dub-word:focus-visible{outline:2px solid #7eb6d6;outline-offset:1px}
.hc-dub-edit{box-sizing:border-box;display:block;width:100%;min-height:4.5rem;margin:0 0 .75rem;padding:.6rem .7rem;font:inherit;font-size:1.25rem;line-height:1.5;color:#e8eef3;background:#070b10;border:1px solid #47617a;border-radius:4px;resize:vertical}
.hc-dub-edit:focus-visible{outline:2px solid #7eb6d6;outline-offset:1px}
.hc-dub-state{min-height:1.5em;margin:0 0 .75rem;font-size:.9rem;color:#9fb4c4}
.hc-dub-state.error{color:#ff9d8a}
.hc-dub-acts{display:flex;flex-wrap:wrap;gap:.6rem}
.hc-dub-acts button{font:inherit;padding:.55rem .95rem;border-radius:4px;border:1px solid #47617a;background:#16222e;color:#e8eef3;cursor:pointer}
.hc-dub-acts button:disabled{opacity:.4;cursor:default}
.hc-dub-acts button[hidden]{display:none}
.hc-dub-acts button.lead{border-color:#f2b84b;background:#f2b84b;color:#0d141c}
.hc-dub-acts button.live{border-color:#ff6b57;background:#ff6b57;color:#0d141c}
.hc-dub-acts .hc-dub-gap{flex:1}
@media (prefers-reduced-motion: reduce){.hc-dub-word{transition:none}}
`

const installStyle = (): void => {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE
  document.head.append(style)
}

/** The first container the browser can record sound into, or '' for its own. */
export const takeType = (supports: (type: string) => boolean): string =>
  ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => supports(type)) ?? ''

let open: (() => void) | null = null

/** Open the recorder for one sentence. A second ask replaces the first. */
export const openDubRecorder = (ask: DubRecorderAsk): void => {
  open?.()
  installStyle()
  const { t } = ask

  const root = document.createElement('div')
  root.className = 'hc-dub'
  root.setAttribute('role', 'region')
  root.setAttribute('aria-label', t('dub.title', 'Record this sentence'))
  const card = document.createElement('div')
  card.className = 'hc-dub-card'

  const head = document.createElement('p')
  head.className = 'hc-dub-head'
  const title = document.createElement('span')
  title.textContent = t('dub.title', 'Record this sentence')
  const where = document.createElement('span')
  where.textContent = t('dub.where', 'Sentence {at} of {of}', { at: ask.at + 1, of: ask.of })
  head.append(title, where)

  /** The words as they stand now, and the pace a take of them is guided at. */
  let text = foldSentence(ask.say)
  let words: KaraokeWord[] = []
  let spans: HTMLSpanElement[] = []
  const line = document.createElement('p')
  line.className = 'hc-dub-words'
  const edit = document.createElement('textarea')
  edit.className = 'hc-dub-edit'
  edit.hidden = true
  edit.setAttribute('aria-label', t('dub.edit', 'Edit the words'))

  /** Lay the sentence out a word at a time, timed across `seconds`. */
  const layout = (seconds: number): void => {
    words = karaoke(text, seconds)
    line.replaceChildren()
    spans = words.map((word, index) => {
      const span = document.createElement('span')
      span.className = 'hc-dub-word'
      span.textContent = word.word
      span.tabIndex = 0
      span.setAttribute('role', 'button')
      const put = (): void => { moveTo(index) }
      span.addEventListener('click', put)
      span.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); put() } })
      line.append(span, document.createTextNode(' '))
      return span
    })
  }

  const state = document.createElement('p')
  state.className = 'hc-dub-state'
  state.setAttribute('role', 'status')

  const acts = document.createElement('div')
  acts.className = 'hc-dub-acts'
  const button = (label: string, cls = ''): HTMLButtonElement => {
    const made = document.createElement('button')
    made.type = 'button'
    made.textContent = label
    if (cls) made.className = cls
    return made
  }
  const record = button(t('dub.record', 'Record'), 'lead')
  const hear = button(t('dub.hear', 'Hear it'))
  const keep = button(t('dub.keep', 'Keep this take'))
  const reword = button(t('dub.edit', 'Edit the words'))
  const saveWords = button(t('dub.save-words', 'Save the words'), 'lead')
  const pageWords = button(t('dub.page-words', 'Use the page\'s words'))
  const cancelWords = button(t('dub.cancel', 'Cancel'))
  const original = button(t('dub.original', 'Use the original voice'))
  const close = button(t('dub.close', 'Close'))
  const gap = document.createElement('span')
  gap.className = 'hc-dub-gap'
  acts.append(record, hear, keep, reword, saveWords, pageWords, cancelWords, gap, original, close)

  card.append(head, line, edit, state, acts)
  root.append(card)

  // ── the cursor ────────────────────────────────────────────────────────────
  let cursor = 0
  let frame = 0
  /** Seconds into the sentence the cursor's clock started from, and when. */
  let clockFrom = 0
  let clockAt = 0
  let clock: (() => number) | null = null
  const paint = (now: number): void => {
    spans.forEach((span, index) => {
      span.classList.toggle('said', index < now)
      span.classList.toggle('now', index === now)
    })
  }
  const tick = (): void => {
    if (!clock) return
    cursor = wordAt(words, clock())
    paint(cursor)
    frame = requestAnimationFrame(tick)
  }
  const run = (from: () => number): void => { cancelAnimationFrame(frame); clock = from; frame = requestAnimationFrame(tick) }
  const rest = (): void => { cancelAnimationFrame(frame); clock = null }
  /** Put the cursor on a word. While a take is running the walk carries on
   *  from there; at rest it only marks where a take would be read from. */
  const moveTo = (index: number): void => {
    if (!words.length) return
    cursor = Math.max(0, Math.min(words.length - 1, index))
    if (player && !player.paused) { try { player.currentTime = words[cursor]!.from } catch { /* not seekable yet */ } }
    else if (recorder) { clockFrom = words[cursor]!.from; clockAt = performance.now() }
    paint(cursor)
  }

  // ── the take ──────────────────────────────────────────────────────────────
  let stream: MediaStream | null = null
  let recorder: MediaRecorder | null = null
  let take: Blob | null = null
  let takeSeconds = 0
  let takeUrl = ''
  /** Whether a take is kept for this sentence — it goes when the kept take is put down. */
  let kept = ask.kept
  let player: HTMLAudioElement | null = null
  let busy = false
  let editing = false

  const say = (message: string, error = false): void => { state.textContent = message; state.classList.toggle('error', error) }
  const sync = (): void => {
    const recording = !!recorder
    record.textContent = recording ? t('dub.stop', 'Stop') : take ? t('dub.again', 'Record again') : t('dub.record', 'Record')
    record.className = recording ? 'live' : take || editing ? '' : 'lead'
    record.disabled = busy || editing
    hear.disabled = recording || busy || editing || !(take || kept)
    keep.disabled = recording || busy || editing || !take
    keep.className = take && !recording && !editing ? 'lead' : ''
    reword.hidden = editing
    reword.disabled = recording || busy
    saveWords.hidden = cancelWords.hidden = !editing
    saveWords.disabled = cancelWords.disabled = busy
    pageWords.hidden = !editing || foldSentence(ask.original) === text
    pageWords.disabled = busy
    original.disabled = recording || busy || editing || !kept
    line.hidden = editing
    edit.hidden = !editing
  }
  const stopPlayer = (): void => { if (player) { player.pause(); player = null } }
  const letGo = (): void => {
    for (const track of stream?.getTracks() ?? []) track.stop()
    stream = null
  }
  /** A take belongs to the words it was read from: new words, no take in hand. */
  const dropTake = (): void => {
    take = null
    takeSeconds = 0
    if (takeUrl) { URL.revokeObjectURL(takeUrl); takeUrl = '' }
  }

  const start = async (): Promise<void> => {
    stopPlayer()
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      say(t('dub.no-mic', 'This browser cannot record from a microphone here.'), true)
      return
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch {
      say(t('dub.mic-refused', 'The microphone was not allowed. Allow it for this site and press Record again.'), true)
      return
    }
    const type = takeType(candidate => MediaRecorder.isTypeSupported(candidate))
    const chunks: Blob[] = []
    const made = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
    const began = performance.now()
    made.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
    made.onstop = () => {
      dropTake()
      takeSeconds = (performance.now() - began) / 1000
      take = new Blob(chunks, { type: made.mimeType || type || 'audio/webm' })
      takeUrl = URL.createObjectURL(take)
      recorder = null
      letGo()
      rest()
      // The cursor now walks the take as it was read, not the guide.
      layout(takeSeconds)
      cursor = 0
      paint(-1)
      say(t('dub.taken', 'Take recorded: {seconds} s. Hear it, keep it, or record again.', { seconds: takeSeconds.toFixed(1) }))
      sync()
    }
    recorder = made
    const from = cursor
    layout(readingSeconds(text))
    cursor = Math.min(from, Math.max(0, words.length - 1))
    clockFrom = words[cursor]?.from ?? 0
    clockAt = performance.now()
    made.start()
    run(() => clockFrom + (performance.now() - clockAt) / 1000)
    say(t('dub.recording', 'Recording. Read with the cursor, then press Stop.'))
    sync()
  }

  const stop = (): void => { if (recorder && recorder.state !== 'inactive') recorder.stop() }

  const play = (): void => {
    const url = takeUrl || kept
    if (!url) return
    stopPlayer()
    const audio = new Audio(url)
    player = audio
    if (!take) {
      layout(readingSeconds(text))
      audio.onloadedmetadata = () => { if (Number.isFinite(audio.duration) && audio.duration > 0) layout(audio.duration) }
    }
    audio.onended = () => { if (player === audio) { player = null; rest(); paint(-1) } }
    run(() => audio.currentTime)
    void audio.play().catch(() => { if (player === audio) { player = null; rest() } })
  }

  /** Run one save, and say so when it did not hold. */
  const save = (work: () => Promise<boolean>, then: () => void): void => {
    if (busy) return
    busy = true
    sync()
    void work().catch(() => false).then(ok => {
      busy = false
      if (ok) then()
      else { say(t('dub.not-kept', 'It could not be kept. Nothing changed.'), true); sync() }
    })
  }

  // ── the words ─────────────────────────────────────────────────────────────
  const beginEdit = (): void => {
    stopPlayer()
    rest()
    editing = true
    edit.value = text
    say(t('dub.editing', 'Change the words, then save them. A take is read from the words as they stand.'))
    sync()
    edit.focus()
  }
  const endEdit = (): void => { editing = false; sync(); record.focus() }
  const setWords = (next: string): void => {
    const folded = foldSentence(next)
    if (!folded) { say(t('dub.no-words', 'A sentence needs at least one word.'), true); return }
    if (folded === text) { endEdit(); return }
    save(() => ask.reword(folded), () => {
      text = folded
      dropTake()
      layout(readingSeconds(text))
      cursor = 0
      paint(-1)
      endEdit()
      say(kept
        ? t('dub.words-saved-take', 'Words saved. The kept take was read from the old words: record them again when ready.')
        : t('dub.words-saved', 'Words saved. Record them when ready.'))
    })
  }

  record.addEventListener('click', () => { if (recorder) stop(); else void start() })
  hear.addEventListener('click', play)
  keep.addEventListener('click', () => { const held = take; if (held) save(() => ask.keep(held, takeSeconds, text), dismiss) })
  reword.addEventListener('click', beginEdit)
  saveWords.addEventListener('click', () => setWords(edit.value))
  pageWords.addEventListener('click', () => setWords(ask.original))
  cancelWords.addEventListener('click', () => { say(''); endEdit() })
  original.addEventListener('click', () => save(() => ask.originalVoice(), () => {
    kept = ''
    say(t('dub.put-down', 'This sentence plays its original voice again'))
    sync()
  }))

  const keys = (event: KeyboardEvent): void => {
    // A key pressed inside the editor is the editor's and stops here: the page
    // steps scenes on the arrows and plays on space. A key pressed anywhere
    // else is the page's, as always — the editor is beside it, not over it.
    event.stopPropagation()
    if (event.key === 'Escape') { event.preventDefault(); if (editing) { say(''); endEdit() } else dismiss(); return }
    if (editing) {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); setWords(edit.value) }
      return
    }
    if (event.key === 'ArrowRight') { event.preventDefault(); moveTo(cursor + 1) }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); moveTo(cursor - 1) }
    else if (event.key === ' ' && !(event.target instanceof HTMLButtonElement) && !(event.target as Element | null)?.classList?.contains('hc-dub-word')) {
      event.preventDefault()
      if (recorder) stop(); else void start()
    }
  }
  const dismiss = (): void => {
    if (open !== dismiss) return
    open = null
    if (recorder && recorder.state !== 'inactive') { recorder.onstop = null; recorder.stop() }
    recorder = null
    letGo()
    rest()
    stopPlayer()
    if (takeUrl) URL.revokeObjectURL(takeUrl)
    watch.disconnect()
    root.remove()
  }
  close.addEventListener('click', dismiss)
  root.addEventListener('keydown', keys)
  // The page it sits in went away (another tile, the hive): it goes with it.
  const watch = new MutationObserver(() => { if (!root.isConnected) dismiss() })
  open = dismiss

  layout(readingSeconds(text))
  say(kept
    ? t('dub.has-take', 'This sentence has a take of yours. Hear it, or record a new one.')
    : t('dub.ready', 'Press Record and read with the cursor. Press a word to start from it.'))
  sync()
  paint(-1)
  const above = ask.above?.isConnected ? ask.above : null
  if (above) above.before(root)
  else { root.classList.add('floating'); document.body.append(root) }
  watch.observe(above?.parentNode ?? document.body, { childList: true, subtree: !above })
  try { root.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) } catch { /* older engines */ }
  record.focus({ preventScroll: true })
}

/** Close the recorder if it is open (the page went away). */
export const closeDubRecorder = (): void => { open?.() }
