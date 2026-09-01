// Typography for GENERATED sites, with no third-party requests.
//
// Every published page used to carry `<link href="fonts.googleapis.com/...">`,
// which hands Google the reader's IP, User-Agent and Referer — i.e. which page
// of which site they were reading — on every load, before a single byte of our
// own renders. See documentation/no-third-party-requests.md.
//
// These builders publish ONE self-contained HTML resource via `put-resource`;
// there is no sibling-file slot next to it, and the `resource:<sig>` scheme
// does not resolve inside a CSS url(). So a face we want to keep travels as a
// data: URI in the page's own <style>, and everything else resolves to fonts
// the reader already has.
//
//   FRAUNCES_FACE  — inlined (~90K b64). Distinctive soft-serif that carries
//                    the design; Georgia is not a substitute for it.
//   SERIF_STACK    — Source Serif 4 was NOT inlined: roman + italic is ~338K
//                    per page, and its existing Iowan/Georgia fallback is a
//                    genuinely good match. Bytes not worth the difference.
//   UI_STACK       — Inter's role. system-ui renders SF Pro / Segoe UI Variable
//                    / Roboto, all a hair from Inter at body sizes, for 0 bytes.
const fs = require('fs'), path = require('path')

const FONT_DIR = path.join(__dirname, 'fonts')

function face(file, family, weightRange, style = 'normal') {
  const b64 = fs.readFileSync(path.join(FONT_DIR, file)).toString('base64')
  return `@font-face{font-family:'${family}';font-style:${style};`
       + `font-weight:${weightRange};font-display:swap;`
       + `src:url(data:font/woff2;base64,${b64}) format('woff2')}`
}

// Latin only. Fraunces carries no CJK, so wider coverage would ship bytes for
// characters that fall through to the system stack anyway.
const FRAUNCES_FACE = () => face('fraunces-latin.woff2', 'Fraunces', '400 600')

const UI_STACK = `system-ui,-apple-system,'Segoe UI Variable','Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`
const SERIF_STACK = `'Iowan Old Style',Georgia,'Times New Roman',serif`

module.exports = { FRAUNCES_FACE, UI_STACK, SERIF_STACK }
