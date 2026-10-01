// assistant/models.queen.ts
//
// THE MODELS ON THE LIST, BY WORD (documentation/agent-harness.md §11).
// `models` opens the providers console, where the lines are, and says how many requests stand the hive works with and the weight of work
// each takes; `models add <id> [fast|balanced|deep]` puts one on the list;
// `models drop <id>` takes one off; `models requests` reads what the work has
// asked for; `models request <what the work needs>` files one by hand.
//
// The point of the word is the balance: the cheap models do the everyday
// work, and a strong one is on the list FOR deep work only — it answers when
// a turn is handed up to it and never otherwise. `models add <id> deep` is
// how a request for a stronger model is answered. A line added with no tier
// takes the tier its price falls in, as it always has.
//
// A model line is an OpenRouter instance (providers/openrouter-instances.ts):
// OpenRouter's key pays for all of them, and nothing here touches a key.

import { QueenBee, EffectBus, I18N_IOC_KEY, AGENT_MODEL_REQUEST, type I18nProvider } from '@hypercomb/core'
import { llmModelChoice } from './llm-model-choice.js'
import { llmProviderRegistry } from './llm-provider-registry.js'
import { cachedOpenRouterCatalog, isOpenRouterBatchModel } from './providers/openrouter-catalog.js'
import { instanceId } from './providers/openrouter-instances.js'
import { OPENROUTER_PROVIDER } from './providers/openrouter.provider.js'
import { listModelRequests } from './model-requests.js'

type Tier = 'fast' | 'balanced' | 'deep'
const TIERS: readonly Tier[] = ['fast', 'balanced', 'deep']
const isTier = (word: string): word is Tier => (TIERS as readonly string[]).includes(word)

const OWNER = OPENROUTER_PROVIDER.id

const ago = (at: number, now = Date.now()): string => {
  const minutes = Math.max(0, Math.round((now - at) / 60_000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}

/** One line of the list, as the registry holds it now. */
export const modelLine = (modelId: string): string => {
  const provider = llmProviderRegistry().get(instanceId(modelId))
  if (!provider) return `${modelId} (held back: priced above the last stage; say models add ${modelId} deep to use it for deep work)`
  const tiers = [...new Set(provider.models.map(model => model.tier))].join('/')
  const price = provider.models[0]?.outputPerMillion
  const said = llmModelChoice.tierOf(OWNER, modelId) ? ', said' : ''
  return `${modelId} (${provider.decisionOnly ? 'judge' : tiers}${said}${price !== undefined ? `, $${Number(price.toPrecision(3))}/M out` : ''})`
}

/** The spelling the word forgives: case, and a leading '~'. */
const sameModel = (left: string, right: string): boolean =>
  left.replace(/^~/, '').toLowerCase() === right.replace(/^~/, '').toLowerCase()

/**
 * The catalogue's word on an id: known, unknown with near names, or not loaded.
 *
 * A known id comes back AS THE CATALOGUE SPELLS IT (`id`), and that is the
 * spelling to save: price, label and the price stages are all found by the
 * exact id (providers/openrouter-instances.ts), so a line saved as typed —
 * other capitals, the '~' left off — was a line with no price, which offers
 * every tier and slips past the stage that holds the exact id back.
 */
export const catalogueCheck = (modelId: string): { readonly known: boolean; readonly loaded: boolean; readonly near: readonly string[]; readonly id?: string } => {
  const catalogue = cachedOpenRouterCatalog()
  if (!catalogue) return { known: false, loaded: false, near: [] }
  // Nearest spelling first, so `x/y` typed in capitals is never taken for `~x/y`.
  const match = catalogue.find(entry => entry.id === modelId)
    ?? catalogue.find(entry => entry.id.toLowerCase() === modelId.toLowerCase())
    ?? catalogue.find(entry => sameModel(entry.id, modelId))
  if (match) return { known: true, loaded: true, near: [], id: match.id }
  const bare = modelId.replace(/^~/, '').toLowerCase()
  const tail = bare.split('/').pop() ?? bare
  const near = catalogue.map(entry => entry.id).filter(id => id.toLowerCase().includes(tail) || tail.includes(id.split('/').pop()?.toLowerCase() ?? '\u0000')).slice(0, 4)
  return { known: false, loaded: true, near }
}

export class ModelQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  readonly command = 'models'
  override description = 'Open the providers console; add a model line for a weight of work, drop one, read what the work asked for'
  override descriptionKey = 'slash.models'
  override options = ['add <model id> [fast|balanced|deep]', 'drop <model id>', 'requests', 'request <what the work needs>']
  override examples = [
    { input: '/models', result: 'Opens the providers console and says how many requests stand' },
    { input: '/models add anthropic/claude-sonnet-4.5 deep', result: 'The model takes only the work handed up to it' },
    { input: '/models requests', result: 'Reads what the work has asked a stronger model for' },
  ]

  // EVERYTHING AFTER THE WORD IS THIS WORD'S, VERBATIM. A model id carries
  // '.' and ':' (`anthropic/claude-sonnet-4.5`, `deepseek/deepseek-r1:free`)
  // and a request is prose, so no dot is a walk, no colon a tag, and no word
  // in the prose another behaviour's.
  override rawArgs = true

  // Each offer is the word being typed, completed — the command line writes
  // it over the last word of the line, after the real arguments it handed in.
  override slashComplete(args: string): readonly string[] {
    const words = args.trimStart().toLowerCase().split(/\s+/)
    const [verb = '', rest = '', tier = ''] = words
    if (words.length === 1) return ['add ', 'drop ', 'requests', 'request '].filter(word => word.startsWith(verb) && word.trim() !== verb)
    // An id typed whole offers nothing. Enter takes what is on offer, and
    // `x/y` in full must never become `x/y:free` — another model, another line.
    const from = (ids: readonly string[], fits: (id: string) => boolean): readonly string[] =>
      ids.some(id => id.toLowerCase() === rest) ? [] : ids.filter(id => fits(id.toLowerCase()))
    if (words.length === 2 && verb === 'drop') return from(llmModelChoice.saved(OWNER), id => id.startsWith(rest))
    if (words.length === 2 && verb === 'add' && rest.length >= 2) {
      return from((cachedOpenRouterCatalog() ?? []).map(entry => entry.id), id => id.includes(rest)).slice(0, 8)
    }
    if (words.length === 3 && verb === 'add') return TIERS.filter(word => word.startsWith(tier) && word !== tier)
    return []
  }

  protected async execute(args: string): Promise<void> {
    const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
    const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
      const value = i18n?.t?.(key, params)
      return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
    }
    const toast = (message: string, type = 'info'): void => { EffectBus.emit('toast:show', { type, message }) }
    const trimmed = args.trim()
    const [word = '', ...rest] = trimmed.split(/\s+/).filter(Boolean)
    const verb = word.toLowerCase()

    if (!verb) {
      // The bare word opens the providers console, as it always has; the
      // toast adds what the console does not show — the standing requests.
      EffectBus.emit('providers:open', {})
      const lines = llmModelChoice.saved(OWNER).filter(model => !isOpenRouterBatchModel(model)).map(modelLine)
      const asked = (await listModelRequests()).length
      const listed = lines.length
        ? `${t('model.list', 'Model lines:')} ${lines.join(' · ')}`
        : t('model.none', 'No model lines yet. models add <model id> [fast|balanced|deep] puts one on the list.')
      toast(`${listed}${asked ? ` — ${t('model.asked', '{count} requests for a stronger model; models requests reads them.', { count: asked })}` : ''}`)
      return
    }

    if (verb === 'add') {
      const tier = rest.length > 1 && isTier(rest[rest.length - 1].toLowerCase()) ? rest[rest.length - 1].toLowerCase() as Tier : undefined
      const typed = (tier ? rest.slice(0, -1) : rest).join('').trim()
      if (!typed) { toast(t('model.usage.add', 'Say which: models add <model id> [fast|balanced|deep]'), 'warning'); return }
      if (isOpenRouterBatchModel(typed)) { toast(t('model.batch', '{model} is a batch model: it answers in hours, not in a chat.', { model: typed }), 'warning'); return }
      const check = catalogueCheck(typed)
      if (check.loaded && !check.known) {
        toast(t('model.unknown', 'No model called {model} in the catalogue.{near}', { model: typed, near: check.near.length ? ` Near: ${check.near.join(', ')}` : '' }), 'warning')
        return
      }
      // The catalogue's own spelling is the line: the price is found by it.
      const modelId = check.id ?? typed
      // On the list, never in use: the cheap model stays the everyday one.
      llmModelChoice.add(OWNER, modelId, false)
      if (tier) llmModelChoice.setTier(OWNER, modelId, tier)
      toast(t('model.added', '{line} is on the list{only}.{unchecked}', {
        line: modelLine(modelId),
        only: tier ? ` for ${tier} work only` : '',
        unchecked: check.loaded ? '' : ' The catalogue is not loaded, so the name was not checked.',
      }), 'success')
      EffectBus.emit('model:added', { model: modelId, ...(tier ? { tier } : {}) })
      return
    }

    if (verb === 'drop') {
      const typed = rest.join('').trim()
      if (!typed) { toast(t('model.usage.drop', 'Say which: models drop <model id>'), 'warning'); return }
      // The line as it was saved, found by the same spelling `add` forgives.
      const saved = llmModelChoice.saved(OWNER)
      const modelId = saved.find(model => model === typed) ?? saved.find(model => sameModel(model, typed))
      if (!modelId) { toast(t('model.notlisted', '{model} is not on the list.', { model: typed }), 'warning'); return }
      llmModelChoice.drop(OWNER, modelId)
      toast(t('model.dropped', '{model} is off the list.', { model: modelId }), 'success')
      EffectBus.emit('model:dropped', { model: modelId })
      return
    }

    if (verb === 'requests') {
      const asked = await listModelRequests()
      if (!asked.length) { toast(t('model.norequests', 'No work has asked for a stronger model.')); return }
      const lines = asked.slice(0, 5).map(request => `${ago(request.at)} — ${request.from || 'a model'}: ${request.needs}`)
      toast(`${t('model.requests', 'Asked for a stronger model ({count}):', { count: asked.length })} ${lines.join(' · ')} — ${t('model.answer', 'models add <model id> deep answers them.')}`)
      return
    }

    if (verb === 'request') {
      const needs = trimmed.slice(word.length).trim()
      if (!needs) { toast(t('model.usage.request', 'Say what the work needs: models request <what for>'), 'warning'); return }
      EffectBus.emit(AGENT_MODEL_REQUEST, { id: 'word', convoId: '', leg: 0, at: Date.now(), from: 'the participant', needs, tier: 'deep' })
      toast(t('model.requested', 'Filed: a stronger model is asked for — {needs}', { needs }), 'success')
      return
    }

    toast(t('model.usage', 'models · models add <model id> [fast|balanced|deep] · models drop <model id> · models requests · models request <what for>'), 'warning')
  }
}

const _model = new ModelQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ModelQueenBee', _model)
