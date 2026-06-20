// hypercomb-shared/ui/file-teaser/file-teaser-hover.component.ts
//
// The "feature tease" panel: a compact row of file-TYPE icons, each with a
// count badge, for the current breadcrumb location. Composes PinnableHoverBase
// — hover the header zone for an ephemeral peek; click to pin. Pin several
// (across locations) and drag them apart to COMPARE what files live where.
//
// Data is supplied by FilesTeaserDrone (essentials) over EffectBus
// `files:teaser:hover-show` / `:hover-pin`; this shell component only renders.
// Type taxonomy (icon + colour) is reused from the files-viewer so the teaser
// and the full panel read identically.

import { Component } from '@angular/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { PinnableHoverBase } from '../pinnable/pinnable-hover.base'
import { TYPE_META, type FileTypeKey } from '../files-viewer/file-icons'

export interface FileTeaserData {
  segments: string[]
  label: string
  counts: { type: FileTypeKey; count: number }[]
  total: number
}

@Component({
  selector: 'hc-file-teaser-hover',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './file-teaser-hover.component.html',
  styleUrls: ['./file-teaser-hover.component.scss'],
})
export class FileTeaserHoverComponent extends PinnableHoverBase<FileTeaserData> {

  protected get ns(): string { return 'files:teaser' }
  protected get posKey(): string { return 'hc:file-teaser-pins-pos' }
  protected override get panelWidth(): number { return 230 }

  /** Exposed to the template for icon + colour per type. */
  readonly meta = TYPE_META

  protected toPanel(payload: unknown): { key: string; data: FileTeaserData } | null {
    const d = payload as Partial<FileTeaserData> | undefined
    if (!d || !Array.isArray(d.counts)) return null
    const segments = Array.isArray(d.segments) ? d.segments.map(String) : []
    const counts = d.counts.filter(c => c && typeof c.count === 'number' && c.count > 0)
    return {
      // Key by location path so pinning the teaser at different breadcrumbs
      // stacks one panel per place — that's the comparison.
      key: segments.join('/') || '/',
      data: {
        segments,
        label: (typeof d.label === 'string' && d.label.trim()) ? d.label : (segments[segments.length - 1] ?? '/'),
        counts,
        total: typeof d.total === 'number' ? d.total : counts.reduce((a, c) => a + c.count, 0),
      },
    }
  }
}
