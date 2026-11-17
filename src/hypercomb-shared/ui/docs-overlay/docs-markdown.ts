// hypercomb-shared/ui/docs-overlay/docs-markdown.ts
//
// The docs browser's markdown, and where its links go. Pure, so a spec reads
// every rule here without an Angular host.
//
// A LINK NEVER LEAVES THE HIVE. The page is shown inside the hive's own tab,
// so a raw `<a href="glossary.md">` navigated that tab away from the hive.
// Every link is resolved against the document it sits in:
//   - another document under documentation/ opens in the browser itself
//     (`/documentation/<file>#<anchor>`, which the overlay intercepts);
//   - `#anchor` scrolls within the page (heading ids follow GitHub's rule, so
//     the anchors the documents were written with land);
//   - a web or mail link opens in a new tab;
//   - anything else — a source file, a line in one — has nothing to open in
//     the browser and is shown as code, with its path as the title.

export const DOCS_BASE = '/documentation/'

export type DocLink =
  | { readonly kind: 'doc'; readonly file: string; readonly hash: string }
  | { readonly kind: 'anchor'; readonly hash: string }
  | { readonly kind: 'external'; readonly href: string }
  | { readonly kind: 'source'; readonly path: string }

const ORIGIN = 'https://docs.invalid'

/** Where `href`, written in the document `fromDoc` (a path under
 *  documentation/, e.g. `bee-story/the-bee.md`), points. */
export const resolveDocLink = (href: string, fromDoc: string): DocLink => {
  const raw = href.trim()
  if (/^(https?:|mailto:)/i.test(raw)) return { kind: 'external', href: raw }
  if (raw.startsWith('#')) return { kind: 'anchor', hash: decodeURIComponent(raw.slice(1)) }
  let url: URL
  try { url = new URL(raw, `${ORIGIN}${DOCS_BASE}${fromDoc}`) } catch { return { kind: 'source', path: raw } }
  if (url.origin !== ORIGIN) return { kind: 'external', href: raw }
  const path = decodeURIComponent(url.pathname)
  const hash = decodeURIComponent(url.hash.replace(/^#/, ''))
  if (path.startsWith(DOCS_BASE) && path.endsWith('.md')) return { kind: 'doc', file: path.slice(DOCS_BASE.length), hash }
  return { kind: 'source', path: path.replace(/^\/documentation\//, '') }
}

/** A heading's anchor, as GitHub writes it: lowercase, punctuation dropped,
 *  each space a hyphen (so `A — B` is `a--b`). */
export const headingSlug = (heading: string): string =>
  heading.trim().toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-')

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const attr = (s: string): string => esc(s).replace(/"/g, '&quot;')

const link = (label: string, href: string, fromDoc: string): string => {
  const to = resolveDocLink(href, fromDoc)
  switch (to.kind) {
    case 'doc': return `<a href="${attr(DOCS_BASE + to.file + (to.hash ? '#' + to.hash : ''))}">${label}</a>`
    case 'anchor': return `<a href="#${attr(to.hash)}">${label}</a>`
    case 'external': return `<a href="${attr(to.href)}">${label}</a>`
    case 'source': return `<code class="doc-source" title="${attr(to.path)}">${label.replace(/<\/?code>/g, '')}</code>`
  }
}

/** The document `md`, sitting at `fromDoc`, as HTML. */
export function renderMarkdown(md: string, fromDoc = ''): string {
  // Either line ending: a document saved with CRLF left a `\r` on every
  // line, and no heading, list or table pattern matched it.
  const lines = md.split(/\r?\n/)
  const out: string[] = []
  const slugs = new Map<string, number>()
  let inCodeBlock = false
  let codeLang = ''
  let codeLines: string[] = []
  let inList = false
  let listType: 'ul' | 'ol' = 'ul'
  let inTable = false

  const flush = () => {
    if (inList) { out.push(`</${listType}>`); inList = false }
    if (inTable) { out.push('</tbody></table>'); inTable = false }
  }

  const inline = (s: string): string => {
    // code spans first (protect from further processing)
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>')
    s = s.replace(/~~(.+?)~~/g, '<del>$1</del>')
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label: string, href: string) => link(label, href, fromDoc))
    return s
  }

  /** GitHub's anchor, made unique within the page the way GitHub does. */
  const idFor = (heading: string): string => {
    const base = headingSlug(heading.replace(/[*`]/g, ''))
    const seen = slugs.get(base) ?? 0
    slugs.set(base, seen + 1)
    return seen ? `${base}-${seen}` : base
  }

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        flush()
        inCodeBlock = true
        codeLang = line.slice(3).trim()
        codeLines = []
      } else {
        const langAttr = codeLang ? ` class="language-${esc(codeLang)}"` : ''
        out.push(`<pre><code${langAttr}>${codeLines.map(esc).join('\n')}</code></pre>`)
        inCodeBlock = false
        codeLang = ''
      }
      continue
    }
    if (inCodeBlock) { codeLines.push(line); continue }

    if (line.trim() === '') { flush(); continue }

    if (/^(---|\*\*\*|___)$/.test(line.trim())) { flush(); out.push('<hr>'); continue }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      flush()
      const level = headingMatch[1]!.length
      out.push(`<h${level} id="${attr(idFor(headingMatch[2]!))}">${inline(headingMatch[2]!)}</h${level}>`)
      continue
    }

    if (line.includes('|') && line.trim().startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim())
      if (cells.every(c => /^:?-+:?$/.test(c))) continue
      if (!inTable) {
        flush()
        inTable = true
        out.push('<table><thead><tr>')
        for (const cell of cells) out.push(`<th>${inline(cell)}</th>`)
        out.push('</tr></thead><tbody>')
      } else {
        out.push('<tr>')
        for (const cell of cells) out.push(`<td>${inline(cell)}</td>`)
        out.push('</tr>')
      }
      continue
    }

    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/)
    if (ulMatch) {
      if (inTable) { out.push('</tbody></table>'); inTable = false }
      if (!inList || listType !== 'ul') {
        if (inList) out.push(`</${listType}>`)
        inList = true; listType = 'ul'; out.push('<ul>')
      }
      out.push(`<li>${inline(ulMatch[2]!)}</li>`)
      continue
    }

    const olMatch = line.match(/^(\s*)\d+[.)]\s+(.+)$/)
    if (olMatch) {
      if (inTable) { out.push('</tbody></table>'); inTable = false }
      if (!inList || listType !== 'ol') {
        if (inList) out.push(`</${listType}>`)
        inList = true; listType = 'ol'; out.push('<ol>')
      }
      out.push(`<li>${inline(olMatch[2]!)}</li>`)
      continue
    }

    if (line.startsWith('>')) {
      flush()
      out.push(`<blockquote>${inline(line.slice(1).trim())}</blockquote>`)
      continue
    }

    flush()
    out.push(`<p>${inline(line)}</p>`)
  }

  flush()
  if (inCodeBlock) out.push(`<pre><code>${codeLines.map(esc).join('\n')}</code></pre>`)
  return out.join('\n')
}
