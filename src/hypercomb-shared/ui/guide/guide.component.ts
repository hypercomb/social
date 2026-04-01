// hypercomb-shared/ui/guide/guide.component.ts
//
// Learning guide panel — glassmorphic overlay showing categorized topics
// with progress tracking. Subscribes to GuideDrone state via fromRuntime().

import { Component, computed, type OnInit, type OnDestroy } from '@angular/core'
import { EffectBus, type I18nProvider, I18N_IOC_KEY } from '@hypercomb/core'
import { fromRuntime } from '../../core/from-runtime'
import { TranslatePipe } from '../../core/i18n.pipe'

import type {
  GuideState,
  GuideCategory,
  GuideTopic,
  GuideStep,
} from '@hypercomb/essentials/diamondcoreprocessor.com/commands/guide.drone'

import { GUIDE_CATEGORIES } from
  '@hypercomb/essentials/diamondcoreprocessor.com/commands/guide.drone'

@Component({
  selector: 'hc-guide',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './guide.component.html',
  styleUrls: ['./guide.component.scss'],
})
export class GuideComponent implements OnInit, OnDestroy {

  #drone: any
  #unsub: (() => void) | null = null

  readonly categories = GUIDE_CATEGORIES

  private readonly state$ = fromRuntime(
    get('@diamondcoreprocessor.com/GuideDrone') as EventTarget,
    () => (this.#drone?.state ?? { open: false, topics: [], completedTopics: new Set(), activeCategory: null }) as GuideState,
  )

  readonly open = computed(() => this.state$().open)
  readonly topics = computed(() => this.state$().topics)
  readonly completedTopics = computed(() => this.state$().completedTopics)
  readonly activeCategory = computed(() => this.state$().activeCategory)
  readonly progress = computed(() => this.#drone?.progressPercent ?? 0)

  readonly visibleTopics = computed(() => {
    const cat = this.activeCategory()
    if (!cat) return []
    return this.topics().filter(t => t.category === cat)
  })

  ngOnInit(): void {
    this.#drone = get('@diamondcoreprocessor.com/GuideDrone')

    this.#unsub = EffectBus.on<{ cmd: string }>('keymap:invoke', payload => {
      if (payload?.cmd === 'global.escape' && this.open()) this.close()
    })
  }

  ngOnDestroy(): void {
    this.#drone = undefined
    this.#unsub?.()
  }

  close(): void {
    EffectBus.emit('guide:close', undefined)
  }

  selectCategory(category: GuideCategory): void {
    this.#drone?.setCategory?.(category)
  }

  isCompleted(topicId: string): boolean {
    return this.completedTopics().has(topicId)
  }

  completeTopic(topicId: string): void {
    this.#drone?.completeTopic?.(topicId)
  }

  resetProgress(): void {
    this.#drone?.resetProgress?.()
  }

  categoryProgress(category: GuideCategory): number {
    const all = this.topics().filter(t => t.category === category)
    if (all.length === 0) return 0
    const done = all.filter(t => this.completedTopics().has(t.id)).length
    return Math.round((done / all.length) * 100)
  }

  categoryCount(category: GuideCategory): { done: number; total: number } {
    const all = this.topics().filter(t => t.category === category)
    const done = all.filter(t => this.completedTopics().has(t.id)).length
    return { done, total: all.length }
  }

  t(key: string): string {
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    return i18n?.t(key) ?? key
  }
}
