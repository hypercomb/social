// diamondcoreprocessor.com/instructions/instruction.drone.ts
//
// Collects instruction anchors from all registered bees, builds a
// signature-addressed manifest, manages per-user settings (dismiss/restore),
// and records history ops for undo/redo/time-travel.
//
// Uses the Signature Node Pattern (capture → sign → reference):
//   - InstructionManifest: full catalog of all instruction anchors (resource)
//   - InstructionSettings: user's visibility choices (resource)
//   - History ops point at settings resource signatures
//
// Effects:
//   instruction:toggle    → toggle overlay visibility
//   instruction:dismiss   → dismiss an individual anchor
//   instruction:restore-item → restore a dismissed anchor
//   instruction:state     → broadcast current state (last-value replay)
//   instruction:register  → late bees register their anchors
//   instruction:restore   → history cursor restores a settings snapshot

import { EffectBus } from '@hypercomb/core'
import type { Bee } from '@hypercomb/core'
import type { InstructionAnchor, InstructionManifest, InstructionSettings, InstructionSet } from '@hypercomb/core'

// ─── state ───────────────────────────────────────────

export interface InstructionState {
  visible: boolean
  catalogOpen: boolean
  manifestSig: string | null
  manifest: InstructionManifest | null
  settingsSig: string | null
  settings: InstructionSettings | null
}

// ─── drone ───────────────────────────────────────────

export class InstructionDrone extends EventTarget {

  #visible = false
  #catalogOpen = false
  #manifestSig: string | null = null
  #manifest: InstructionManifest | null = null
  #settingsSig: string | null = null
  #settings: InstructionSettings | null = null

  // three-level cache: in-memory → OPFS → never invalidates (immutable)
  #manifestCache = new Map<string, InstructionManifest>()
  #settingsCache = new Map<string, InstructionSettings>()
  #beeFingerprint = ''
  #lateRegistrations = new Map<string, readonly InstructionAnchor[]>()

  get state(): InstructionState {
    return {
      visible: this.#visible,
      catalogOpen: this.#catalogOpen,
      manifestSig: this.#manifestSig,
      manifest: this.#manifest,
      settingsSig: this.#settingsSig,
      settings: this.#settings,
    }
  }

  constructor() {
    super()

    // ── toggle visibility ──
    EffectBus.on<{ visible?: boolean } | undefined>('instruction:toggle', payload => {
      if (payload && typeof payload.visible === 'boolean') {
        this.#visible = payload.visible
      } else {
        this.#visible = !this.#visible
      }
      this.#catalogOpen = false
      if (this.#visible && !this.#manifest) this.#collectAndBuild()
      this.#emit()
    })

    // ── catalog mode (ctrl+click) ──
    EffectBus.on<undefined>('instruction:catalog', () => {
      this.#catalogOpen = !this.#catalogOpen
      if (this.#catalogOpen) {
        this.#visible = true
        if (!this.#manifest) this.#collectAndBuild()
      }
      this.#emit()
    })

    // ── dismiss individual anchor ──
    EffectBus.on<{ selector: string }>('instruction:dismiss', payload => {
      if (!payload?.selector || !this.#settings || !this.#manifestSig) return
      const hidden = [...this.#settings.hidden]
      if (!hidden.includes(payload.selector)) hidden.push(payload.selector)
      this.#updateSettings(hidden)
    })

    // ── restore dismissed anchor ──
    EffectBus.on<{ selector: string }>('instruction:restore-item', payload => {
      if (!payload?.selector || !this.#settings) return
      const hidden = this.#settings.hidden.filter(s => s !== payload.selector)
      this.#updateSettings(hidden)
    })

    // ── late registration from bees loaded after initial collection ──
    EffectBus.on<{ owner: string; anchors: readonly InstructionAnchor[] }>('instruction:register', payload => {
      if (!payload?.owner || !payload?.anchors?.length) return
      this.#lateRegistrations.set(payload.owner, payload.anchors)
      this.#beeFingerprint = '' // invalidate fingerprint → force rebuild
      if (this.#visible) this.#collectAndBuild()
    })

    // ── history restore: load settings by signature ──
    EffectBus.on<{ settingsSig: string }>('instruction:restore', async payload => {
      if (!payload?.settingsSig) return
      const settings = await this.#resolveSettings(payload.settingsSig)
      if (!settings) return
      this.#settingsSig = payload.settingsSig
      this.#settings = settings
      // also load the manifest this settings references
      if (settings.manifestSig && settings.manifestSig !== this.#manifestSig) {
        const manifest = await this.#resolveManifest(settings.manifestSig)
        if (manifest) {
          this.#manifestSig = settings.manifestSig
          this.#manifest = manifest
        }
      }
      this.#emit()
    })

    // ── clean up when bees are disposed ──
    EffectBus.on<{ iocKey: string }>('bee:disposed', () => {
      this.#beeFingerprint = '' // invalidate → rebuild on next show
    })
  }

  // ─── collection ──────────────────────────────────────

  #collectAndBuild(): void {
    const ioc = (globalThis as any).ioc
    if (!ioc) return

    const keys: string[] = ioc.list?.() ?? []
    const fingerprint = keys.slice().sort().join(',')
    if (fingerprint === this.#beeFingerprint && this.#manifest) return

    this.#beeFingerprint = fingerprint
    const sets: InstructionSet[] = []

    for (const key of keys) {
      const bee = ioc.get(key) as Bee | undefined
      if (!bee?.instructions?.length) continue
      sets.push({
        owner: key,
        label: bee.name ?? key,
        anchors: bee.instructions,
      })
    }

    // merge late-registered anchors (from instruction:register effect)
    for (const [owner, anchors] of this.#lateRegistrations) {
      if (sets.some(s => s.owner === owner)) continue // already from IoC
      const label = owner.replace(/^@[^/]+\//, '').replace(/Drone$/, '').replace(/([a-z])([A-Z])/g, '$1 $2')
      sets.push({ owner, label, anchors })
    }

    const locale = (globalThis as any).ioc?.get?.('@hypercomb.social/I18n')?.locale ?? 'en'
    const manifest: InstructionManifest = {
      version: 1,
      locale,
      timestamp: Date.now(),
      sets,
    }

    // sign and cache
    this.#manifest = manifest
    this.#captureManifest(manifest)

    // create default settings if none exist
    if (!this.#settings || this.#settings.manifestSig !== this.#manifestSig) {
      this.#updateSettings([])
    }
  }

  // ─── signature node: capture manifest ────────────────

  async #captureManifest(manifest: InstructionManifest): Promise<void> {
    const json = this.#deterministicJson(manifest)
    const sig = await this.#sign(json)
    this.#manifestSig = sig
    this.#manifestCache.set(sig, manifest)
    await this.#storeResource(sig, json)
  }

  // ─── signature node: capture settings ────────────────

  async #captureSettings(settings: InstructionSettings): Promise<string> {
    const json = this.#deterministicJson(settings)
    const sig = await this.#sign(json)
    this.#settingsSig = sig
    this.#settings = settings
    this.#settingsCache.set(sig, settings)
    await this.#storeResource(sig, json)
    return sig
  }

  // ─── settings update + history recording ─────────────

  async #updateSettings(hidden: string[]): Promise<void> {
    if (!this.#manifestSig) return
    const settings: InstructionSettings = {
      version: 1,
      manifestSig: this.#manifestSig,
      hidden,
      at: Date.now(),
    }
    const sig = await this.#captureSettings(settings)

    // record history op
    this.#recordHistory(sig)
    this.#emit()
  }

  // ─── resolve from cache or OPFS ──────────────────────

  async #resolveManifest(sig: string): Promise<InstructionManifest | null> {
    const cached = this.#manifestCache.get(sig)
    if (cached) return cached
    const blob = await this.#loadResource(sig)
    if (!blob) return null
    const manifest = JSON.parse(await blob.text()) as InstructionManifest
    this.#manifestCache.set(sig, manifest)
    return manifest
  }

  async #resolveSettings(sig: string): Promise<InstructionSettings | null> {
    const cached = this.#settingsCache.get(sig)
    if (cached) return cached
    const blob = await this.#loadResource(sig)
    if (!blob) return null
    const settings = JSON.parse(await blob.text()) as InstructionSettings
    this.#settingsCache.set(sig, settings)
    return settings
  }

  // ─── helpers ─────────────────────────────────────────

  #emit(): void {
    EffectBus.emit('instruction:state', this.state)
    this.dispatchEvent(new CustomEvent('change'))
  }

  #deterministicJson(data: object): string {
    return JSON.stringify(data, Object.keys(data).sort(), 0)
  }

  async #sign(json: string): Promise<string> {
    const bytes = new TextEncoder().encode(json)
    const hash = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  async #storeResource(sig: string, json: string): Promise<void> {
    try {
      const store = (globalThis as any).ioc?.get?.('@hypercomb.social/Store')
      if (!store?.putResource) return
      await store.putResource(new Blob([json], { type: 'application/json' }))
    } catch { /* OPFS may not be available in all environments */ }
  }

  async #loadResource(sig: string): Promise<Blob | null> {
    try {
      const store = (globalThis as any).ioc?.get?.('@hypercomb.social/Store')
      if (!store?.getResource) return null
      return await store.getResource(sig)
    } catch { return null }
  }

  #recordHistory(settingsSig: string): void {
    try {
      const historyService = (globalThis as any).ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
      if (!historyService?.record) return

      // get current location signature from lineage
      const lineage = (globalThis as any).ioc?.get?.('@hypercomb.social/Lineage')
      if (!lineage) return

      // use the location signature from lineage
      const locSig = lineage.locationSignature?.()
      if (!locSig) return

      historyService.record(locSig, {
        op: 'instruction-state',
        cell: settingsSig,
        at: Date.now(),
        groupId: 'instruction',
      })
    } catch { /* history may not be available */ }
  }
}

// ─── built-in instruction anchors (controls bar + command line) ──

const BUILTIN_ANCHORS: readonly InstructionAnchor[] = [
  { selector: 'dcp.open-processor', labelKey: 'instruction.dcp.open-processor', placement: 'top', category: 'view' },
  { selector: 'dcp.fit-content', labelKey: 'instruction.dcp.fit-content', shortcut: 'Ctrl+Click: lock', placement: 'top', category: 'view' },
  { selector: 'dcp.zoom-out', labelKey: 'instruction.dcp.zoom-out', shortcut: 'Scroll down', placement: 'top', category: 'navigation' },
  { selector: 'dcp.zoom-in', labelKey: 'instruction.dcp.zoom-in', shortcut: 'Scroll up', placement: 'top', category: 'navigation' },
  { selector: 'dcp.lock', labelKey: 'instruction.dcp.lock', placement: 'top', category: 'view' },
  { selector: 'dcp.fullscreen', labelKey: 'instruction.dcp.fullscreen', placement: 'top', category: 'view' },
  { selector: 'dcp.layout-mode', labelKey: 'instruction.dcp.layout-mode', command: '/layout', placement: 'top', category: 'view' },
  { selector: 'dcp.instructions-toggle', labelKey: 'instruction.dcp.instructions-toggle', command: '/instructions', placement: 'top', category: 'help' },
]

// ─── self-register in IoC ────────────────────────────

const _instructions = new InstructionDrone()
;(globalThis as any).ioc?.register?.('@diamondcoreprocessor.com/InstructionDrone', _instructions)

// register built-in instructions after a tick (ensures IoC is ready)
queueMicrotask(() => {
  EffectBus.emit('instruction:register', {
    owner: '@diamondcoreprocessor.com/InstructionDrone',
    anchors: BUILTIN_ANCHORS,
  })
})
