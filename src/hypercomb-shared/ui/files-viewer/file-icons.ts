// hypercomb-shared/ui/files-viewer/file-icons.ts
//
// File-type taxonomy for the files viewer: maps a filename/mime to a
// coarse category, each with a short type badge and an accent colour.
// Lives in shared (presentation) — the panel can't import essentials —
// and is derived purely from name/mime, so no `type` needs to ride the
// payload. Drives both the per-row type icon and the top filter chips.

export type FileTypeKey =
  | 'pdf' | 'doc' | 'sheet' | 'slides'
  | 'image' | 'vector' | 'code' | 'archive' | 'other'

export type FileTypeMeta = {
  /** i18n key for the type's display name (filter chip tooltip). */
  labelKey: string
  /** Short badge text shown as the "type icon". */
  short: string
  /** Accent colour (CSS) for the badge + active filter chip. */
  color: string
}

/** Stable order for the filter bar. */
export const TYPE_ORDER: readonly FileTypeKey[] = [
  'pdf', 'doc', 'sheet', 'slides', 'image', 'vector', 'code', 'archive', 'other',
]

export const TYPE_META: Record<FileTypeKey, FileTypeMeta> = {
  pdf:     { labelKey: 'files.type.pdf',     short: 'PDF',  color: '#ff6b6b' },
  doc:     { labelKey: 'files.type.doc',     short: 'DOC',  color: '#6ba8ff' },
  sheet:   { labelKey: 'files.type.sheet',   short: 'XLS',  color: '#5fd07a' },
  slides:  { labelKey: 'files.type.slides',  short: 'PPT',  color: '#ffb060' },
  image:   { labelKey: 'files.type.image',   short: 'IMG',  color: '#c89bff' },
  vector:  { labelKey: 'files.type.vector',  short: 'SVG',  color: '#ff9bd0' },
  code:    { labelKey: 'files.type.code',    short: '{ }',  color: '#8fe0e0' },
  archive: { labelKey: 'files.type.archive', short: 'ZIP',  color: '#d0b07a' },
  other:   { labelKey: 'files.type.other',   short: 'FILE', color: '#9aa0b0' },
}

const EXT_MAP: Record<string, FileTypeKey> = {
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc', txt: 'doc', md: 'doc',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', tsv: 'sheet',
  ppt: 'slides', pptx: 'slides', key: 'slides',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', avif: 'image', heic: 'image',
  svg: 'vector',
  js: 'code', ts: 'code', jsx: 'code', tsx: 'code', json: 'code', html: 'code', htm: 'code',
  css: 'code', scss: 'code', xml: 'code', yml: 'code', yaml: 'code', py: 'code', rb: 'code',
  go: 'code', rs: 'code', sh: 'code',
  zip: 'archive', tar: 'archive', gz: 'archive', '7z': 'archive', rar: 'archive',
}

const extOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** Map a file to its category by extension, with a mime fallback. */
export function categorize(name: string, mime?: string): FileTypeKey {
  const byExt = EXT_MAP[extOf(name)]
  if (byExt) return byExt
  const m = (mime ?? '').toLowerCase()
  if (m === 'application/pdf') return 'pdf'
  if (m === 'image/svg+xml') return 'vector'
  if (m.startsWith('image/')) return 'image'
  if (m === 'application/json' || m.startsWith('text/')) return 'doc'
  if (m.includes('zip') || m.includes('compressed')) return 'archive'
  return 'other'
}

export function typeMeta(name: string, mime?: string): FileTypeMeta {
  return TYPE_META[categorize(name, mime)]
}
