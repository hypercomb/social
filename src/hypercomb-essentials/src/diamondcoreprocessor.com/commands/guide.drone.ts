// diamondcoreprocessor.com/commands/guide.drone.ts
//
// Learning guide system — tracks user milestones and surfaces contextual tips.
// Progressively reveals features as the user discovers the app.
//
// Effects:
//   'guide:open'   — open the full learning guide panel
//   'guide:close'  — close the guide panel
//   'guide:state'  — emitted whenever state changes (for the component)

import { EffectBus, type I18nProvider, I18N_IOC_KEY } from '@hypercomb/core'

// ── topic definitions ──────────────────────────────────

export interface GuideTopic {
  readonly id: string
  readonly titleKey: string
  readonly descriptionKey: string
  readonly category: GuideCategory
  readonly steps: readonly GuideStep[]
  readonly triggerEffect?: string        // effect that reveals this topic's tip
}

export interface GuideStep {
  readonly key: string                   // i18n key for step text
  readonly shortcut?: string             // keyboard shortcut hint (e.g. "Ctrl+K")
  readonly command?: string              // slash command (e.g. "/help")
}

export type GuideCategory = 'getting-started' | 'navigation' | 'content' | 'organization' | 'collaboration' | 'power-user'

export interface GuideState {
  open: boolean
  topics: readonly GuideTopic[]
  completedTopics: ReadonlySet<string>
  activeCategory: GuideCategory | null
}

const STORAGE_KEY = 'hc:guide-completed'
const WELCOMED_KEY = 'hc:guide-welcomed'
const TIP_COOLDOWN = 60_000  // min ms between automatic tips

// ── topic registry ─────────────────────────────────────

const TOPICS: GuideTopic[] = [
  // ── getting started ──
  {
    id: 'welcome',
    titleKey: 'guide.welcome.title',
    descriptionKey: 'guide.welcome.description',
    category: 'getting-started',
    steps: [
      { key: 'guide.welcome.step-explore' },
      { key: 'guide.welcome.step-command', shortcut: 'Ctrl+Space' },
      { key: 'guide.welcome.step-help', command: '/guide' },
    ],
  },
  {
    id: 'create-cell',
    titleKey: 'guide.create-cell.title',
    descriptionKey: 'guide.create-cell.description',
    category: 'getting-started',
    triggerEffect: 'cell:added',
    steps: [
      { key: 'guide.create-cell.step-focus', shortcut: 'Ctrl+Space' },
      { key: 'guide.create-cell.step-type' },
      { key: 'guide.create-cell.step-nested' },
    ],
  },

  // ── navigation ──
  {
    id: 'navigate',
    titleKey: 'guide.navigate.title',
    descriptionKey: 'guide.navigate.description',
    category: 'navigation',
    steps: [
      { key: 'guide.navigate.step-arrows' },
      { key: 'guide.navigate.step-enter' },
      { key: 'guide.navigate.step-back' },
    ],
  },
  {
    id: 'pan-zoom',
    titleKey: 'guide.pan-zoom.title',
    descriptionKey: 'guide.pan-zoom.description',
    category: 'navigation',
    steps: [
      { key: 'guide.pan-zoom.step-pan' },
      { key: 'guide.pan-zoom.step-zoom' },
      { key: 'guide.pan-zoom.step-fit' },
    ],
  },

  // ── content ──
  {
    id: 'tile-editor',
    titleKey: 'guide.tile-editor.title',
    descriptionKey: 'guide.tile-editor.description',
    category: 'content',
    triggerEffect: 'editor:open',
    steps: [
      { key: 'guide.tile-editor.step-select' },
      { key: 'guide.tile-editor.step-image' },
      { key: 'guide.tile-editor.step-link' },
      { key: 'guide.tile-editor.step-save' },
    ],
  },

  // ── organization ──
  {
    id: 'clipboard',
    titleKey: 'guide.clipboard.title',
    descriptionKey: 'guide.clipboard.description',
    category: 'organization',
    triggerEffect: 'clipboard:paste-done',
    steps: [
      { key: 'guide.clipboard.step-copy', shortcut: 'C' },
      { key: 'guide.clipboard.step-cut', shortcut: 'X' },
      { key: 'guide.clipboard.step-paste', shortcut: 'Enter' },
    ],
  },
  {
    id: 'move-tiles',
    titleKey: 'guide.move-tiles.title',
    descriptionKey: 'guide.move-tiles.description',
    category: 'organization',
    triggerEffect: 'move:committed',
    steps: [
      { key: 'guide.move-tiles.step-activate', command: '/move' },
      { key: 'guide.move-tiles.step-drag' },
      { key: 'guide.move-tiles.step-layout', command: '/layout save' },
    ],
  },
  {
    id: 'keywords',
    titleKey: 'guide.keywords.title',
    descriptionKey: 'guide.keywords.description',
    category: 'organization',
    triggerEffect: 'tags:changed',
    steps: [
      { key: 'guide.keywords.step-add', command: '/keyword' },
      { key: 'guide.keywords.step-filter' },
      { key: 'guide.keywords.step-remove' },
    ],
  },

  // ── collaboration ──
  {
    id: 'mesh',
    titleKey: 'guide.mesh.title',
    descriptionKey: 'guide.mesh.description',
    category: 'collaboration',
    triggerEffect: 'mesh:public-changed',
    steps: [
      { key: 'guide.mesh.step-toggle', shortcut: 'Shift+P' },
      { key: 'guide.mesh.step-relay' },
      { key: 'guide.mesh.step-meeting', command: '/meeting' },
    ],
  },

  // ── power user ──
  {
    id: 'command-palette',
    titleKey: 'guide.command-palette.title',
    descriptionKey: 'guide.command-palette.description',
    category: 'power-user',
    steps: [
      { key: 'guide.command-palette.step-open', shortcut: 'Ctrl+K' },
      { key: 'guide.command-palette.step-search' },
      { key: 'guide.command-palette.step-recent' },
    ],
  },
  {
    id: 'slash-commands',
    titleKey: 'guide.slash-commands.title',
    descriptionKey: 'guide.slash-commands.description',
    category: 'power-user',
    steps: [
      { key: 'guide.slash-commands.step-type' },
      { key: 'guide.slash-commands.step-autocomplete' },
      { key: 'guide.slash-commands.step-help', command: '/help' },
    ],
  },
  {
    id: 'shortcuts',
    titleKey: 'guide.shortcuts.title',
    descriptionKey: 'guide.shortcuts.description',
    category: 'power-user',
    steps: [
      { key: 'guide.shortcuts.step-view', shortcut: '/' },
      { key: 'guide.shortcuts.step-escape', shortcut: 'Escape' },
      { key: 'guide.shortcuts.step-palette', shortcut: 'Ctrl+K' },
    ],
  },
]

const CATEGORIES: { id: GuideCategory; labelKey: string }[] = [
  { id: 'getting-started',  labelKey: 'guide.category.getting-started' },
  { id: 'navigation',       labelKey: 'guide.category.navigation' },
  { id: 'content',          labelKey: 'guide.category.content' },
  { id: 'organization',     labelKey: 'guide.category.organization' },
  { id: 'collaboration',    labelKey: 'guide.category.collaboration' },
  { id: 'power-user',       labelKey: 'guide.category.power-user' },
]

export { CATEGORIES as GUIDE_CATEGORIES }

export class GuideDrone extends EventTarget {
  #open = false
  #completedTopics: Set<string>
  #activeCategory: GuideCategory | null = null
  #lastTipAt = 0
  #unsubs: (() => void)[] = []

  get state(): GuideState {
    return {
      open: this.#open,
      topics: TOPICS,
      completedTopics: this.#completedTopics,
      activeCategory: this.#activeCategory,
    }
  }

  get progressPercent(): number {
    return Math.round((this.#completedTopics.size / TOPICS.length) * 100)
  }

  constructor() {
    super()

    // restore persisted progress
    const stored = localStorage.getItem(STORAGE_KEY)
    this.#completedTopics = stored ? new Set(JSON.parse(stored)) : new Set()

    // listen for guide open/close
    EffectBus.on('guide:open', () => this.#openGuide())
    EffectBus.on('guide:close', () => this.#closeGuide())

    // listen for contextual trigger effects — fire a tip toast when user
    // performs an action related to an uncompleted topic for the first time
    for (const topic of TOPICS) {
      if (!topic.triggerEffect) continue
      this.#unsubs.push(
        EffectBus.on(topic.triggerEffect, () => this.#onTopicTriggered(topic))
      )
    }

    // welcome tip on first visit
    queueMicrotask(() => this.#maybeWelcome())
  }

  completeTopic(topicId: string): void {
    if (this.#completedTopics.has(topicId)) return
    this.#completedTopics.add(topicId)
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.#completedTopics]))
    this.#emit()
  }

  resetProgress(): void {
    this.#completedTopics.clear()
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(WELCOMED_KEY)
    this.#emit()
  }

  setCategory(category: GuideCategory | null): void {
    this.#activeCategory = category
    this.#emit()
  }

  topicsForCategory(category: GuideCategory): readonly GuideTopic[] {
    return TOPICS.filter(t => t.category === category)
  }

  #openGuide(): void {
    this.#open = true
    EffectBus.emit('keymap:suppress', { reason: 'guide' })
    this.#emit()
  }

  #closeGuide(): void {
    this.#open = false
    EffectBus.emit('keymap:unsuppress', { reason: 'guide' })
    this.#emit()
  }

  #onTopicTriggered(topic: GuideTopic): void {
    if (this.#completedTopics.has(topic.id)) return

    const now = Date.now()
    if (now - this.#lastTipAt < TIP_COOLDOWN) return
    this.#lastTipAt = now

    // mark completed — the user performed the action
    this.completeTopic(topic.id)

    // show a congratulatory tip toast
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    const title = i18n?.t(topic.titleKey) ?? topic.id
    const message = i18n?.t('guide.tip.discovered', { feature: title }) ?? `You discovered: ${title}`

    EffectBus.emit('toast:show', {
      type: 'tip',
      title: i18n?.t('guide.tip.title') ?? 'New skill unlocked',
      message,
      duration: 6_000,
      actionLabel: i18n?.t('guide.tip.learn-more') ?? 'Learn more',
      actionEffect: 'guide:open',
    })
  }

  #maybeWelcome(): void {
    if (localStorage.getItem(WELCOMED_KEY)) return
    localStorage.setItem(WELCOMED_KEY, 'true')

    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined

    // small delay so the app settles before the first toast
    setTimeout(() => {
      EffectBus.emit('toast:show', {
        type: 'tip',
        title: i18n?.t('guide.welcome.toast-title') ?? 'Welcome to Hypercomb',
        message: i18n?.t('guide.welcome.toast-message') ?? 'Type /guide to open the learning guide, or press Ctrl+Space to start creating.',
        duration: 12_000,
        actionLabel: i18n?.t('guide.welcome.toast-action') ?? 'Open guide',
        actionEffect: 'guide:open',
      })
    }, 2_500)
  }

  #emit(): void {
    this.dispatchEvent(new Event('change'))
    EffectBus.emit('guide:state', this.state)
  }
}

const _guide = new GuideDrone()
window.ioc.register('@diamondcoreprocessor.com/GuideDrone', _guide)
