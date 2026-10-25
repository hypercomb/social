// assistant/say.queen.ts
//
// `say` — THE COMMUNICATION VECTOR FOR A HARNESS. A desktop tool (Claude Code,
// Codex, Hermes) puts a sentence into a conversation that lives ON A TILE, and
// the hive's own chat carries it from there: visible on that tile, continued
// under the participant's own Execution rules, answered in natural language.
//
//   say on /work: <text>          a NEW conversation about that tile
//   say in <conversation>: <text> carry on one that already exists
//
// The first line of <text> is the conversation's NAME — a conversation is
// titled by the first thing said in it (chat-thread titleOfRaw), so the sender
// makes the name up by how it begins. The rest is the request.
//
// WHAT THIS IS NOT. It is not a bridge op and it is not a job conversation:
// the manager door (`manager.cjs ask`) mints `chat:tile:/::job-…`, which every
// list walk hides, and runs it trusted. This conversation is in the tile's own
// list, and it is NOT trusted — a change it wants runs only if the
// participant's auto rules say so, else it waits in Execution for a hand.
// There is deliberately no `machine` block: a model in the hive cannot start
// conversations with itself; a harness reaches this word through the
// participant's own command line, where nothing is declared.
//
// The word answers with the conversation's id (an activity line), which is how
// the sender reads the thread back, and says `say in` to continue it.
import { QueenBee, EffectBus } from '@hypercomb/core'
import { newTileConvoId, TILE_CONVO_PREFIX } from './chat-thread.js'
import { HIVE_TREE_READER_IOC_KEY } from './hive-tree-reader.js'

const get = <T,>(key: string): T | undefined => (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

type TreeReaderLike = {
  readNode?(segments: readonly string[], options: { maxBytes: number; withContent: boolean }): Promise<
    { ok: true; children: readonly { name: string }[] } | { ok: false }
  >
}

const BACKSLASH = String.fromCharCode(92)
const TEXT_MAX = 20_000

const segmentsOf = (route: string): string[] =>
  route.split('/').map(part => [...part].filter(ch => ch !== BACKSLASH && ch.charCodeAt(0) > 31).join('').trim()).filter(Boolean)

/** `on /route: text` or `in chat:tile:/…::stamp: text` — what goes where. Only
 *  a colon followed by space ends the place: a conversation's id holds colons. */
const READ = /^(on|in)\s+(\S+?):\s+([\s\S]+)$/i

export class SayQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  readonly command = 'say'
  override description = 'Put a sentence into a tile’s conversation — a harness’s way to talk to the hive'
  override descriptionKey = 'slash.say'
  override options = ['on /<route>: <text>', 'in <conversation>: <text>']
  override examples = [
    { input: '/say on /work: Tidy the invoices\nFile them under invoices.', result: 'A new conversation on /work, named "Tidy the invoices"' },
    { input: '/say in chat:tile:/work::1792-ab12cd: Also the receipts', result: 'Carries on that conversation' },
  ]

  // The sentence is prose, verbatim: no word in it is another behaviour's.
  override rawArgs = true

  protected async execute(args: string): Promise<void> {
    const said = READ.exec(args.trim())
    if (!said) throw new Error('say — say where: say on /<route>: <text>, or say in <conversation>: <text>')
    const [, how, where, rest] = said
    const text = rest.trim().slice(0, TEXT_MAX)
    if (!text) throw new Error('say — there is nothing to say')

    let convoId: string
    if (how.toLowerCase() === 'in') {
      convoId = where
      if (!convoId.startsWith(TILE_CONVO_PREFIX)) throw new Error(`say — "${where}" is not a conversation id; it begins ${TILE_CONVO_PREFIX}`)
    } else {
      if (!where.startsWith('/')) throw new Error('say — a tile is a route that begins with /')
      const route = segmentsOf(where)
      // A route is not a guess: a tile that is not there is said, never talked to.
      if (route.length) {
        const reader = get<TreeReaderLike>(HIVE_TREE_READER_IOC_KEY)
        const listed = await reader?.readNode?.(route.slice(0, -1), { maxBytes: 8_000, withContent: false }).catch(() => undefined)
        const tile = route[route.length - 1].toLowerCase()
        if (listed?.ok && !listed.children.some(child => child.name.toLowerCase() === tile)) {
          throw new Error(`say — there is no tile at /${route.join('/')}; nothing was said`)
        }
      }
      convoId = newTileConvoId(route)
    }

    // `trust` is OFF: the conversation runs under the participant's own rules.
    const askId = `say-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    EffectBus.emit('chat:ask', { askId, convoId, text, trust: false })
    EffectBus.emit('activity:log', { message: `Say — ${convoId}`, icon: '💬' })
  }
}

const _say = new SayQueenBee()
window.ioc.register('@diamondcoreprocessor.com/SayQueenBee', _say)
