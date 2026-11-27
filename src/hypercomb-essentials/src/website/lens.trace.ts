// website/lens.trace.ts
//
// WATCHING A PANEL DRAW. For as long as `run` takes, every element made, every
// property and attribute set, every class toggled, style set, listener added
// and node placed is recorded against the node it touched, with the line and
// column of the code that did it (read off the call stack). Then everything is
// put back exactly as it was.
//
// The trace changes nothing it watches: each wrapper calls the platform's own
// method with the same arguments and hands back what it returned. What it
// records is only kept for the nodes the lens asks about (lens.panel.ts reads
// the ones inside the panel), so code that happens to run alongside costs a
// few records and nothing else.
//
// Every wrapper's name starts `__lensTrace`, so the frame that called it is
// the next one down the stack. (Bees are built unminified; the names survive.)

export interface Site {
  readonly url: string
  readonly line: number
  readonly column: number
  /** The function the call was made from, as the stack names it: `#row`. */
  readonly fn: string
}

export type TraceOp =
  | { readonly kind: 'create'; readonly site: Site | null }
  | { readonly kind: 'set'; readonly name: string; readonly site: Site | null }
  | { readonly kind: 'attr'; readonly name: string; readonly site: Site | null }
  | { readonly kind: 'listen'; readonly name: string; readonly site: Site | null }
  | { readonly kind: 'style'; readonly name: string; readonly site: Site | null }
  | { readonly kind: 'class'; readonly name: string; readonly site: Site | null }

export interface Trace {
  /** What was done to each node, in order. */
  readonly ops: ReadonlyMap<Node, readonly TraceOp[]>
  /** Where each node was last put into its parent. */
  readonly placed: ReadonlyMap<Node, Site | null>
}

const MARK = '__lensTrace'
const FRAME = /at (?:(.*?) \()?((?:https?|blob|file|chrome-extension):.+?):(\d+):(\d+)\)?\s*$/

/** The caller of the first trace wrapper on a stack: the code that touched the node. */
export function siteOf(stack: string): Site | null {
  const lines = String(stack ?? '').split('\n')
  let mark = -1
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(MARK)) mark = i
  if (mark < 0) return null
  for (let i = mark + 1; i < lines.length; i++) {
    const frame = FRAME.exec(lines[i])
    if (!frame) continue
    const fn = (frame[1] ?? '').replace(/^async /, '').replace(/ \[as [^\]]+\]$/, '').replace(/^.*\.(#?[\w$]+)$/, '$1')
    return { url: frame[2], line: Number(frame[3]), column: Number(frame[4]), fn }
  }
  return null
}

/** Properties whose setters say what a node shows or how it behaves. */
const SETTERS: ReadonlyArray<[() => object | undefined, readonly string[]]> = [
  [() => globalThis.Node?.prototype, ['textContent']],
  [() => globalThis.Element?.prototype, ['className', 'id', 'innerHTML']],
  [() => globalThis.HTMLElement?.prototype, ['hidden', 'title', 'tabIndex', 'innerText', 'dir', 'lang']],
  [() => globalThis.HTMLButtonElement?.prototype, ['type', 'disabled', 'value', 'name']],
  [() => globalThis.HTMLInputElement?.prototype, ['type', 'disabled', 'value', 'checked', 'placeholder', 'name']],
  [() => globalThis.HTMLTextAreaElement?.prototype, ['disabled', 'value', 'placeholder']],
  [() => globalThis.HTMLSelectElement?.prototype, ['disabled', 'value']],
  [() => globalThis.HTMLImageElement?.prototype, ['src', 'alt']],
  [() => globalThis.HTMLAnchorElement?.prototype, ['href', 'target']],
  [() => globalThis.HTMLIFrameElement?.prototype, ['src', 'srcdoc']],
]

/**
 * Run `run` with the DOM watched, and hand back what it did. Whatever `run`
 * throws is thrown again, after everything is put back.
 */
export async function traceRender(run: () => unknown): Promise<Trace> {
  const ops = new Map<Node, TraceOp[]>()
  const placed = new Map<Node, Site | null>()
  const restore: Array<() => void> = []
  const styleOwner = new WeakMap<object, Element>()
  const classOwner = new WeakMap<object, Element>()

  const record = (node: unknown, op: TraceOp): void => {
    if (!(node instanceof Node)) return
    let list = ops.get(node)
    if (!list) ops.set(node, list = [])
    list.push(op)
  }
  const here = (): Site | null => {
    try { return siteOf(new Error().stack ?? '') } catch { return null }
  }

  const wrapMethod = (target: object | undefined, key: string, make: (original: (...args: unknown[]) => unknown) => (...args: unknown[]) => unknown): void => {
    if (!target) return
    const descriptor = Object.getOwnPropertyDescriptor(target, key)
    if (!descriptor || typeof descriptor.value !== 'function') return
    Object.defineProperty(target, key, { ...descriptor, value: make(descriptor.value) })
    restore.push(() => Object.defineProperty(target, key, descriptor))
  }
  const wrapSetter = (target: object | undefined, key: string, onSet: (self: unknown, value: unknown) => void): void => {
    if (!target) return
    const descriptor = Object.getOwnPropertyDescriptor(target, key)
    if (!descriptor?.set || !descriptor.configurable) return
    const set = descriptor.set
    Object.defineProperty(target, key, {
      ...descriptor,
      set: function __lensTraceSet(this: unknown, value: unknown) { try { onSet(this, value) } catch { /* watching never breaks the watched */ } set.call(this, value) },
    })
    restore.push(() => Object.defineProperty(target, key, descriptor))
  }
  const wrapGetter = (target: object | undefined, key: string, onGet: (self: unknown, value: unknown) => void): void => {
    if (!target) return
    const descriptor = Object.getOwnPropertyDescriptor(target, key)
    if (!descriptor?.get || !descriptor.configurable) return
    const get = descriptor.get
    Object.defineProperty(target, key, {
      ...descriptor,
      get: function __lensTraceGet(this: unknown) { const value = get.call(this); try { onGet(this, value) } catch { /* as above */ } return value },
    })
    restore.push(() => Object.defineProperty(target, key, descriptor))
  }

  // A declaration to find the style setters on, made before anything is watched.
  const sample = typeof document !== 'undefined' ? document.createElement('div').style : undefined

  try {
    const doc = globalThis.Document?.prototype
    wrapMethod(doc, 'createElement', original => function __lensTraceCreate(this: unknown, ...args: unknown[]) {
      const node = original.apply(this, args)
      record(node, { kind: 'create', site: here() })
      return node
    })
    wrapMethod(doc, 'createTextNode', original => function __lensTraceCreate(this: unknown, ...args: unknown[]) {
      const node = original.apply(this, args)
      record(node, { kind: 'create', site: here() })
      return node
    })

    for (const [proto, keys] of SETTERS) {
      for (const key of keys) wrapSetter(proto(), key, self => record(self, { kind: 'set', name: key, site: here() }))
    }

    const element = globalThis.Element?.prototype
    wrapMethod(element, 'setAttribute', original => function __lensTraceAttr(this: unknown, ...args: unknown[]) {
      record(this, { kind: 'attr', name: String(args[0]), site: here() })
      return original.apply(this, args)
    })
    wrapMethod(globalThis.EventTarget?.prototype, 'addEventListener', original => function __lensTraceListen(this: unknown, ...args: unknown[]) {
      record(this, { kind: 'listen', name: String(args[0]), site: here() })
      return original.apply(this, args)
    })

    // Placing a node: the call that put it where it is.
    const place = (nodes: unknown[]): void => {
      const site = here()
      for (const node of nodes) if (node instanceof Node) placed.set(node, site)
    }
    const node = globalThis.Node?.prototype
    wrapMethod(node, 'appendChild', original => function __lensTracePlace(this: unknown, ...args: unknown[]) { place([args[0]]); return original.apply(this, args) })
    wrapMethod(node, 'insertBefore', original => function __lensTracePlace(this: unknown, ...args: unknown[]) { place([args[0]]); return original.apply(this, args) })
    for (const key of ['append', 'prepend', 'replaceChildren', 'before', 'after', 'replaceWith']) {
      wrapMethod(element, key, original => function __lensTracePlace(this: unknown, ...args: unknown[]) { place(args); return original.apply(this, args) })
    }

    // Classes toggled and styles set: their lists and declarations belong to an element.
    wrapGetter(element, 'classList', (self, list) => { if (self instanceof Element && list) classOwner.set(list as object, self) })
    for (const key of ['add', 'remove', 'toggle', 'replace']) {
      wrapMethod(globalThis.DOMTokenList?.prototype, key, original => function __lensTraceClass(this: unknown, ...args: unknown[]) {
        record(classOwner.get(this as object), { kind: 'class', name: key, site: here() })
        return original.apply(this, args)
      })
    }
    wrapGetter(globalThis.HTMLElement?.prototype, 'style', (self, decl) => { if (self instanceof Element && decl) styleOwner.set(decl as object, self) })
    for (let proto = sample ? Object.getPrototypeOf(sample) : null; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key === 'setProperty') {
          wrapMethod(proto, key, original => function __lensTraceStyle(this: unknown, ...args: unknown[]) {
            record(styleOwner.get(this as object), { kind: 'style', name: String(args[0]), site: here() })
            return original.apply(this, args)
          })
        } else if (key !== 'parentRule' && key !== 'length') {
          wrapSetter(proto, key, self => record(styleOwner.get(self as object), { kind: 'style', name: key, site: here() }))
        }
      }
    }

    await run()
  } finally {
    for (const undo of restore.reverse()) {
      try { undo() } catch { /* already its own */ }
    }
  }
  return { ops, placed }
}
