// src/app/common/header/search-bar/search-bar.component.ts

import { Component, AfterViewInit, OnDestroy, ViewChild, ElementRef, inject, signal, computed } from "@angular/core"
import { CompletionContext, CompletionUtility } from "../../../core/completion-utility"
import { InitState } from "../../../core/model"
import { ScriptPreloaderService } from "../../../core/script-preloader.service"
import { ResourceCompletionService } from "./resource-completion.service"
import { Lineage } from "../../../core/lineage"
import { MovementService } from "../../../core/movement.service"
import { Navigation } from "../../../core/navigation"
import { hypercomb } from "@hypercomb/core"

@Component({
  selector: 'hc-search-bar',
  standalone: true,
  templateUrl: './search-bar.component.html',
  styleUrls: ['./search-bar.component.scss']
})
export class SearchBarComponent extends hypercomb implements AfterViewInit, OnDestroy {
  private readonly completions = inject(CompletionUtility)
  @ViewChild('input', { static: true })
  private readonly input!: ElementRef<HTMLInputElement>

  private readonly lineage = inject(Lineage)
  private readonly movement = inject(MovementService)
  private readonly navigation = inject(Navigation)
  private readonly preloader = inject(ScriptPreloaderService)
  private readonly resources = inject(ResourceCompletionService)

  private initState: InitState = 'unlocked'

  private readonly value = signal('')
  private readonly activeIndex = signal(0)
  private readonly suppressed = signal(false)

  // open dcp only once per page load, and only while locked
  private dcpOpened = false

  // -------------------------------------------------
  // readiness / locking
  // -------------------------------------------------

  // app becomes usable as soon as any payload exists in /__resources__
  // (even if action extraction fails, typing must not be blocked)
  private readonly hasAnyResources = computed<boolean>(() => this.preloader.resourceCount() > 0)

  // locked only while there are zero payloads in /__resources__
  private readonly locked = computed<boolean>(() => !this.hasAnyResources())

  // -------------------------------------------------
  // placeholder
  // -------------------------------------------------

  public readonly placeholder = computed<string>(() => {
    return this.locked()
      ? 'press # to open dcp...'
      : 'search actions...'
  })

  // -------------------------------------------------
  // completion context
  // -------------------------------------------------

  private readonly context = computed<CompletionContext>(() => {
    const v = this.value()
    const lastHash = v.lastIndexOf('#')

    if (lastHash !== -1) {
      const after = v.slice(lastHash + 1)
      const leadingWs = after.match(/^\s*/)?.[0] ?? ''
      const raw = after.slice(leadingWs.length)

      return {
        active: true,
        mode: 'marker',
        head: v.slice(0, lastHash + 1) + leadingWs,
        raw,
        normalized: this.completions.normalize(raw),
        style: raw.includes('.') ? 'dot' : 'space'
      }
    }

    if (!v.trim()) return { active: false }

    return {
      active: true,
      mode: 'action',
      head: '',
      raw: v,
      normalized: this.completions.normalize(v),
      style: v.includes('.') ? 'dot' : 'space'
    }
  })

  // -------------------------------------------------
  // suggestions
  // -------------------------------------------------

  public readonly suggestions = computed<readonly string[]>(() => {
    if (this.suppressed()) return []

    const ctx = this.context()
    if (!ctx.active) return []

    const all = this.resources.names()
    if (!ctx.normalized) return all

    return all.filter((n: any) => n.startsWith(ctx.normalized))
  })

  public readonly showCompletions = computed<boolean>(() => {
    return this.suggestions().length > 0
  })

  // -------------------------------------------------
  // ghost mirror (second input layer)
  // -------------------------------------------------

  public readonly ghostValue = computed<string>(() => {
    if (!this.showCompletions()) return ''

    const ctx = this.context()
    if (!ctx.active) return ''

    const list = this.suggestions()
    const best = list[this.activeIndex()] ?? list[0]
    if (!best) return ''

    if (!best.startsWith(ctx.normalized)) return ''

    const rendered = this.completions.render(best, ctx.style)
    const prefix = this.completions.render(ctx.normalized, ctx.style)

    let suffix = rendered.slice(prefix.length)
    if (!suffix) return ''

    const current = this.value()
    const last = current.slice(-1)

    // avoid double separators when user already typed '.' or space
    if ((last === '.' || /\s/.test(last)) && (suffix.startsWith('.') || suffix.startsWith(' '))) {
      suffix = suffix.slice(1)
    }

    return current + suffix
  })

  // -------------------------------------------------
  // lifecycle
  // -------------------------------------------------

  public ngAfterViewInit(): void {
    this.input.nativeElement.focus()
    this.syncSignalsFromDom()
  }

  public ngOnDestroy(): void { }

  // -------------------------------------------------
  // template helpers (required)
  // -------------------------------------------------

  public getActiveIndex = (): number => this.activeIndex()

  public typedPart = (s: string): string => {
    const ctx = this.context()
    if (!ctx.active) return ''

    const rendered = this.completions.render(s, ctx.style)
    const prefix = this.completions.render(ctx.normalized, ctx.style)
    return rendered.slice(0, Math.min(prefix.length, rendered.length))
  }

  public restPart = (s: string): string => {
    const ctx = this.context()
    if (!ctx.active) return s

    const rendered = this.completions.render(s, ctx.style)
    const prefix = this.completions.render(ctx.normalized, ctx.style)
    return rendered.slice(Math.min(prefix.length, rendered.length))
  }

  public onSuggestionMouseDown = (e: MouseEvent, s: string, i: number): void => {
    e.preventDefault()
    this.activeIndex.set(i)
    this.acceptCompletion(s)
  }

  // -------------------------------------------------
  // input handling
  // -------------------------------------------------

  public onInput = (): void => {
    this.suppressed.set(false)
    this.syncSignalsFromDom()
    this.clampActiveIndex()
  }

  // src/app/common/header/search-bar/search-bar.component.ts

  // -------------------------------------------------
  // input handling
  // -------------------------------------------------

  public onKeyDown = (e: KeyboardEvent): void => {

    const el = this.input.nativeElement
    const v = el.value

    // -------------------------------------------------
    // open dcp whenever "#" is the only character
    // (always, not only while locked)
    // -------------------------------------------------
    if (e.key === 'Enter' && v.trim() === '#') {
      e.preventDefault()
      this.dcpOpened = true
      window.dispatchEvent(new CustomEvent('portal:open', { detail: { target: 'dcp' } }))
      this.clear()
      return
    }

    // open dcp only once, only while locked (no resources yet)
    if (this.locked() && !this.dcpOpened) {
      if (e.key === '#') {
        this.dcpOpened = true
        window.dispatchEvent(new CustomEvent('portal:open', { detail: { target: 'dcp' } }))
        // allow '#' to type
      }
    }

    // while locked: only allow '#', edit/nav keys, and shortcuts
    if (this.locked()) {
      if (this.blockWhileLocked(e)) return
    }

    if (this.handleCompletionKeys(e)) return

    // -------------------------------------------------
    // enter behavior:
    // - enter: selection toggle / create (no navigation)
    // - shift+enter: navigate to seed (no selection changes)
    // -------------------------------------------------
    if (e.key === 'Enter') {
      e.preventDefault()

      if (e.shiftKey) {
        void this.commitNavigate()
        return
      }

      void this.commit()
    }
  }

  // -------------------------------------------------
  // commit (selection toggle / create only)
  // -------------------------------------------------
  private readonly commit = async (): Promise<void> => {
    const raw = this.input.nativeElement.value.trim()
    if (!raw) return

    if (this.locked()) {
      this.clear()
      return
    }

    const hashIndex = raw.indexOf('#')

    const rawSeed =
      hashIndex === -1 ? raw : raw.slice(0, hashIndex).trim()

    const rawMarker =
      hashIndex === -1 ? null : raw.slice(hashIndex + 1).trim()

    const seedName = rawSeed
      ? this.completions.normalize(rawSeed)
      : null

    const markerName = rawMarker
      ? this.completions.normalize(rawMarker)
      : null

    const baseSegments = this.navigation.segments()

    // selection semantics
    if (seedName) {
      const target = [...baseSegments, seedName]
      const exists = await this.lineage.tryResolve(target)

      // // create only if missing
      // if (!exists) {
      //   await this.lineage.ensure(target)
      // }
      throw new Error('disabled for now')

      // toggle selection in url hash
     // this.navigation.toggleSelection(seedName)
    }

    // marker attachment (seed#marker)
    // if (markerName) {
    //   const descriptor = this.preloader.resolveByName(markerName)
    //   if (descriptor) {
    //     const target = seedName
    //       ? [...baseSegments, seedName]
    //       : baseSegments

    //     await this.lineage.addMarker(target, descriptor.signature)
    //   }
    // }

    this.clear()
  }

  // -------------------------------------------------
  // commit (navigate only)
  // -------------------------------------------------
  private readonly commitNavigate = async (): Promise<void> => {
    const raw = this.input.nativeElement.value.trim()
    if (!raw) return

    if (this.locked()) {
      this.clear()
      return
    }

    const hashIndex = raw.indexOf('#')

    const rawSeed =
      hashIndex === -1 ? raw : raw.slice(0, hashIndex).trim()

    const seedName = rawSeed
      ? this.completions.normalize(rawSeed)
      : null

    if (!seedName) {
      this.clear()
      return
    }

    const baseSegments = this.navigation.segments()
    const target = [...baseSegments, seedName]

    // navigate should only happen if seed exists
    const exists = await this.lineage.tryResolve(target)
    if (!exists) {
      // do not create and do not navigate on shift+enter
      this.clear()
      return
    }

    await this.movement.move(seedName)
    this.clear()
  }

  // -------------------------------------------------
  // completion logic
  // -------------------------------------------------

  private readonly handleCompletionKeys = (e: KeyboardEvent): boolean => {
    const list = this.suggestions()
    if (!list.length) return false

    if (e.key === 'Escape') {
      e.preventDefault()
      this.suppressed.set(true)
      return true
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      this.activeIndex.update(v => Math.min(v + 1, list.length - 1))
      return true
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      this.activeIndex.update(v => Math.max(v - 1, 0))
      return true
    }

    if (e.key === 'Tab' || e.key === 'ArrowRight') {
      e.preventDefault()
      this.acceptCompletion()
      return true
    }

    return false
  }

  private readonly acceptCompletion = (forced?: string): void => {
    const ctx = this.context()
    if (!ctx.active) return

    const list = this.suggestions()
    const best = forced ?? list[this.activeIndex()] ?? list[0]
    if (!best) return

    const rendered = this.completions.render(best, ctx.style)

    this.input.nativeElement.value =
      ctx.mode === 'marker'
        ? ctx.head + rendered + ' '
        : rendered + ' '

    this.suppressed.set(true)
    this.placeCaretAtEnd()
    this.syncSignalsFromDom()
  }

  private readonly clampActiveIndex = (): void => {
    const max = this.suggestions().length - 1
    this.activeIndex.update(v => Math.max(0, Math.min(v, max)))
  }

  // -------------------------------------------------
  // ui helpers
  // -------------------------------------------------

  private readonly clear = (): void => {
    this.input.nativeElement.value = ''
    this.syncSignalsFromDom()
  }

  private readonly placeCaretAtEnd = (): void => {
    const el = this.input.nativeElement
    queueMicrotask(() => el.setSelectionRange(el.value.length, el.value.length))
  }

  private readonly syncSignalsFromDom = (): void => {
    this.value.set(this.input.nativeElement.value)
  }

  // -------------------------------------------------
  // blocking logic (while locked)
  // -------------------------------------------------

  private readonly blockWhileLocked = (e: KeyboardEvent): boolean => {
    const key = e.key

    if (key === 'Backspace' || key === 'Delete') return false
    if (key === '#') return false
    if (key === 'Enter') return false

    if (
      key === 'ArrowLeft' ||
      key === 'ArrowRight' ||
      key === 'ArrowUp' ||
      key === 'ArrowDown' ||
      key === 'Home' ||
      key === 'End' ||
      key === 'Tab' ||
      key === 'Escape' ||
      key === 'Shift' ||
      key === 'Control' ||
      key === 'Alt' ||
      key === 'Meta'
    ) return false

    if (e.ctrlKey || e.metaKey) return false

    e.preventDefault()
    return true
  }

}
