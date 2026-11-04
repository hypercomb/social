// hypercomb-shared/core/i18n.pipe.view.spec.ts — THE WORDS IN A VIEW.
//
// The pipe spec proves the pipe; this one proves the view around it, through
// Angular itself: a rendered `{{ 'key' | t }}` costs no lookup when an
// unrelated signal ticks, and flips when the locale does — the catalog version
// being a signal the view read is what refreshes it, without markForCheck.

import '@angular/compiler'
import { describe, expect, it } from 'vitest'

type Globals = typeof globalThis & {
  register?: (key: string, value: unknown) => void
  get?: (key: string) => unknown
}
const registry = new Map<string, unknown>()
;(globalThis as Globals).register = (key, value) => { registry.set(key, value) }
;(globalThis as Globals).get = (key) => registry.get(key)

const nextTick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('a view that shows words', () => {
  it('costs no lookup when an unrelated signal ticks, and flips with the locale', async () => {
    localStorage.clear()
    localStorage.setItem('hc:locale', 'en')
    // One module graph for the whole test — Angular's testing module and the
    // component class must share one @angular/core.
    const { Component, ChangeDetectionStrategy, signal, provideZonelessChangeDetection } = await import('@angular/core')
    const { TestBed } = await import('@angular/core/testing')
    const { BrowserTestingModule, platformBrowserTesting } = await import('@angular/platform-browser/testing')
    const { LocalizationService } = await import('../../hypercomb-runtime/src/i18n.service')
    const { TranslatePipe, translateStats } = await import('./i18n.pipe')

    const i18n = registry.get('@hypercomb.social/I18n') as InstanceType<typeof LocalizationService>
    i18n.registerTranslations('app', 'en', { 'editor.save': 'Save' })
    i18n.registerTranslations('app', 'ja', { 'editor.save': '保存' })
    await nextTick()

    TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting())
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] })

    @Component({
      selector: 'hc-words-probe',
      standalone: true,
      imports: [TranslatePipe],
      changeDetection: ChangeDetectionStrategy.OnPush,
      template: `<span class="word">{{ 'editor.save' | t }}</span><span class="tick">{{ tick() }}</span>`,
    })
    class WordsProbe {
      readonly tick = signal(0)
    }

    const fixture = TestBed.createComponent(WordsProbe)
    await fixture.whenStable()
    const host = fixture.nativeElement as HTMLElement
    const text = (): string => host.querySelector('.word')?.textContent ?? ''
    expect(text()).toBe('Save')

    const lookups = translateStats.lookups
    for (let n = 1; n <= 20; n++) {
      fixture.componentInstance.tick.set(n)
      await fixture.whenStable()
    }
    expect(host.querySelector('.tick')?.textContent).toBe('20')
    expect(translateStats.lookups).toBe(lookups)

    i18n.setLocale('ja')
    await nextTick()
    await fixture.whenStable()
    expect(text()).toBe('保存')
    expect(translateStats.lookups).toBe(lookups + 1)
  }, 30_000)
})
