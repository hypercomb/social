// mail/template-pool.ts
//
// THE TEMPLATES THIS HIVE KEEPS. A template is one artifact: its bytes are a
// resource at the content root, `<root>/<sig>` (S2), held once however many
// messages and tiles name it (A6). The pool `mail:template` says which of
// those the participant keeps (P1): membership, never the template's truth —
// a reader trusts a template by its signature at the gate, not because it is
// on a list (P6, T3).
//
// ── ONE DOCUMENT, AND IT IS THE INDEX A HOST SERVES ─────────────────────────
//
// The pool holds one current document, `{ meaning, members: [sig, …] }`,
// written through the store's document writer so every save keeps the list
// before it (a participant's save keeps every version; nothing is ever
// removed, H3). That shape is exactly the index published-pools.ts reads from
// `<origin>/<sign(meaning)>`, so offering this pool later is serving these
// bytes as they are, and every member is already at `<origin>/<sig>` (T1).
// Taking a template off the list is hiding it (hide first): its bytes stay,
// and the list's history still names it.
//
// ── NEVER A HOST, NEVER A THROW ─────────────────────────────────────────────
//
// Listing reads only this device's own heap (`getResourceLocal`): showing the
// participant their templates never makes this browser contact anyone (T7).
// Every member is read back through `parseTemplate` by its signature, so what
// the list shows is what will render, and a member that does not read is kept
// in the answer with its reason rather than dropped or thrown.
//
// ── THE AUDIT IS A READING, NEVER A YES ─────────────────────────────────────
//
// `auditTemplate` reads what a template reaches — its links and the words they
// show, which holes let the sender choose a link or a picture, whether it
// declares a script — and writes no verdict: it recommends 'unclear', always.
// A well-formed letter can still be a phishing letter, and only a person can
// say otherwise (M1, and the brood's rule that an audit can never accept).
// The report is content, kept by its own signature; `recordTemplateAudit`
// returns the entry the brood's `attachAudit` takes, for the gate of step 4.
// Store access is through IoC, as mail-to-hive.ts does; nothing registers here.

import { get, type BroodAudit } from '@hypercomb/core'
import {
  MAIL_TEMPLATE_LIMITS,
  outlineTemplate,
  parseTemplate,
  templateBytes,
  type MailTemplate,
  type MailTemplateDocument,
  type TemplateLink,
} from './template.js'

/** The pool's meaning. Its address is `sign('mail:template')`, derived by the store. */
export const MAIL_TEMPLATE_MEANING = 'mail:template'
/** The self-declaring key of an audit report; its value is the format version. */
export const MAIL_TEMPLATE_AUDIT_KEY = 'mail:template-audit'
/** Who wrote a mechanical audit: this module, never a person and never a model. */
export const TEMPLATE_READER = 'template-reader'
/** As many as one host may offer per meaning (published-pools.ts), so the list always publishes whole. */
export const MAX_KEPT_TEMPLATES = 64

const STORE_KEY = '@hypercomb.social/Store'
const SIG = /^[0-9a-f]{64}$/

/** The store, as far as this module uses it. Every method optional: an older store, or none, is an answer. */
export interface TemplateStore {
  /** Opens the pool, creating it — only for a write. */
  getPool?(meaning: string): Promise<object | null>
  /** Opens the pool and never creates it — for a read. */
  openPool?(meaning: string): Promise<object | null>
  getPoolDoc?(pool: object, subKey?: string): Promise<ArrayBuffer | null>
  putPoolDoc?(pool: object, bytes: ArrayBuffer, subKey?: string, options?: { keep?: 'versions' | 'current' }): Promise<string | null>
  putResource?(blob: Blob, options?: { emit?: boolean }): Promise<string>
  getResourceLocal?(signature: string): Promise<Blob | null>
}

const storeFromIoc = (): TemplateStore | undefined => {
  try { return get<TemplateStore>(STORE_KEY) } catch { return undefined }
}

// ── the list ────────────────────────────────────────────────────────────────

export type TemplateEntry =
  | { readonly sig: string; readonly ok: true; readonly template: MailTemplate }
  | { readonly sig: string; readonly ok: false; readonly reason: string }

export interface TemplateListing {
  /** Members in the order they were kept, each read back or refused with its reason. */
  readonly entries: readonly TemplateEntry[]
  /** Set when there is no list to read: no store here, or a list on disk that does not read. */
  readonly problem?: 'no-store' | 'unreadable'
}

/** The bytes of one list: the published-index shape, members in order. */
const listBytes = (members: readonly string[]): ArrayBuffer => {
  const bytes = new TextEncoder().encode(JSON.stringify({ meaning: MAIL_TEMPLATE_MEANING, members }))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** The members a list document names, or null when it is not one. Strict: a list this module did not write is not quietly rewritten. */
const membersOfList = (bytes: ArrayBuffer): string[] | null => {
  try {
    if (bytes.byteLength > 64 * 1024) return null
    const doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
    const { meaning, members } = doc as { meaning?: unknown; members?: unknown }
    if (meaning !== MAIL_TEMPLATE_MEANING || !Array.isArray(members) || members.length > MAX_KEPT_TEMPLATES) return null
    if (!members.every(member => typeof member === 'string' && SIG.test(member))) return null
    return [...new Set(members as string[])]
  } catch { return null }
}

/** Whether the pool holds a document at all, so a read that came back empty is a failed read and not an empty list. */
async function holdsDocument(pool: object): Promise<boolean> {
  const keys = (pool as { keys?(): AsyncIterable<string> }).keys
  if (typeof keys !== 'function') return false
  try {
    for await (const name of keys.call(pool)) if (SIG.test(name)) return true
  } catch { return true }
  return false
}

/** The list as it stands. `null` means a list is there and does not read. */
async function readList(store: TemplateStore, pool: object): Promise<string[] | null> {
  const bytes = await store.getPoolDoc?.(pool).catch(() => null) ?? null
  if (bytes) return membersOfList(bytes)
  return await holdsDocument(pool) ? null : []
}

/** One member read from this device's heap, by its signature. */
async function readMember(store: TemplateStore, sig: string): Promise<TemplateEntry> {
  let blob: Blob | null = null
  try { blob = await store.getResourceLocal?.(sig) ?? null } catch { blob = null }
  if (!blob) return { sig, ok: false, reason: 'its bytes are not held here' }
  // Size first, so a member that is not a template is never read whole.
  if (blob.size > MAIL_TEMPLATE_LIMITS.templateBytes) return { sig, ok: false, reason: `it is larger than ${MAIL_TEMPLATE_LIMITS.templateBytes / 1024} KB` }
  let bytes: Uint8Array
  try { bytes = new Uint8Array(await blob.arrayBuffer()) } catch { return { sig, ok: false, reason: 'its bytes could not be read' } }
  const parsed = await parseTemplate(bytes, sig)
  return parsed.ok ? { sig, ok: true, template: parsed.template } : { sig, ok: false, reason: parsed.reason }
}

/**
 * The templates this hive keeps, each read back by its signature. Reads only
 * this device: no pool is created, no host is asked. Never throws.
 */
export async function listTemplates(store: TemplateStore | undefined = storeFromIoc()): Promise<TemplateListing> {
  try {
    if (!store?.openPool || !store.getPoolDoc) return { entries: [], problem: 'no-store' }
    const pool = await store.openPool(MAIL_TEMPLATE_MEANING).catch(() => null)
    if (!pool) return { entries: [] }
    const members = await readList(store, pool)
    if (!members) return { entries: [], problem: 'unreadable' }
    const entries: TemplateEntry[] = []
    for (const sig of members) entries.push(await readMember(store, sig))
    return { entries }
  } catch { return { entries: [], problem: 'unreadable' } }
}

// ── keeping one ─────────────────────────────────────────────────────────────

export type SaveResult =
  | { readonly ok: true; readonly sig: string; readonly added: boolean }
  | { readonly ok: false; readonly reason: string }

// One change at a time, each reading the list the one before it wrote, so two
// saves finishing together are both on the list.
let changing: Promise<unknown> = Promise.resolve()
const inTurn = <T>(act: () => Promise<T>): Promise<T> => {
  const next = changing.then(act, act)
  changing = next.catch(() => undefined)
  return next
}

/** Change the list, complete or not at all: a list that does not read is never rewritten as a shorter one. */
async function changeList(
  store: TemplateStore | undefined,
  change: (members: readonly string[]) => { members: readonly string[]; changed: boolean } | { refused: string },
): Promise<{ ok: true; changed: boolean } | { ok: false; reason: string }> {
  if (!store?.getPool || !store.getPoolDoc || !store.putPoolDoc) return { ok: false, reason: 'the store is not available here' }
  const pool = await store.getPool(MAIL_TEMPLATE_MEANING).catch(() => null)
  if (!pool) return { ok: false, reason: 'the template list could not be opened' }
  const members = await readList(store, pool)
  if (!members) return { ok: false, reason: 'the template list on this device does not read, so it was left as it is' }
  const next = change(members)
  if ('refused' in next) return { ok: false, reason: next.refused }
  if (!next.changed) return { ok: true, changed: false }
  const written = await store.putPoolDoc(pool, listBytes(next.members)).catch(() => null)
  return written ? { ok: true, changed: true } : { ok: false, reason: 'the template list could not be written' }
}

/**
 * Keep a template: its canonical bytes become a resource (one template, one
 * signature, I1), proven to read before anything is written, and the list
 * gains its signature. Saving the same template twice changes nothing. A
 * participant's save, so the list before it is kept. Never throws.
 */
export function saveTemplate(store: TemplateStore | undefined, template: MailTemplateDocument): Promise<SaveResult> {
  return inTurn(async (): Promise<SaveResult> => {
    try {
      if (!store?.putResource) return { ok: false, reason: 'the store is not available here' }
      let bytes: Uint8Array
      try { bytes = templateBytes(template) } catch { return { ok: false, reason: 'it is not a template' } }
      // Never keep what would not read back: the list shows only what renders.
      const parsed = await parseTemplate(bytes)
      if (!parsed.ok) return { ok: false, reason: parsed.reason }
      const copy = bytes.slice()
      const written = await store.putResource(new Blob([copy.buffer as ArrayBuffer], { type: 'application/json' })).catch(() => '')
      // The store signs what it wrote; a different answer is not this template (S3).
      if (written !== parsed.sig) return { ok: false, reason: 'the store did not keep the bytes it was given' }
      const listed = await changeList(store, members => {
        if (members.includes(parsed.sig)) return { members, changed: false }
        if (members.length >= MAX_KEPT_TEMPLATES) return { refused: `the list already holds ${MAX_KEPT_TEMPLATES} templates` }
        return { members: [...members, parsed.sig], changed: true }
      })
      return listed.ok ? { ok: true, sig: parsed.sig, added: listed.changed } : listed
    } catch { return { ok: false, reason: 'it could not be kept' } }
  })
}

/**
 * Take a template off the list. Hide first: its bytes stay in the heap, every
 * message that names it still renders, and the list before this one still
 * names it. Never throws.
 */
export function forgetTemplate(store: TemplateStore | undefined, sig: string): Promise<SaveResult> {
  return inTurn(async (): Promise<SaveResult> => {
    try {
      if (typeof sig !== 'string' || !SIG.test(sig)) return { ok: false, reason: 'not a signature' }
      const listed = await changeList(store, members =>
        members.includes(sig) ? { members: members.filter(member => member !== sig), changed: true } : { members, changed: false })
      return listed.ok ? { ok: true, sig, added: false } : listed
    } catch { return { ok: false, reason: 'it could not be taken off the list' } }
  })
}

// ── the audit ───────────────────────────────────────────────────────────────

export type FindingKind =
  /** A literal link to a host. Every host it can send a reader to is listed. */
  | 'links-to'
  /** A link whose words read as an address, and the link goes somewhere else. */
  | 'link-words-name-another-place'
  /** The sender picks where a link goes, at send. */
  | 'sender-chooses-link'
  /** The sender picks a picture, at send. */
  | 'sender-chooses-picture'
  /** It names a picture of its own, by signature. */
  | 'names-resource'
  /** It declares a script, which runs only after the gate admits it (step 4). */
  | 'declares-script'

export interface TemplateFinding {
  readonly kind: FindingKind
  /** The host, hole, signature or link words the finding is about. */
  readonly subject: string
  /** For a link, where it goes: a url, or `{{hole}}` when the sender picks. */
  readonly target?: string
}

/** An audit report: content, kept by its own signature. No date in it, so one template always gives one report. */
export interface TemplateAuditReport {
  readonly [MAIL_TEMPLATE_AUDIT_KEY]: 1
  readonly template: string
  readonly by: typeof TEMPLATE_READER
  /** Every host its literal links can send a reader to, sorted. */
  readonly hosts: readonly string[]
  readonly findings: readonly TemplateFinding[]
}

/** Where a url sends a reader: a web host, or the domain a mailto writes to. */
const hostOf = (url: string): string | null => {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'mailto:') {
      const at = parsed.pathname.lastIndexOf('@')
      return at < 0 ? null : decodeURIComponent(parsed.pathname.slice(at + 1)).toLowerCase() || null
    }
    return parsed.hostname.toLowerCase() || null
  } catch { return null }
}

// Words that read as a place: a url, or a bare domain like "bank.example/login".
const READS_AS_PLACE = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:www\.)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})(?::\d+)?(?:[/?#]\S*)?$/i

/** The host link words name, when they read as a place at all. */
const placeNamed = (words: string): string | null => {
  const m = READS_AS_PLACE.exec(words.trim())
  return m ? (m[1] as string).toLowerCase().replace(/^www\./, '') : null
}

const sameHost = (a: string, b: string): boolean => a.replace(/^www\./, '') === b.replace(/^www\./, '')

const linkFindings = (link: TemplateLink): TemplateFinding[] => {
  const out: TemplateFinding[] = []
  const named = placeNamed(link.text)
  if (link.href && 'url' in link.href) {
    const host = hostOf(link.href.url)
    if (named && (!host || !sameHost(named, host))) out.push({ kind: 'link-words-name-another-place', subject: link.text.trim(), target: link.href.url })
  } else if (link.href && 'hole' in link.href) {
    // The words promise a place the template cannot keep: the sender picks where it goes.
    if (named) out.push({ kind: 'link-words-name-another-place', subject: link.text.trim(), target: `{{${link.href.hole}}}` })
  }
  return out
}

/**
 * What a template reaches, read from its bytes: a report for a person to
 * judge. Pure and deterministic; null for a template that does not compile.
 */
export function auditTemplate(template: MailTemplate): TemplateAuditReport | null {
  const outline = outlineTemplate(template)
  if (!outline) return null
  const hosts = new Set<string>()
  const findings: TemplateFinding[] = []
  for (const link of outline.links) {
    if (link.href && 'url' in link.href) {
      const host = hostOf(link.href.url)
      if (host) hosts.add(host)
    }
    findings.push(...linkFindings(link))
  }
  const sorted = [...hosts].sort()
  return {
    [MAIL_TEMPLATE_AUDIT_KEY]: 1,
    template: template.sig,
    by: TEMPLATE_READER,
    hosts: sorted,
    findings: [
      ...sorted.map(host => ({ kind: 'links-to' as const, subject: host })),
      ...findings,
      ...outline.senderLinks.map(hole => ({ kind: 'sender-chooses-link' as const, subject: hole })),
      ...outline.senderPictures.map(hole => ({ kind: 'sender-chooses-picture' as const, subject: hole })),
      ...Object.values(template.resources ?? {}).map(sig => ({ kind: 'names-resource' as const, subject: sig })),
      ...(template.script ? [{ kind: 'declares-script' as const, subject: template.script }] : []),
    ],
  }
}

/** The report's canonical bytes: the fields in one order, so the same reading has the same signature. */
export function auditBytes(report: TemplateAuditReport): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    [MAIL_TEMPLATE_AUDIT_KEY]: 1,
    template: report.template,
    by: report.by,
    hosts: report.hosts,
    findings: report.findings.map(f => ({ kind: f.kind, subject: f.subject, ...(f.target !== undefined ? { target: f.target } : {}) })),
  }))
}

/** One line for a list: what it reaches, in counts. The record's words; the report is the detail. */
const summaryOf = (report: TemplateAuditReport): string => {
  const count = (kind: FindingKind): number => report.findings.filter(f => f.kind === kind).length
  const parts = [
    `links to ${report.hosts.length} host${report.hosts.length === 1 ? '' : 's'}`,
    ...(count('link-words-name-another-place') ? [`${count('link-words-name-another-place')} link${count('link-words-name-another-place') === 1 ? ' whose words name' : 's whose words name'} another place`] : []),
    ...(count('sender-chooses-link') ? [`the sender picks ${count('sender-chooses-link')} link${count('sender-chooses-link') === 1 ? '' : 's'}`] : []),
    ...(count('declares-script') ? ['declares a script'] : []),
  ]
  return `template: ${parts.join('; ')}`
}

/**
 * Keep an audit report by its signature and hand back the brood entry for it.
 * The entry recommends 'unclear', always: a reading is never a yes. Attaching
 * it to a brood record is the gate's step (4); the brood holds bees today.
 */
export async function recordTemplateAudit(
  store: TemplateStore | undefined,
  template: MailTemplate,
): Promise<{ ok: true; reportSig: string; audit: Omit<BroodAudit, 'at'> } | { ok: false; reason: string }> {
  try {
    const report = auditTemplate(template)
    if (!report) return { ok: false, reason: 'it is not a template' }
    if (!store?.putResource) return { ok: false, reason: 'the store is not available here' }
    const bytes = auditBytes(report)
    const reportSig = await store.putResource(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/json' })).catch(() => '')
    if (!SIG.test(reportSig)) return { ok: false, reason: 'the report could not be kept' }
    return { ok: true, reportSig, audit: { reportSig, summary: summaryOf(report), by: TEMPLATE_READER, recommends: 'unclear' } }
  } catch { return { ok: false, reason: 'it could not be audited' } }
}
