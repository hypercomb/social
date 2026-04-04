// diamondcoreprocessor.com/recording/recording.types.ts

// ── transcript segment (emitted per utterance) ──────────────

export type TranscriptSegment = {
  peerId: string
  speakerLabel: string
  text: string
  timestamp: number
  isFinal: boolean
}

// ── recording configuration ─────────────────────────────────

export type RecordingConfig = {
  compileIntervalMs: number
}

export const DEFAULT_RECORDING_CONFIG: RecordingConfig = {
  compileIntervalMs: 30_000,
}

// ── recording session state ─────────────────────────────────

export type RecordingState = {
  active: boolean
  localStream: MediaStream | null
  segments: TranscriptSegment[]
  lastSentIndex: number
  startedAt: number
}

// ── transcription provider interface ────────────────────────

export interface TranscriptionProvider {
  start(stream: MediaStream, peerId: string, label: string): void
  stop(peerId: string): void
  stopAll(): void
  onSegment: ((segment: TranscriptSegment) => void) | null
}

// ── effect payloads ─────────────────────────────────────────

export type MeetingStreamReadyPayload = {
  cell: string
  slot: number
  stream: MediaStream
  peerId: string
}
