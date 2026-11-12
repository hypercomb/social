// commands/create-cells.ts
//
// THE COMMIT A CREATE PERFORMS — moved out of the Angular command line
// (jwize, 2026-11-11: "anything built in the debugger (subdomains) should not
// load angular"). The first run of the chat on a debugger page showed why: a
// model said `/create roadmap`, the behaviour handed the tile to
// `command:create-cells`, and the only listener was a component that page does
// not have ("Create command line is unavailable").
//
// So the commit lives here, once, and has two callers:
//
//   • the command line, for a name typed and entered — it still parses the
//     line, holds the armed picture and clears itself afterwards;
//   • `answerCreateRequest` at the foot of this file, for
//     `command:create-cells` on a page where no command line is mounted.
//
// This file exports; it registers nothing. The create word's bee
// (create.queen.ts) puts the service in the IoC and subscribes the answer.
//
// Where the command line IS mounted it answers `command:create-cells` itself,
// exactly as before, and this listener stays out: one request, one creator.
//
// What moved is the work, not the gestures: no input is read or cleared here,
// nothing navigates, and an armed picture is handed in by whoever holds it.

import {
  EffectBus, hypercomb, isReservedPoolWord, normalizeCell, CANONICAL_REFERENCE_SERVICE_KEY,
  I18N_IOC_KEY, type I18nProvider, type PlaceCanonicalReferenceOptions,
} from '@hypercomb/core'

export const CREATE_CELLS_IOC_KEY = '@diamondcoreprocessor.com/CreateCells'

/** The shell's command line says it is mounted by registering under this key.
 *  Asked at the moment of a request, never at boot. */
export const COMMAND_LINE_IOC_KEY = '@hypercomb.social/CommandLine'

/** A resource dropped for the tile about to be made — the participant's
 *  picture, link or document for it. Held by the command line; handed in. */
export type ArmedResource = {
  readonly largeSig: string
  readonly smallPointSig: string | null
  readonly smallFlatSig: string | null
  readonly url: string | null
  readonly type: 'image' | 'youtube' | 'link' | 'document'
  readonly attachment?: { name: string; mime: string; size: number; sig: string } | null
  readonly atTop?: boolean
  readonly generationSig?: string
}

export type CreateCellsRequest = {
  /** One name per level, already normalized: `[meals, breakfast]`. */
  readonly parts: readonly string[]
  readonly armed?: ArmedResource | null
  /** Called once the armed resource has been asked to attach — the holder
   *  puts its slot away. */
  readonly armedTaken?: () => void
  /** A caller that must not report a tile nothing committed. */
  readonly requireCommitter?: boolean
}

export type CreateCellsOutcome =
  | { readonly made: true; readonly base: readonly string[]; readonly parts: readonly string[]; readonly moved: boolean }
  | { readonly made: false; readonly why: 'empty' | 'reserved' | 'saved'; readonly word?: string }

const iocGet = <T>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.(key) as T | undefined

const said = (key: string, fallback: string): string => {
  const value = iocGet<I18nProvider>(I18N_IOC_KEY)?.t?.(key)
  return value && value !== key ? value : fallback
}

type ReferenceDoor = {
  landing?: (standing: readonly string[], parts: readonly string[]) => Promise<{
    base: readonly string[]
    parts: readonly string[]
    gather: PlaceCanonicalReferenceOptions | null
  }>
  place?: (options: PlaceCanonicalReferenceOptions) => Promise<string | null>
}

type Committer = {
  importTree?: (
    updates: { segments: readonly string[]; layer: { name?: string } & { [slot: string]: unknown } }[],
  ) => Promise<void>
}

/** Make the named tiles on the page the participant stands on — or where the
 *  page's landing says they belong. Resolves once they are committed. */
export async function createCells(request: CreateCellsRequest): Promise<CreateCellsOutcome> {
  const parts = request.parts.map(part => String(part ?? '')).filter(Boolean)
  if (parts.length === 0) return { made: false, why: 'empty' }

  // THE RESERVED-NAME GATE (documentation/hypergraph-molecule-lineage.md,
  // execution order step 5). A molecule named `bees` IS sign('bees') — the
  // install's own bee pool — so the tile's atoms would gather inside the
  // pool. Refused here, at the naming gesture, before anything is minted or
  // painted. Every segment is a word, so every segment is checked.
  const reserved = parts.find(part => isReservedPoolWord(part))
  if (reserved) {
    EffectBus.emit('activity:log', {
      message: `"${reserved}" is a reserved word — it is the address of a system pool. Choose another name.`,
      icon: 'error',
    })
    return { made: false, why: 'reserved', word: reserved }
  }
  // A SAVED ROOT'S NAME IS NOT A TILE (save as, history/saved-roots.ts):
  // a tile called <name> would open the saved root itself. Say how to reach it.
  const savedRoots = iocGet<{ isSaved?: (name: string) => boolean }>('@diamondcoreprocessor.com/SavedRoots')
  const saved = parts.find(part => savedRoots?.isSaved?.(part))
  if (saved) {
    EffectBus.emit('activity:log', { message: `"${saved}" is a saved root — use ${saved} turns it on.`, icon: 'error' })
    return { made: false, why: 'saved', word: saved }
  }

  // Tile creation is a layer-only mutation. Per the architecture doctrine
  // (project_layer_is_primitive) the current layer is the sole source of
  // truth for tile membership.
  //
  // For nested paths like `meals/breakfast/pastries`, every level gains a
  // child: root.children += meals, meals.children += breakfast,
  // breakfast.children += pastries. Build one (segments, cell) tuple per
  // gained level, then commit them in ONE shared importTree cascade — each
  // affected ancestor commits exactly once with the union of changes. The
  // leaf event still drives UI fade-in via cell:added, marked
  // `viaUpdate: true` so the per-event commit listener skips it.
  const lineage = iocGet<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
  // NO LINEAGE, NO COMMIT. The layer committer returns without writing when
  // the page has no lineage service, and says nothing. The first debugger
  // run reported `/create roadmap` as run on exactly such a page while no
  // tile was on any page (2026-11-11). A caller that must not report a tile
  // nothing committed hears the refusal instead.
  if (request.requireCommitter && !lineage?.explorerSegments) {
    throw new Error('Create cannot place a tile: this page does not know where it stands')
  }
  const standing = (lineage?.explorerSegments?.() ?? []).map(segment => String(segment))

  // WHERE THE TILE IS MADE — not always where you stand. Behind a doorway it
  // is made at the reference's target; on a holder (a page of references
  // gathered from one group) it is made IN the group and the holder gathers
  // it as a reference, so `bob` typed on `friends` is one of the people.
  // commands/create-landing.ts. No reference door loaded = the old answer: here.
  const references = iocGet<ReferenceDoor>(CANONICAL_REFERENCE_SERVICE_KEY)
  const landing = await references?.landing?.(standing, parts).catch(() => null) ?? null
  const baseSegments = [...(landing?.base ?? standing)]
  const made = [...(landing?.parts ?? parts)]
  const moved = baseSegments.join('/') !== standing.join('/')

  const events: { cell: string; segments: string[] }[] = []
  const accumulated: string[] = [...baseSegments]
  for (const part of made) {
    events.push({ cell: part, segments: accumulated.slice() })
    accumulated.push(part)
  }

  const leafCell = made[made.length - 1]
  const armed = request.armed ?? null

  const committer = iocGet<Committer>('@diamondcoreprocessor.com/LayerCommitter')
  // The acknowledged grammar path must fail before even optimistic UI is
  // emitted when there is no durable commit seam behind it.
  if (request.requireCommitter && !committer?.importTree) {
    throw new Error('Create layer committer is unavailable')
  }

  if (armed) {
    // Lock substrate out of this cell until the resource is fully attached.
    // The lock is released by ResourceAttachDrone once the props blob is
    // written to OPFS and the tile-props-index is updated.
    EffectBus.emit('cell:attach-pending', { cell: leafCell, pending: true })
  }

  // UI subscribers (show-cell incremental render, activity log, substrate
  // trigger) need the cell:added event BEFORE the commit so the visual mount
  // happens immediately — the layer cascade can take a tick to settle and
  // gating the render on it makes creates feel laggy. `viaUpdate: true` tells
  // the LayerCommitter listener to skip queueing because the upcoming
  // importTree IS the commit.
  //
  // Made ELSEWHERE (landing moved), none of it is on this page to fade in,
  // and announcing early only races the substrate against the commit. It is
  // announced once the tile exists and is dressed (below).
  const announce = (): void => {
    for (const evt of events) {
      EffectBus.emit('cell:added', { ...evt, viaUpdate: true })
    }
  }
  if (!moved) announce()

  // ONE atomic cascade: importTree commits every affected ancestor exactly
  // once. For `a/b/c` from root that's 1 marker each in root, /a, /a/b,
  // /a/b/c — never N markers per level.
  if (committer?.importTree) {
    const updates = events.map(evt => ({
      segments: [...evt.segments, evt.cell],
      layer: { name: evt.cell },
    }))
    await committer.importTree(updates)
    // The tiles now exist in the layer: let the view re-read their pictures
    // (the fill that followed cell:added ran before this commit).
    for (const evt of events) EffectBus.emitTransient('cell:committed', evt)
  }

  // A dropped resource is the participant's picture for the tile just made.
  // On a holder it must LAND before the holder gathers the member (below),
  // so the wait is armed before the attach is asked for; the replay of this
  // flow's own `pending: true` is ignored, and a stalled attach never holds
  // the gather hostage.
  let attached: Promise<void> = Promise.resolve()
  if (armed) {
    if (landing?.gather) {
      attached = new Promise<void>(resolve => {
        let live = false
        const timer = setTimeout(() => { off(); resolve() }, 10_000)
        const off = EffectBus.on<{ cell?: string; pending?: boolean }>('cell:attach-pending', payload => {
          if (!live || payload?.cell !== leafCell || payload.pending !== false) return
          clearTimeout(timer)
          off()
          resolve()
        })
        live = true
      })
    }
    EffectBus.emit('cell:attach-resource', {
      // Made elsewhere: the picture belongs where the tile was made.
      ...(moved ? { segments: [...baseSegments, ...made.slice(0, -1)] } : {}),
      cell: leafCell,
      largeSig: armed.largeSig,
      smallPointSig: armed.smallPointSig,
      smallFlatSig: armed.smallFlatSig,
      url: armed.url,
      type: armed.type,
      attachment: armed.attachment ?? null,
      atTop: armed.atTop === true,
      ...(armed.generationSig ? { generationSig: armed.generationSig } : {}),
    })
    request.armedTaken?.()
  }

  // The holder gathers what was just made in its group — after the commit,
  // because a reference must point at a tile that exists.
  //
  // ONE PERSON, ONE FACE. The reference shares the member's details at the
  // moment it is placed, so the member is dressed FIRST — with the dropped
  // picture when it is the tile the drop was for, otherwise with its
  // substrate default — then announced, then placed. Left to the early
  // announcement, dressing and placing raced: a reference placed before the
  // member was dressed had no picture to share and drew a different default
  // of its own — two backgrounds for one `bob`.
  const member = landing?.gather ?? null
  if (member) {
    if (armed && made.length === 1) {
      await attached
    } else {
      const substrate = iocGet<{ applyToCell?: (label: string, segments?: readonly string[]) => Promise<boolean> }>(
        '@diamondcoreprocessor.com/SubstrateService')
      await substrate?.applyToCell?.(member.name, member.sourceSegments.slice(0, -1)).catch(() => false)
    }
  }
  if (moved) announce()
  if (member) {
    await references?.place?.(member)
    const gatheredMessage = said('activity.gathered', `made "{cell}" in {group} — gathered here`)
      .replace('{cell}', member.name)
      .replace('{group}', baseSegments[baseSegments.length - 1] ?? '')
    EffectBus.emit('activity:log', { message: gatheredMessage, icon: '⬡' })
    // Said where it is seen: the tile landed somewhere else, and a line in
    // the activity strip alone is too quiet to notice (jwize, 2026-09-23).
    EffectBus.emit('toast:show', { type: 'success', message: gatheredMessage })
  }

  // Made ON a group, what you made is also gathered into the group's targets
  // that are switched on — the subset you chose, never every page by itself
  // (references/gather/gather-link.ts).
  if (!moved && made.length > 0) {
    const link = iocGet<{ feed?: (group: readonly string[], names: readonly string[]) => Promise<string[][]> }>(
      '@diamondcoreprocessor.com/GatherLinkService')
    const fed = await link?.feed?.(baseSegments, [made[0]]).catch(() => [] as string[][]) ?? []
    if (fed.length > 0) {
      const fedMessage = said('activity.fed', 'also gathered into {pages}')
        .replace('{pages}', fed.map(page => page[page.length - 1]).join(', '))
      EffectBus.emit('activity:log', { message: fedMessage, icon: 'alt_route' })
      EffectBus.emit('toast:show', { type: 'success', message: fedMessage })
    }
  }

  void new hypercomb().act()
  return { made: true, base: baseSegments, parts: made, moved }
}

/** The service the command line calls. One function: the commit. */
export const createCellsService = { create: createCells }

export type CreateCellsAsk = { name?: string; accept?: () => void; complete?: (error?: unknown) => void }

/** A REQUEST WITH NO COMMAND LINE TO ANSWER IT. Every behaviour that makes a
 *  tile asks with `command:create-cells` and treats an unaccepted request as
 *  a refusal. On a page with the command line, that component accepts. On a
 *  page without one — the framework-free host, a debugger subdomain — this
 *  does, with the same commit and no armed picture (the slot is the command
 *  line's). */
export const answerCreateRequest = (payload: CreateCellsAsk): void => {
  if (iocGet(COMMAND_LINE_IOC_KEY)) return
  // A leading or trailing slash means walk-in-after-create on the typed
  // line. Said by a behaviour the name is just a name.
  const seed = String(payload?.name ?? '').replace(/^\/+|\/+$/g, '').trim()
  const parts = seed.split('/').map(part => normalizeCell(part.trim())).filter(Boolean)
  if (parts.length === 0) return
  payload.accept?.()
  createCells({ parts, requireCommitter: true }).then(
    outcome => payload.complete?.(outcome.made ? undefined : new Error(
      outcome.why === 'empty' ? 'Create needs a name'
        : `"${outcome.word}" cannot be a tile name here`)),
    error => payload.complete?.(error),
  )
}
