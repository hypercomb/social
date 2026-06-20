// diamondcoreprocessor.com/files/files-teaser.drone.ts
//
// Feeds the header "file teaser". On a header-zone hover/click request, walks
// the CURRENT breadcrumb location (its own cell + its child tiles), collects
// each tile's `files:attachment` records, and emits the raw { name, mime }
// list to the shell FileTeaserHover component — which categorizes + tallies
// per type (the taxonomy lives in shared and essentials must not import it).
//
//   files:teaser:request       (hover)  → emit files:teaser:hover-show
//   files:teaser:request-pin   (click)  → emit files:teaser:hover-pin
//   files:teaser:request-hide  (leave)  → emit files:teaser:hover-hide
//
// Mirrors ContactDrone: a Drone bridging a shell trigger to the data + the
// pinnable shell component, all over EffectBus. No shared/web import.

import { Drone, EffectBus } from '@hypercomb/core'
import { listAttachments } from './files-attachment.js'

const SIG = /^[a-f0-9]{64}$/

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: <U>(k: string) => U | undefined } }).ioc?.get?.<T>(key)

type LineageLike = { explorerSegments?: () => readonly string[]; explorerLabel?: () => string }
type HistoryLike = {
  sign: (l: { explorerSegments?: () => readonly string[] }) => Promise<string>
  currentLayerAt: (s: string) => Promise<{ children?: unknown } | null>
  getLayerBySig: (s: string) => Promise<{ name?: unknown } | null>
}

export class FilesTeaserDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'files'

  public override description =
    'Counts files at the current breadcrumb (its cell + child tiles) and feeds the header file-teaser — hover peek, click to pin and compare.'

  protected override listens = ['files:teaser:request', 'files:teaser:request-pin', 'files:teaser:request-hide']
  protected override emits = ['files:teaser:hover-show', 'files:teaser:hover-pin', 'files:teaser:hover-hide']

  #wired = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#wired) return
    this.#wired = true
    this.onEffect('files:teaser:request', () => void this.#feed('hover-show'))
    this.onEffect('files:teaser:request-pin', () => void this.#feed('hover-pin'))
    this.onEffect('files:teaser:request-hide', () => EffectBus.emit('files:teaser:hover-hide', {}))
  }

  async #feed(kind: 'hover-show' | 'hover-pin'): Promise<void> {
    const lineage = ioc<LineageLike>('@hypercomb.social/Lineage')
    const hist = ioc<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    if (!lineage || !hist) return

    const segments = (lineage.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    const label = ((lineage.explorerLabel?.() ?? segments[segments.length - 1] ?? '/') as string).trim() || '/'

    const files: { name: string; mime: string }[] = []
    const push = async (segs: readonly string[]): Promise<void> => {
      const att = await listAttachments(segs).catch(() => [])
      for (const a of att) files.push({ name: a.payload.name, mime: a.payload.mime })
    }

    await push(segments)
    try {
      const sig = await hist.sign({ explorerSegments: () => segments })
      const layer = await hist.currentLayerAt(sig)
      const children = Array.isArray(layer?.children) ? layer!.children : []
      for (const entry of children) {
        const s = String(entry ?? '').trim()
        let name = s
        if (SIG.test(s)) {
          const cl = await hist.getLayerBySig(s).catch(() => null)
          name = typeof cl?.name === 'string' ? cl.name : ''
        }
        if (name) await push([...segments, name])
      }
    } catch { /* cold cache — the current cell's files still feed the peek */ }

    EffectBus.emit(`files:teaser:${kind}`, { segments, label, files })
  }
}

const _filesTeaser = new FilesTeaserDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/FilesTeaserDrone',
  _filesTeaser,
)
