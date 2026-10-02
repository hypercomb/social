// assistant/agent.queen.ts
//
// `/agent` — a model works on the hive, with no chat window (assistant/
// agent-turn.ts). The minimal build has no Angular and so no chat; this is
// its door to the same loop, and the one any participant — a person, or
// another model acting for them — drives the hive through.
//
//   /agent <request>   → a turn: the model reads, changes and drafts in
//                        rounds until the request is done; its answer and
//                        every step go to the activity log
//   /agent continue    → the next stretch, from what the model said is left
//   /agent new         → forget this conversation
//
// Reads and changes wait in Execution as the participant's policy says. A
// file of the build's own source is staged into a draft and never leaves the
// browser until the participant sends it (`/versions ask <host>`).

import { EffectBus, I18N_IOC_KEY, QueenBee, continueMessage, get, type I18nProvider } from '@hypercomb/core'
import { AGENT_TURN_IOC_KEY, agentTurn, liveAgentDeps, runAgentTurn, type AgentTurnRequest, type AgentTurnResult } from './agent-turn.js'

type Turn = { role: 'user' | 'assistant'; text: string; model?: string }
/** Turns kept for the next request; older ones fall off. */
const KEPT = 24

export class AgentQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  readonly command = 'agent'
  override description = 'A model works on the hive in rounds — reading, changing, drafting the build’s own source — with no chat window'
  override descriptionKey = 'slash.agent'
  override options = ['<request>', 'continue', 'new']
  override examples = [
    { input: '/agent what does the versions command do?', result: 'The model reads the code and answers in the activity log' },
    { input: '/agent continue', result: 'Carries on from what the model said is left' },
  ]

  protected override listens = []
  protected override emits = ['toast:show', 'activity:log']

  #turns: Turn[] = []
  #left = ''
  #running: AbortController | null = null

  public override slashComplete(args: string): readonly string[] {
    const q = String(args ?? '').trim().toLowerCase()
    return ['continue', 'new'].filter(option => !q || option.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const said = String(args ?? '').trim()
    if (!said) {
      this.#toast('info', this.#t('agent.what', 'Say what to do: /agent <request>.'))
      return
    }
    if (said.toLowerCase() === 'new') {
      this.#running?.abort()
      this.#turns = []
      this.#left = ''
      this.#toast('info', this.#t('agent.new', 'A new conversation.'))
      return
    }
    if (said.toLowerCase() === 'continue' && !this.#left) {
      this.#toast('info', this.#t('agent.nothingleft', 'Nothing is left to continue.'))
      return
    }
    const request = said.toLowerCase() === 'continue' ? continueMessage(this.#left) : said
    this.#running?.abort()
    const running = this.#running = new AbortController()
    this.#activity(`› ${said}`, '✦')
    let result: AgentTurnResult
    try {
      result = await runAgentTurn({ request, transcript: this.#turns, convoId: 'agent:queen', signal: running.signal })
    } catch (error) {
      if (running.signal.aborted) return
      this.#toast('warning', error instanceof Error ? error.message : String(error))
      return
    } finally {
      if (this.#running === running) this.#running = null
    }
    this.#turns.push({ role: 'user', text: request }, { role: 'assistant', text: result.answer, ...(result.model ? { model: result.model } : {}) })
    this.#turns = this.#turns.slice(-KEPT)
    this.#left = result.left ?? ''
    for (const line of result.ran) this.#activity(`ran ${line}`, '▸')
    for (const draft of result.drafts) this.#activity(`draft ${draft.draft.slice(0, 12)} over ${draft.version.slice(0, 12)} · ${draft.paths.join(', ')}`, '✎')
    this.#activity(result.answer || this.#t('agent.silent', '(no answer)'), '✦')
    this.#toast(result.stopped ? 'warning' : 'success', result.stopped
      ? this.#t('agent.stopped', 'The work stopped: {why}', { why: result.stopped })
      : result.left
        ? this.#t('agent.left', 'Answered in {rounds} round(s). Left: {left} — /agent continue.', { rounds: result.rounds, left: result.left })
        : this.#t('agent.done', 'Answered in {rounds} round(s) — in the activity log.', { rounds: result.rounds }))
  }

  #t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    const text = i18n?.t(key, params)
    return text && text !== key ? text : fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
  }

  #activity = (message: string, icon: string): void => { EffectBus.emit('activity:log', { message, icon }) }
  #toast = (type: string, message: string): void => { EffectBus.emit('toast:show', { type, title: this.#t('agent.title', 'Agent'), message }) }
}

window.ioc.register('@diamondcoreprocessor.com/AgentQueenBee', new AgentQueenBee())

// THE SAME LOOP FOR A HAND THAT IS NOT TYPING: a participant's own code
// streams a turn (`stream`) or awaits it whole (`run`).
window.ioc.register(AGENT_TURN_IOC_KEY, {
  run: (turn: AgentTurnRequest) => runAgentTurn(turn),
  stream: async (turn: AgentTurnRequest) => agentTurn(turn, await liveAgentDeps()),
})
