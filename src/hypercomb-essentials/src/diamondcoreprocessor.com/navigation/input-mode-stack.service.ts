// diamondcoreprocessor.com/navigation/input-mode-stack.service.ts
//
// Single-active input-mode stack. Modes are pushed/popped; only the
// top-of-stack mode has its listeners mounted. Transitions mechanically
// mount/unmount listener sets — replaces the cooperative-veto InputGate
// pattern for any input system that migrates onto the stack.
//
// Architectural model: input is one-of, not many. When mode A is on top,
// A's listeners are mounted; when B is pushed above A, A unmounts and B
// mounts; when B pops, A re-mounts. No cooperative checks, no veto
// negotiation — the listeners simply aren't attached when the mode
// isn't active.
//
// IoC key: @diamondcoreprocessor.com/InputModeStack
//
// Other input systems (pan, touch, editor) still use InputGate for now;
// they can migrate to the stack incrementally as the pattern proves out.

export type InputMode = {
  /** Unique identifier — used for pop and remove. */
  readonly name: string
  /** Called when this mode becomes the active top of the stack. */
  mount(): void
  /** Called when this mode is no longer the active top of the stack
   *  (either because something was pushed above it, or it was popped). */
  unmount(): void
}

export class InputModeStack extends EventTarget {
  #stack: InputMode[] = []

  /** Current active mode name (top of stack), or null if empty. */
  get active(): string | null {
    return this.#stack[this.#stack.length - 1]?.name ?? null
  }

  /** Push a mode onto the stack. Unmounts the current top (if any) and
   *  mounts the new mode. The new mode becomes the active one. */
  push = (mode: InputMode): void => {
    if (this.#stack.length > 0) {
      this.#stack[this.#stack.length - 1].unmount()
    }
    this.#stack.push(mode)
    mode.mount()
    this.dispatchEvent(new CustomEvent('change'))
  }

  /** Pop the top mode if it matches the given name. Unmounts it and
   *  re-mounts whatever is now on top. No-op if name mismatches —
   *  this is the safety net against pop-without-push or double-pop. */
  pop = (name: string): void => {
    if (this.#stack.length === 0) return
    const top = this.#stack[this.#stack.length - 1]
    if (top.name !== name) return
    top.unmount()
    this.#stack.pop()
    if (this.#stack.length > 0) {
      this.#stack[this.#stack.length - 1].mount()
    }
    this.dispatchEvent(new CustomEvent('change'))
  }

  /** Forced removal by name regardless of position in the stack. If the
   *  removed mode was the active top, unmount it and re-mount the new top.
   *  Useful for teardown (component disposed while its mode was still
   *  pushed, or escape-cascade-style emergency cleanup). */
  remove = (name: string): void => {
    const idx = this.#stack.findIndex(m => m.name === name)
    if (idx === -1) return
    const wasTop = idx === this.#stack.length - 1
    if (wasTop) this.#stack[idx].unmount()
    this.#stack.splice(idx, 1)
    if (wasTop && this.#stack.length > 0) {
      this.#stack[this.#stack.length - 1].mount()
    }
    this.dispatchEvent(new CustomEvent('change'))
  }
}

window.ioc.register('@diamondcoreprocessor.com/InputModeStack', new InputModeStack())
