// hypercomb-legacy/src/app/interactivity/interaction.state.ts

// ─────────────────────────────────────────────
// application / routing layer (ephemeral)
// ─────────────────────────────────────────────

export type AppMode =
  | { kind: 'world' }
  | { kind: 'editor'; editorId?: string }
  | { kind: 'viewer' }


// ─────────────────────────────────────────────
// viewer surface (presentation execution only)
// source of truth lives elsewhere
// ─────────────────────────────────────────────

export type ViewerType =
  | 'youtube'
  | 'document'
  | 'opfs'
  | 'photo'

// ─────────────────────────────────────────────
// input primitives
// ─────────────────────────────────────────────

export type PointerDevice = 'mouse' | 'touch' | 'pen'

// ─────────────────────────────────────────────
// keyboard focus (ephemeral)
// ─────────────────────────────────────────────

export type KeyboardFocus =
  | { kind: 'shortcuts' }
  | { kind: 'text'; targetId: string }
  | { kind: 'none' }

// ─────────────────────────────────────────────
// world-level interaction (ephemeral)
// ─────────────────────────────────────────────

export type WorldGesture =
  | { kind: 'idle' }
  | { kind: 'pan'; device: PointerDevice }
  | { kind: 'zoom'; method: 'wheel' | 'pinch' | 'keys' | 'program' }
  | { kind: 'drag-tile'; tileId: string; device: PointerDevice }  
  | { kind: 'select'; device: PointerDevice }

// ─────────────────────────────────────────────
// editor interaction (ephemeral)
// reacts to shared intent, never owns it
// ─────────────────────────────────────────────

export type EditorGesture =
  | { kind: 'idle' }
  | { kind: 'pan-canvas'; device: PointerDevice }
  | { kind: 'zoom-canvas'; method: 'wheel' | 'pinch' | 'keys' | 'program' }
  | { kind: 'edit-text'; targetId: string }
  | { kind: 'drag-item'; itemId: string; device: PointerDevice }
  | {
      kind: 'drag-handle'
      handle: 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
      device: PointerDevice
    }

// ─────────────────────────────────────────────
// environment / execution conditions
// toggles, not intent
// ─────────────────────────────────────────────

export interface Conditions {
  snap: boolean
  grid: boolean
  debug: boolean
}

// ─────────────────────────────────────────────
// root interaction state
// execution-only, never semantic truth
// ─────────────────────────────────────────────

export interface InteractionState {
  // routing / surface
  appMode: AppMode

  // viewer execution (visibility & surface only)
  viewer: {
    visible: boolean
    surface: ViewerType | null
  }

  // keyboard capture
  keyboardFocus: KeyboardFocus

  // environment flags
  conditions: Conditions

  // world execution
  world: {
    gesture: WorldGesture
    camera: {
      x: number
      y: number
      zoom: number
    }
  }

  // editor execution
  editor: {
    gesture: EditorGesture
    camera: {
      x: number
      y: number
      zoom: number
    }
  }

  // physical selection presence only
  selection: {
    active: boolean
  }
}
