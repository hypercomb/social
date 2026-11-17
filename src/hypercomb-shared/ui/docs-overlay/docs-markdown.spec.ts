// docs-markdown.spec.ts — the docs browser's markdown and its links. A link
// never leaves the hive's tab; every link in every document lands; every
// index entry is a document that exists.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DOC_INDEX, DOCTRINE_PAGE } from './docs-index'
import { headingSlug, renderMarkdown, resolveDocLink } from './docs-markdown'

const DOCS = resolve(__dirname, '../../../documentation')
const SRC = resolve(DOCS, '..')

describe('where a link goes', () => {
  it('opens another document in the browser, resolved against the one it sits in', () => {
    expect(resolveDocLink('glossary.md', 'signature-system.md')).toEqual({ kind: 'doc', file: 'glossary.md', hash: '' })
    expect(resolveDocLink('../glossary.md#layers', 'bee-story/the-bee.md')).toEqual({ kind: 'doc', file: 'glossary.md', hash: 'layers' })
    expect(resolveDocLink('the-hive.md', 'bee-story/the-bee.md')).toEqual({ kind: 'doc', file: 'bee-story/the-hive.md', hash: '' })
    expect(resolveDocLink('/documentation/pheromones.md#deposits', 'x.md')).toEqual({ kind: 'doc', file: 'pheromones.md', hash: 'deposits' })
  })

  it('scrolls for an anchor, and sends a web link to a new tab', () => {
    expect(resolveDocLink('#the-round', 'a.md')).toEqual({ kind: 'anchor', hash: 'the-round' })
    expect(resolveDocLink('https://example.org/x', 'a.md')).toEqual({ kind: 'external', href: 'https://example.org/x' })
    expect(resolveDocLink('mailto:someone@example.org', 'a.md').kind).toBe('external')
  })

  it('has nothing to open for a source file or a line in one', () => {
    expect(resolveDocLink('../hypercomb-core/src/index.ts', 'a.md')).toEqual({ kind: 'source', path: '/hypercomb-core/src/index.ts' })
    expect(resolveDocLink('../hypercomb-core/src/index.ts:35', 'a.md').kind).toBe('source')
    expect(resolveDocLink('../CLAUDE.md', '')).toEqual({ kind: 'source', path: '/CLAUDE.md' })
    expect(resolveDocLink('doctrine.codex', 'a.md')).toEqual({ kind: 'source', path: 'doctrine.codex' })
  })
})

describe('the rendered page', () => {
  it('names headings as GitHub does, so a document\'s own anchors land, and never twice', () => {
    expect(headingSlug('The round: what actually guards a turn')).toBe('the-round-what-actually-guards-a-turn')
    expect(headingSlug('Who may use the bridge — codes')).toBe('who-may-use-the-bridge--codes')
    const html = renderMarkdown('# Notes\n\n## Notes\n\n## `code` *and* words')
    expect(html).toContain('<h1 id="notes">')
    expect(html).toContain('<h2 id="notes-1">')
    expect(html).toContain('<h2 id="code-and-words">')
  })

  it('writes each link as where it goes, never a raw href that would leave the hive', () => {
    const html = renderMarkdown('See [the bee](the-bee.md#wings), [top](#top), [web](https://example.org) and [`index.ts`](../../hypercomb-core/src/index.ts:3).', 'bee-story/x.md')
    expect(html).toContain('<a href="/documentation/bee-story/the-bee.md#wings">the bee</a>')
    expect(html).toContain('<a href="#top">top</a>')
    expect(html).toContain('<a href="https://example.org">web</a>')
    expect(html).toContain('<code class="doc-source" title="/hypercomb-core/src/index.ts:3">index.ts</code>')
  })

  it('escapes code blocks, closes lists when their kind changes, and draws tables', () => {
    const html = renderMarkdown('```ts\nconst a = <T>() => 1\n```\n1. one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<pre><code class="language-ts">const a = &lt;T&gt;() =&gt; 1</code></pre>')
    expect(html).toContain('<ol>\n<li>one</li>\n</ol>\n<ul>\n<li>two</li>\n</ul>')
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('<td>2</td>')
  })

  it('reads a document saved with either line ending', () => {
    expect(renderMarkdown('# Title\r\n\r\n- one\r\n- two\r\n')).toBe(renderMarkdown('# Title\n\n- one\n- two\n'))
    expect(renderMarkdown('# Title\r\n')).toContain('<h1 id="title">Title</h1>')
  })

  it('draws quotes, rules, emphasis and an unclosed code block', () => {
    const html = renderMarkdown('> quoted **loud**\n\n---\n\n***both*** ~~gone~~ *soft*\n\n```\nleft open')
    expect(html).toContain('<blockquote>quoted <strong>loud</strong></blockquote>')
    expect(html).toContain('<hr>')
    expect(html).toContain('<strong><em>both</em></strong> <del>gone</del> <em>soft</em>')
    expect(html).toContain('<pre><code>left open</code></pre>')
  })
})

/** Every markdown file under documentation/, as a path under it. */
const allDocs = (): string[] => {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.md')) out.push(relative(DOCS, path).replace(/\\/g, '/'))
    }
  }
  walk(DOCS)
  return out
}

const idsOf = (html: string): Set<string> => new Set([...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&')))

describe('the documentation, as the browser shows it', () => {
  it('lists only documents that exist', () => {
    const missing = DOC_INDEX.filter(entry => entry.file !== DOCTRINE_PAGE && !existsSync(join(DOCS, entry.file))).map(entry => entry.file)
    expect(missing).toEqual([])
  })

  it('has no link that lands nowhere: every document, anchor and source file it names is there', () => {
    const rendered = new Map<string, Set<string>>()
    const ids = (file: string): Set<string> => {
      if (!rendered.has(file)) rendered.set(file, idsOf(renderMarkdown(readFileSync(join(DOCS, file), 'utf8'), file)))
      return rendered.get(file)!
    }
    const broken: string[] = []
    for (const file of allDocs()) {
      const text = readFileSync(join(DOCS, file), 'utf8').replace(/```[\s\S]*?```/g, '')
      for (const [, , href] of text.matchAll(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const to = resolveDocLink(href!, file)
        if (to.kind === 'external') continue
        if (to.kind === 'anchor') { if (!ids(file).has(to.hash)) broken.push(`${file}: ${href}`); continue }
        if (to.kind === 'doc') {
          if (!existsSync(join(DOCS, to.file))) broken.push(`${file}: ${href}`)
          else if (to.hash && !ids(to.file).has(to.hash)) broken.push(`${file}: ${href}`)
          continue
        }
        const path = to.path.replace(/:\d+(-\d+)?$/, '')
        const onDisk = path.startsWith('/') ? join(SRC, path) : join(DOCS, path)
        if (!existsSync(onDisk)) broken.push(`${file}: ${href}`)
      }
    }
    expect(broken).toEqual([])
  })
})
