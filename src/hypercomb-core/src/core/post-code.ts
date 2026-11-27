// hypercomb-core/src/core/post-code.ts
//
// THE CODE OF AN ENTRY POOL, AS IT RIDES AN ADDRESS (documentation/
// open-entry-pools.md). A leader opens a pool and shows a page of theirs with
// `#post=<O>~<nonce>`: `O` is the signature of the public opening record and
// the nonce is 16 random bytes. The shell announces a code it finds in the
// address bar (hypercomb-shared core/invite-capture.ts), the selection reader
// (runtime navigation.ts) and the site view leave that fragment alone, and the
// leader's hive writes it. All of them ask here, so there is one rule for what
// a code is. Runtime and shared may import core, and essentials may import
// only core, which is why the rule lives in core and not beside any of them.
//
// The nonce itself is kept by `EntryNonceStore` (llm-keys.ts), with the hive's
// other secrets. This file holds no state: only the spelling.

/** The fragment a pool's code rides in: `#post=<O>~<nonce>`. */
export const POST_CODE_PREFIX = '#post='

/** The stored effect the shell announces a code on. Its payload is a
 *  `PostCode`. Stored, so the post bee, asleep until then, is handed the code
 *  when it wakes. Not a `:open`, `:toggle`, `:run` or `:invoke` name: it says
 *  what arrived, not what to do with it. */
export const POST_CODE_EFFECT = 'entries:code'

/** The two parts of a code: the opening record's signature and the nonce. */
export type PostCode = { readonly record: string; readonly nonce: string }

const POST_CODE_RE = /^#post=([0-9a-f]{64})~([0-9a-f]{32})$/

/** The code a fragment (`location.hash`, with its `#`) spells, or null. Exact:
 *  lowercase hex, nothing before or after. A fragment that is nearly a code
 *  is not one, and is whatever any other fragment is. */
export const parsePostCode = (fragment: unknown): PostCode | null => {
  const m = typeof fragment === 'string' ? POST_CODE_RE.exec(fragment) : null
  return m ? { record: m[1], nonce: m[2] } : null
}

/** Is this fragment a pool's code? The one question the selection reader and
 *  the site view ask before they read or strip a fragment. */
export const isPostFragment = (fragment: unknown): boolean => parsePostCode(fragment) !== null

/** The fragment for a code, as the leader's hive appends it to a page's
 *  address, or `''` when either part is not the hex it must be. Case is
 *  folded and the ends trimmed, because the parts come from the hive's own
 *  records; what comes out always parses back to the same two parts. */
export const postCodeFragment = (record: string, nonce: string): string => {
  const clean = (raw: unknown): string => String(raw ?? '').trim().toLowerCase()
  const fragment = `${POST_CODE_PREFIX}${clean(record)}~${clean(nonce)}`
  return isPostFragment(fragment) ? fragment : ''
}

/** THE MARK A SHELL WEARS WHEN IT TAKES A CODE: one meta line in the visitor
 *  page (hypercomb-web index.visitor.html), name and content as below. A
 *  shell from before the capture opens the leader's site and says nothing
 *  about posting, so the leader's hive reads the picked page as a visitor
 *  would and shows no code unless the mark is there. */
export const POST_SHELL_MARK_NAME = 'hypercomb-takes'
export const POST_SHELL_MARK_CONTENT = 'post'

/** Does this page's HTML wear the mark? `content` is a list of words, so the
 *  same line can later say what else a shell takes. Comments are not read: a
 *  page may describe the mark without wearing it. */
export const shellTakesPostCode = (html: unknown): boolean => {
  const attribute = (tag: string, name: string): string => {
    const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)
    return m ? m[1] ?? m[2] ?? '' : ''
  }
  const page = String(html ?? '').replace(/<!--[\s\S]*?-->/g, '')
  for (const tag of page.match(/<meta\b[^>]*>/gi) ?? []) {
    if (attribute(tag, 'name') !== POST_SHELL_MARK_NAME) continue
    if (attribute(tag, 'content').split(/\s+/).includes(POST_SHELL_MARK_CONTENT)) return true
  }
  return false
}
