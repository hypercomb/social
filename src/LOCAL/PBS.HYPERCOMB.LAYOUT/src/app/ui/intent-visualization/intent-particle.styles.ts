import { IntentParticle } from "../../core/intent/models/intent-field.model"

export function styleForParticle(p: IntentParticle) {
  switch (p.safetyClass) {
    case 'unsafe':
      return { color: '#ff4d4d', opacity: 0.9, pulse: true, border: 'solid' }
    case 'restricted':
      return { color: '#ffb84d', opacity: 0.7, pulse: false, border: 'dashed' }
    default:
      return { color: '#4dff88', opacity: 0.6, pulse: false, border: 'none' }
  }
}

