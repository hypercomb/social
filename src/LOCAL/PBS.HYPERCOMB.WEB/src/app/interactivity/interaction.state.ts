// -----------------------------
// app scope
// -----------------------------
export type AppMode =
  | { kind: 'world' }
  | { kind: 'editor'; editorId: string }

// -----------------------------
// input & focus
// -----------------------------
export type PointerDevice = 'mouse' | 'touch' | 'pen'

export type KeyboardFocus =
  | { kind: 'shortcuts' }
  | { kind: 'text'; targetId: string }
  | { kind: 'none' }

// -----------------------------
// world interactions
// -----------------------------
export type WorldGesture =
  | { kind: 'idle' }
  | { kind: 'pan'; device: PointerDevice }
  | { kind: 'zoom'; method: 'wheel' | 'pinch' | 'keys' | 'program' }
  | { kind: 'drag-tile'; tileId: string; device: PointerDevice }
  | { kind: 'select'; device: PointerDevice }

// -----------------------------
// editor interactions
// -----------------------------
export type EditorTool =
  | { kind: 'select' }
  | { kind: 'text' }
  | { kind: 'move' }
  | { kind: 'resize' }
  | { kind: 'paint' }

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

// -----------------------------
// orthogonal conditions
// -----------------------------
export interface Conditions {
  snap: boolean
  grid: boolean
  debug: boolean
}

// -----------------------------
// full app state
// -----------------------------
export interface AppState {
  appMode: AppMode
  keyboardFocus: KeyboardFocus
  conditions: Conditions

  world: {
    gesture: WorldGesture
    camera: { x: number; y: number; zoom: number }
  }

  editor: {
    tool: EditorTool
    gesture: EditorGesture
    camera: { x: number; y: number; zoom: number }
  }
}

// -----------------------------
// derived helpers (pure)
// -----------------------------
export const inEditor = (s: AppState): boolean =>
  s.appMode.kind === 'editor'

export const typing = (s: AppState): boolean =>
  s.keyboardFocus.kind === 'text'

export const allowWorldInput = (s: AppState): boolean =>
  !inEditor(s)

export const allowEditorInput = (s: AppState): boolean =>
  inEditor(s)

export const allowShortcuts = (s: AppState): boolean =>
  s.keyboardFocus.kind === 'shortcuts'
