// player.js — standalone vanilla JS track player
// Mirrors the Angular TrackPlayerComponent + AudioPlayerComponent logic

const TRACK_SEQUENCE_KEY = 'ibh:track-player:sequence'
const NO_SIGNAL_DURATION_MS = 2500

// ── DOM references ────────────────────────────────────────

const $ = (id) => document.getElementById(id)

const audio         = $('audio')
const playBtn       = $('playBtn')
const iconPlay      = playBtn.querySelector('.icon-play')
const iconPause     = playBtn.querySelector('.icon-pause')
const scrub         = $('scrub')
const progressBar   = $('progressBar')
const bufferedBar   = $('bufferedBar')
const thumb         = $('thumb')
const trackList     = $('trackList')
const playerContent = $('playerContent')
const statusLoading = $('statusLoading')
const statusError   = $('statusError')
const statusEmpty   = $('statusEmpty')
const selectedTitle = $('selectedTitle')
const selectedFile  = $('selectedFile')
const noSignal      = $('noSignal')
const skipNoSignal  = $('skipNoSignal')
const legend        = $('legend')

// ── state ─────────────────────────────────────────────────

let tracks = []
let currentTrack = null
let shouldAutoplay = false
let dragging = false
let noSignalTimer = null
let gestureHandler = null

// ── track loading ─────────────────────────────────────────

async function loadTracks() {
  statusLoading.hidden = false
  statusError.hidden = true
  statusEmpty.hidden = true
  playerContent.hidden = true

  try {
    const response = await fetch('tracks/manifest.json', { cache: 'no-store' })
    if (!response.ok) throw new Error(`manifest request failed: ${response.status}`)

    const manifest = await response.json()
    tracks = Array.isArray(manifest.tracks)
      ? manifest.tracks.filter(t => t?.src && t?.title)
      : []

    statusLoading.hidden = true

    if (!tracks.length) {
      statusEmpty.hidden = false
      return
    }

    const hasLimited = tracks.some(t => t.limited)
    legend.hidden = !hasLimited

    renderTrackList()
    playerContent.hidden = false
    restoreSequence()
  } catch (error) {
    console.error('[track-player] failed to load tracks', error)
    statusLoading.hidden = true
    statusError.textContent = 'Tracks are unavailable right now.'
    statusError.hidden = false
  }
}

// ── track list rendering ──────────────────────────────────

function renderTrackList() {
  trackList.innerHTML = ''
  for (const track of tracks) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'track-player__track'
    if (track.limited) button.classList.add('is-limited')
    button.setAttribute('role', 'listitem')
    button.innerHTML = `
      <span class="track-player__track-name">${track.limited ? '<span class="track-player__track-dot"></span>' : ''}${escapeHtml(track.title)}</span>
      <span class="track-player__track-path">${escapeHtml(track.file)}</span>
    `
    button.addEventListener('click', () => selectTrack(track))
    button._track = track
    trackList.appendChild(button)
  }
}

function updateActiveTrack() {
  for (const button of trackList.children) {
    button.classList.toggle('is-active', button._track === currentTrack)
  }
}

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

// ── track selection ───────────────────────────────────────

function selectTrack(track, autoplay = true) {
  cancelNoSignalTimer()
  noSignal.hidden = true
  currentTrack = track
  shouldAutoplay = autoplay
  selectedTitle.textContent = track.title
  selectedFile.textContent = track.file
  audio.src = track.src
  audio.load()
  updateActiveTrack()
  if (autoplay) attemptPlayWithGestureFallback()
}

// ── autoplay sequence logic ───────────────────────────────

function restoreSequence() {
  const episodeOne = tracks[0] ?? null
  const prequel = tracks.find(t => t.title === 'Prequel') ?? tracks[tracks.length - 1] ?? null
  const state = readSequenceState()

  if (!episodeOne) return

  if (!state.episodeOneCompleted) {
    selectTrack(episodeOne, true)
    return
  }

  if (prequel && !state.prequelCompleted) {
    selectTrack(episodeOne, false)
    startNoSignalTransition(prequel)
    return
  }

  selectTrack(prequel ?? episodeOne, false)
}

function onTrackEnded() {
  if (!currentTrack) return

  const episodeOne = tracks[0] ?? null
  const prequel = tracks.find(t => t.title === 'Prequel') ?? tracks[tracks.length - 1] ?? null

  if (episodeOne && currentTrack.file === episodeOne.file) {
    const nextState = { ...readSequenceState(), episodeOneCompleted: true }
    writeSequenceState(nextState)

    if (prequel && !nextState.prequelCompleted) {
      startNoSignalTransition(prequel)
    } else {
      shouldAutoplay = false
    }
    return
  }

  if (prequel && currentTrack.file === prequel.file) {
    writeSequenceState({
      ...readSequenceState(),
      episodeOneCompleted: true,
      prequelCompleted: true,
    })
    shouldAutoplay = false

    // Auto-advance to next track in list
    const currentIndex = tracks.indexOf(currentTrack)
    const nextTrack = tracks[currentIndex + 1]
    if (nextTrack) {
      selectTrack(nextTrack, true)
      return
    }
  }

  // Default: advance to next track
  const currentIndex = tracks.indexOf(currentTrack)
  const nextTrack = tracks[currentIndex + 1]
  if (nextTrack) {
    selectTrack(nextTrack, true)
  }
}

// ── no-signal transition ──────────────────────────────────

function startNoSignalTransition(nextTrack) {
  cancelNoSignalTimer()
  shouldAutoplay = false
  noSignal.hidden = false
  noSignalTimer = setTimeout(() => {
    noSignalTimer = null
    beginTrackPlayback(nextTrack)
  }, NO_SIGNAL_DURATION_MS)
}

function beginTrackPlayback(track) {
  cancelNoSignalTimer()
  noSignal.hidden = true
  selectTrack(track, true)
}

function cancelNoSignalTimer() {
  if (!noSignalTimer) return
  clearTimeout(noSignalTimer)
  noSignalTimer = null
}

skipNoSignal.addEventListener('click', () => {
  const prequel = tracks.find(t => t.title === 'Prequel') ?? tracks[tracks.length - 1] ?? null
  if (prequel) beginTrackPlayback(prequel)
})

// ── playback controls ─────────────────────────────────────

function updatePlayButton() {
  const isPlaying = !audio.paused
  iconPlay.hidden = isPlaying
  iconPause.hidden = !isPlaying
  playBtn.setAttribute('aria-label', isPlaying ? 'pause' : 'play')
}

playBtn.addEventListener('click', () => {
  if (audio.paused) audio.play().catch(() => {})
  else audio.pause()
})

audio.addEventListener('play', updatePlayButton)
audio.addEventListener('pause', updatePlayButton)
audio.addEventListener('ended', () => {
  updatePlayButton()
  onTrackEnded()
})

audio.addEventListener('loadedmetadata', () => {
  scrub.setAttribute('aria-valuemax', audio.duration)
})

audio.addEventListener('timeupdate', () => {
  if (dragging) return
  const pct = audio.duration > 0 ? (audio.currentTime / audio.duration) * 100 : 0
  progressBar.style.width = pct + '%'
  thumb.style.left = pct + '%'
  scrub.setAttribute('aria-valuenow', audio.currentTime)
})

audio.addEventListener('progress', () => {
  if (audio.buffered.length > 0) {
    const buffEnd = audio.buffered.end(audio.buffered.length - 1)
    const pct = audio.duration > 0 ? (buffEnd / audio.duration) * 100 : 0
    bufferedBar.style.width = pct + '%'
  }
})

// ── scrub interaction ─────────────────────────────────────

function seekFromEvent(event) {
  const rect = scrub.getBoundingClientRect()
  if (rect.width <= 0) return
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  const next = ratio * (audio.duration || 0)
  audio.currentTime = next
  const pct = audio.duration > 0 ? (next / audio.duration) * 100 : 0
  progressBar.style.width = pct + '%'
  thumb.style.left = pct + '%'
}

scrub.addEventListener('pointerdown', (e) => {
  scrub.setPointerCapture(e.pointerId)
  dragging = true
  seekFromEvent(e)
})

scrub.addEventListener('pointermove', (e) => {
  if (dragging) seekFromEvent(e)
})

scrub.addEventListener('pointerup', (e) => {
  if (!dragging) return
  try { scrub.releasePointerCapture(e.pointerId) } catch {}
  seekFromEvent(e)
  dragging = false
})

scrub.addEventListener('pointercancel', (e) => {
  if (!dragging) return
  try { scrub.releasePointerCapture(e.pointerId) } catch {}
  dragging = false
})

// ── keyboard support ──────────────────────────────────────

document.getElementById('audioPlayer').addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Spacebar') {
    e.preventDefault()
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    audio.currentTime = Math.max(0, audio.currentTime - 5)
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5)
  }
})

// ── autoplay with gesture fallback ────────────────────────

function attemptPlayWithGestureFallback() {
  removeGestureFallback()

  gestureHandler = () => {
    audio.play().catch(() => {})
    removeGestureFallback()
  }
  window.addEventListener('pointerdown', gestureHandler, { once: true })
  window.addEventListener('keydown', gestureHandler, { once: true })

  audio.play().then(() => {
    removeGestureFallback()
  }).catch(() => {
    // autoplay blocked — gesture fallback remains armed
  })
}

function removeGestureFallback() {
  if (!gestureHandler) return
  window.removeEventListener('pointerdown', gestureHandler)
  window.removeEventListener('keydown', gestureHandler)
  gestureHandler = null
}

// ── localStorage persistence ──────────────────────────────

function readSequenceState() {
  try {
    const raw = localStorage.getItem(TRACK_SEQUENCE_KEY)
    if (!raw) return { episodeOneCompleted: false, prequelCompleted: false }
    const parsed = JSON.parse(raw)
    return {
      episodeOneCompleted: parsed.episodeOneCompleted === true,
      prequelCompleted: parsed.prequelCompleted === true,
    }
  } catch {
    return { episodeOneCompleted: false, prequelCompleted: false }
  }
}

function writeSequenceState(state) {
  localStorage.setItem(TRACK_SEQUENCE_KEY, JSON.stringify(state))
}

// ── boot ──────────────────────────────────────────────────

loadTracks()
