// diamondcoreprocessor.com/recording/recording.drone.ts

import { Drone, EffectBus } from '@hypercomb/core'
import {
  type RecordingState, type RecordingConfig,
  type MeetingStreamReadyPayload, type TranscriptSegment,
  DEFAULT_RECORDING_CONFIG,
} from './recording.types.js'
import { WebSpeechTranscriptionProvider } from './transcription.provider.js'

// ── bridge protocol ─────────────────────────────────────────

const BRIDGE_PORT = 2401

type BridgeResponse = { id: string; ok: boolean; data?: unknown; error?: string }

// ── recording drone ─────────────────────────────────────────

export class RecordingDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'recording'
  override description = 'Transcribes speech in real-time and feeds transcript to the Claude bridge for live hierarchy building'

  protected override deps = {}

  protected override listens = ['meeting:stream-ready', 'recording:toggle', 'recording:configure']
  protected override emits = ['recording:started', 'recording:stopped', 'recording:transcript-update']

  #effectsRegistered = false
  #config: RecordingConfig = { ...DEFAULT_RECORDING_CONFIG }
  #state: RecordingState | null = null
  #transcription = new WebSpeechTranscriptionProvider()
  #sendTimer: ReturnType<typeof setInterval> | null = null
  #ws: WebSocket | null = null
  #msgId = 0

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    // also accept meeting streams — add their audio to transcription
    this.onEffect<MeetingStreamReadyPayload>('meeting:stream-ready', (payload) => {
      if (this.#state?.active) {
        this.#transcription.start(payload.stream, payload.peerId, `speaker-${payload.peerId.slice(0, 6)}`)
      }
    })

    this.onEffect<{ cell?: string }>('recording:toggle', () => {
      if (this.#state?.active) {
        void this.#stopRecording()
      } else {
        void this.#startRecording()
      }
    })

    this.onEffect<Partial<RecordingConfig>>('recording:configure', (payload) => {
      if (payload.compileIntervalMs !== undefined) {
        this.#config.compileIntervalMs = payload.compileIntervalMs

        // restart timer if active
        if (this.#state?.active && this.#sendTimer) {
          clearInterval(this.#sendTimer)
          this.#sendTimer = setInterval(() => void this.#sendTranscriptBatch(), this.#config.compileIntervalMs)
        }
      }
      console.log('[recording] Config updated:', this.#config)
    })
  }

  // ── start recording (standalone mic) ────────────────────

  async #startRecording(): Promise<void> {
    if (this.#state?.active) return

    // grab mic
    let localStream: MediaStream
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      })
    } catch (e) {
      console.warn('[recording] Microphone access denied:', e)
      return
    }

    // connect to bridge
    this.#ws = this.#connectBridge()

    // initialize state
    this.#state = {
      active: true,
      localStream,
      segments: [],
      lastSentIndex: 0,
      startedAt: Date.now(),
    }

    // wire up transcription
    this.#transcription.onSegment = (segment: TranscriptSegment) => {
      if (!this.#state) return
      if (segment.isFinal) {
        this.#state.segments.push(segment)
      }
      EffectBus.emitTransient('recording:transcript-update', {
        text: segment.text,
        isFinal: segment.isFinal,
      })
    }

    // start transcribing local mic
    this.#transcription.start(localStream, 'local', 'you')

    // start interval timer to push transcript batches to the bridge
    this.#sendTimer = setInterval(
      () => void this.#sendTranscriptBatch(),
      this.#config.compileIntervalMs,
    )

    EffectBus.emit('recording:started', {})
    console.log(`[recording] Started — interval ${this.#config.compileIntervalMs / 1000}s`)
  }

  // ── bridge connection ───────────────────────────────────

  #connectBridge(): WebSocket | null {
    try {
      const ws = new WebSocket(`ws://localhost:${BRIDGE_PORT}`)
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'recorder' }))
        console.log('[recording] Bridge connected')
      }
      ws.onclose = () => console.log('[recording] Bridge disconnected')
      ws.onerror = () => { /* onclose handles it */ }
      return ws
    } catch {
      console.warn('[recording] Bridge not available at localhost:' + BRIDGE_PORT)
      return null
    }
  }

  #sendBridge(op: string, data: Record<string, unknown>): void {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) return
    const id = `rec-${++this.#msgId}`
    this.#ws.send(JSON.stringify({ id, op, ...data }))
  }

  // ── send transcript batch to bridge ─────────────────────

  async #sendTranscriptBatch(): Promise<void> {
    if (!this.#state?.active) return

    const newSegments = this.#state.segments.slice(this.#state.lastSentIndex)
    if (newSegments.length === 0) return

    this.#state.lastSentIndex = this.#state.segments.length

    // format transcript for the bridge
    const transcript = newSegments
      .map(s => `[${new Date(s.timestamp).toLocaleTimeString()}] ${s.speakerLabel}: ${s.text}`)
      .join('\n')

    this.#sendBridge('transcript', {
      transcript,
      segmentCount: newSegments.length,
      totalSegments: this.#state.segments.length,
      elapsedMs: Date.now() - this.#state.startedAt,
    })

    console.log(`[recording] Sent ${newSegments.length} segments to bridge`)
  }

  // ── stop recording ──────────────────────────────────────

  async #stopRecording(): Promise<void> {
    if (!this.#state) return

    const duration = Date.now() - this.#state.startedAt

    // send final batch
    await this.#sendTranscriptBatch()

    // stop timer
    if (this.#sendTimer) {
      clearInterval(this.#sendTimer)
      this.#sendTimer = null
    }

    // stop transcription
    this.#transcription.stopAll()
    this.#transcription.onSegment = null

    // stop mic
    if (this.#state.localStream) {
      for (const track of this.#state.localStream.getTracks()) track.stop()
    }

    // notify bridge that recording ended
    this.#sendBridge('transcript-end', {
      totalSegments: this.#state.segments.length,
      durationMs: duration,
    })

    // close bridge
    if (this.#ws) {
      this.#ws.close()
      this.#ws = null
    }

    this.#state = null

    EffectBus.emit('recording:stopped', { duration })
    console.log(`[recording] Stopped. Duration: ${Math.round(duration / 1000)}s`)
  }
}

const _recording = new RecordingDrone()
window.ioc.register('@diamondcoreprocessor.com/RecordingDrone', _recording)
