
export type ShortcutResult = boolean | void | Promise<boolean | void>
export type ShortcutHandler<T = unknown> = (ctx: T) => ShortcutResult

export interface IHandlerEntry<T = unknown> {
  cmd: string
  fn: ShortcutHandler<T>
  priority: number
}

export interface IShortcutKey {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
  primary?: boolean
  button?: number // optional for mouse shortcuts
}

/** config for a single shortcut */
export interface IShortcut<TPayload = unknown> {
  cmd: string
  description: string
  category?: string
  keys: IShortcutKey[][] // support for multi-step sequences
  global?: boolean

  risk?: 'none' | 'warning' | 'danger'
  riskNote?: string
  showRisk?: boolean

  /** optional payload injected into the ActionContext when invoked */
  payload?: TPayload
}

export interface IShortcutOverride {
  cmd: string
  keys: IShortcutKey[][]
}

export interface IShortcutBinding<T = any> {
  keys: string
  cmdId: string
  priority: number
  toPayload?: (ev: KeyboardEvent) => T
}


