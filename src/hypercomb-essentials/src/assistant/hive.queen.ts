// assistant/hive.queen.ts
//
// `hive` — cut a hive from what this session ran.
//
//   hive                     cut a hive named "hive" at the default depth
//   hive solomon             name it
//   hive solomon depth 0     sparsest: only the faces, the rest wait
//
// A hive decides which beehaviors an entrance makes available
// (documentation/hives.md). This word reads the bees that ran here, names the
// faces among them, checks the result against the package and keeps it — one
// signed document in the store, nothing published. It says the link that opens
// it: the page address with `?hive=<signature>`. The cutting is the runtime's
// (the preloader holds the class index); a module never imports it, so the word
// asks over IoC.
import { QueenBee, EffectBus } from '@hypercomb/core'

type Authored =
  | { ok: true; sig: string; faces: string[]; notes: unknown[] }
  | { ok: false; error: string; problems?: Array<{ severity: string; kind: string; name?: string }> }

type Cutter = { authorHive?: (options: { name: string; depth?: 0 | 1 | 2 }) => Promise<Authored> }

/** `solomon depth 0` → name and depth. The name may be several words. */
export const parseHiveWord = (text: string): { name: string; depth?: 0 | 1 | 2 } => {
  const match = /^(.*?)\s*\bdepth\s+([012])\s*$/i.exec(text.trim())
  const name = (match ? match[1] : text).trim() || 'hive'
  return match ? { name, depth: Number(match[2]) as 0 | 1 | 2 } : { name }
}

export class HiveQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  readonly command = 'hive'
  override description = 'Cut a hive from what this session ran — only those behaviours load when it is opened'
  override options = ['<name>', '<name> depth 0|1|2']
  override examples = [
    { input: '/hive solomon', result: 'Keeps a hive named solomon and says the link that opens it' },
    { input: '/hive solomon depth 0', result: 'The sparsest: only the faces load, the rest wait' },
  ]

  override rawArgs = true

  protected async execute(args: string): Promise<void> {
    const cutter = window.ioc.get<Cutter>('@hypercomb.social/ScriptPreloader')
    const say = (message: string): void => {
      EffectBus.emit('activity:log', { message, icon: '🐝' })
      EffectBus.emit('toast:show', { type: 'info', message })
    }
    if (!cutter?.authorHive) return say('Hive — cutting is not available here')

    const result = await cutter.authorHive(parseHiveWord(args))
    if (!result.ok) {
      const named = (result.problems ?? []).filter(p => p.severity === 'error').map(p => p.name ?? p.kind)
      return say(`Hive — ${result.error}${named.length ? ` (${named.join(', ')})` : ''}`)
    }
    const link = `${location.origin}/?hive=${result.sig}`
    say(`Hive kept — ${result.faces.length} ${result.faces.length === 1 ? 'face' : 'faces'}: ${result.faces.join(', ')}. Open ${link}`)
  }
}

const _hive = new HiveQueenBee()
window.ioc.register('@diamondcoreprocessor.com/HiveQueenBee', _hive)
