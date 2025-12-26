// @hypercomb/core/src/intents/intent.ts

import { Effect } from "./effect.js"

export interface Intent {
  // identity
  signature: string

  // presentation
  title: string
  summary?: string
  description?: string

  // classification
  scope?: 'global' | 'contextual'
  implicit?: boolean

  // execution (optional)
  effects?: Effect[]

  // language surface
  grammar?: {
    example: string
    meaning?: string
  }[]

  // discovery / documentation
  links?: {
    label: string
    url: string
    trust?: 'official' | 'community'
    purpose?: string
  }[]
}
