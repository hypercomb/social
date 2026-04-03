// hypercomb-shared/core/voice-input.service.ts
// Speech recognition via Web Speech API.
// Emits EffectBus events: voice:interim, voice:final, voice:active, voice:error
// Activated via /voice slash behaviour, mic button in controls bar, or mic button in command line.

import { EffectBus } from '@hypercomb/core'

export class VoiceInputService extends EventTarget {

  #recognition: any = null
  #active = false
  #finalText = ''
  #wantActive = false

  static supported(): boolean {
    return !!(
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition
    )
  }

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

      // emit interim for live preview (final + current interim)
      const preview = (this.#finalText + ' ' + interim).trim()
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

    // emit final text immediately — don't wait for onend
    // release = cue to submit, so emit voice:submit for auto-execution
    const text = this.#finalText.trim()
    if (text) {
      EffectBus.emit('voice:final', { text })
      EffectBus.emit('voice:submit', { text })
    }

    this.#cleanup()
  }

  #cleanup(): void {
    this.#active = false
    this.#wantActive = false
    this.#recognition = null
    EffectBus.emit('voice:active', { active: false })
    this.dispatchEvent(new CustomEvent('change'))
  }
}

const _voiceInput = new VoiceInputService()
window.ioc.register('@hypercomb.social/VoiceInputService', _voiceInput)
