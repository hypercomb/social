// hypercomb-core/src/core/file-icons.ts
//
// File-type taxonomy for the files viewer: maps a filename/mime to a
// coarse category, each with a short type badge and an accent colour.
// Drives both the per-row type icon and the top filter chips.
//
// IT LANDED IN CORE, not beside the panel, because it has TWO consumers and
// they live on opposite sides of the dependency rule: the converted
// files-viewer element in essentials, and file-teaser, which is still an
// Angular component in shared — and shared may never import essentials. A
// primitive both kits need is exactly what core is for. Pure data plus two
// pure functions, no imports at all, so it costs either bundle nothing but
// its bytes.
//
// Consequence for the catalog split: the eleven `files.type.*` keys this
// table names are rendered through it by BOTH consumers, so they are carried
// by the files-viewer catalog AND left in the shell for file-teaser. A key
// two surfaces render belongs to both.
//
// The classification is derived from name/mime ALONE, deliberately: no `type`
// rides the `files:open` payload, so the drone never has to agree with the
// panel about what a file is, and a taxonomy change needs no re-gather.

export type FileTypeKey =
  | 'pdf' | 'doc' | 'sheet' | 'slides'
  | 'image' | 'vector' | 'audio' | 'video' | 'code' | 'archive' | 'other'

export type FileTypeMeta = {
  /** i18n key for the type's display name (filter chip tooltip). */
  labelKey: string
  /** Short text label (tooltip / fallback). */
  short: string
  /** Accent colour (CSS) for the icon + active filter chip. */
  color: string
  /** Material Symbols ligature shown as the type icon (row + filter chip). */
  icon: string
}

/** Stable order for the filter bar. */
export const TYPE_ORDER: readonly FileTypeKey[] = [
  'pdf', 'doc', 'sheet', 'slides', 'image', 'vector', 'audio', 'video', 'code', 'archive', 'other',
]

export const TYPE_META: Record<FileTypeKey, FileTypeMeta> = {
  pdf:     { labelKey: 'files.type.pdf',     short: 'PDF',  color: '#ff6b6b', icon: 'picture_as_pdf' },
  doc:     { labelKey: 'files.type.doc',     short: 'DOC',  color: '#6ba8ff', icon: 'description' },
  sheet:   { labelKey: 'files.type.sheet',   short: 'XLS',  color: '#5fd07a', icon: 'table_chart' },
  slides:  { labelKey: 'files.type.slides',  short: 'PPT',  color: '#ffb060', icon: 'slideshow' },
  image:   { labelKey: 'files.type.image',   short: 'IMG',  color: '#c89bff', icon: 'image' },
  vector:  { labelKey: 'files.type.vector',  short: 'SVG',  color: '#ff9bd0', icon: 'polyline' },
  audio:   { labelKey: 'files.type.audio',   short: 'AUD',  color: '#6be0c0', icon: 'audio_file' },
  video:   { labelKey: 'files.type.video',   short: 'VID',  color: '#ff8f6b', icon: 'video_file' },
  code:    { labelKey: 'files.type.code',    short: '{ }',  color: '#8fe0e0', icon: 'code' },
  archive: { labelKey: 'files.type.archive', short: 'ZIP',  color: '#d0b07a', icon: 'folder_zip' },
  other:   { labelKey: 'files.type.other',   short: 'FILE', color: '#9aa0b0', icon: 'draft' },
}

const EXT_MAP: Record<string, FileTypeKey> = {
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc', txt: 'doc', md: 'doc',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', tsv: 'sheet',
  ppt: 'slides', pptx: 'slides', key: 'slides',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', avif: 'image', heic: 'image',
  svg: 'vector',
  mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio', m4a: 'audio', aac: 'audio',
  mp4: 'video', mov: 'video', avi: 'video', mkv: 'video', webm: 'video', m4v: 'video',
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
  if (m.startsWith('audio/')) return 'audio'
  if (m.startsWith('video/')) return 'video'
  if (m === 'application/json' || m.startsWith('text/')) return 'doc'
  if (m.includes('zip') || m.includes('compressed')) return 'archive'
  return 'other'
}

export function typeMeta(name: string, mime?: string): FileTypeMeta {
  return TYPE_META[categorize(name, mime)]
}
