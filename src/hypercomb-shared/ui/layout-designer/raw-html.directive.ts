// hypercomb-shared/ui/layout-designer/raw-html.directive.ts
//
// MOUNT MARKUP THE SANITISER WOULD TAKE APART.
//
// Angular's `[innerHTML]` binding runs the DOM sanitiser, which strips the
// `style` attribute and every `data-*` attribute. That is exactly right for
// anything a stranger authored, and exactly wrong for the one thing this
// directive exists for: markup THIS APPLICATION just generated from its own
// pure builder, whose entire content is inline custom properties and
// `data-hc-*` attributes.
//
// A layout container arrives as
//
//     <div data-hc-container="sidebar" style="display:flex;--hc-layout-left:10rem">
//       <div data-hc-slot="0" data-hc-hole="left" data-hc-fill="fixed" style="flex:0 0 …">
//
// Through `[innerHTML]` every one of those attributes is removed, so the
// arrangement mounts as a stack of empty unstyled divs — it renders as
// nothing, and the CSS that dresses the holes matches nothing either. That is
// not a styling bug that can be worked around in the sheet; the information is
// already gone by the time the element exists.
//
// ── WHY THIS IS SAFE HERE, AND ONLY HERE ────────────────────────────────
//
// The value must be markup the app MINTED, never markup it received. Layout
// markup is produced by `layout-template.ts`, which is pure, emits a fixed set
// of elements and attributes, and escapes every value that reaches an
// attribute (`attr()`) or a style (`cssLength()` rejects `;{}<>"'`). No hole
// key, variable name or value the participant can type survives into the
// output unchecked.
//
// So the rule for this directive is a one-liner, and it is the whole contract:
// pass it the output of a builder in this repository, never a string that came
// from a peer, a page, a note, a paste, or the network. If you find yourself
// wanting it for content, you want `[innerHTML]` and its sanitiser instead.

import { Directive, ElementRef, effect, inject, input } from '@angular/core'

@Directive({
  selector: '[hcRawHtml]',
  standalone: true,
})
export class RawHtmlDirective {
  /** App-minted markup. See the header — never a foreign string. */
  readonly hcRawHtml = input<string>('')

  readonly #host = inject(ElementRef<HTMLElement>)

  constructor() {
    effect(() => {
      const host = this.#host.nativeElement as HTMLElement | null
      if (host) host.innerHTML = this.hcRawHtml() ?? ''
    })
  }
}
