// sharing/host-directory.drill.ts
//
// THE TWO WAYS TO LOOK AT THE HOSTS, and what the desk remembers about them. (jwize,
// 2026-11-05: "this is advanced mode — the other should just be the hosts list large
// in the middle with a drill down to the code. Nothing fancy, the same things but
// single drill in … maybe the items can be toggled as a multiselect." Then: "no I
// think we need both" — and "this four pane view is beautiful".)
//
//   SIMPLE (the default) — one large list in the middle, and a drill: the hosts, then
//     a host's packages (and the packages inside one), then the files a package
//     declares, then the code. A click goes one step in; Escape goes one step back. A
//     Select switch turns every row into a check box, and what is checked is opened
//     together — several hosts stacked, several packages' parts side by side, several
//     files read at once. It is the same state the four panes read (`#stack`, `#cols`,
//     `#files`), shown one step at a time.
//   ADVANCED — the four panes: hosts, packages, files, code, each as wide as the
//     participant drags it.
//
// This file is the part that needs no DOM: which page a state is, which list a page
// shows, the trail of crumbs above it, the one record the desk keeps, and the order
// finished work is listed in. The view draws it; the spec below it pins it.
//
// A dependency (atomic-modules-plan.md): it registers nothing and imports nothing.

export type DeskMode = 'simple' | 'advanced'

/** What the desk keeps between openings: one current record, written only by a press
 *  or a drag — never by software. Anything it does not understand is "not set". */
export interface DeskRecord {
  mode: DeskMode
  /** Pane widths in rem, only the ones the participant has set. */
  panes: Partial<Record<PaneName, number>>
}

export type PaneName = 'rail' | 'packages' | 'files'

/** Every pane's width, in rem: where it starts, and how far it may be dragged. The
 *  code pane takes what is left, so it has no width of its own. */
export const PANE_LIMITS: Readonly<Record<PaneName, { min: number; max: number; start: number }>> = Object.freeze({
  rail: { min: 11, max: 30, start: 18 },
  packages: { min: 11, max: 32, start: 16 },
  files: { min: 11, max: 32, start: 16 },
})

/** A width inside its pane's limits, to a tenth of a rem. A value that is no number is the start. */
export const clampPane = (pane: PaneName, rem: unknown): number => {
  const { min, max, start } = PANE_LIMITS[pane]
  if (typeof rem !== 'number' || !Number.isFinite(rem)) return start
  return Math.round(Math.min(max, Math.max(min, rem)) * 10) / 10
}

/** The record as it was kept: only `advanced` is a choice (simple is the default),
 *  and only a pane that holds a number is a width. */
export function deskRecord(raw: unknown): DeskRecord {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const panes: Partial<Record<PaneName, number>> = {}
  const kept = record['panes'] && typeof record['panes'] === 'object' ? record['panes'] as Record<string, unknown> : {}
  for (const pane of Object.keys(PANE_LIMITS) as PaneName[]) {
    if (typeof kept[pane] === 'number' && Number.isFinite(kept[pane])) panes[pane] = clampPane(pane, kept[pane])
  }
  return { mode: record['mode'] === 'advanced' ? 'advanced' : 'simple', panes }
}

/** The record's bytes: a fixed key order, so the same choices are the same document. */
export const deskRecordText = (record: DeskRecord): string => {
  const panes: Record<string, number> = {}
  for (const pane of ['rail', 'packages', 'files'] as const) {
    const width = record.panes[pane]
    if (typeof width === 'number') panes[pane] = clampPane(pane, width)
  }
  return JSON.stringify({ mode: record.mode, panes })
}

// ── the drill ────────────────────────────────────────────────────────────────

export type DrillPage = 'hosts' | 'packages' | 'code'

/** Which page the state is: the hosts until one is opened; then the packages and their
 *  files; then the code of the files being read. Reading needs something to read. */
export const drillPage = (input: { atHosts: boolean; reading: boolean; filesPicked: number }): DrillPage =>
  input.atHosts ? 'hosts' : input.reading && input.filesPicked > 0 ? 'code' : 'packages'

/**
 * The list a packages page shows, and whose files it lists. The columns are the
 * packages one level at a time, each the parts of what the one before it picked; the
 * page is the FIRST column nothing is picked in (what is inside the packages already
 * picked), and the files are those of the deepest column that has a pick. When every
 * column is picked down to packages with nothing inside, there is no list — only files.
 */
export function drillRows<R>(model: readonly { rows: readonly R[]; picked: { keys: readonly string[] } }[]): {
  /** The column the page lists. `model.length` when there is none. */
  level: number
  rows: readonly R[]
  /** The packages whose files are listed. */
  paths: readonly string[]
} {
  const level = model.findIndex(column => column.picked.keys.length === 0)
  const open = level < 0 ? model.length : level
  let paths: readonly string[] = []
  for (let k = model.length - 1; k >= 0; k--) {
    if (model[k]!.picked.keys.length) { paths = model[k]!.picked.keys; break }
  }
  return { level: open, rows: model[open]?.rows ?? [], paths }
}

export interface Crumb {
  kind: 'hosts' | 'host' | 'package' | 'file'
  /** What it names, when it is one thing; the count when it is several. */
  one: string
  count: number
}

/** The trail above a page: the hosts, the host(s) opened, each level of packages
 *  picked (its last part, or how many), and the files being read. */
export function crumbTrail(input: {
  atHosts: boolean
  hosts: readonly string[]
  picks: readonly (readonly string[])[]
  reading: number
}): Crumb[] {
  const trail: Crumb[] = [{ kind: 'hosts', one: '', count: 0 }]
  if (input.atHosts) return trail
  trail.push({ kind: 'host', one: input.hosts.length === 1 ? input.hosts[0]! : '', count: input.hosts.length })
  for (const keys of input.picks) {
    if (!keys.length) break
    trail.push({ kind: 'package', one: keys.length === 1 ? keys[0]!.split('/').pop()! : '', count: keys.length })
  }
  if (input.reading > 0) trail.push({ kind: 'file', one: '', count: input.reading })
  return trail
}

/** Whether a checked key is a file (a signature) or a package (a path). */
export const isFileKey = (key: string): boolean => /^[0-9a-f]{64}$/.test(key)

// ── finished work goes last ──────────────────────────────────────────────────

/** Rows in the order they were given, except that the finished ones go to the end,
 *  each group keeping its own order — so what is still moving stays in view. */
export function finishedLast<R>(rows: readonly R[], finished: (row: R) => boolean): R[] {
  const moving: R[] = []
  const done: R[] = []
  for (const row of rows) (finished(row) ? done : moving).push(row)
  return [...moving, ...done]
}
