// hypercomb-shared/core/voice-input.service.ts
// Speech recognition via Web Speech API.
// Emits EffectBus events: voice:interim, voice:final, voice:active, voice:error
// Activated via /voice slash behaviour, mic button in controls bar, or mic button in command line.

import { EffectBus } from '@hypercomb/core'

/**
 * What a spoken line becomes before anything reads it.
 *
 * The recognizer writes PROSE — sentence case, proper-noun capitals, and a
 * closing full stop — and none of that was said out loud. The full stop is
 * the expensive one: the command line reads a line carrying a '.' as being
 * in DOT style (the register cell paths use), so "open providers." made the
 * completion render itself back as "open.providers." and matched nothing.
 * The capitals broke word matching on their own.
 *
 * So: folded to lowercase, whitespace collapsed, and sentence-final
 * punctuation trimmed. Punctuation INSIDE the utterance is left alone — a
 * dictated note is allowed to have commas.
 */
const spokenLine = (text: string): string =>
  text.replace(/\s+/g, ' ').trim().replace(/[.,!?;:]+$/, '').trim().toLowerCase()

export class VoiceInputService extends EventTarget {

  #recognition: any = null
  #active = false
  #finalText = ''
  #interimText = ''
  #carriedText = ''
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
      const preview = spokenLine(this.#carriedText + ' ' + this.#finalText + ' ' + interim)
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
    const text = spokenLine(this.#carriedText + ' ' + this.#finalText + ' ' + this.#interimText)
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

const _voiceInput = new VoiceInputService()
window.ioc.register('@hypercomb.social/VoiceInputService', _voiceInput)
