// hc-icon — renders an IconRef as an SVG glyph.
//
// Single resolution path for both ref kinds: inline `path` renders
// immediately; `signature` asks the Store for the resource and uses the
// returned text as the SVG path `d` attribute. Signature-backed icons
// are expected to be warmed by the preloader before the component
// renders them — in the uncommon case the resource isn't resident the
// host just renders nothing until the fetch resolves.
//
// Everything (history categories, menu items, decorated drones) flows
// through this one component so adding a new decorated node is just
// attaching an IconRef — no parallel rendering paths.

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  signal,
} from '@angular/core'
import type { IconRef } from '@hypercomb/core'
import { IconRef as IconRefGuards } from '@hypercomb/core'

type StoreLike = {
  getResource(signature: string): Promise<Blob | null>
}

@Component({
  selector: 'hc-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (path(); as d) {
      <svg [attr.viewBox]="viewBox()" aria-hidden="true">
        <path [attr.d]="d"></path>
      </svg>
    }
  `,
  styles: `
    :host { display: inline-flex; align-items: center; justify-content: center; line-height: 0; }
    svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; }
  `,
})
export class IconComponent {

  readonly ref = input<IconRef | null>(null)
  readonly viewBox = input<string>('0 0 24 24')

  // Resolved `d` attribute for signature refs. Path refs never touch
  // this — they short-circuit through `path()` directly.
  #resolved = signal<{ signature: string; d: string } | null>(null)
  #loadSeq = 0

  readonly path = computed<string | null>(() => {
    const r = this.ref()
    if (!r) return null
    if (IconRefGuards.isPath(r)) return r.path
    const cached = this.#resolved()
    return cached && cached.signature === r.signature ? cached.d : null
  })

  constructor() {
    effect(() => {
      const r = this.ref()
      if (!r || !IconRefGuards.isSignature(r)) return
      const cached = this.#resolved()
      if (cached && cached.signature === r.signature) return
      const seq = ++this.#loadSeq
      void this.#fetchSignature(r.signature, seq)
    })
  }

  async #fetchSignature(signature: string, seq: number): Promise<void> {
    const store = window.ioc?.get<StoreLike>('@hypercomb.social/Store') ?? null
    if (!store) return
    try {
      const blob = await store.getResource(signature)
      if (seq !== this.#loadSeq) return
      if (!blob) return
      const d = (await blob.text()).trim()
      if (seq !== this.#loadSeq) return
      this.#resolved.set({ signature, d })
    } catch { /* ignored — icon stays blank until ref changes */ }
  }
}
