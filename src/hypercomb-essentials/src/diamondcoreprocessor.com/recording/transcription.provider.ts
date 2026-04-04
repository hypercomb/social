// diamondcoreprocessor.com/recording/transcription.provider.ts

import type { TranscriptionProvider, TranscriptSegment } from './recording.types.js'

// ── Web Speech API transcription ────────────────────────────

type SpeechRecognitionInstance = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionEvent = {
  resultIndex: number
  results: {
    length: number
    [index: number]: {
      isFinal: boolean
      [index: number]: { transcript: string }
      length: number
    }
  }
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  const w = globalThis as unknown as Record<string, unknown>
  return (w['SpeechRecognition'] ?? w['webkitSpeechRecognition'] ?? null) as SpeechRecognitionConstructor | null
}

// ── provider: one SpeechRecognition per peer stream ─────────

export class WebSpeechTranscriptionProvider implements TranscriptionProvider {
  #recognizers = new Map<string, SpeechRecognitionInstance>()
  #labels = new Map<string, string>()
  #active = new Map<string, boolean>()
  onSegment: ((segment: TranscriptSegment) => void) | null = null

  start(stream: MediaStream, peerId: string, label: string): void {
    if (this.#recognizers.has(peerId)) return

    const SpeechRecognition = getSpeechRecognition()
    if (!SpeechRecognition) {
      console.warn('[transcription] Web Speech API not available')
      return
    }

    this.#labels.set(peerId, label)

    const recognizer = new SpeechRecognition()
    recognizer.continuous = true
    recognizer.interimResults = true
    recognizer.lang = document.documentElement.lang || 'en-US'

    recognizer.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0]?.transcript?.trim()
        if (!transcript) continue

        this.onSegment?.({
          peerId,
          speakerLabel: this.#labels.get(peerId) ?? peerId.slice(0, 8),
          text: transcript,
          timestamp: Date.now(),
          isFinal: result.isFinal,
        })
      }
    }

    recognizer.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return
      console.warn(`[transcription] ${peerId}: ${event.error}`)
    }

    recognizer.onend = () => {
      // auto-restart if still active
      if (this.#active.get(peerId)) {
        try { recognizer.start() } catch { /* already started */ }
      }
    }

    this.#recognizers.set(peerId, recognizer)
    this.#active.set(peerId, true)

    try {
      recognizer.start()
    } catch (e) {
      console.warn(`[transcription] Failed to start for ${peerId}:`, e)
    }
  }

  stop(peerId: string): void {
    this.#active.set(peerId, false)
    const recognizer = this.#recognizers.get(peerId)
    if (recognizer) {
      try { recognizer.abort() } catch { /* already stopped */ }
      this.#recognizers.delete(peerId)
    }
    this.#labels.delete(peerId)
    this.#active.delete(peerId)
  }

  stopAll(): void {
    for (const peerId of [...this.#recognizers.keys()]) {
      this.stop(peerId)
    }
  }
}

// ── provider: chunked audio via MediaRecorder ───────────────
// Fallback for remote peer streams where Web Speech API cannot
// access the audio directly. Accumulates chunks and calls an
// external transcription callback.

export type AudioChunkHandler = (
  peerId: string,
  label: string,
  audioBlob: Blob,
) => Promise<string>

export class ChunkedAudioTranscriptionProvider implements TranscriptionProvider {
  #recorders = new Map<string, MediaRecorder>()
  #labels = new Map<string, string>()
  #chunkHandler: AudioChunkHandler
  onSegment: ((segment: TranscriptSegment) => void) | null = null

  constructor(chunkHandler: AudioChunkHandler) {
    this.#chunkHandler = chunkHandler
  }

  start(stream: MediaStream, peerId: string, label: string): void {
    if (this.#recorders.has(peerId)) return
    this.#labels.set(peerId, label)

    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) {
      console.warn(`[transcription-chunked] No audio tracks for ${peerId}`)
      return
    }

    const audioStream = new MediaStream(audioTracks)
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'

    const recorder = new MediaRecorder(audioStream, { mimeType })

    recorder.ondataavailable = (event) => {
      if (event.data.size === 0) return
      void this.#processChunk(peerId, event.data)
    }

    this.#recorders.set(peerId, recorder)
    recorder.start(5000) // 5-second chunks
  }

  async #processChunk(peerId: string, audioBlob: Blob): Promise<void> {
    const label = this.#labels.get(peerId) ?? peerId.slice(0, 8)

    try {
      const text = await this.#chunkHandler(peerId, label, audioBlob)
      if (!text.trim()) return

      this.onSegment?.({
        peerId,
        speakerLabel: label,
        text: text.trim(),
        timestamp: Date.now(),
        isFinal: true,
      })
    } catch (e) {
      console.warn(`[transcription-chunked] Chunk processing failed for ${peerId}:`, e)
    }
  }

  stop(peerId: string): void {
    const recorder = this.#recorders.get(peerId)
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop() } catch { /* already stopped */ }
    }
    this.#recorders.delete(peerId)
    this.#labels.delete(peerId)
  }

  stopAll(): void {
    for (const peerId of [...this.#recorders.keys()]) {
      this.stop(peerId)
    }
  }
}
