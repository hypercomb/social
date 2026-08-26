// voice-input.service.ts (moved down from hypercomb-shared in the
// everything-is-a-beehavior Phase 1 — contract in core voice-input.types.ts)
// Speech recognition via Web Speech API.
// Emits EffectBus events: voice:interim, voice:final, voice:active, voice:error
// Activated via /voice slash behaviour, mic button in controls bar, or mic button in command line.

import { EffectBus, VOICE_INPUT_KEY, voiceInputSupported, type VoiceInputProvider } from '@hypercomb/core'

export class VoiceInputService extends EventTarget implements VoiceInputProvider {

  #recognition: any = null
  #active = false
  #finalText = ''
  #interimText = ''
  #carriedText = ''
  #wantActive = false

  static supported(): boolean { return voiceInputSupported() }

  get active(): boolean { return this.#active }

  /** Toggle voice input on/off. */
  toggle(): void {
    if (this.#active) {
      this.stop()
    } else {
      this.start()
    }
  }

  start(): void {
    if (this.#active) return
    if (!VoiceInputService.supported()) return

    const SpeechRecognition: any =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition

    this.#recognition = new SpeechRecognition()
    this.#recognition.continuous = true
    this.#recognition.interimResults = true
    this.#recognition.lang = 'en-US'
    this.#recognition.maxAlternatives = 1

    this.#finalText = ''
    this.#interimText = ''
    this.#carriedText = ''
    this.#wantActive = true

    this.#recognition.onstart = () => {
      this.#active = true
      EffectBus.emit('voice:active', { active: true })
      this.dispatchEvent(new CustomEvent('change'))
    }

    this.#recognition.onresult = (event: any) => {
      let interim = ''
      let final = ''

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          final += result[0].transcript
        } else {
          interim += result[0].transcript
        }
      }

      if (final) {
        this.#finalText = final
      }
      this.#interimText = interim

      // emit interim for live preview (final + current interim)
      const preview = (this.#carriedText + ' ' + this.#finalText + ' ' + interim).trim()
      if (preview) {
        EffectBus.emit('voice:interim', { text: preview })
      }
    }

    this.#recognition.onerror = (event: any) => {
      // 'no-speech' and 'aborted' are expected during normal use
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        EffectBus.emit('voice:error', { message: event.error })
      }
    }

    this.#recognition.onend = () => {
      // auto-restart if user is still holding the button (speech API times out after silence)
      if (this.#wantActive) {
        // The API ends a session on its own after a silence. Its results
        // list restarts empty, so carry what was said before the restart
        // or the first half of a long dictation is lost.
        this.#carriedText = (this.#carriedText + ' ' + this.#finalText + ' ' + this.#interimText).trim()
        this.#finalText = ''
        this.#interimText = ''
        try {
          this.#recognition.start()
        } catch {
          this.#cleanup()
        }
        return
      }
      this.#cleanup()
    }

    try {
      this.#recognition.start()
    } catch {
      this.#cleanup()
    }
  }

  stop(): void {
    this.#wantActive = false
    if (!this.#recognition) return

    try {
      this.#recognition.stop()
    } catch {
      // already stopped
    }

    // emit final text immediately — don't wait for onend.
    // Web Speech API may not have promoted interim → final yet, so fall
    // back to the current interim so the user's last utterance isn't lost.
    // release = cue to submit, so emit voice:submit for auto-execution.
    const text = (this.#carriedText + ' ' + this.#finalText + ' ' + this.#interimText).trim()
    if (text) {
      EffectBus.emit('voice:final', { text })
      EffectBus.emit('voice:submit', { text })
    }

    this.#cleanup()
  }

  #cleanup(): void {
    this.#active = false
    this.#wantActive = false
    this.#carriedText = ''
    this.#recognition = null
    EffectBus.emit('voice:active', { active: false })
    this.dispatchEvent(new CustomEvent('change'))
  }
}

export const voiceInputService = new VoiceInputService()

/** Re-assert into the LIVE IoC map (the llm-provider-registry lesson). */
export const ensureVoiceInputRegistered = (): void => {
  if (!window.ioc?.has?.(VOICE_INPUT_KEY)) {
    window.ioc?.register?.(VOICE_INPUT_KEY, voiceInputService)
  }
}
ensureVoiceInputRegistered()
