// hypercomb-shared/ui/flex-editor/flex-editor.component.ts
//
// THE FLEX EDITOR — the other side of the pane.
//
// Select a container in the layout designer and this opens on the RIGHT,
// opposite the palette: the palette is what a container could BE, this is how
// the one you picked BEHAVES.
//
// ── AN ACCORDION OF AXES ────────────────────────────────────────────────
//
// Five properties decide how a flexbox container arranges what is in it. Each
// is a row that, SHUT, says what the axis does and what this container is
// currently set to — so the panel reads as a summary of the configuration
// without being opened at all. OPEN, it shows you: a live preview of YOUR
// container wearing each value.
//
// One at a time, because five axes of previews at once is a wall, and it asks
// you to compare twenty-four pictures when the question in front of you
// concerns four.
//
// ── THE GALLERY AND THE EDITOR ARE THE SAME OBJECT ──────────────────────
//
// Choosing between `space-around` and `space-evenly` is a matter of looking at
// them — it always was. So every picture is both the illustration of a value
// and the control that chooses it, and there is no separate list of names.
//
// One preview per VALUE, never per combination: each holds the other axes at
// what this container already says, so walking down the panel is walking
// through the configuration one decision at a time.
//
// ── IT SHOWS THE REAL THING ─────────────────────────────────────────────
//
// Every preview is `templateContainer` output — the same pure builder that
// draws the container on the page and in the palette chip, at chip scale. A
// preview cannot advertise an arrangement the layout does not make, because
// there is no second drawing routine to drift from the first.
//
// ── IT READS NOTHING ITSELF ─────────────────────────────────────────────
//
// Shell UI must not import essentials. TemplateAuthorDrone is the one reader;
// this window renders `template:selected` and emits `template:set-var` back —
// the same intent the designer's own sliders use, so a variable has one write
// path however it was moved.

import { registerShellSurface } from '../../core/shell-surface-registry'
import { Component, computed, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { RawHtmlDirective } from '../layout-designer/raw-html.directive'
import { signalSession } from '../window-session'

interface AxisValueState { value: string; active: boolean; preview: string }
interface AxisState { name: string; values: AxisValueState[] }

interface SelectionMsg {
  segments?: string[]
  path?: string[]
  layout?: string
  axes?: AxisState[]
}

@Component({
  selector: 'hc-flex-editor',
  standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective, RawHtmlDirective],
  templateUrl: './flex-editor.component.html',
  styleUrls: ['./flex-editor.component.scss'],
})
export class FlexEditorComponent implements OnDestroy {

  readonly visible = signal(false)

  /** A COMPANION, not a window of its own.
   *
   *  The shell parks every other tool window when one opens — one window at a
   *  time, because a tool window is the thing you are doing (window-rule.ts).
   *  This is not that. It cannot exist without the designer, it shows the
   *  container the designer has selected, and every press in it edits that
   *  selection: put the two side by side or neither is any use. That is the
   *  same relation the pheromone palette has to whatever it paints, and the
   *  rule states its exception without naming ids so exactly this case can
   *  declare itself into it.
   *
   *  On a phone the exception is spent — one full-bleed sheet has no room for
   *  a second — and the rule decides that on its own. */
  readonly session = signalSession(
    this.visible,
    open => EffectBus.emit('flex:view-state', { open }),
    { dismiss: () => this.dismiss(), close: () => this.close() },
    { companion: true },
  )

  // ── what the drone tells us ───────────────────────────────────────
  readonly segments = signal<string[]>([])
  readonly path = signal<string[]>([])
  readonly layout = signal('')
  readonly axes = signal<AxisState[]>([])

  /** Which axis is open. One at a time — see the header. */
  readonly openAxis = signal('')

  /** The level being configured, as a trail. */
  readonly where = computed(() => this.path().join(' › '))

  #busCleanup: (() => void)[] = []

  constructor() {
    // The designer owns whether there is a selection at all; this window is
    // its other half and never opens on its own.
    this.#busCleanup.push(EffectBus.on<SelectionMsg | null>('template:selected', state => {
      if (!state?.axes?.length) {
        this.axes.set([])
        this.visible.set(false)
        return
      }
      const moved = (state.path ?? []).join('/') !== this.path().join('/')
      this.segments.set((state.segments ?? []).map(String))
      this.path.set((state.path ?? []).map(String))
      this.layout.set(String(state.layout ?? ''))
      this.axes.set(state.axes ?? [])
      // A different container is a different question: do not carry the last
      // one's open row across, or the panel answers something nobody asked.
      if (moved) this.openAxis.set('')
      this.visible.set(true)
    }))

    // Closing the designer closes this with it: a configuration editor for a
    // container nobody is looking at is a window in the way.
    this.#busCleanup.push(EffectBus.on<{ open?: boolean }>('template:view-state', state => {
      if (state?.open === false) this.visible.set(false)
    }))
  }

  ngOnDestroy(): void {
    for (const off of this.#busCleanup) off()
    this.#busCleanup = []
  }

  toggleAxis(name: string): void {
    this.openAxis.update(open => (open === name ? '' : name))
  }

  /** What this axis is currently set to — what a shut row shows. */
  current(axis: AxisState): string {
    return axis.values.find(value => value.active)?.value ?? ''
  }

  /** One write path for a variable, however it was moved — the same intent the
   *  designer's own sliders emit. */
  choose(axis: string, value: string): void {
    EffectBus.emit('template:set-var', {
      segments: this.segments(),
      path: this.path(),
      name: axis,
      value,
    })
  }

  /** One level back per press: shut the open axis, then let the cascade on. */
  dismiss(): boolean {
    if (!this.openAxis()) return false
    this.openAxis.set('')
    return true
  }

  close(): void {
    this.visible.set(false)
    EffectBus.emit('flex:view-state', { open: false })
  }
}

registerShellSurface({
  name: 'hc-flex-editor',
  owner: '@hypercomb.shared/FlexEditorComponent',
  component: FlexEditorComponent,
  order: 137,
})
