// keymap.ts — type definitions for the layered keyboard shortcut system
//
// Shortcuts are discrete command dispatchers. They coexist with continuous
// inputs (zoom, pan) without interference — different interaction types,
// different isolation patterns.

// -------------------------------------------------
// chord: a single key press with optional modifiers
// -------------------------------------------------

export interface KeyChord {
  key: string              // normalized lowercase: 'a', 'space', 'escape', 'enter', 'delete', 'tab', etc.
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
  primary?: boolean        // platform-aware: Cmd on Mac, Ctrl elsewhere
}

// -------------------------------------------------
// binding: maps a key sequence to a command
// -------------------------------------------------

export interface KeyBinding {
  cmd: string              // e.g. 'tile.branch', 'navigation.fullscreen'
  sequence: KeyChord[][]   // outer = sequence steps, inner = simultaneous keys per step
  description?: string
  category?: string
  risk?: 'none' | 'warning' | 'danger'
  pierce?: boolean         // if true, fires even when suppressed (escape, emergency commands)
}

// -------------------------------------------------
// layer: a named, prioritized set of bindings
// -------------------------------------------------

export interface KeyMapLayer {
  id: string               // e.g. 'global', 'default', 'notes-context', 'user-overrides'
  priority: number         // higher wins for duplicate cmd across layers
  bindings: KeyBinding[]
}
