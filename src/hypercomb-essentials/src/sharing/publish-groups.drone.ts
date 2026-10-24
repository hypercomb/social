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
import { hostsOfBranch, setBranchHosts } from './community-hosts.js'
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

/** A group as the `groups` word reads it. */
export interface PublishGroupView {
  readonly meaning: string
  readonly name: string
  readonly icon: string
  readonly color: string
  /** The member tiles, by name, in the layer's own child order. */
  readonly members: readonly string[]
}

/** What a layer says about its publish groups. */
export interface PublishGroupsReading {
  /** `publish:groups` is deposited here. */
  readonly on: boolean
  /** …and the behaviour is asleep for this hive (switched off in the pool). */
  readonly dormant: boolean
  readonly groups: readonly PublishGroupView[]
  /** Every child tile of the layer, by name — what a group can hold. */
  readonly children: readonly string[]
}

const quiet = (): void => { /* the write queue already said why */ }

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
    'render:cell-count', ENABLEMENT_CHANGED, ICON_PICK_RESULT, ICON_PICKER_OPEN, 'publish-groups:publish',
    'publish-groups:create',
  ]
  protected override emits = [
    'group:preview', 'toast:show', 'publish:refresh', 'publish-groups:render', ICON_PICK_REQUEST,
    'features:enable',
  ]

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
  /** Groups made by `+` whose editor is open before the read that shows them. */
  #awaiting = new Set<string>()

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
    // The Publish panel's own Groups section — a group publishes from there
    // too, and from inside a view, where the strip is not drawn.
    this.onEffect<{ segments?: unknown; meaning?: unknown }>('publish-groups:publish', (p) => {
      const segments = Array.isArray(p?.segments) ? p.segments.map(s => String(s ?? '').trim()).filter(Boolean) : null
      const meaning = typeof p?.meaning === 'string' ? p.meaning : ''
      if (segments && meaning) void this.publishGroup(segments, meaning)
    })
    // A GROUP FROM THE PUBLISH PANEL'S SELECTION (jwize 2026-10-24: "so you
    // can have them available to create a group and then publish to it") —
    // what `groups new` does with the tiles selected on the page.
    this.onEffect<{ segments?: unknown; members?: unknown; name?: unknown }>('publish-groups:create', (p) => {
      const segments = Array.isArray(p?.segments) ? p.segments.map(s => String(s ?? '').trim()).filter(Boolean) : null
      const members = Array.isArray(p?.members) ? p.members.map(m => String(m ?? '').trim()).filter(Boolean) : []
      const name = typeof p?.name === 'string' ? p.name : undefined
      if (segments && members.length) void this.createFromPanel(segments, members, name)
    })
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
    // A covering view hides the STRIP (#render asks), not the groups: the
    // Publish panel lists them over a view as well.
    if (isPublishedVisitorShell()) {
      this.#settle(gen, segments, false, [])
      return
    }
    try {
      const reading = await this.#read(segments, false)
      if (gen !== this.#gen) return
      const lit = reading.on && !reading.dormant
      this.#settle(gen, segments, lit, lit ? reading.shown : [])
    } catch {
      this.#settle(gen, segments, false, [])
    }
  }

  /** ONE read of a layer's groups — the strip and the word ask the same
   *  question. `full` also reads every child (to name members and what a
   *  group could hold); the strip skips that where there is nothing to show. */
  async #read(segments: readonly string[], full: boolean): Promise<{
    on: boolean; dormant: boolean; shown: Shown[]; children: string[]
  }> {
    const history = ioc<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    if (!history?.sign) return { on: false, dormant: false, shown: [], children: [] }
    const layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => segments }))
    const records = await this.#recordsOf(layer)
    const on = records.some(r => r.kind === PUBLISH_GROUPS_KIND)
    const dormant = isBehaviorDormant(PUBLISH_GROUPS_KIND, segments)
    const groups = groupsInSlotOrder(records)
    const sigs = await Promise.all(groups.map(g => groupSignature(g.meaning)))
    const memberOf = new Map(sigs.map(sig => [sig, new Set<string>()]))
    const shown = (): Shown[] => groups.map((group, i) => ({ group, sig: sigs[i], members: memberOf.get(sigs[i])! }))
    if (!full && (!on || dormant || groups.length === 0)) return { on, dormant, shown: shown(), children: [] }

    // Every child of this layer, not just the rendered ones — a filtered
    // page must not publish half a group. The parent's `children` names
    // them; each child's marks are read from ITS OWN head, because a child
    // gaining a mark does not move the sig its parent lists (names are the
    // truth, resolved to heads when read).
    const childSigs = (Array.isArray(layer?.children) ? layer!.children as unknown[] : [])
      .filter((s): s is string => typeof s === 'string' && SIG_RE.test(s))
    const children = [...new Set((await Promise.all(childSigs.map(sig => history.getLayerBySig(sig).catch(() => null))))
      .map(child => typeof child?.name === 'string' ? child.name : '')
      .filter(Boolean))]
    if (groups.length > 0) {
      const heads = await Promise.all(children.map(async name =>
        history.currentLayerAt(await history.sign({ explorerSegments: () => [...segments, name] })).catch(() => null)))
      for (const [i, name] of children.entries()) {
        for (const record of await this.#recordsOf(heads[i])) {
          if (record.kind !== 'group') continue
          memberOf.get(String(record.payload?.['sig'] ?? '').toLowerCase())?.add(name)
        }
      }
    }
    return { on, dormant, shown: shown(), children }
  }

  #settle(gen: number, segments: string[], lit: boolean, shown: Shown[]): void {
    if (gen !== this.#gen) return
    this.#segments = segments
    this.#lit = lit
    this.#shown = shown
    for (const s of shown) this.#awaiting.delete(s.group.meaning)
    // A group made a moment ago may not be in this read yet — its editor
    // waits for it rather than closing.
    if (this.#editing && !this.#awaiting.has(this.#editing) && !shown.some(s => s.group.meaning === this.#editing)) {
      this.#editing = ''
    }
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

  async #layerRecords(segments: readonly string[]): Promise<RecordLike[]> {
    const history = ioc<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    if (!history?.sign) return []
    return this.#recordsOf(await history.currentLayerAt(await history.sign({ explorerSegments: () => segments })))
  }

  /** This group's records on the layer AS IT IS NOW, by the sigs the slot
   *  really holds. A write's returned sig need not be one of them — history's
   *  write boundary canonicalizes what it commits (HistoryService
   *  `#canonicalArtifactReferences`) — so a removal names what a read found,
   *  never what a write returned. */
  async #groupRecords(segments: readonly string[], meaning: string): Promise<RecordLike[]> {
    return (await this.#layerRecords(segments))
      .filter(r => r.kind === PUBLISH_GROUP_KIND && parseGroupPayload(r.payload)?.meaning === meaning)
  }

  // ── the acts — the strip's gestures and the `groups` word both land here ──

  /** A layer's groups, their members, and every child a group could hold. */
  async groupsAt(segments: readonly string[]): Promise<PublishGroupsReading> {
    const reading = await this.#read(segments, true)
    return {
      on: reading.on,
      dormant: reading.dormant,
      children: reading.children,
      groups: reading.shown.map(({ group, members }) => ({
        meaning: group.meaning, name: group.name, icon: group.icon, color: group.color,
        members: reading.children.filter(name => members.has(name)),
      })),
    }
  }

  /** The names on the strip right now — what the word offers as you type. */
  groupNamesShown(): string[] {
    return this.#shown.map(s => s.group.name)
  }

  /** A new group on the layer; `members` join it at once. With no name it is
   *  named from the layer's count, and it takes a colour the layer is not
   *  wearing yet. */
  createGroup(
    segments: readonly string[],
    opts: { name?: string; members?: readonly string[]; meaning?: string } = {},
  ): Promise<PublishGroupAppearance> {
    const meaning = opts.meaning ?? newGroupMeaning()
    return this.#write(async () => {
      const before = groupsInSlotOrder(await this.#layerRecords(segments))
      const n = before.length + 1
      const made: PublishGroupAppearance = {
        meaning,
        name: opts.name?.trim() || this.#t('publish-groups.default-name', `Group ${n}`, { n }),
        icon: DEFAULT_GROUP_ICON,
        color: nextGroupColor(before.map(g => g.color)),
      }
      await writeDecoration({ kind: PUBLISH_GROUP_KIND, appliesTo: segments, segments, payload: made, mark: 'persistent' })
      const sig = await groupSignature(meaning)
      for (const label of opts.members ?? []) await wearEnrollment([...segments, label], { sig, meaning })
      return made
    })
  }

  /** A group made from the Publish panel's selection — the same act as
   *  `groups new` with those tiles selected on their page. Only tiles that ARE
   *  children of the page join (a group holds one page's tiles); the strip is
   *  lit there, because a group on a page means the strip belongs there and an
   *  unlit layer announces no groups at all. Says what it made. */
  async createFromPanel(segments: readonly string[], members: readonly string[], name?: string): Promise<PublishGroupAppearance | null> {
    try {
      const reading = await this.#read(segments, true)
      // Switched off for this hive, a group is made and never seen: say so,
      // the way the `groups` word does, and make nothing.
      if (reading.dormant) {
        this.#toast('error', this.#t('groups.asleep', 'Publish groups is switched off for this hive — light it in the Beehaviors pool'))
        return null
      }
      const joining = [...new Set(members)].filter(label => reading.children.includes(label))
      if (joining.length === 0) {
        this.#toast('error', this.#t('publish-groups.not-on-page', 'None of those are tiles on that page — nothing was grouped'))
        return null
      }
      if (!reading.on) {
        EffectBus.emit('features:enable', {
          cell: segments[segments.length - 1] ?? '/',
          segments: [...segments],
          kind: PUBLISH_GROUPS_KIND,
          silent: true,
        })
      }
      const made = await this.createGroup(segments, { name, members: joining })
      this.#schedule()
      this.#toast('success', this.#t('publish-groups.made-from', `Made ${made.name} with ${joining.length}`, { name: made.name, count: joining.length }))
      return made
    } catch (error) {
      console.warn('[publish-groups] could not make a group from the panel:', error)
      this.#toast('error', this.#t('publish-groups.not-made', 'The group could not be made'))
      return null
    }
  }

  joinGroup(segments: readonly string[], meaning: string, labels: readonly string[]): Promise<void> {
    return this.#write(async () => {
      const sig = await groupSignature(meaning)
      for (const label of labels) await wearEnrollment([...segments, label], { sig, meaning })
    })
  }

  leaveGroup(segments: readonly string[], meaning: string, labels: readonly string[]): Promise<void> {
    return this.#write(async () => {
      const sig = await groupSignature(meaning)
      for (const label of labels) await dropEnrollment([...segments, label], sig)
    })
  }

  /** A new appearance is a new record: write it, then drop every record the
   *  group had before it. The meaning never changes, so no member is touched.
   *  Each edit starts from the layer as the previous one left it. */
  editGroup(
    segments: readonly string[],
    meaning: string,
    patch: Partial<Omit<PublishGroupAppearance, 'meaning'>>,
  ): Promise<void> {
    return this.#write(async () => {
      const before = await this.#groupRecords(segments, meaning)
      const g = groupsInSlotOrder(before)[0]
      if (!g) return
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

  /** Take the group off the layer: every member's mark, then its record. */
  ungroupAt(segments: readonly string[], meaning: string): Promise<void> {
    return this.#write(async () => {
      const shown = (await this.#read(segments, true)).shown.find(s => s.group.meaning === meaning)
      if (shown) for (const label of shown.members) await dropEnrollment([...segments, label], shown.sig)
      for (const record of await this.#groupRecords(segments, meaning)) {
        await removeDecorationAndWait({ sig: record.sig, segments })
      }
    })
  }

  /** Publish every member's branch, one after the other — never in parallel:
   *  every publish read-modify-writes the host's signed index, and two at once
   *  can drop each other's entry. Reports how it went either way. Null when
   *  the group is not on this layer or is already publishing. */
  async publishGroup(
    segments: readonly string[],
    meaning: string,
  ): Promise<{ total: number; failures: string[] } | null> {
    if (this.#publishing.has(meaning)) return null
    const shown = (await this.#read(segments, true)).shown.find(s => s.group.meaning === meaning)
    if (!shown) return null
    const members = [...shown.members]
    const name = shown.group.name
    if (members.length === 0) return { total: 0, failures: [] }
    const progress = { done: 0, total: members.length }
    this.#publishing.set(meaning, progress)
    this.#render()
    const failures: string[] = []
    let refusedHosts = ''
    // A GROUP PUBLISHES WHERE ITS PAGE DOES. The page's domains are its own
    // switches at the top of the Publish panel; a member that names no host
    // of its own takes them — written as its own host marks, the record every
    // publish reads, so the member's own row says where it went.
    const pageZones = await hostsOfBranch(segments).catch(() => [] as string[])
    try {
      for (const label of members) {
        const memberSegments = [...segments, label]
        if (pageZones.length > 0 && (await hostsOfBranch(memberSegments).catch(() => [] as string[])).length === 0) {
          await setBranchHosts(memberSegments, pageZones).catch(err =>
            console.warn("[publish-groups] could not give a member its page's domains:", err))
        }
        const result = await publishBranch(memberSegments)
        if (!result.ok) {
          failures.push(result.failure)
          if (result.failure === 'not-a-node') refusedHosts = result.reason ?? ''
        }
        progress.done++
        this.#render()
      }
    } finally {
      this.#publishing.delete(meaning)
      this.#render()
    }
    if (failures.length === 0) {
      this.#toast('success', this.#t('publish-groups.done', `Published ${name}`, { name }))
    } else {
      const why = failures[0]
      // Nowhere at all: the page names no domain, and nothing stands in. Say
      // where the switch is, rather than the general "add a host".
      const message = why === 'no-host' && pageZones.length === 0
        ? this.#t('publish-groups.no-host', 'Turn on a domain for this page in Publish — a group publishes where its page does')
        : this.#t(`publish.failure.${why}`, why, { hosts: refusedHosts })
      this.#toast('error',
        this.#t('publish-groups.failed', `${name}: ${failures.length} not published`, { name, count: failures.length }),
        message)
    }
    EffectBus.emit('publish:refresh', {})
    return { total: members.length, failures }
  }

  /** Every write, one after another — the caller hears its own outcome, the
   *  queue carries on whatever happened, and the strip re-reads after. */
  #write<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#writes.then(task)
    this.#writes = run
      .then(() => undefined, err => { console.warn('[publish-groups] write failed:', err) })
      .then(() => this.#schedule())
    return run
  }

  // ── the strip's gestures ───────────────────────────────────────────

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
    if (join.length) this.joinGroup(this.#segments, shown.group.meaning, join).catch(quiet)
    if (leave.length) this.leaveGroup(this.#segments, shown.group.meaning, leave).catch(quiet)
  }

  #create(): void {
    const meaning = newGroupMeaning()
    this.#editing = meaning
    this.#awaiting.add(meaning)
    this.createGroup(this.#segments, { meaning, members: [...this.#selected] }).catch(quiet)
  }

  #edit(shown: Shown, patch: Partial<Omit<PublishGroupAppearance, 'meaning'>>): void {
    this.editGroup(this.#segments, shown.group.meaning, patch).catch(quiet)
  }

  #ungroup(shown: Shown): void {
    this.#editing = ''
    this.#render()
    this.ungroupAt(this.#segments, shown.group.meaning).catch(quiet)
  }

  #publish(shown: Shown): void {
    void this.publishGroup(this.#segments, shown.group.meaning)
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

  /** The layer's groups for the Publish panel (shell — it cannot ask the
   *  drone, so it is told). Last-value replayed: a panel opened later reads
   *  the layer it opens on. Empty where the behaviour is not lit. */
  #announce(): void {
    EffectBus.emit('publish-groups:render', {
      segments: [...this.#segments],
      groups: this.#lit ? this.#shown.map(({ group, members }) => ({
        meaning: group.meaning,
        name: group.name,
        icon: group.icon,
        color: group.color,
        count: members.size,
        publishing: this.#publishing.has(group.meaning) ? { ...this.#publishing.get(group.meaning)! } : null,
      })) : [],
    })
  }

  #render(): void {
    this.#announce()
    const el = this.#element
    if (!el) return
    if (!this.#lit || this.#covered()) {
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
