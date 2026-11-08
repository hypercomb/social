// assistant/inspect.queen.ts
//
// `inspect` — DRILL INTO THE CODE A TILE NEEDS TO RUN (documentation/inspect.md).
//
//   inspect                    the selected tile, or the page you stand on
//   inspect <tile>             a tile on this page (what you can see wins)
//   inspect /<path>/<tile>     any tile, from the root
//   inspect code <word>        every line of running code that quotes a word:
//                              an effect, an IoC key, a decoration kind
//   inspect <sig> [src/path]   a running module by signature, or one of its
//                              source files
//
// It opens the inspect panel (inspect-window.view.ts), which walks from the
// tile to the behaviours that key on it, into each behaviour's source, and on
// to every behaviour that source talks to. It only reads: modules are read as
// bytes, never run, and nothing is written. The participant's word — a model
// already reads code with `/read <sig> <section>` and `/code <word>`, so this
// queen declares no machine grammar.

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import type { InspectFrame, InspectWindowView } from './inspect-window.view.js'

const SIG = /^[0-9a-f]{64}$/
const BACKSLASH = String.fromCharCode(92)

const get = <T,>(key: string): T | undefined => (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

/** Names become path segments: no separators, no control characters. */
const safeName = (raw: string): string =>
  [...raw].filter(ch => ch !== '/' && ch !== BACKSLASH && ch.charCodeAt(0) > 31).join('').trim()

/** What `inspect <args>` opens, given the page you stand on and the tiles selected on it. */
export const inspectTarget = (args: string, here: readonly string[], selected: readonly string[]): InspectFrame => {
  const said = args.trim()
  const [first = '', ...rest] = said.split(/\s+/).filter(Boolean)
  if (SIG.test(first.toLowerCase())) {
    const section = rest[0]
    return { kind: 'section', sig: first.toLowerCase(), ...(section ? { section: section.startsWith('src/') ? section : `src/${section}` } : {}) }
  }
  if (first.toLowerCase() === 'code' && rest.length) return { kind: 'word', word: rest.join(' ') }
  if (!said) return { kind: 'tile', segments: selected.length === 1 ? [...here, selected[0]] : [...here] }
  if (said.startsWith('/')) return { kind: 'tile', segments: said.split('/').map(safeName).filter(Boolean) }
  const path = said.split('/').map(safeName).filter(Boolean)
  return { kind: 'tile', segments: [...here, ...path] }
}

export class InspectQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'inspect'
  override genotype = 'assistant'
  override description = 'Drill into a tile: the behaviours that run it, their source, and every behaviour that source talks to'
  override descriptionKey = 'slash.inspect'
  override options = ['<tile>', '/<path>', 'code <word>', '<sig> [src/path]']
  override examples = [
    { input: '/inspect', result: 'Opens the code behind the selected tile, or the page you stand on' },
    { input: '/inspect solomon', result: 'Opens the code behind the tile "solomon" on this page' },
    { input: '/inspect code tile:action', result: 'Every line of running code that emits, listens for or names tile:action' },
  ]

  protected override emits: string[] = ['toast:show']

  #view: InspectWindowView | null = null
  #loading: Promise<InspectWindowView> | null = null

  override slashComplete(args: string): readonly string[] {
    const typed = args.trim().toLowerCase()
    return typed && 'code '.startsWith(typed) && typed !== 'code' ? ['code '] : []
  }

  protected async execute(args: string): Promise<void> {
    const here = (get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? []).map(String)
    const selection = get<{ selected?: ReadonlySet<string> }>('@diamondcoreprocessor.com/SelectionService')
    const selected = selection?.selected ? [...selection.selected].filter(Boolean).map(String) : []
    const target = inspectTarget(args, here, selected)
    try {
      const view = await this.#panel()
      view.open(target)
    } catch (error) {
      const i18n = get<I18nProvider>(I18N_IOC_KEY)
      const value = i18n?.t?.('inspect.no-panel', { error: String(error) })
      EffectBus.emit('toast:show', {
        type: 'error',
        message: value && value !== 'inspect.no-panel' ? value : `The inspect panel could not open: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  /** The panel arrives with the first `inspect`, never at boot. */
  #panel(): Promise<InspectWindowView> {
    if (this.#view) return Promise.resolve(this.#view)
    return this.#loading ??= import('./inspect-window.view.js').then(({ InspectWindowView }) => {
      this.#view = new InspectWindowView()
      return this.#view
    }, error => { this.#loading = null; throw error })
  }
}

const _inspect = new InspectQueenBee()
window.ioc.register('@diamondcoreprocessor.com/InspectQueenBee', _inspect)
