// hypercomb-essentials/src/sharing/publish-groups.drone.ts
//
// PUBLISH GROUPS (jwize 2026-10-10) — "a behavior that you get to put tiles
// in, assign icons and colors in the hive itself": top of the hive, select
// then tap, per layer. The data model and every decision live in
// publish-groups.ts; this drone is the strip, the reads and the writes.
//
// THE STRIP. While `publish:groups` is lit on the layer you stand in (the
// Beehaviors panel deposits it like any behaviour), a row of the layer's
// groups sits at the top of the hive, each its own icon in its own colour,
// with a `+` at the end. Hexagons only: a takeover view, a published visitor
// shell, or a dormant behaviour takes it away.
//
//   • tiles selected, tap an icon → they join the group (or leave it, when
//     every selected tile is already in) — the members WEAR the group's mark;
//   • nothing selected, tap an icon → its editor: name, icon (the shared
//     chooser), colour, Publish, Ungroup;
//   • `+` → a new group, taking in whatever is selected;
//   • hover an icon → its members light in its colour (show-cell's
//     `group:preview`), the way a hovered pheromone lights its carriers.
//
// PUBLISH runs each member's branch through `publishBranch`, one after the
// other — never in parallel: every publish read-modify-writes the host's
// signed index, and two at once can drop each other's entry.
//
// Ungroup, not delete (documentation/hide-first-delete-second.md): it takes
// the marks and the group's record off this layer — an ordinary layer edit,
// and undo puts it back.

import {
  Drone, EffectBus, I18N_IOC_KEY, ICON_PICK_REQUEST, ICON_PICK_RESULT, ICON_PICKER_OPEN, groupSignature,
  type I18nProvider, type IconPickResult,
} from '@hypercomb/core'
import { removeDecorationAndWait, writeDecoration } from '../commands/decoration-manifest.js'
import { dropEnrollment, wearEnrollment } from '../pheromones/enrollment-acts.js'
import { ENABLEMENT_CHANGED, isBehaviorDormant, isPublishedVisitorShell } from './behavior-enablement.js'
import { publishBranch } from './publish-branch.js'
import {
  DEFAULT_GROUP_ICON, GROUP_COLORS, PUBLISH_GROUPS_KIND, PUBLISH_GROUP_KIND,
  decideTap, groupsInSlotOrder, newGroupMeaning, nextGroupColor, parseGroupPayload,
  type PublishGroup, type PublishGroupAppearance,
} from './publish-groups.js'

export const PUBLISH_GROUPS_SURFACE = 'hc-publish-groups'
export const PUBLISH_GROUPS_KEY = '@diamondcoreprocessor.com/PublishGroupsDrone'

/** Above the canvas host (59989), below the header (60000) — the band the
 *  history clock and the layer strip already share. */
const STRIP_Z = 59991
const SIG_RE = /^[0-9a-f]{64}$/
const STYLE_ID = 'hc-publish-groups-style'

type LayerLike = { name?: unknown; children?: unknown; decorations?: unknown }
type HistoryLike = {
  sign(lineage: { explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<LayerLike | null>
  getLayerBySig(sig: string): Promise<LayerLike | null>
}
type StoreLike = { getResource(sig: string): Promise<Blob | null> }
type RecordLike = { sig: string; kind: string; payload?: Record<string, unknown> }
type ViewModeLike = EventTarget & { mode?: string }

/** A group on the strip: its appearance, its identity, who wears it. */
interface Shown {
  readonly group: PublishGroup
  readonly sig: string
  readonly members: Set<string>
}

const ioc = <T>(key: string): T | undefined => window.ioc?.get?.<T>(key)

/** The element the shell-surface registry mounts. Its whole job is to exist
 *  in the DOM and tell the drone where it is. */
export class PublishGroupsElement extends HTMLElement {
  connectedCallback(): void {
    ioc<PublishGroupsDrone>(PUBLISH_GROUPS_KEY)?.attach(this)
  }

  disconnectedCallback(): void {
    ioc<PublishGroupsDrone>(PUBLISH_GROUPS_KEY)?.detach(this)
  }
}

export class PublishGroupsDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'Publish groups — the layer\'s tiles gathered under coloured icons at the top of the hive, each group publishable at once.'

  protected override deps = { lineage: '@hypercomb.social/Lineage' }
  protected override listens = [
    'decorations:changed', 'history:cursor-changed', 'selection:changed', 'view:active',
    'render:cell-count', ENABLEMENT_CHANGED, ICON_PICK_RESULT, ICON_PICKER_OPEN,
  ]
  protected override emits = ['group:preview', 'toast:show', 'publish:refresh', ICON_PICK_REQUEST]

  #bound = false
  #element: HTMLElement | null = null
  #segments: string[] = []
  #lit = false
  #shown: Shown[] = []
  #selected: string[] = []
  /** The meaning of the group whose editor is open ('' = none). */
  #editing = ''
  /** meaning → publish progress, while a group is publishing. */
  #publishing = new Map<string, { done: number; total: number }>()
  #pickerOpen = false
  /** The icon request in flight: its token, and the group it is for. */
  #iconPick: { token: string; meaning: string } | null = null
  #gen = 0
  #timer: ReturnType<typeof setTimeout> | null = null
  /** Decoration records are content-addressed — a sig names the same record
   *  forever, so a parse is never repeated. */
  #records = new Map<string, RecordLike | null>()
  /** Every write, one after another. A name committed on blur and the swatch
   *  click that caused the blur are two edits of ONE record: run side by side
   *  they would both start from the old record, one would be lost, and a
   *  stray record would stay in the slot. */
  #writes: Promise<void> = Promise.resolve()

  protected override heartbeat = async (): Promise<void> => {
    if (this.#bound) return
    this.#bound = true

    const lineage = ioc<EventTarget>('@hypercomb.social/Lineage')
    lineage?.addEventListener?.('change', () => {
      this.#editing = ''
      this.#preview([], '')
      this.#schedule()
    })
    ioc<ViewModeLike>('@hypercomb.social/ViewMode')?.addEventListener?.('change', () => this.#schedule())

    this.onEffect('decorations:changed', () => this.#schedule())
    this.onEffect('history:cursor-changed', () => this.#schedule())
    this.onEffect('render:cell-count', () => this.#schedule())
    this.onEffect('view:active', () => this.#schedule())
    this.onEffect(ENABLEMENT_CHANGED, () => this.#schedule())
    this.onEffect<{ selected?: unknown }>('selection:changed', (payload) => {
      this.#selected = Array.isArray(payload?.selected) ? payload.selected.map(String) : []
      this.#render()
    })
    this.onEffect<{ open?: boolean }>(ICON_PICKER_OPEN, (payload) => { this.#pickerOpen = payload?.open === true })
    this.onEffect<IconPickResult>(ICON_PICK_RESULT, (result) => {
      const pick = this.#iconPick
      if (!pick || result?.token !== pick.token) return
      this.#iconPick = null
      const shown = this.#shown.find(s => s.group.meaning === pick.meaning)
      if (result.name && shown) this.#edit(shown, { icon: result.name })
    })

    window.addEventListener('keydown', this.#onKeyDown, true)
    window.addEventListener('pointerdown', this.#onPointerDown, true)
    this.#schedule()
  }

  /** Called by the element when the registry mounts it. */
  attach(el: HTMLElement): void {
    this.#element = el
    installStyle()
    el.style.cssText = `position:fixed;z-index:${STRIP_Z};`
    this.#render()
  }

  detach(el: HTMLElement): void {
    if (this.#element === el) this.#element = null
  }

  // ── reading the layer ──────────────────────────────────────────────

  #schedule(): void {
    if (this.#timer) return
    // Coalesced: a navigation fires lineage + cursor + cell-count together,
    // and an edit lands as an append then a remove.
    this.#timer = setTimeout(() => {
      this.#timer = null
      void this.#refresh()
    }, 60)
  }

  #currentSegments(): string[] {
    const lineage = ioc<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  /** A takeover view or an owner-counted cover (the chat window) is over the
   *  hexagons — the strip has nothing to point at. */
  #covered(): boolean {
    const mode = ioc<ViewModeLike>('@hypercomb.social/ViewMode')?.mode ?? 'hexagons'
    if (mode !== 'hexagons') return true
    const modes = ioc<{ ownersOf(mode: string): readonly string[] }>('@diamondcoreprocessor.com/ModeRegistry')
    return (modes?.ownersOf?.('view:active') ?? []).length > 0
  }

  async #refresh(): Promise<void> {
    const gen = ++this.#gen
    const segments = this.#currentSegments()
    const history = ioc<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    if (isPublishedVisitorShell() || this.#covered() || !history?.sign) {
      this.#settle(gen, segments, false, [])
      return
    }
    try {
      const layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => segments }))
      if (gen !== this.#gen) return
      const records = await this.#recordsOf(layer)
      const lit = records.some(r => r.kind === PUBLISH_GROUPS_KIND)
        && !isBehaviorDormant(PUBLISH_GROUPS_KIND, segments)
      if (!lit) { this.#settle(gen, segments, false, []); return }

      const groups = groupsInSlotOrder(records)
      const sigs = await Promise.all(groups.map(g => groupSignature(g.meaning)))
      const memberOf = new Map(sigs.map(sig => [sig, new Set<string>()]))
      // Every child of this layer, not just the rendered ones — a filtered
      // page must not publish half a group. The parent's `children` names
      // them; each child's marks are read from ITS OWN head, because a child
      // gaining a mark does not move the sig its parent lists (names are the
      // truth, resolved to heads when read).
      const childSigs = (Array.isArray(layer?.children) ? layer!.children as unknown[] : [])
        .filter((s): s is string => typeof s === 'string' && SIG_RE.test(s))
      const names = [...new Set((await Promise.all(childSigs.map(sig => history.getLayerBySig(sig).catch(() => null))))
        .map(child => typeof child?.name === 'string' ? child.name : '')
        .filter(Boolean))]
      const heads = await Promise.all(names.map(async name =>
        history.currentLayerAt(await history.sign({ explorerSegments: () => [...segments, name] })).catch(() => null)))
      for (const [i, name] of names.entries()) {
        for (const record of await this.#recordsOf(heads[i])) {
          if (record.kind !== 'group') continue
          memberOf.get(String(record.payload?.['sig'] ?? '').toLowerCase())?.add(name)
        }
      }
      if (gen !== this.#gen) return
      this.#settle(gen, segments, true, groups.map((group, i) => ({ group, sig: sigs[i], members: memberOf.get(sigs[i])! })))
    } catch {
      this.#settle(gen, segments, false, [])
    }
  }

  #settle(gen: number, segments: string[], lit: boolean, shown: Shown[]): void {
    if (gen !== this.#gen) return
    this.#segments = segments
    this.#lit = lit
    this.#shown = shown
    if (this.#editing && !shown.some(s => s.group.meaning === this.#editing)) this.#editing = ''
    this.#render()
  }

  async #recordsOf(layer: LayerLike | null): Promise<RecordLike[]> {
    const sigs = Array.isArray(layer?.decorations) ? layer!.decorations as unknown[] : []
    const out: RecordLike[] = []
    for (const sig of sigs) {
      if (typeof sig !== 'string' || !SIG_RE.test(sig)) continue
      const record = await this.#record(sig)
      if (record) out.push(record)
    }
    return out
  }

  async #record(sig: string): Promise<RecordLike | null> {
    if (this.#records.has(sig)) return this.#records.get(sig)!
    let record: RecordLike | null = null
    try {
      const blob = await ioc<StoreLike>('@hypercomb.social/Store')?.getResource(sig)
      const parsed = blob ? JSON.parse(await blob.text()) as { kind?: unknown; payload?: unknown } : null
      if (parsed && typeof parsed.kind === 'string') {
        record = { sig, kind: parsed.kind, payload: parsed.payload as Record<string, unknown> | undefined }
      }
    } catch { /* unreadable — not ours to show */ }
    // Only a hit is remembered: a cold miss may warm up later.
    if (record) this.#records.set(sig, record)
    return record
  }

  /** This group's records on the layer AS IT IS NOW, by the sigs the slot
   *  really holds. A write's returned sig need not be one of them — history's
   *  write boundary canonicalizes what it commits (HistoryService
   *  `#canonicalArtifactReferences`) — so a removal names what a read found,
   *  never what a write returned. */
  async #groupRecords(segments: readonly string[], meaning: string): Promise<RecordLike[]> {
    const history = ioc<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    if (!history?.sign) return []
    const layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => segments }))
    return (await this.#recordsOf(layer))
      .filter(r => r.kind === PUBLISH_GROUP_KIND && parseGroupPayload(r.payload)?.meaning === meaning)
  }

  // ── the gestures ───────────────────────────────────────────────────

  /** Queue a write behind every earlier one, then re-read. The layer it
   *  targets is captured NOW — a walk before it runs must not move it. */
  #write(task: (segments: readonly string[]) => Promise<void>): Promise<void> {
    const segments = [...this.#segments]
    this.#writes = this.#writes
      .then(() => task(segments))
      .catch(err => console.warn('[publish-groups] write failed:', err))
      .then(() => this.#schedule())
    return this.#writes
  }

  #tap(shown: Shown): void {
    if (this.#selected.length === 0) {
      this.#editing = this.#editing === shown.group.meaning ? '' : shown.group.meaning
      this.#render()
      return
    }
    const { join, leave } = decideTap(this.#selected, shown.members)
    // Answer on the strip at once; the reads confirm it when the commits land.
    for (const label of join) shown.members.add(label)
    for (const label of leave) shown.members.delete(label)
    this.#render()
    const { sig } = shown
    const { meaning } = shown.group
    void this.#write(async (segments) => {
      for (const label of join) await wearEnrollment([...segments, label], { sig, meaning })
      for (const label of leave) await dropEnrollment([...segments, label], sig)
    })
  }

  #create(): void {
    const appearance: PublishGroupAppearance = {
      meaning: newGroupMeaning(),
      name: this.#t('publish-groups.default-name', `Group ${this.#shown.length + 1}`, { n: this.#shown.length + 1 }),
      icon: DEFAULT_GROUP_ICON,
      color: nextGroupColor(this.#shown.map(s => s.group.color)),
    }
    const joining = [...this.#selected]
    this.#editing = appearance.meaning
    void this.#write(async (segments) => {
      await writeDecoration({
        kind: PUBLISH_GROUP_KIND, appliesTo: segments, segments, payload: appearance, mark: 'persistent',
      })
      const sig = await groupSignature(appearance.meaning)
      for (const label of joining) await wearEnrollment([...segments, label], { sig, meaning: appearance.meaning })
    })
  }

  /** A new appearance is a new record: write it, then drop every record the
   *  group had before it. The meaning never changes, so no member is touched.
   *  Each edit starts from the layer as the previous one left it. */
  #edit(shown: Shown, patch: Partial<Omit<PublishGroupAppearance, 'meaning'>>): void {
    const { meaning } = shown.group
    void this.#write(async (segments) => {
      const before = await this.#groupRecords(segments, meaning)
      const g = groupsInSlotOrder(before)[0] ?? shown.group
      const next: PublishGroupAppearance = {
        meaning,
        name: (patch.name ?? g.name).trim() || g.name,
        icon: patch.icon ?? g.icon,
        color: patch.color ?? g.color,
      }
      if (next.name === g.name && next.icon === g.icon && next.color === g.color) return
      await writeDecoration({ kind: PUBLISH_GROUP_KIND, appliesTo: segments, segments, payload: next, mark: 'persistent' })
      for (const record of before) {
        const look = parseGroupPayload(record.payload)
        // A stray record already wearing the new look IS the new record now.
        if (look && look.name === next.name && look.icon === next.icon && look.color === next.color) continue
        await removeDecorationAndWait({ sig: record.sig, segments })
      }
    })
  }

  #ungroup(shown: Shown): void {
    const { meaning } = shown.group
    const { sig } = shown
    const members = [...shown.members]
    this.#editing = ''
    this.#render()
    void this.#write(async (segments) => {
      for (const label of members) await dropEnrollment([...segments, label], sig)
      for (const record of await this.#groupRecords(segments, meaning)) {
        await removeDecorationAndWait({ sig: record.sig, segments })
      }
    })
  }

  async #publish(shown: Shown): Promise<void> {
    const meaning = shown.group.meaning
    if (this.#publishing.has(meaning)) return
    const segments = [...this.#segments]
    const members = [...shown.members]
    if (members.length === 0) return
    const progress = { done: 0, total: members.length }
    this.#publishing.set(meaning, progress)
    this.#render()
    const failures: string[] = []
    for (const label of members) {
      const result = await publishBranch([...segments, label])
      if (!result.ok) failures.push(result.failure)
      progress.done++
      this.#render()
    }
    this.#publishing.delete(meaning)
    this.#render()
    const name = shown.group.name
    if (failures.length === 0) {
      this.#toast('success', this.#t('publish-groups.done', `Published ${name}`, { name }))
    } else {
      const why = failures[0]
      this.#toast('error',
        this.#t('publish-groups.failed', `${name}: ${failures.length} not published`, { name, count: failures.length }),
        this.#t(`publish.failure.${why}`, why))
    }
    EffectBus.emit('publish:refresh', {})
  }

  #pickIcon(shown: Shown): void {
    const token = `${shown.group.meaning}:${Date.now().toString(36)}`
    this.#iconPick = { token, meaning: shown.group.meaning }
    EffectBus.emit(ICON_PICK_REQUEST, {
      id: PUBLISH_GROUPS_SURFACE, token, store: false, title: this.#t('publish-groups.icon', 'Choose an icon'),
    })
  }

  /** Light the members in the group's colour — a look, nothing written. */
  #preview(labels: readonly string[], color: string): void {
    EffectBus.emitTransient('group:preview', { labels: [...labels], color })
  }

  #toast(type: 'success' | 'error', title: string, message?: string): void {
    EffectBus.emitTransient('toast:show', { type, title, ...(message ? { message } : {}) })
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    const value = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    return value && value !== key ? value : fallback
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !this.#editing || this.#pickerOpen) return
    e.preventDefault()
    e.stopImmediatePropagation()
    this.#editing = ''
    this.#render()
  }

  #onPointerDown = (e: PointerEvent): void => {
    if (!this.#editing || this.#pickerOpen || !this.#element) return
    if (e.target instanceof Node && this.#element.contains(e.target)) return
    this.#editing = ''
    this.#render()
  }

  // ── the strip ──────────────────────────────────────────────────────

  #render(): void {
    const el = this.#element
    if (!el) return
    if (!this.#lit) {
      el.hidden = true
      el.replaceChildren()
      return
    }
    el.hidden = false
    // A re-read can land while the name is being typed — carry the field's
    // text, focus and caret across the rebuild.
    const typing = el.querySelector<HTMLInputElement>('.hc-pg-name')
    const kept = typing && document.activeElement === typing
      ? { value: typing.value, start: typing.selectionStart, end: typing.selectionEnd }
      : null
    const strip = document.createElement('div')
    strip.className = 'hc-pg-strip'
    for (const shown of this.#shown) strip.append(this.#groupButton(shown))
    const add = button('hc-pg-btn hc-pg-add', 'add', this.#t('publish-groups.new', 'New group'))
    add.addEventListener('click', () => this.#create())
    strip.append(add)
    el.replaceChildren(strip)

    const editing = this.#shown.find(s => s.group.meaning === this.#editing)
    if (editing) el.append(this.#editor(editing))
    const field = kept && el.querySelector<HTMLInputElement>('.hc-pg-name')
    if (kept && field) {
      field.value = kept.value
      field.focus()
      field.setSelectionRange(kept.start, kept.end)
    }
  }

  #groupButton(shown: Shown): HTMLButtonElement {
    const { group, members } = shown
    const tip = this.#t('publish-groups.tip', `${group.name} (${members.size})`, { name: group.name, count: members.size })
    const btn = button('hc-pg-btn', group.icon, tip)
    btn.style.setProperty('--pg', group.color)
    btn.dataset['meaning'] = group.meaning
    if (group.meaning === this.#editing) btn.classList.add('editing')
    if (members.size > 0) {
      const count = document.createElement('span')
      count.className = 'hc-pg-count'
      count.textContent = String(members.size)
      btn.append(count)
    }
    btn.addEventListener('pointerenter', () => this.#preview([...members], group.color))
    btn.addEventListener('pointerleave', () => this.#preview([], group.color))
    btn.addEventListener('click', () => this.#tap(shown))
    return btn
  }

  #editor(shown: Shown): HTMLElement {
    const { group, members } = shown
    const panel = document.createElement('div')
    panel.className = 'hc-pg-editor'
    panel.style.setProperty('--pg', group.color)

    const name = document.createElement('input')
    name.className = 'hc-pg-name'
    name.value = group.name
    name.placeholder = this.#t('publish-groups.name', 'Group name')
    name.setAttribute('aria-label', name.placeholder)
    const commitName = (): void => { this.#edit(shown, { name: name.value }) }
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitName() } })
    name.addEventListener('change', commitName)

    const look = document.createElement('div')
    look.className = 'hc-pg-row'
    const icon = button('hc-pg-btn', group.icon, this.#t('publish-groups.icon', 'Choose an icon'))
    icon.style.setProperty('--pg', group.color)
    icon.addEventListener('click', () => this.#pickIcon(shown))
    look.append(icon)
    for (const color of GROUP_COLORS) {
      const swatch = document.createElement('button')
      swatch.type = 'button'
      swatch.className = 'hc-pg-swatch' + (color === group.color.toLowerCase() ? ' on' : '')
      swatch.style.background = color
      swatch.setAttribute('aria-label', color)
      swatch.addEventListener('click', () => { this.#edit(shown, { color }) })
      look.append(swatch)
    }

    const acts = document.createElement('div')
    acts.className = 'hc-pg-row'
    const progress = this.#publishing.get(group.meaning)
    const publish = document.createElement('button')
    publish.type = 'button'
    publish.className = 'hc-pg-act'
    publish.textContent = progress
      ? this.#t('publish-groups.publishing', `Publishing ${progress.done} of ${progress.total}…`, { done: progress.done, total: progress.total })
      : this.#t('publish-groups.publish', `Publish (${members.size})`, { count: members.size })
    publish.disabled = !!progress || members.size === 0
    publish.addEventListener('click', () => { void this.#publish(shown) })
    const ungroup = document.createElement('button')
    ungroup.type = 'button'
    ungroup.className = 'hc-pg-act quiet'
    ungroup.textContent = this.#t('publish-groups.ungroup', 'Ungroup')
    ungroup.disabled = !!progress
    ungroup.addEventListener('click', () => this.#ungroup(shown))
    acts.append(publish, ungroup)

    panel.append(name, look, acts)
    // Under its own icon, kept on screen.
    queueMicrotask(() => {
      const anchor = this.#element?.querySelector<HTMLElement>(`.hc-pg-btn[data-meaning="${CSS.escape(group.meaning)}"]`)
      const rect = anchor?.getBoundingClientRect()
      if (!rect) return
      const width = panel.offsetWidth || 240
      const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8)
      panel.style.left = `${left}px`
      panel.style.top = `${rect.bottom + 8}px`
    })
    return panel
  }
}

function button(className: string, glyph: string, label: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = className
  btn.title = label
  btn.setAttribute('aria-label', label)
  const sym = document.createElement('span')
  sym.className = 'mat-sym'
  sym.textContent = glyph
  btn.append(sym)
  return btn
}

function installStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STRIP_CSS
  document.head.append(style)
}

const STRIP_CSS = `
hc-publish-groups{top:calc(var(--hc-header-anchor,3.5rem) + .5rem);left:calc(var(--hc-inset-left,0px) + var(--hc-controls-left,0px));right:var(--hc-inset-right,0px);display:flex;justify-content:center;pointer-events:none}
hc-publish-groups[hidden]{display:none}
.hc-pg-strip{display:flex;align-items:center;gap:.4rem;padding:.3rem .4rem;border-radius:999px;pointer-events:auto;background:rgba(var(--hc-panel-pane,12,19,27),.72);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 4px 18px rgba(0,0,0,.22)}
.hc-pg-btn{position:relative;width:2.1rem;height:2.1rem;padding:0;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--pg);border:1px solid color-mix(in srgb,var(--pg) 55%,transparent);background:color-mix(in srgb,var(--pg) 14%,transparent);transition:background .12s ease,box-shadow .12s ease}
.hc-pg-btn:hover{background:color-mix(in srgb,var(--pg) 26%,transparent)}
.hc-pg-btn.editing{box-shadow:0 0 0 2px var(--pg)}
.hc-pg-btn .mat-sym{font-size:1.2rem}
.hc-pg-count{position:absolute;right:-.3rem;bottom:-.25rem;min-width:1rem;height:1rem;padding:0 .22rem;box-sizing:border-box;border-radius:999px;background:var(--pg);color:#0b0e12;font:600 .62rem/1rem system-ui,sans-serif;text-align:center}
.hc-pg-add{--pg:var(--hc-panel-text,#c9d6df);border-style:dashed;background:transparent;opacity:.75}
.hc-pg-add:hover{opacity:1;background:transparent}
.hc-pg-editor{position:fixed;width:15rem;box-sizing:border-box;padding:.6rem;display:flex;flex-direction:column;gap:.55rem;pointer-events:auto;border-radius:var(--hc-radius-floating,4px);color:var(--hc-panel-text,#dbe7ef);background:rgba(var(--hc-panel-pane,12,19,27),.97);border:1px solid color-mix(in srgb,var(--pg) 45%,transparent);box-shadow:0 14px 40px rgba(0,0,0,.4);font:400 .8rem/1.3 var(--hc-mono,system-ui)}
.hc-pg-name{width:100%;box-sizing:border-box;padding:.35rem .5rem;border-radius:var(--hc-radius-control,2px);border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font:inherit}
.hc-pg-row{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap}
.hc-pg-swatch{width:1.15rem;height:1.15rem;padding:0;border-radius:50%;cursor:pointer;border:2px solid transparent;box-shadow:0 0 0 1px rgba(0,0,0,.25)}
.hc-pg-swatch.on{border-color:var(--hc-panel-text,#fff)}
.hc-pg-act{flex:1;padding:.35rem .5rem;border-radius:var(--hc-radius-control,2px);cursor:pointer;color:inherit;font:inherit;border:1px solid color-mix(in srgb,var(--pg) 50%,transparent);background:color-mix(in srgb,var(--pg) 16%,transparent)}
.hc-pg-act.quiet{flex:0 0 auto;background:transparent;border-color:rgba(127,127,127,.35)}
.hc-pg-act:disabled{opacity:.45;cursor:default}
`

const _publishGroups = new PublishGroupsDrone()
window.ioc.register(PUBLISH_GROUPS_KEY, _publishGroups)

// Contribute the surface the doctrine way: define the element, then add it
// to the registry — never a template tag in either app.html.
window.ioc.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (registry: { add(s: unknown): void }) => {
  if (!customElements.get(PUBLISH_GROUPS_SURFACE)) {
    customElements.define(PUBLISH_GROUPS_SURFACE, PublishGroupsElement)
  }
  try {
    registry.add({
      name: PUBLISH_GROUPS_SURFACE,
      owner: PUBLISH_GROUPS_KEY,
      element: PUBLISH_GROUPS_SURFACE,
      order: 710,
    })
  } catch {
    // duplicate add (hot reload) — the mounted surface is already live
  }
})
