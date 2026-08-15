// hypercomb-shared/ui/chat-window/chat-markdown.ts
//
// MARKDOWN FOR THE CHAT WINDOW — the answers arrive as markdown, so they must
// be read as markdown. A model that writes a table and gets a wall of pipes
// looks stupid on the participant's behalf.
//
// ── Escape first, format second ─────────────────────────────────────────────
//
// The output is handed to `bypassSecurityTrustHtml`, so this file is the whole
// safety boundary. The discipline that makes that sound is ORDER: every piece
// of model text passes through `esc()` BEFORE any tag is emitted, and the only
// unescaped characters in the result are ones this file wrote itself.
//
// Spans that must survive the escaping (code, finished anchors) are lifted out
// into placeholders first and put back last, so no pass can ever look inside a
// tag it did not write. URLs are scheme-checked — `javascript:` and `data:`
// hrefs never reach the DOM.
//
// ── Hive paths are buttons, not links ───────────────────────────────────────
//
// An answer naming `dolphin/site` should take you there. It is rendered as a
// BUTTON carrying `data-hive-path`, not an `<a href>`: navigating the document
// is how the native window dies (see document-view-links.ts), and the chat
// window's own click delegate can route a path through Lineage instead.
//
// The detection rule is deliberately narrow — a surprise navigation chip on the
// word "and/or" is worse than a missing one:
//
//   • a code span that starts with `/`               → `/dolphin/site`
//   • a code span of 2–4 dot-free slug segments      → `dolphin/site`
//   • a markdown link whose href has no scheme       → `[the site](dolphin/site)`
//
// Anything with a dot in it (`src/index.ts`, `hypercomb.io/x`) stays plain code
// unless it was written with a leading slash.
//
// No framework imports: this is a pure string function, testable on its own.

/** Placeholder sentinels. Stripped from the input first, so model text can
 *  never forge one and reach the restore pass with markup of its own. */
const CODE_MARK = '\u0000'
const LINK_MARK = '\u0001'

const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Attribute values additionally lose quotes — the value lands inside `"…"`. */
const escAttr = (value: string): string => esc(value).replace(/"/g, '&quot;')

/** `esc()` leaves `&amp;` where the author wrote `&`; scheme checks must see
 *  the real URL, not the entity-encoded one. */
const unesc = (value: string): string =>
  value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** A dot-free slug path of 2–4 segments, or anything rooted with `/`. */
const HIVE_ROOTED = /^\/[^\s/]+(?:\/[^\s/]+)*\/?$/
const HIVE_BARE = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\/[A-Za-z0-9][A-Za-z0-9_-]*){1,3}\/?$/

/** Does this text name a place in the hive? */
export const isHivePath = (text: string): boolean => {
  const value = text.trim()
  if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value)) return false
  return HIVE_ROOTED.test(value) || HIVE_BARE.test(value)
}

/** The segments a hive-path chip navigates to. */
export const hivePathSegments = (path: string): string[] =>
  path.split('/').map(s => s.trim()).filter(Boolean)

/** Only http(s) and mailto reach an href. Everything else — `javascript:`,
 *  `data:`, `vbscript:` — is dropped and the label is rendered as plain text. */
const safeHref = (raw: string): string | null => {
  const url = unesc(raw).trim()
  if (!url) return null
  if (/^(https?:|mailto:)/i.test(url)) return url
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null
  // Scheme-less and not a hive path (checked before this): a relative web link
  // has no meaning in a hive, so it stays text.
  return null
}

const externalLink = (href: string, label: string): string =>
  `<a class="chat-link-out" href="${escAttr(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`

const hiveChip = (path: string, label: string): string =>
  `<button type="button" class="chat-path" data-hive-path="${escAttr(path.trim())}">`
  + `<span class="chat-path-glyph mat-sym" aria-hidden="true">hexagon</span>${label}</button>`

/**
 * Inline markdown for one already-block-classified line of text.
 *
 * Passes, in the only order that is safe:
 *   1. lift code spans out (they must not be formatted or autolinked)
 *   2. escape everything that is left — after this, no `<` came from the model
 *   3. markdown links → finished anchors, lifted out as placeholders
 *   4. bare URLs → anchors, also lifted out
 *   5. emphasis, on text that now contains no markup at all
 *   6. put the anchors back, then the code spans
 */
const inline = (raw: string): string => {
  const codes: string[] = []
  const links: string[] = []

  let text = raw.replace(/`+([^`]+?)`+/g, (_match, code: string) => {
    codes.push(code)
    return `${CODE_MARK}${codes.length - 1}${CODE_MARK}`
  })

  text = esc(text)

  text = text.replace(/\[([^\]]*)\]\(([^)\s]*)\)/g, (_match, label: string, href: string) => {
    const target = unesc(href).trim()
    const shown = label.trim() || target
    const safe = safeHref(href)
    // An unusable target — `javascript:`, a relative web path, an empty href —
    // degrades to its own LABEL rather than to the raw `[…](…)` source. The
    // syntax is noise, and leaving the dead scheme on screen invites a copy.
    const html = isHivePath(target) ? hiveChip(target, shown)
      : safe ? externalLink(safe, shown)
        : shown
    links.push(html)
    return `${LINK_MARK}${links.length - 1}${LINK_MARK}`
  })

  // Bare URLs. Trailing sentence punctuation is not part of the address.
  text = text.replace(/(^|[\s(])(https?:\/\/[^\s<>()]+)/g, (_match, lead: string, url: string) => {
    const trimmed = url.replace(/[.,;:!?]+$/, '')
    const tail = url.slice(trimmed.length)
    links.push(externalLink(unesc(trimmed), trimmed))
    return `${lead}${LINK_MARK}${links.length - 1}${LINK_MARK}${tail}`
  })

  text = text
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\s][^_]*)_/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')

  text = text.replace(new RegExp(`${LINK_MARK}(\\d+)${LINK_MARK}`, 'g'),
    (_match, index: string) => links[Number(index)] ?? '')

  return text.replace(new RegExp(`${CODE_MARK}(\\d+)${CODE_MARK}`, 'g'), (_match, index: string) => {
    const code = codes[Number(index)] ?? ''
    return isHivePath(code)
      ? hiveChip(code, esc(code.trim()))
      : `<code>${esc(code)}</code>`
  })
}

/** A fenced block: language label, copy button, and a scroller of its own so a
 *  long line never widens the panel. The copy button reads the `<code>` text at
 *  click time (chat-window.component.ts), so the source is never duplicated. */
const codeBlock = (language: string, lines: readonly string[]): string => {
  const lang = language.replace(/[^A-Za-z0-9+#._-]/g, '').slice(0, 24)
  const classes = lang ? ` class="language-${escAttr(lang.toLowerCase())}"` : ''
  return '<div class="chat-code">'
    + `<div class="chat-code-bar"><span class="chat-code-lang">${esc(lang || 'text')}</span>`
    + '<button type="button" class="chat-code-copy" data-copy-code>copy</button></div>'
    + `<pre><code${classes}>${esc(lines.join('\n'))}</code></pre>`
    + '</div>'
}

type ListFrame = { tag: 'ul' | 'ol'; indent: number }

/**
 * Render one message's markdown to HTML.
 *
 * Written for STREAMING as much as for finished text: an unterminated fence,
 * an open list, a half-written table all close themselves at the end of input,
 * so a partial answer renders as the answer it is becoming rather than as a
 * wall of pipes that snaps into shape on the last chunk.
 */
export const renderChatMarkdown = (source: string): string => {
  const clean = String(source ?? '').replace(/[\u0000\u0001]/g, '')
  const lines = clean.split('\n')
  const out: string[] = []

  const lists: ListFrame[] = []
  let fence = ''
  let fenceLang = ''
  let codeLines: string[] = []
  let quote: string[] = []
  let paragraph: string[] = []
  let table: { head: string[]; rows: string[][] } | null = null

  const closeLists = (toIndent = -1): void => {
    while (lists.length && lists[lists.length - 1].indent > toIndent) {
      out.push(`</${lists.pop()!.tag}>`)
    }
  }

  const closeParagraph = (): void => {
    if (!paragraph.length) return
    out.push(`<p>${inline(paragraph.join(' '))}</p>`)
    paragraph = []
  }

  const closeQuote = (): void => {
    if (!quote.length) return
    out.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`)
    quote = []
  }

  const closeTable = (): void => {
    if (!table) return
    const head = table.head.map(cell => `<th>${inline(cell)}</th>`).join('')
    const body = table.rows
      .map(row => `<tr>${row.map(cell => `<td>${inline(cell)}</td>`).join('')}</tr>`)
      .join('')
    // Its own horizontal scroller: a wide table must never widen the panel.
    out.push(`<div class="chat-table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`)
    table = null
  }

  /** Everything that is open, closed — before a block of a different kind. */
  const flush = (keepListsTo = -1): void => {
    closeParagraph()
    closeQuote()
    closeTable()
    closeLists(keepListsTo)
  }

  const cells = (line: string): string[] => {
    const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
    return trimmed.split('|').map(cell => cell.trim())
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // ── fenced code ───────────────────────────────────────────────────────
    const fenceMatch = line.match(/^\s{0,3}(```+|~~~+)(.*)$/)
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        out.push(codeBlock(fenceLang, codeLines))
        fence = ''
        fenceLang = ''
        codeLines = []
      } else {
        codeLines.push(line)
      }
      continue
    }
    if (fenceMatch) {
      flush()
      fence = fenceMatch[1]
      fenceLang = fenceMatch[2].trim().split(/\s+/)[0] ?? ''
      codeLines = []
      continue
    }

    // ── blank ─────────────────────────────────────────────────────────────
    if (!line.trim()) {
      // A blank line ends a paragraph and a table, but NOT a list — a loose
      // list with breathing room between its items is still one list.
      closeParagraph()
      closeQuote()
      closeTable()
      continue
    }

    // ── table ─────────────────────────────────────────────────────────────
    const next = lines[i + 1] ?? ''
    if (!table && line.includes('|') && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(next) && next.includes('|')) {
      flush()
      table = { head: cells(line), rows: [] }
      i++
      continue
    }
    if (table) {
      if (line.includes('|')) { table.rows.push(cells(line)); continue }
      closeTable()
    }

    // ── heading / rule ────────────────────────────────────────────────────
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/)
    if (heading) {
      flush()
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2].replace(/\s+#+\s*$/, ''))}</h${level}>`)
      continue
    }
    if (/^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(line)) {
      flush()
      out.push('<hr>')
      continue
    }

    // ── blockquote ────────────────────────────────────────────────────────
    const quoted = line.match(/^\s{0,3}>\s?(.*)$/)
    if (quoted) {
      closeParagraph()
      closeTable()
      quote.push(quoted[1])
      continue
    }
    closeQuote()

    // ── list ──────────────────────────────────────────────────────────────
    const bullet = line.match(/^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/)
    if (bullet) {
      closeParagraph()
      closeTable()
      const indent = bullet[1].length
      const tag: 'ul' | 'ol' = /\d/.test(bullet[2]) ? 'ol' : 'ul'
      // Pop deeper levels, then open one if this indent is new. Sibling items
      // at the same indent but a different marker restart the list.
      while (lists.length && lists[lists.length - 1].indent > indent) out.push(`</${lists.pop()!.tag}>`)
      const top = lists[lists.length - 1]
      if (!top || top.indent < indent) {
        lists.push({ tag, indent })
        out.push(`<${tag}>`)
      } else if (top.tag !== tag) {
        out.push(`</${lists.pop()!.tag}>`)
        lists.push({ tag, indent })
        out.push(`<${tag}>`)
      }
      out.push(`<li>${inline(bullet[3])}</li>`)
      continue
    }

    // ── paragraph ─────────────────────────────────────────────────────────
    // Indented continuation of the item above stays in the item's list.
    if (!lists.length) closeLists()
    paragraph.push(line.trim())
  }

  // End of input — including the middle of a stream. Close what is open, so a
  // half-arrived fence renders as the code block it is on its way to being.
  if (fence) out.push(codeBlock(fenceLang, codeLines))
  flush()

  return out.join('')
}
