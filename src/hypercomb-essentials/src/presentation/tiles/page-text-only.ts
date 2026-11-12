// presentation/tiles/page-text-only.ts
//
// DOES THIS VERSION OF A PAGE CHANGE ONLY ITS WORDS? (documentation/
// page-contributions.md, step 1.)
//
// A contribution to a page is somebody else's bytes. Viewing it is safe without
// review only when it runs nothing its base did not already run, which holds
// exactly when the two pages differ in their visible text and nowhere else:
//
//   - the same nodes in the same order: elements, text, comments, doctype;
//   - every element the same tag with the same attributes and values (an
//     attribute is where a handler, a source or a link lives);
//   - the text inside <script> and <style> identical (that text is code);
//   - a <template>'s content held to the same rules (a declarative shadow root
//     is markup that becomes live).
//
// Anything else — a changed word in a script, a new element, one attribute — is
// not text-only, and the page goes through the activation gate like any
// adopted page (page-run-gate.ts). Fail-closed: two pages that cannot be
// compared are not text-only.

/** Elements whose text is code, not words. */
const CODE_TEXT = new Set(['script', 'style'])

const attributesOf = (el: Element): string =>
  Array.from(el.attributes)
    .map(a => `${a.namespaceURI ?? ''}\u0000${a.name}\u0000${a.value}`)
    .sort()
    .join('\u0001')

/** Do `a` and `b` agree on everything but the words? `inCode` = the nodes sit
 *  inside an element whose text is code. */
function sameExceptWords(a: Node, b: Node, inCode: boolean): boolean {
  if (a.nodeType !== b.nodeType) return false
  switch (a.nodeType) {
    case 3: // text
    case 4: // CDATA
      return inCode ? (a as CharacterData).data === (b as CharacterData).data : true
    case 8: // comment
      return (a as Comment).data === (b as Comment).data
    case 10: { // doctype
      const da = a as DocumentType
      const db = b as DocumentType
      return da.name === db.name && da.publicId === db.publicId && da.systemId === db.systemId
    }
    case 1: { // element
      const ea = a as Element
      const eb = b as Element
      if (ea.namespaceURI !== eb.namespaceURI || ea.localName !== eb.localName) return false
      if (attributesOf(ea) !== attributesOf(eb)) return false
      const code = inCode || CODE_TEXT.has(ea.localName.toLowerCase())
      if (ea instanceof HTMLTemplateElement !== eb instanceof HTMLTemplateElement) return false
      if (ea instanceof HTMLTemplateElement && !sameChildren(ea.content, (eb as HTMLTemplateElement).content, code)) return false
      return sameChildren(ea, eb, code)
    }
    case 9:  // document
    case 11: // fragment
      return sameChildren(a, b, inCode)
    default:
      return false
  }
}

function sameChildren(a: Node, b: Node, inCode: boolean): boolean {
  const ka = a.childNodes
  const kb = b.childNodes
  if (ka.length !== kb.length) return false
  for (let i = 0; i < ka.length; i++) {
    if (!sameExceptWords(ka[i], kb[i], inCode)) return false
  }
  return true
}

/** True when `next` is `base` with only visible words changed — nothing added,
 *  removed or rewired, and no code touched. Identical pages are text-only. */
export function differsOnlyInText(base: string, next: string): boolean {
  try {
    const parse = (html: string): Document => new DOMParser().parseFromString(String(html ?? ''), 'text/html')
    return sameExceptWords(parse(base), parse(next), false)
  } catch {
    return false
  }
}
