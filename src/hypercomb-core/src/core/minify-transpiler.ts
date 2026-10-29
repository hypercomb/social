// hypercomb-core/src/core/minify-transpiler.ts
//
// THE MINIFY TRANSPILER. It is this module, and a derivation names it by the
// signature of its program (documentation/derivations.md). Names stay. A
// newline that separated two tokens stays, so `return` keeps its break.
// Comments and spare spaces go. A body the program cannot read throws, and
// the caller keeps that module's readable bytes.
//
// `MINIFY_TRANSPILER_PROGRAM` is the program text between the markers below.
// The signature is of that text. A change to the program is a new tool.

import { SignatureService } from './signature.service.js'

// program
const WORD_END = /[A-Za-z0-9_$]$/
const WORD_START = /^[A-Za-z0-9_$]/
const BEFORE_REGEX = new Set(['return', 'throw', 'case', 'delete', 'void', 'typeof', 'instanceof', 'in', 'of', 'new', 'await', 'yield', 'else', 'do', 'extends'])
const OPS = ['>>>=', '>>=', '<<=', '===', '!==', '>>>', '**=', '&&=', '||=', '??=', '&&', '||', '??', '?.', '=>', '++', '--', '**', '>>', '<<', '<=', '>=', '==', '!=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '>=', '<=', '>', '<', '=', '!', '+', '-', '*', '/', '%', '&', '|', '^', '~', '?', ':', '.', ',', ';', '(', ')', '{', '}', '[', ']'].sort((a, b) => b.length - a.length)

type Token = { readonly text: string; readonly gap: boolean }

const sticks = (left: string, right: string): boolean => {
  if (WORD_END.test(left) && WORD_START.test(right)) return true
  const a = left[left.length - 1] ?? ''
  const b = right[0] ?? ''
  if (a === '+' && b === '+') return true
  if (a === '-' && b === '-') return true
  if (a === '/' && (b === '/' || b === '*')) return true
  if (a === '<' && (b === '<' || b === '=' || b === '/' || b === '!')) return true
  if (a === '>' && (b === '>' || b === '=')) return true
  if (a === '=' && (b === '=' || b === '>')) return true
  if (a === '!' && b === '=') return true
  if (a === '&' && b === '&') return true
  if (a === '|' && b === '|') return true
  if (a === '?' && (b === '?' || b === '.')) return true
  if (a === '*' && b === '*') return true
  return false
}

const fail = (why: string): never => { throw new Error(why) }

const readQuoted = (text: string, at: number): number => {
  const quote = text[at]
  let i = at + 1
  while (i < text.length) {
    const c = text[i]!
    if (c === '\\') {
      if (i + 1 >= text.length) fail('a short escape')
      i += 2
      continue
    }
    if (c === '\n') fail('a line break in a string')
    if (c === quote) return i + 1
    i++
  }
  fail('an open string')
}

const readTemplate = (text: string, at: number): number => {
  let i = at + 1
  let expr = 0
  while (i < text.length) {
    const c = text[i]!
    if (expr === 0) {
      if (c === '\\') {
        if (i + 1 >= text.length) fail('a short escape')
        i += 2
        continue
      }
      if (c === '`') return i + 1
      if (c === '$' && text[i + 1] === '{') { expr = 1; i += 2; continue }
      i++
      continue
    }
    if (c === '\\') {
      if (i + 1 >= text.length) fail('a short escape')
      i += 2
      continue
    }
    if (c === "'" || c === '"') { i = readQuoted(text, i); continue }
    if (c === '`') { i = readTemplate(text, i); continue }
    if (c === '{') expr++
    if (c === '}') expr--
    i++
  }
  fail('an open template')
}

const readRegex = (text: string, at: number): number => {
  let i = at + 1
  let klass = false
  while (i < text.length) {
    const c = text[i]!
    if (c === '\\') {
      if (i + 1 >= text.length) fail('a short escape')
      i += 2
      continue
    }
    if (c === '\n') fail('a line break in a regex')
    if (c === '[' && !klass) { klass = true; i++; continue }
    if (c === ']' && klass) { klass = false; i++; continue }
    if (c === '/' && !klass) {
      i++
      while (i < text.length && /[A-Za-z]/.test(text[i]!)) i++
      return i
    }
    i++
  }
  fail('an open regex')
}

const canRegex = (prev: string | null): boolean => {
  if (prev === null) return true
  if (BEFORE_REGEX.has(prev)) return true
  if (!prev) return false
  if (prev.endsWith('++') || prev.endsWith('--') || prev.endsWith(')') || prev.endsWith(']')) return false
  return '([{,;:?=+-*%&|^!~<>'.includes(prev[prev.length - 1]!)
}

const scan = (text: string): Token[] => {
  const tokens: Token[] = []
  let i = 0
  let gap = false
  const push = (end: number): void => {
    tokens.push({ text: text.slice(i, end), gap })
    i = end
    gap = false
  }
  while (i < text.length) {
    const c = text[i]!
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f') {
      if (c === '\n') gap = true
      i++
      continue
    }
    if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i)
      if (nl < 0) { i = text.length; continue }
      i = nl
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      if (close < 0) fail('an open comment')
      if (text.slice(i, close).includes('\n')) gap = true
      i = close + 2
      continue
    }
    if (c === "'" || c === '"') { push(readQuoted(text, i)); continue }
    if (c === '`') { push(readTemplate(text, i)); continue }
    if (c === '/') {
      const prev = tokens.length ? tokens[tokens.length - 1]!.text : null
      if (canRegex(prev)) { push(readRegex(text, i)); continue }
    }
    if (/[A-Za-z0-9_$]/.test(c) || c === '#') {
      let j = i + 1
      while (j < text.length && /[A-Za-z0-9_$]/.test(text[j]!)) j++
      push(j)
      continue
    }
    let matched = 0
    for (const op of OPS) {
      if (text.startsWith(op, i)) { matched = op.length; break }
    }
    if (!matched) fail('a mark this transpiler does not read')
    push(i + matched)
  }
  return tokens
}

export function minifyModuleBody(body: string): string {
  const tokens = scan(body)
  let out = ''
  for (let n = 0; n < tokens.length; n++) {
    const token = tokens[n]!
    if (n > 0) {
      const prev = tokens[n - 1]!.text
      if (token.gap) out += '\n'
      else if (sticks(prev, token.text)) out += ' '
    }
    out += token.text
  }
  return out
}
// program end


const encoder = new TextEncoder()

/** The program between the markers, base64 so the source text is the bytes
 *  that get signed. A quote or a dollar sign in that text stays a quote or a
 *  dollar sign. The test checks these bytes against the markers. */
const PROGRAM_B64 = 'Y29uc3QgV09SRF9FTkQgPSAvW0EtWmEtejAtOV8kXSQvCmNvbnN0IFdPUkRfU1RBUlQgPSAvXltBLVphLXowLTlfJF0vCmNvbnN0IEJFRk9SRV9SRUdFWCA9IG5ldyBTZXQoWydyZXR1cm4nLCAndGhyb3cnLCAnY2FzZScsICdkZWxldGUnLCAndm9pZCcsICd0eXBlb2YnLCAnaW5zdGFuY2VvZicsICdpbicsICdvZicsICduZXcnLCAnYXdhaXQnLCAneWllbGQnLCAnZWxzZScsICdkbycsICdleHRlbmRzJ10pCmNvbnN0IE9QUyA9IFsnPj4+PScsICc+Pj0nLCAnPDw9JywgJz09PScsICchPT0nLCAnPj4+JywgJyoqPScsICcmJj0nLCAnfHw9JywgJz8/PScsICcmJicsICd8fCcsICc/PycsICc/LicsICc9PicsICcrKycsICctLScsICcqKicsICc+PicsICc8PCcsICc8PScsICc+PScsICc9PScsICchPScsICcrPScsICctPScsICcqPScsICcvPScsICclPScsICcmPScsICd8PScsICdePScsICc+PScsICc8PScsICc+JywgJzwnLCAnPScsICchJywgJysnLCAnLScsICcqJywgJy8nLCAnJScsICcmJywgJ3wnLCAnXicsICd+JywgJz8nLCAnOicsICcuJywgJywnLCAnOycsICcoJywgJyknLCAneycsICd9JywgJ1snLCAnXSddLnNvcnQoKGEsIGIpID0+IGIubGVuZ3RoIC0gYS5sZW5ndGgpCgp0eXBlIFRva2VuID0geyByZWFkb25seSB0ZXh0OiBzdHJpbmc7IHJlYWRvbmx5IGdhcDogYm9vbGVhbiB9Cgpjb25zdCBzdGlja3MgPSAobGVmdDogc3RyaW5nLCByaWdodDogc3RyaW5nKTogYm9vbGVhbiA9PiB7CiAgaWYgKFdPUkRfRU5ELnRlc3QobGVmdCkgJiYgV09SRF9TVEFSVC50ZXN0KHJpZ2h0KSkgcmV0dXJuIHRydWUKICBjb25zdCBhID0gbGVmdFtsZWZ0Lmxlbmd0aCAtIDFdID8/ICcnCiAgY29uc3QgYiA9IHJpZ2h0WzBdID8/ICcnCiAgaWYgKGEgPT09ICcrJyAmJiBiID09PSAnKycpIHJldHVybiB0cnVlCiAgaWYgKGEgPT09ICctJyAmJiBiID09PSAnLScpIHJldHVybiB0cnVlCiAgaWYgKGEgPT09ICcvJyAmJiAoYiA9PT0gJy8nIHx8IGIgPT09ICcqJykpIHJldHVybiB0cnVlCiAgaWYgKGEgPT09ICc8JyAmJiAoYiA9PT0gJzwnIHx8IGIgPT09ICc9JyB8fCBiID09PSAnLycgfHwgYiA9PT0gJyEnKSkgcmV0dXJuIHRydWUKICBpZiAoYSA9PT0gJz4nICYmIChiID09PSAnPicgfHwgYiA9PT0gJz0nKSkgcmV0dXJuIHRydWUKICBpZiAoYSA9PT0gJz0nICYmIChiID09PSAnPScgfHwgYiA9PT0gJz4nKSkgcmV0dXJuIHRydWUKICBpZiAoYSA9PT0gJyEnICYmIGIgPT09ICc9JykgcmV0dXJuIHRydWUKICBpZiAoYSA9PT0gJyYnICYmIGIgPT09ICcmJykgcmV0dXJuIHRydWUKICBpZiAoYSA9PT0gJ3wnICYmIGIgPT09ICd8JykgcmV0dXJuIHRydWUKICBpZiAoYSA9PT0gJz8nICYmIChiID09PSAnPycgfHwgYiA9PT0gJy4nKSkgcmV0dXJuIHRydWUKICBpZiAoYSA9PT0gJyonICYmIGIgPT09ICcqJykgcmV0dXJuIHRydWUKICByZXR1cm4gZmFsc2UKfQoKY29uc3QgZmFpbCA9ICh3aHk6IHN0cmluZyk6IG5ldmVyID0+IHsgdGhyb3cgbmV3IEVycm9yKHdoeSkgfQoKY29uc3QgcmVhZFF1b3RlZCA9ICh0ZXh0OiBzdHJpbmcsIGF0OiBudW1iZXIpOiBudW1iZXIgPT4gewogIGNvbnN0IHF1b3RlID0gdGV4dFthdF0KICBsZXQgaSA9IGF0ICsgMQogIHdoaWxlIChpIDwgdGV4dC5sZW5ndGgpIHsKICAgIGNvbnN0IGMgPSB0ZXh0W2ldIQogICAgaWYgKGMgPT09ICdcXCcpIHsKICAgICAgaWYgKGkgKyAxID49IHRleHQubGVuZ3RoKSBmYWlsKCdhIHNob3J0IGVzY2FwZScpCiAgICAgIGkgKz0gMgogICAgICBjb250aW51ZQogICAgfQogICAgaWYgKGMgPT09ICdcbicpIGZhaWwoJ2EgbGluZSBicmVhayBpbiBhIHN0cmluZycpCiAgICBpZiAoYyA9PT0gcXVvdGUpIHJldHVybiBpICsgMQogICAgaSsrCiAgfQogIGZhaWwoJ2FuIG9wZW4gc3RyaW5nJykKfQoKY29uc3QgcmVhZFRlbXBsYXRlID0gKHRleHQ6IHN0cmluZywgYXQ6IG51bWJlcik6IG51bWJlciA9PiB7CiAgbGV0IGkgPSBhdCArIDEKICBsZXQgZXhwciA9IDAKICB3aGlsZSAoaSA8IHRleHQubGVuZ3RoKSB7CiAgICBjb25zdCBjID0gdGV4dFtpXSEKICAgIGlmIChleHByID09PSAwKSB7CiAgICAgIGlmIChjID09PSAnXFwnKSB7CiAgICAgICAgaWYgKGkgKyAxID49IHRleHQubGVuZ3RoKSBmYWlsKCdhIHNob3J0IGVzY2FwZScpCiAgICAgICAgaSArPSAyCiAgICAgICAgY29udGludWUKICAgICAgfQogICAgICBpZiAoYyA9PT0gJ2AnKSByZXR1cm4gaSArIDEKICAgICAgaWYgKGMgPT09ICckJyAmJiB0ZXh0W2kgKyAxXSA9PT0gJ3snKSB7IGV4cHIgPSAxOyBpICs9IDI7IGNvbnRpbnVlIH0KICAgICAgaSsrCiAgICAgIGNvbnRpbnVlCiAgICB9CiAgICBpZiAoYyA9PT0gJ1xcJykgewogICAgICBpZiAoaSArIDEgPj0gdGV4dC5sZW5ndGgpIGZhaWwoJ2Egc2hvcnQgZXNjYXBlJykKICAgICAgaSArPSAyCiAgICAgIGNvbnRpbnVlCiAgICB9CiAgICBpZiAoYyA9PT0gIiciIHx8IGMgPT09ICciJykgeyBpID0gcmVhZFF1b3RlZCh0ZXh0LCBpKTsgY29udGludWUgfQogICAgaWYgKGMgPT09ICdgJykgeyBpID0gcmVhZFRlbXBsYXRlKHRleHQsIGkpOyBjb250aW51ZSB9CiAgICBpZiAoYyA9PT0gJ3snKSBleHByKysKICAgIGlmIChjID09PSAnfScpIGV4cHItLQogICAgaSsrCiAgfQogIGZhaWwoJ2FuIG9wZW4gdGVtcGxhdGUnKQp9Cgpjb25zdCByZWFkUmVnZXggPSAodGV4dDogc3RyaW5nLCBhdDogbnVtYmVyKTogbnVtYmVyID0+IHsKICBsZXQgaSA9IGF0ICsgMQogIGxldCBrbGFzcyA9IGZhbHNlCiAgd2hpbGUgKGkgPCB0ZXh0Lmxlbmd0aCkgewogICAgY29uc3QgYyA9IHRleHRbaV0hCiAgICBpZiAoYyA9PT0gJ1xcJykgewogICAgICBpZiAoaSArIDEgPj0gdGV4dC5sZW5ndGgpIGZhaWwoJ2Egc2hvcnQgZXNjYXBlJykKICAgICAgaSArPSAyCiAgICAgIGNvbnRpbnVlCiAgICB9CiAgICBpZiAoYyA9PT0gJ1xuJykgZmFpbCgnYSBsaW5lIGJyZWFrIGluIGEgcmVnZXgnKQogICAgaWYgKGMgPT09ICdbJyAmJiAha2xhc3MpIHsga2xhc3MgPSB0cnVlOyBpKys7IGNvbnRpbnVlIH0KICAgIGlmIChjID09PSAnXScgJiYga2xhc3MpIHsga2xhc3MgPSBmYWxzZTsgaSsrOyBjb250aW51ZSB9CiAgICBpZiAoYyA9PT0gJy8nICYmICFrbGFzcykgewogICAgICBpKysKICAgICAgd2hpbGUgKGkgPCB0ZXh0Lmxlbmd0aCAmJiAvW0EtWmEtel0vLnRlc3QodGV4dFtpXSEpKSBpKysKICAgICAgcmV0dXJuIGkKICAgIH0KICAgIGkrKwogIH0KICBmYWlsKCdhbiBvcGVuIHJlZ2V4JykKfQoKY29uc3QgY2FuUmVnZXggPSAocHJldjogc3RyaW5nIHwgbnVsbCk6IGJvb2xlYW4gPT4gewogIGlmIChwcmV2ID09PSBudWxsKSByZXR1cm4gdHJ1ZQogIGlmIChCRUZPUkVfUkVHRVguaGFzKHByZXYpKSByZXR1cm4gdHJ1ZQogIGlmICghcHJldikgcmV0dXJuIGZhbHNlCiAgaWYgKHByZXYuZW5kc1dpdGgoJysrJykgfHwgcHJldi5lbmRzV2l0aCgnLS0nKSB8fCBwcmV2LmVuZHNXaXRoKCcpJykgfHwgcHJldi5lbmRzV2l0aCgnXScpKSByZXR1cm4gZmFsc2UKICByZXR1cm4gJyhbeyw7Oj89Ky0qJSZ8XiF+PD4nLmluY2x1ZGVzKHByZXZbcHJldi5sZW5ndGggLSAxXSEpCn0KCmNvbnN0IHNjYW4gPSAodGV4dDogc3RyaW5nKTogVG9rZW5bXSA9PiB7CiAgY29uc3QgdG9rZW5zOiBUb2tlbltdID0gW10KICBsZXQgaSA9IDAKICBsZXQgZ2FwID0gZmFsc2UKICBjb25zdCBwdXNoID0gKGVuZDogbnVtYmVyKTogdm9pZCA9PiB7CiAgICB0b2tlbnMucHVzaCh7IHRleHQ6IHRleHQuc2xpY2UoaSwgZW5kKSwgZ2FwIH0pCiAgICBpID0gZW5kCiAgICBnYXAgPSBmYWxzZQogIH0KICB3aGlsZSAoaSA8IHRleHQubGVuZ3RoKSB7CiAgICBjb25zdCBjID0gdGV4dFtpXSEKICAgIGlmIChjID09PSAnICcgfHwgYyA9PT0gJ1x0JyB8fCBjID09PSAnXHInIHx8IGMgPT09ICdcbicgfHwgYyA9PT0gJ1xmJykgewogICAgICBpZiAoYyA9PT0gJ1xuJykgZ2FwID0gdHJ1ZQogICAgICBpKysKICAgICAgY29udGludWUKICAgIH0KICAgIGlmIChjID09PSAnLycgJiYgdGV4dFtpICsgMV0gPT09ICcvJykgewogICAgICBjb25zdCBubCA9IHRleHQuaW5kZXhPZignXG4nLCBpKQogICAgICBpZiAobmwgPCAwKSB7IGkgPSB0ZXh0Lmxlbmd0aDsgY29udGludWUgfQogICAgICBpID0gbmwKICAgICAgY29udGludWUKICAgIH0KICAgIGlmIChjID09PSAnLycgJiYgdGV4dFtpICsgMV0gPT09ICcqJykgewogICAgICBjb25zdCBjbG9zZSA9IHRleHQuaW5kZXhPZignKi8nLCBpICsgMikKICAgICAgaWYgKGNsb3NlIDwgMCkgZmFpbCgnYW4gb3BlbiBjb21tZW50JykKICAgICAgaWYgKHRleHQuc2xpY2UoaSwgY2xvc2UpLmluY2x1ZGVzKCdcbicpKSBnYXAgPSB0cnVlCiAgICAgIGkgPSBjbG9zZSArIDIKICAgICAgY29udGludWUKICAgIH0KICAgIGlmIChjID09PSAiJyIgfHwgYyA9PT0gJyInKSB7IHB1c2gocmVhZFF1b3RlZCh0ZXh0LCBpKSk7IGNvbnRpbnVlIH0KICAgIGlmIChjID09PSAnYCcpIHsgcHVzaChyZWFkVGVtcGxhdGUodGV4dCwgaSkpOyBjb250aW51ZSB9CiAgICBpZiAoYyA9PT0gJy8nKSB7CiAgICAgIGNvbnN0IHByZXYgPSB0b2tlbnMubGVuZ3RoID8gdG9rZW5zW3Rva2Vucy5sZW5ndGggLSAxXSEudGV4dCA6IG51bGwKICAgICAgaWYgKGNhblJlZ2V4KHByZXYpKSB7IHB1c2gocmVhZFJlZ2V4KHRleHQsIGkpKTsgY29udGludWUgfQogICAgfQogICAgaWYgKC9bQS1aYS16MC05XyRdLy50ZXN0KGMpIHx8IGMgPT09ICcjJykgewogICAgICBsZXQgaiA9IGkgKyAxCiAgICAgIHdoaWxlIChqIDwgdGV4dC5sZW5ndGggJiYgL1tBLVphLXowLTlfJF0vLnRlc3QodGV4dFtqXSEpKSBqKysKICAgICAgcHVzaChqKQogICAgICBjb250aW51ZQogICAgfQogICAgbGV0IG1hdGNoZWQgPSAwCiAgICBmb3IgKGNvbnN0IG9wIG9mIE9QUykgewogICAgICBpZiAodGV4dC5zdGFydHNXaXRoKG9wLCBpKSkgeyBtYXRjaGVkID0gb3AubGVuZ3RoOyBicmVhayB9CiAgICB9CiAgICBpZiAoIW1hdGNoZWQpIGZhaWwoJ2EgbWFyayB0aGlzIHRyYW5zcGlsZXIgZG9lcyBub3QgcmVhZCcpCiAgICBwdXNoKGkgKyBtYXRjaGVkKQogIH0KICByZXR1cm4gdG9rZW5zCn0KCmV4cG9ydCBmdW5jdGlvbiBtaW5pZnlNb2R1bGVCb2R5KGJvZHk6IHN0cmluZyk6IHN0cmluZyB7CiAgY29uc3QgdG9rZW5zID0gc2Nhbihib2R5KQogIGxldCBvdXQgPSAnJwogIGZvciAobGV0IG4gPSAwOyBuIDwgdG9rZW5zLmxlbmd0aDsgbisrKSB7CiAgICBjb25zdCB0b2tlbiA9IHRva2Vuc1tuXSEKICAgIGlmIChuID4gMCkgewogICAgICBjb25zdCBwcmV2ID0gdG9rZW5zW24gLSAxXSEudGV4dAogICAgICBpZiAodG9rZW4uZ2FwKSBvdXQgKz0gJ1xuJwogICAgICBlbHNlIGlmIChzdGlja3MocHJldiwgdG9rZW4udGV4dCkpIG91dCArPSAnICcKICAgIH0KICAgIG91dCArPSB0b2tlbi50ZXh0CiAgfQogIHJldHVybiBvdXQKfQ=='

const decodeProgram = (packed: string): string => {
  const binary = atob(packed)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export const MINIFY_TRANSPILER_PROGRAM = decodeProgram(PROGRAM_B64)

/** Whitespace only. Names stay. Syntax that would rename a binding is not this program. */
export const MINIFY_OPTIONS: Readonly<Record<string, unknown>> = { minifyWhitespace: true }

export const transpilerSignature = (): Promise<string> =>
  SignatureService.sign(encoder.encode(MINIFY_TRANSPILER_PROGRAM).buffer as ArrayBuffer)

export const ownedMinifyTool = async (): Promise<{ name: string; options: Readonly<Record<string, unknown>> }> => ({
  name: await transpilerSignature(),
  options: MINIFY_OPTIONS,
})
