// Keyword Suggestions — background Haiku generation + participant review.
//
// `/keywords` opens the transcript/target composer. Once submitted, the
// surface closes and the request continues through the Claude Bridge. A
// producer-owned attention icon appears in the command-line when the grouped
// proposals are ready. Clicking it opens the completed review; nothing is
// written until the participant checks items and presses Add.

import { EffectBus } from '@hypercomb/core'
import {
  keywordGenerationPrompt,
  parseKeywordProposal,
  type KeywordProposalGroup,
} from './keyword-proposals.js'

type OpenPayload = { transcript?: string }
type SelectionLike = { selected: ReadonlySet<string> }
type ShowCellLike = { renderedCells?: Map<string, unknown> }
type LineageLike = { explorerSegments?: () => readonly string[] }
type DecorationServiceLike = { addTag(segments: readonly string[], name: string): Promise<string> }
type TagRegistryLike = { ensureLoaded(): Promise<void>; add(name: string): Promise<void> }
type ModeRegistryLike = { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void }
type LlmQueenLike = {
  activeModel: string
  submitChat(
    convoId: string,
    message: string,
    targets: string[],
    transcript: ReadonlyArray<{ role: string; text: string }>,
  ): Promise<boolean>
}

export interface KeywordReviewJob {
  id: string
  transcript: string
  targetKeys: string[]
  displayTargets: string[]
  segments: string[]
  groups: KeywordProposalGroup[]
  status: 'pending' | 'ready' | 'failed'
  error?: string
  createdAt: number
}

const OWNER = 'keyword-suggestions'
const STYLE_ID = 'hc-keyword-suggestions-styles'
const STORAGE_KEY = 'hc:keyword-reviews'
const ATTENTION_KEY = 'keywords-attention'
const CURRENT_TARGET = '@current'
const JOB_TIMEOUT_MS = 10 * 60_000

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  node.className = css
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * Owns keyword requests independently of the review view. Its small
 * participant-local queue survives navigation and reload; the transcript and
 * proposals never enter the shared layer until chosen tags are committed.
 */
export class KeywordGenerationService {
  readonly #jobs = new Map<string, KeywordReviewJob>()
  readonly #timeouts = new Map<string, ReturnType<typeof setTimeout>>()

  constructor() {
    this.#restore()
    EffectBus.on<{ convoId?: string; text?: string }>('ask:chat-reply', payload => {
      const id = String(payload?.convoId ?? '')
      if (!id.startsWith('keywords:')) return
      this.#acceptReply(id, String(payload?.text ?? ''))
    })
    EffectBus.on<{ key?: string }>('indicator:activate', ({ key }) => {
      if (key !== ATTENTION_KEY) return
      const job = this.nextAttention()
      if (job) EffectBus.emit('keywords:review-open', { jobId: job.id })
    })
    EffectBus.on('indicator:query', () => this.#publishAttention())

    // Side effects boot before Angular creates the command line. The explicit
    // query above is the primary replay path; this covers non-Angular shells.
    setTimeout(() => this.#publishAttention(), 0)
  }

  get(id: string): KeywordReviewJob | undefined {
    return this.#jobs.get(id)
  }

  nextAttention(): KeywordReviewJob | undefined {
    return [...this.#jobs.values()]
      .filter(job => job.status === 'ready' || job.status === 'failed')
      .sort((a, b) => a.createdAt - b.createdAt)[0]
  }

  async request(
    transcript: string,
    targetKeys: string[],
    displayTargets: string[],
    segments: string[],
  ): Promise<string> {
    const queen = ioc<LlmQueenLike>('@diamondcoreprocessor.com/LlmQueenBee')
    if (!queen?.submitChat) throw new Error('Ask service is not ready.')

    const id = `keywords:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
    const job: KeywordReviewJob = {
      id,
      transcript,
      targetKeys: [...targetKeys],
      displayTargets: [...displayTargets],
      segments: [...segments],
      groups: [],
      status: 'pending',
      createdAt: Date.now(),
    }
    this.#jobs.set(id, job)
    this.#persist()
    this.#armTimeout(job)
    EffectBus.emit('agent:start', {
      id,
      behavior: 'keywords',
      kind: 'model',
      model: 'haiku',
      request: 'Generate keyword proposals from transcript',
      targets: job.displayTargets,
      segments: job.segments,
    })
    EffectBus.emit('agent:progress', { id, activity: 'waiting for Haiku on the Claude Bridge' })

    try {
      queen.activeModel = 'haiku'
      const queued = await queen.submitChat(
        id,
        keywordGenerationPrompt(transcript),
        job.displayTargets,
        [],
      )
      if (!queued) throw new Error('The Claude Bridge request could not be queued.')
    } catch (error) {
      this.#remove(id)
      const reason = String((error as Error)?.message ?? error)
      EffectBus.emit('agent:end', { id, ok: false, summary: reason })
      throw error
    }

    EffectBus.emit('toast:show', {
      type: 'tip',
      message: 'Haiku is generating keywords in the background. An attention icon will appear here when review is ready.',
    })
    return id
  }

  complete(id: string): void {
    this.#remove(id)
  }

  discard(id: string): void {
    this.#remove(id)
    EffectBus.emit('toast:show', { type: 'info', message: 'Keyword proposals discarded.' })
  }

  #acceptReply(id: string, answer: string): void {
    const job = this.#jobs.get(id)
    if (!job) return
    this.#clearTimeout(id)
    const groups = parseKeywordProposal(answer)
    if (groups.length > 0) {
      job.groups = groups
      job.status = 'ready'
      delete job.error
      const total = groups.reduce((sum, group) => sum + group.keywords.length, 0)
      EffectBus.emit('agent:end', { id, ok: true, summary: `${total} keyword proposals ready for review` })
      EffectBus.emit('toast:show', {
        type: 'success',
        title: 'Keywords ready',
        message: `${total} proposals are ready. Open the attention icon to choose which tags to add.`,
      })
    } else {
      job.groups = []
      job.status = 'failed'
      job.error = 'Haiku replied, but its grouped keyword list could not be read.'
      EffectBus.emit('agent:end', { id, ok: false, summary: 'No readable keyword proposals found' })
      EffectBus.emit('toast:show', {
        type: 'error',
        title: 'Keyword review needs attention',
        message: 'Haiku replied, but the grouped keyword list could not be read.',
      })
    }
    this.#persist()
    this.#publishAttention()
  }

  #armTimeout(job: KeywordReviewJob): void {
    this.#clearTimeout(job.id)
    const remaining = Math.max(0, JOB_TIMEOUT_MS - (Date.now() - job.createdAt))
    this.#timeouts.set(job.id, setTimeout(() => {
      const current = this.#jobs.get(job.id)
      if (!current || current.status !== 'pending') return
      current.status = 'failed'
      current.error = 'Timed out waiting for Haiku. Make sure the Claude Bridge and ask watcher are running, then retry.'
      EffectBus.emit('agent:end', { id: job.id, ok: false, summary: 'Timed out waiting for the Claude Bridge' })
      this.#persist()
      this.#publishAttention()
    }, remaining))
  }

  #clearTimeout(id: string): void {
    const timer = this.#timeouts.get(id)
    if (timer) clearTimeout(timer)
    this.#timeouts.delete(id)
  }

  #remove(id: string): void {
    this.#clearTimeout(id)
    this.#jobs.delete(id)
    this.#persist()
    this.#publishAttention()
  }

  #publishAttention(): void {
    const jobs = [...this.#jobs.values()].filter(job => job.status !== 'pending')
    if (jobs.length === 0) {
      EffectBus.emit('indicator:clear', { key: ATTENTION_KEY })
      return
    }
    const failed = jobs.filter(job => job.status === 'failed').length
    const label = failed
      ? `${jobs.length} keyword review${jobs.length === 1 ? '' : 's'} need attention — click to open`
      : `${jobs.length} keyword review${jobs.length === 1 ? '' : 's'} ready — click to choose tags`
    EffectBus.emit('indicator:set', {
      key: ATTENTION_KEY,
      icon: 'notification_important',
      label,
      dismissable: false,
      actionable: true,
    })
  }

  #persist(): void {
    const jobs = [...this.#jobs.values()]
    if (jobs.length === 0) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs))
  }

  #restore(): void {
    let raw: unknown
    try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') } catch { return }
    if (!Array.isArray(raw)) return
    for (const candidate of raw.slice(-20)) {
      if (!candidate || typeof candidate !== 'object') continue
      const value = candidate as Record<string, unknown>
      const id = String(value['id'] ?? '')
      const status = value['status']
      if (!id.startsWith('keywords:') || !['pending', 'ready', 'failed'].includes(String(status))) continue
      const groups = parseKeywordProposal(JSON.stringify(value['groups'] ?? []))
      const job: KeywordReviewJob = {
        id,
        transcript: String(value['transcript'] ?? '').slice(0, 100_000),
        targetKeys: Array.isArray(value['targetKeys']) ? value['targetKeys'].map(String).filter(Boolean) : [CURRENT_TARGET],
        displayTargets: Array.isArray(value['displayTargets']) ? value['displayTargets'].map(String).filter(Boolean) : [],
        segments: Array.isArray(value['segments']) ? value['segments'].map(String).filter(Boolean) : [],
        groups,
        status: status as KeywordReviewJob['status'],
        error: typeof value['error'] === 'string' ? value['error'] : undefined,
        createdAt: Number(value['createdAt']) || Date.now(),
      }
      this.#jobs.set(job.id, job)
      if (job.status === 'pending') {
        this.#armTimeout(job)
        EffectBus.emit('agent:start', {
          id: job.id,
          behavior: 'keywords',
          kind: 'model',
          model: 'haiku',
          request: 'Generate keyword proposals from transcript',
          targets: job.displayTargets,
          segments: job.segments,
        })
        EffectBus.emit('agent:progress', { id: job.id, activity: 'waiting for Haiku on the Claude Bridge' })
      }
    }
  }
}

export class KeywordSuggestionsView {
  #host: HTMLDivElement | null = null
  #input: HTMLTextAreaElement | null = null
  #results: HTMLDivElement | null = null
  #status: HTMLDivElement | null = null
  #apply: HTMLButtonElement | null = null
  #chosenTargets = new Set<string>()
  #chosenKeywords = new Set<string>()
  #groups: KeywordProposalGroup[] = []
  #segments: string[] = []
  #activeJobId: string | null = null
  #busy = false
  #session = 0

  constructor(private readonly generation: KeywordGenerationService) {
    EffectBus.on<OpenPayload>('keywords:open', payload => this.open(String(payload?.transcript ?? '')))
    EffectBus.on<{ jobId?: string }>('keywords:review-open', ({ jobId }) => {
      const job = this.generation.get(String(jobId ?? ''))
      if (job) this.#openJob(job)
    })
    EffectBus.on<{ text?: string; isFinal?: boolean }>('recording:transcript-update', payload => {
      if (!this.#host || !this.#input || this.#input.readOnly || payload?.isFinal !== true) return
      const text = String(payload.text ?? '').trim()
      if (!text) return
      this.#input.value += (this.#input.value.trim() ? '\n' : '') + text
      this.#setStatus('Live transcript added. Generate whenever the sample is ready.')
    })
  }

  open(prefill = ''): void {
    const segments = [...(ioc<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
      .map(String).filter(Boolean)
    const labels = [...(ioc<ShowCellLike>('@diamondcoreprocessor.com/ShowCellDrone')?.renderedCells?.keys() ?? [])]
    const selected = ioc<SelectionLike>('@diamondcoreprocessor.com/SelectionService')?.selected ?? new Set<string>()
    const chosen = [...selected].filter(label => labels.includes(label))
    this.#build({
      transcript: prefill,
      segments,
      targetKeys: chosen.length ? chosen : [CURRENT_TARGET],
      targetOptions: [CURRENT_TARGET, ...labels],
      groups: [],
    })
  }

  #openJob(job: KeywordReviewJob): void {
    this.#build({
      transcript: job.transcript,
      segments: job.segments,
      targetKeys: job.targetKeys,
      targetOptions: job.targetKeys,
      groups: job.groups,
      jobId: job.id,
      error: job.error,
    })
  }

  #build(config: {
    transcript: string
    segments: string[]
    targetKeys: string[]
    targetOptions: string[]
    groups: KeywordProposalGroup[]
    jobId?: string
    error?: string
  }): void {
    this.close()
    this.#session++
    this.#ensureStyles()
    this.#segments = [...config.segments]
    this.#chosenTargets = new Set(config.targetKeys)
    this.#chosenKeywords.clear()
    this.#groups = config.groups
    this.#activeJobId = config.jobId ?? null
    const reviewReady = config.groups.length > 0

    const host = el('div', 'hc-kws')
    const header = el('header', 'hc-kws-head')
    const heading = el('div', 'hc-kws-heading')
    heading.append(el('div', 'hc-kws-kicker', reviewReady ? 'ATTENTION REQUIRED' : 'INFORMATION CONFIGURATION'))
    heading.append(el('h1', 'hc-kws-title', reviewReady ? 'Choose transcript keywords' : 'Keywords from transcript'))
    const close = el('button', 'hc-kws-close', '×')
    close.type = 'button'
    close.setAttribute('aria-label', 'Close')
    close.addEventListener('click', () => this.close())
    header.append(heading, close)

    const body = el('main', 'hc-kws-body')
    const source = el('section', 'hc-kws-source')
    source.append(el('label', 'hc-kws-label', 'Transcript'))
    const input = el('textarea', 'hc-kws-input')
    input.rows = 8
    input.placeholder = 'Paste a transcript here, or leave this open while recording…'
    input.value = config.transcript
    input.readOnly = reviewReady
    this.#input = input
    source.append(input)

    source.append(el('div', 'hc-kws-label hc-kws-target-title', 'Add chosen keywords to'))
    const targets = el('div', 'hc-kws-targets')
    for (const target of [...new Set(config.targetOptions)]) {
      const label = target === CURRENT_TARGET
        ? `Here · ${this.#segments.at(-1) ?? 'current layer'}`
        : target
      const chip = el('button', 'hc-kws-target', label)
      chip.type = 'button'
      chip.classList.toggle('on', this.#chosenTargets.has(target))
      chip.addEventListener('click', () => {
        if (this.#chosenTargets.has(target)) this.#chosenTargets.delete(target)
        else this.#chosenTargets.add(target)
        chip.classList.toggle('on', this.#chosenTargets.has(target))
        this.#syncApply()
      })
      targets.append(chip)
    }
    source.append(targets)

    if (!reviewReady) {
      const generate = el(
        'button',
        'hc-kws-generate',
        config.jobId ? 'Retry with Haiku in background' : 'Generate with Haiku in background',
      )
      generate.type = 'button'
      generate.addEventListener('click', () => void this.#generate(generate))
      source.append(generate)
    }

    const review = el('section', 'hc-kws-review')
    review.append(el('div', 'hc-kws-label', 'Review — nothing is added until you confirm'))
    const statusText = reviewReady
      ? 'The background job is finished. Choose the information that belongs on the tile; groups organize the review, while tags remain independent.'
      : config.error ?? 'Grouped proposals will appear here after Haiku finishes in the background.'
    const status = el('div', `hc-kws-status${config.error ? ' error' : ''}`, statusText)
    const results = el('div', 'hc-kws-results')
    this.#status = status
    this.#results = results
    review.append(status, results)
    body.append(source, review)

    const footer = el('footer', 'hc-kws-foot')
    if (config.jobId) {
      const discard = el('button', 'hc-kws-discard', 'Discard proposals')
      discard.type = 'button'
      discard.addEventListener('click', () => {
        this.generation.discard(config.jobId!)
        this.close()
      })
      footer.append(discard)
    } else {
      footer.append(el('div', 'hc-kws-foot-note', 'The Claude Bridge must be running for Haiku to answer.'))
    }
    const apply = el('button', 'hc-kws-apply', 'Add selected keywords')
    apply.type = 'button'
    apply.disabled = true
    apply.addEventListener('click', () => void this.#applyKeywords())
    this.#apply = apply
    footer.append(apply)

    host.append(header, body, footer)
    document.body.append(host)
    this.#host = host
    this.#renderGroups()
    this.#syncApply()
    ioc<ModeRegistryLike>('@diamondcoreprocessor.com/ModeRegistry')?.enter('view:active', OWNER)
    window.addEventListener('keydown', this.#onKey, true)
    if (!reviewReady) queueMicrotask(() => input.focus())
  }

  #onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.#host) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.close()
  }

  async #generate(button: HTMLButtonElement): Promise<void> {
    if (this.#busy || !this.#input) return
    const transcript = this.#input.value.trim()
    if (!transcript) {
      this.#input.focus()
      this.#setStatus('Add some transcript text first.', true)
      return
    }
    if (this.#chosenTargets.size === 0) {
      this.#setStatus('Choose at least one destination for the keywords.', true)
      return
    }
    this.#busy = true
    button.disabled = true
    const session = this.#session
    const targetKeys = [...this.#chosenTargets]
    const displayTargets = targetKeys.map(target =>
      target === CURRENT_TARGET ? this.#segments.at(-1) ?? 'current layer' : target)
    try {
      await this.generation.request(transcript, targetKeys, displayTargets, this.#segments)
      if (this.#activeJobId) this.generation.complete(this.#activeJobId)
      if (session === this.#session) this.close()
    } catch (error) {
      if (session !== this.#session) return
      this.#busy = false
      button.disabled = false
      this.#setStatus(
        `Could not start the background request: ${String((error as Error)?.message ?? error)}`,
        true,
      )
    }
  }

  #renderGroups(): void {
    if (!this.#results) return
    this.#results.replaceChildren()
    for (const group of this.#groups) {
      const section = el('section', 'hc-kws-group')
      section.append(el('h2', 'hc-kws-group-name', group.name))
      const list = el('div', 'hc-kws-options')
      for (const keyword of group.keywords) {
        const option = el('button', 'hc-kws-option')
        option.type = 'button'
        option.setAttribute('aria-pressed', String(this.#chosenKeywords.has(keyword)))
        const mark = el('span', 'hc-kws-mark', this.#chosenKeywords.has(keyword) ? '✓' : '')
        option.append(mark, document.createTextNode(keyword))
        option.addEventListener('click', () => {
          if (this.#chosenKeywords.has(keyword)) this.#chosenKeywords.delete(keyword)
          else this.#chosenKeywords.add(keyword)
          option.classList.toggle('on', this.#chosenKeywords.has(keyword))
          option.setAttribute('aria-pressed', String(this.#chosenKeywords.has(keyword)))
          mark.textContent = this.#chosenKeywords.has(keyword) ? '✓' : ''
          this.#syncApply()
        })
        list.append(option)
      }
      section.append(list)
      this.#results.append(section)
    }
  }

  #syncApply(): void {
    if (!this.#apply) return
    this.#apply.disabled = this.#busy || this.#chosenKeywords.size === 0 || this.#chosenTargets.size === 0
    this.#apply.textContent = this.#chosenKeywords.size
      ? `Add ${this.#chosenKeywords.size} keyword${this.#chosenKeywords.size === 1 ? '' : 's'}`
      : 'Add selected keywords'
  }

  async #applyKeywords(): Promise<void> {
    if (this.#busy || !this.#chosenKeywords.size || !this.#chosenTargets.size) return
    const decorations = ioc<DecorationServiceLike>('@diamondcoreprocessor.com/DecorationService')
    if (!decorations?.addTag) {
      this.#setStatus('Keyword storage is not ready yet. Try again in a moment.', true)
      return
    }
    this.#busy = true
    const session = this.#session
    const targets = [...this.#chosenTargets]
    const keywords = [...this.#chosenKeywords]
    const segments = [...this.#segments]
    this.#syncApply()
    const updates: Array<{ cell: string; tag: string }> = []
    try {
      for (const target of targets) {
        for (const tag of keywords) {
          const targetSegments = target === CURRENT_TARGET ? segments : [...segments, target]
          const cell = target === CURRENT_TARGET ? segments.at(-1) ?? 'current layer' : target
          await decorations.addTag(targetSegments, tag)
          updates.push({ cell, tag })
        }
      }
      const registry = ioc<TagRegistryLike>('@hypercomb.social/TagRegistry')
      if (registry) {
        await registry.ensureLoaded()
        for (const tag of keywords) await registry.add(tag)
      }
      EffectBus.emit('tags:changed', { updates })
      EffectBus.emit('toast:show', {
        type: 'success',
        message: `${keywords.length} keyword${keywords.length === 1 ? '' : 's'} added to ${targets.length} tile${targets.length === 1 ? '' : 's'}.`,
      })
      if (this.#activeJobId) this.generation.complete(this.#activeJobId)
      if (session === this.#session) this.close()
    } catch (error) {
      if (session !== this.#session) return
      this.#busy = false
      this.#syncApply()
      this.#setStatus(`Could not add the keywords: ${String((error as Error)?.message ?? error)}`, true)
    }
  }

  #setStatus(text: string, error = false): void {
    if (!this.#status) return
    this.#status.textContent = text
    this.#status.classList.toggle('error', error)
  }

  close(): void {
    this.#session++
    window.removeEventListener('keydown', this.#onKey, true)
    this.#host?.remove()
    this.#host = null
    this.#input = null
    this.#results = null
    this.#status = null
    this.#apply = null
    this.#activeJobId = null
    this.#busy = false
    ioc<ModeRegistryLike>('@diamondcoreprocessor.com/ModeRegistry')?.exit('view:active', OWNER)
  }

  #ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
.hc-kws{position:fixed;inset:0;z-index:100000;display:grid;grid-template-rows:auto 1fr auto;color:#d8e6ee;
  background:rgba(7,10,15,.98);font-family:var(--md-font-family,system-ui,sans-serif)}
.hc-kws-head,.hc-kws-foot{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 24px;
  border-color:rgba(126,182,214,.18);border-style:solid}.hc-kws-head{border-width:0 0 1px}.hc-kws-foot{border-width:1px 0 0}
.hc-kws-kicker,.hc-kws-label{font:600 11px/1.3 var(--md-font-mono,ui-monospace,monospace);letter-spacing:.14em;
  text-transform:uppercase;color:rgba(126,182,214,.68)}.hc-kws-title{margin:3px 0 0;font-size:22px;color:#edf6fa}
.hc-kws-close{width:44px;height:44px;border:0;border-radius:8px;background:transparent;color:rgba(216,230,238,.55);
  font-size:28px;cursor:pointer}.hc-kws-close:hover{background:rgba(255,255,255,.06);color:white}
.hc-kws-body{display:grid;grid-template-columns:minmax(280px,38%) 1fr;min-height:0}.hc-kws-source,.hc-kws-review{padding:22px;overflow:auto}
.hc-kws-source{border-right:1px solid rgba(126,182,214,.14)}.hc-kws-input{box-sizing:border-box;width:100%;min-height:180px;
  margin-top:8px;padding:12px 14px;resize:vertical;border:1px solid rgba(126,182,214,.28);border-radius:8px;outline:none;
  background:rgba(126,182,214,.05);color:#edf6fa;font:16px/1.55 inherit}.hc-kws-input:focus{border-color:rgba(126,182,214,.72)}
.hc-kws-input:read-only{color:rgba(216,230,238,.68);resize:none}.hc-kws-target-title{margin-top:20px}
.hc-kws-targets{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}.hc-kws-target,.hc-kws-option{
  border:1px solid rgba(216,230,238,.15);background:rgba(255,255,255,.035);color:#d8e6ee;cursor:pointer}
.hc-kws-target{min-height:36px;padding:7px 12px;border-radius:999px}.hc-kws-target.on{border-color:#7eb6d6;background:rgba(126,182,214,.18)}
.hc-kws-generate,.hc-kws-apply,.hc-kws-discard{min-height:44px;padding:9px 17px;border-radius:7px;font-weight:650;cursor:pointer}
.hc-kws-generate{width:100%;margin-top:20px;border:1px solid rgba(126,182,214,.65);background:rgba(126,182,214,.18);color:#eaf6fb}
.hc-kws-generate:disabled,.hc-kws-apply:disabled{opacity:.38;cursor:default}.hc-kws-status{margin:9px 0 20px;color:rgba(216,230,238,.55);
  font-size:13px;line-height:1.5}.hc-kws-status.error{color:#e79a97}.hc-kws-results{display:grid;gap:18px}
.hc-kws-group{padding:14px;border:1px solid rgba(126,182,214,.14);border-radius:10px;background:rgba(126,182,214,.025)}
.hc-kws-group-name{margin:0 0 11px;font-size:14px;color:#f0f7fa}.hc-kws-options{display:flex;flex-wrap:wrap;gap:8px}
.hc-kws-option{display:flex;align-items:center;gap:7px;min-height:38px;padding:7px 11px;border-radius:7px;text-align:left}
.hc-kws-option:hover{border-color:rgba(126,182,214,.5)}.hc-kws-option.on{border-color:#7eb6d6;background:rgba(126,182,214,.16);color:white}
.hc-kws-mark{display:grid;place-items:center;width:17px;height:17px;border:1px solid rgba(216,230,238,.25);border-radius:4px;font-size:11px}
.hc-kws-option.on .hc-kws-mark{background:#7eb6d6;border-color:#7eb6d6;color:#081017}
.hc-kws-apply{border:1px solid #7eb6d6;background:#7eb6d6;color:#071017}.hc-kws-discard{
  border:1px solid rgba(216,230,238,.22);background:transparent;color:rgba(216,230,238,.72)}
.hc-kws-foot-note{font-size:12px;color:rgba(216,230,238,.42)}
@media(max-width:720px){.hc-kws-body{grid-template-columns:1fr;overflow:auto}.hc-kws-source,.hc-kws-review{overflow:visible}
  .hc-kws-source{border-right:0;border-bottom:1px solid rgba(126,182,214,.14)}.hc-kws-head,.hc-kws-foot{padding:14px}
  .hc-kws-foot{flex-wrap:wrap}.hc-kws-apply{flex:1 1 180px}}
`
    document.head.append(style)
  }
}

const _keywordGeneration = new KeywordGenerationService()
window.ioc.register('@diamondcoreprocessor.com/KeywordGenerationService', _keywordGeneration)

const _keywordSuggestions = new KeywordSuggestionsView(_keywordGeneration)
window.ioc.register('@diamondcoreprocessor.com/KeywordSuggestionsView', _keywordSuggestions)
