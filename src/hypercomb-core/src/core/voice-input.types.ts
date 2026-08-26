// voice-input.types.ts — speech input's module↔shell contract.
//
// The implementation lives in essentials (commands/voice-input.service.ts —
// activated via /voice, the mic buttons resolve it lazily). Support
// detection is a pure platform probe, so it lives here where chrome can ask
// it at field-init time with no instance.

export const VOICE_INPUT_KEY = '@hypercomb.social/VoiceInputService'

/** Web Speech API present? Pure probe — safe before any module loads. */
export function voiceInputSupported(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition)
}

export interface VoiceInputProvider {
  readonly active: boolean
  toggle(): void
  start(): void
  stop(): void
}
