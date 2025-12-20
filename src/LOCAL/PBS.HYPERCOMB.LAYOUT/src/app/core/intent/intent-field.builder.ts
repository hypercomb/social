// src/app/core/intent/intent-field.builder.ts

import { Injectable } from '@angular/core'
import {
  IntentFieldSnapshot,
  IntentParticle,
  IntentPlane
} from './models/intent-field.model'

// this builder is the *only* place where raw external input
// becomes a semantic intent field snapshot
@Injectable({ providedIn: 'root' })
export class IntentFieldBuilder {

  // entry point for raw user text
  public fromText = (text: string): IntentFieldSnapshot => {
    const normalized = this.normalize(text)

    const particles = this.tokenize(normalized)

    return {
      raw: text,
      normalized,
      particles,
      createdAt: Date.now()
    }
  }

  // ─────────────────────────────────────────────
  // normalization
  // ─────────────────────────────────────────────

  private normalize = (text: string): string => {
    return text
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
  }

  // ─────────────────────────────────────────────
  // tokenization → intent particles
  // ─────────────────────────────────────────────

  private tokenize = (text: string): IntentParticle[] => {
    const words = text.split(' ')

    return words.map((word, index) => ({
      index,
      value: word,
      plane: this.classifyPlane(word)
    }))
  }

  // ─────────────────────────────────────────────
  // plane classification (simple, evolvable)
  // ─────────────────────────────────────────────

  private classifyPlane = (token: string): IntentPlane => {
    // action verbs
    if (ACTION_WORDS.has(token)) return 'action'

    // focus / modifiers
    if (FOCUS_WORDS.has(token)) return 'focus'

    // default: object / target
    return 'object'
  }
}

// ─────────────────────────────────────────────
// simple vocab (replaceable later)
// ─────────────────────────────────────────────

const ACTION_WORDS = new Set<string>([
  'add',
  'remove',
  'open',
  'close',
  'create',
  'delete',
  'show',
  'hide',
  'rename',
  'move'
])

const FOCUS_WORDS = new Set<string>([
  'with',
  'without',
  'around',
  'inside',
  'named',
  'as'
])
