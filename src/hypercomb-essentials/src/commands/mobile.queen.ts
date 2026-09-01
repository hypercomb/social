// commands/mobile.queen.ts
//
// /mobile — control the mobile viewer experience.
//
// Syntax:
//   /mobile on      — force the mobile viewer experience on (test the gate
//                     on desktop without device emulation)
//   /mobile off     — force it off
//   /mobile auto    — clear the override, return to auto-detection
//   /mobile sweep   — walk the current subtree and mark every link/image tile
//                     `mobile:friendly` (skips tiles the user held back with
//                     `mobile:hold`). Retroactive; idempotent; never unmarks.
//   /mobile         — report the current state
//
// The mode itself lives in MobileModeService (@
// MobileMode); this queen is the slash surface over its override plus the
// retroactive marking sweep. See documentation/mobile-experience-plan.md §4.2.

import { QueenBee, EffectBus } from '@hypercomb/core'
import { MOBILE_MODE_IOC_KEY, MOBILE_FRIENDLY, MOBILE_HOLD } from '../preferences/mobile-pheromones.js'
import { addMobileRoot } from '../preferences/mobile-roots.js'
import type { MobileModeService } from '../preferences/mobile-mode.service.js'

const SIG_RE = /^[0-9a-f]{64}$/
const MAX_DEPTH = 32
// Hard cap so a stray /mobile sweep on a huge hive can't mint thousands of
// commits. If hit, the toast says so — never silently truncate.
const MAX_NODES = 500

export class MobileQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'mobile'
  override readonly aliases = []
  override description = 'Mobile viewer: on / off / auto, sweep tiles, or designate a hive'
  override descriptionKey = 'slash.mobile'
  override options = ['on', 'off', 'auto', 'sweep', 'hive']
  override examples = [
    { input: '/mobile on', result: 'Force the mobile viewer experience' },
    { input: '/mobile sweep', result: 'Mark link & image tiles mobile-friendly' },
    { input: '/mobile hive Studio', result: 'Make the "Studio" hive a mobile hive' },
  ]

  override slashComplete(args: string): readonly string[] {
    const opts = ['on', 'off', 'auto', 'sweep', 'hive']
    const q = args.toLowerCase().trim()
    return q ? opts.filter(o => o.startsWith(q)) : opts
  }

  protected execute(args: string): void {
    const raw = args.trim()
    const trimmed = raw.toLowerCase()

    if (trimmed === 'sweep') {
      void this.sweep()
      return
    }

    // /mobile hive [name] — designate a root-level hive as a mobile hive:
    // tag its container `mobile:friendly` (so the gate shows only it in mobile
    // mode) AND record its location signature in the mobile-roots pool. `raw`
    // (case preserved) carries the name after the "hive" keyword.
    if (trimmed === 'hive' || trimmed.startsWith('hive ')) {
      void this.#designateHive(raw.slice(4).trim())
      return
    }

    const svc = get(MOBILE_MODE_IOC_KEY) as MobileModeService | undefined
    if (!svc) {
      console.warn('[/mobile] MobileModeService not available')
      return
    }

    if (!trimmed) {
      EffectBus.emit('toast:show', {
        type: 'info',
        message: `Mobile mode is ${svc.active ? 'on' : 'off'} (${svc.override})`,
      })
      console.log(`[/mobile] active=${svc.active} override=${svc.override}`)
      return
    }

    if (trimmed !== 'on' && trimmed !== 'off' && trimmed !== 'auto') {
      EffectBus.emit('toast:show', {
        type: 'warning',
        message: `Unknown option "${trimmed}". Use on, off, auto, sweep, or hive.`,
      })
      return
    }

    svc.setOverride(trimmed)
    EffectBus.emit('toast:show', {
      type: 'success',
      message: trimmed === 'auto'
        ? `Mobile mode: auto (now ${svc.active ? 'on' : 'off'})`
        : `Mobile mode: ${trimmed}`,
    })
    console.log(`[/mobile] override → ${trimmed} (active=${svc.active})`)
  }

  /** Walk the current subtree and deposit `mobile:friendly` on every tile whose
   *  content is inherently mobile-fit (a link or an image), skipping tiles the
   *  user held back (`mobile:hold`) and tiles already marked. Idempotent.
   *  PUBLIC: the mobile empty-state prompt invokes it directly via IoC. */
  async sweep(): Promise<void> {
    const history = get('@diamondcoreprocessor.com/HistoryService') as {
      sign: (l: { explorerSegments?: () => readonly string[] }) => Promise<string>
      currentLayerAt: (sig: string) => Promise<Record<string, unknown> | null>
      getLayerBySig: (sig: string) => Promise<{ name?: string } | null>
    } | undefined
    const store = get('@hypercomb.social/Store') as {
      getResource: (sig: string) => Promise<Blob | null>
    } | undefined
    const deco = get('@diamondcoreprocessor.com/DecorationService') as {
      addTag: (segments: readonly string[], name: string) => Promise<string>
    } | undefined
    const lineage = get('@hypercomb.social/Lineage') as {
      explorerSegments?: () => readonly string[]
    } | undefined

    if (!history?.sign || !history?.currentLayerAt || !store?.getResource || !deco?.addTag) {
      EffectBus.emit('toast:show', { type: 'warning', message: 'Mobile sweep unavailable — try again in a moment' })
      return
    }

    const rootSegs = lineage?.explorerSegments?.() ? [...lineage.explorerSegments()] : []
    EffectBus.emit('toast:show', { type: 'tip', message: 'Sweeping tiles for mobile…', duration: 2_000 })

    let scanned = 0
    let marked = 0
    let capped = false
    // Paths to mark, gathered first (read-only), then deposited — deposits
    // commit layers, so we keep the read walk clean and mutate afterwards.
    const toMark: string[][] = []

    // Read a cell's tag names + mobile-fit signal from its layer.
    const inspect = async (layer: Record<string, unknown>): Promise<{ held: boolean; friendly: boolean; fit: boolean }> => {
      let held = false
      let friendly = false
      const decorations = Array.isArray(layer['decorations']) ? layer['decorations'] as unknown[] : []
      for (const sig of decorations) {
        if (typeof sig !== 'string' || !SIG_RE.test(sig)) continue
        try {
          const blob = await store.getResource(sig)
          if (!blob) continue
          const rec = JSON.parse(await blob.text()) as { kind?: string; payload?: { name?: unknown } }
          if (rec?.kind !== 'tag') continue
          if (rec.payload?.name === MOBILE_HOLD) held = true
          if (rec.payload?.name === MOBILE_FRIENDLY) friendly = true
        } catch { /* malformed decoration — skip */ }
      }
      // Mobile-fit signal: a link or an image is inherently viewable on mobile.
      let fit = false
      const props = Array.isArray(layer['properties']) ? layer['properties'] as unknown[] : []
      const propSig = props[0]
      if (typeof propSig === 'string' && SIG_RE.test(propSig)) {
        try {
          const blob = await store.getResource(propSig)
          if (blob) {
            const p = JSON.parse(await blob.text()) as { link?: unknown; imageSig?: unknown }
            if (typeof p.link === 'string' && p.link.length > 0) fit = true
            if (typeof p.imageSig === 'string' && p.imageSig.length > 0) fit = true
          }
        } catch { /* malformed — skip */ }
      }
      return { held, friendly, fit }
    }

    const walk = async (path: string[], depth: number): Promise<void> => {
      if (depth > MAX_DEPTH || capped) return
      let layer: Record<string, unknown> | null
      try {
        const sig = await history.sign({ explorerSegments: () => path })
        layer = await history.currentLayerAt(sig)
      } catch { return }
      if (!layer) return

      const atRoot = path.length === rootSegs.length
      if (!atRoot) {
        scanned++
        const { held, friendly, fit } = await inspect(layer)
        if (fit && !held && !friendly) {
          if (toMark.length >= MAX_NODES) { capped = true; return }
          toMark.push(path)
        }
      }

      const rawChildren = Array.isArray(layer['children']) ? layer['children'] as unknown[] : []
      for (const entry of rawChildren) {
        // Children may be bare layer SIGNATURES; the navigable segment is the
        // child's NAME, resolved via getLayerBySig when the entry is a sig.
        const s = typeof entry === 'string'
          ? entry.trim()
          : (entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string')
            ? (entry as { name: string }).name.trim()
            : ''
        if (!s) continue
        let childName = s
        if (SIG_RE.test(s)) {
          try {
            const child = await history.getLayerBySig(s)
            if (!child?.name) continue
            childName = String(child.name)
          } catch { continue }
        }
        await walk([...path, childName], depth + 1)
        if (capped) break
      }
    }

    try {
      await walk(rootSegs, 0)
      for (const path of toMark) {
        await deco.addTag(path, MOBILE_FRIENDLY)
        marked++
      }
    } catch (err) {
      console.warn('[/mobile sweep] failed', err)
    }

    // Deposits bypass the painter's tags:apply invalidation, so nudge the
    // renderer to re-run the gate (marked tiles appear without a navigation).
    if (marked > 0) EffectBus.emit('mobile:marks-changed', { marked })

    const suffix = capped ? ` (stopped at ${MAX_NODES} — run again deeper in)` : ''
    EffectBus.emit('toast:show', {
      type: 'success',
      message: marked > 0
        ? `Marked ${marked} of ${scanned} tiles for mobile${suffix}`
        : `No new tiles to mark (${scanned} scanned)${suffix}`,
    })
    console.log(`[/mobile sweep] marked=${marked} scanned=${scanned} capped=${capped}`)
  }

  /** Designate a root-level hive as a mobile hive: tag its container
   *  `mobile:friendly` (authoritative — the gate shows only it in mobile mode)
   *  and record its location signature in the participant-local mobile-roots
   *  pool. With no name, designates the current top-level hive. */
  async #designateHive(name: string): Promise<void> {
    const deco = get('@diamondcoreprocessor.com/DecorationService') as {
      addTag: (segments: readonly string[], name: string) => Promise<string>
    } | undefined
    const history = get('@diamondcoreprocessor.com/HistoryService') as {
      sign: (l: { explorerSegments?: () => readonly string[] }) => Promise<string>
    } | undefined
    const lineage = get('@hypercomb.social/Lineage') as {
      explorerSegments?: () => readonly string[]
    } | undefined

    if (!deco?.addTag || !history?.sign) {
      EffectBus.emit('toast:show', { type: 'warning', message: 'Mobile hive unavailable — try again in a moment' })
      return
    }

    const segs = lineage?.explorerSegments?.() ? [...lineage.explorerSegments()] : []
    // An explicit name targets a root-level hive; otherwise the current
    // top-level hive (the first segment of where you're standing).
    const target = name || segs[0]
    if (!target) {
      EffectBus.emit('toast:show', { type: 'warning', message: 'Name a hive: /mobile hive <name> (or run it inside one)' })
      return
    }

    try {
      await deco.addTag([target], MOBILE_FRIENDLY)
      const sig = await history.sign({ explorerSegments: () => [target] })
      await addMobileRoot(sig)
      EffectBus.emit('mobile:marks-changed', { marked: 1 })
      EffectBus.emit('toast:show', { type: 'success', message: `"${target}" is now a mobile hive` })
      console.log(`[/mobile hive] designated "${target}" sig=${sig}`)
    } catch (err) {
      console.warn('[/mobile hive] failed', err)
      EffectBus.emit('toast:show', { type: 'warning', message: 'Could not designate mobile hive' })
    }
  }
}

const _mobile = new MobileQueenBee()
window.ioc.register('@diamondcoreprocessor.com/MobileQueenBee', _mobile)
