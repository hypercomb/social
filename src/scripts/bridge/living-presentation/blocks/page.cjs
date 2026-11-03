// A BLOCK: one tile's page, whole (documentation/living-presentation.md, "The
// tree as planted"; website-artifact-paradigm.md rules 1, 2 and 10).
//
// Every page this writes stands alone: its look, its script and its pictures
// are inside it, and it asks the network for nothing (doctrine T7; a published
// page's policy allows inline script and style, never another host). It names
// no other block. It plays like a short video — beats, each lighting part of
// the picture with one sentence — and it can be stepped by hand.
//
// Its natural parts are marked by the word each would fill (`data-part`:
// title, picture, narration, try, code). Extruding a block later is a layout of
// those words and a component for each (the layout word); nothing here has to
// know about that.
//
// render(block, { code }) -> the page's HTML. `code` is the source excerpts,
// read from the repo at plant time so a page quotes the code as it is.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const HEX_POINTS = (r) => [0, 1, 2, 3, 4, 5]
  .map(i => { const a = Math.PI / 3 * i - Math.PI / 2; return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}` })
  .join(' ')

/** The picture: nodes (hexagons or boxes) and edges, every one with an id a
 *  beat can light. */
const picture = (pic) => {
  const { width = 640, height = 360, nodes = [], edges = [] } = pic
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
  const lines = edges.map(([a, b]) => {
    const p = byId[a]; const q = byId[b]
    return `<line class="edge" data-id="${esc(`${a}-${b}`)}" x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}"/>`
  }).join('')
  const shapes = nodes.map(n => {
    const label = esc(n.label ?? n.id)
    const sub = n.sub ? `<text class="sub" y="${n.kind === 'box' ? 24 : 28}">${esc(n.sub)}</text>` : ''
    const shape = n.kind === 'box'
      ? `<rect x="${-(n.w ?? 150) * 0.6}" y="-34" width="${(n.w ?? 150) * 1.2}" height="68" rx="4"/>`
      : `<polygon points="${HEX_POINTS((n.r ?? 46) * 1.3)}"/>`
    return `<g class="node ${n.kind === 'box' ? 'box' : 'hex'}" data-id="${esc(n.id)}" transform="translate(${n.x} ${n.y})">${shape}<text class="label" y="${n.sub ? -4 : 7}">${label}</text>${sub}</g>`
  }).join('')
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(pic.label ?? '')}">${lines}${shapes}</svg>`
}

const TRY = {
  // The word's address, exactly as hypercomb-core molecule-address.ts makes
  // it: sign(fold(canon(name) || trim(name))).
  word: {
    label: 'Type a word',
    value: 'My Tile',
    script: `const canon = (s) => s.normalize('NFC').replace(/[^\\p{L}\\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
const key = (s) => (canon(s) || s.trim()).toLowerCase()
const hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('')
async function show(v) {
  const k = key(v)
  out.innerHTML = k ? '<span class="k">the word, folded</span><code>' + esc(k) + '</code><span class="k">its address</span><code class="sig">' + await hex(k) + '</code>' : '<span class="k">an empty word has no address: it would be the root</span>'
}`,
  },
  // A signature, exactly as SignatureService.sign makes it: SHA-256 of the bytes.
  signature: {
    label: 'Type anything',
    value: 'hello',
    script: `const hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('')
let last = ''
async function show(v) {
  const sig = await hex(v)
  const changed = last ? [...sig].filter((c, i) => c !== last[i]).length : 0
  out.innerHTML = '<span class="k">its signature</span><code class="sig">' + sig + '</code>' + (last ? '<span class="k">' + changed + ' of 64 characters changed</span>' : '')
  last = sig
}`,
  },
}

/** One block's page. */
const render = (block, { code = [] } = {}) => {
  const beats = block.beats.map(b => ({ say: b.say, lit: b.lit ?? [] }))
  const tryPart = block.try ? TRY[block.try] : null
  const codePart = code.length ? `
  <section class="part code" data-part="code" aria-label="The code">
    <h2>The code</h2>
    ${code.map(c => `<figure><figcaption>${esc(c.path)}</figcaption><pre><code>${esc(c.text)}</code></pre></figure>`).join('\n    ')}
  </section>` : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(block.title)}</title>
<style>
:root {
  --paper: #fbf8f1; --ink: #23201a; --quiet: #6d665a; --line: #d9d2c3;
  --accent: #b7791f; --accent-soft: #f3e3c3; --code: #f2ede2;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --read: system-ui, -apple-system, "Segoe UI", sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root { --paper: #17150f; --ink: #efe9dc; --quiet: #a39b8a; --line: #3a352b;
    --accent: #e0a440; --accent-soft: #3b2f17; --code: #211e17; }
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--paper); color: var(--ink); font: 17px/1.55 var(--read); }
main { max-width: 52rem; margin: 0 auto; padding: 1.25rem 1rem 3rem; }
.title h1 { margin: 0; font-size: 1.6rem; font-weight: 650; letter-spacing: -0.01em; }
.title p { margin: .25rem 0 0; color: var(--quiet); }
.picture { margin: 1rem 0 .5rem; border: 1px solid var(--line); border-radius: 4px; background: var(--paper); }
.picture svg { display: block; width: 100%; height: auto; }
.edge { stroke: var(--line); stroke-width: 2; transition: stroke .5s, opacity .5s; opacity: .35; }
.node polygon, .node rect { fill: var(--paper); stroke: var(--line); stroke-width: 2; transition: fill .5s, stroke .5s; }
.node text { fill: var(--quiet); text-anchor: middle; font: 600 16px var(--read); transition: fill .5s; }
.node .sub { font: 12px var(--mono); }
@media (max-width: 560px) { .node text { font-size: 21px; } .node .sub { font-size: 16px; } }
.node { opacity: .35; transition: opacity .5s, transform .5s; }
.node.lit, .edge.lit { opacity: 1; }
.node.lit polygon, .node.lit rect { fill: var(--accent-soft); stroke: var(--accent); }
.node.lit text { fill: var(--ink); }
.edge.lit { stroke: var(--accent); }
.narration { min-height: 3.2em; margin: .5rem 0; font-size: 1.15rem; }
.narration p { margin: 0; animation: rise .5s ease; }
@keyframes rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.controls { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
.controls button { font: inherit; font-size: .9rem; padding: .35em .8em; border: 1px solid var(--line); border-radius: 3px; background: transparent; color: var(--ink); cursor: pointer; }
.controls button:hover { border-color: var(--accent); }
.dots { display: flex; gap: .35rem; margin-left: auto; }
.dots span { width: .55rem; height: .55rem; border-radius: 50%; background: var(--line); }
.dots span.on { background: var(--accent); }
.try { margin-top: 1.5rem; padding: 1rem; border: 1px solid var(--line); border-radius: 4px; }
.try label { display: block; font-weight: 600; margin-bottom: .4rem; }
.try input { width: 100%; font: 1rem var(--mono); padding: .5rem; border: 1px solid var(--line); border-radius: 3px; background: var(--code); color: var(--ink); }
.try output { display: grid; gap: .25rem; margin-top: .6rem; }
.try .k { color: var(--quiet); font-size: .85rem; }
.try code { font: .95rem var(--mono); word-break: break-all; }
.try code.sig { color: var(--accent); }
.code { margin-top: 1.5rem; }
.code h2 { font-size: 1.05rem; margin: 0 0 .5rem; }
.code figure { margin: 0 0 1rem; }
.code figcaption { font: .8rem var(--mono); color: var(--quiet); margin-bottom: .25rem; }
.code pre { margin: 0; padding: .75rem; overflow-x: auto; background: var(--code); border-radius: 3px; font: .82rem/1.5 var(--mono); }
@media (prefers-reduced-motion: reduce) { .narration p { animation: none; } .node, .edge, .node * { transition: none; } }
</style>
</head>
<body>
<main>
  <header class="part title" data-part="title">
    <h1>${esc(block.title)}</h1>
    <p>${esc(block.lede)}</p>
  </header>
  <section class="part picture" data-part="picture">${picture(block.picture)}</section>
  <section class="part narration" data-part="narration" aria-live="polite"><p></p></section>
  <nav class="controls" aria-label="Play">
    <button type="button" data-act="back" aria-label="Previous">&#8249;</button>
    <button type="button" data-act="play">Pause</button>
    <button type="button" data-act="next" aria-label="Next">&#8250;</button>
    <span class="dots" aria-hidden="true">${beats.map(() => '<span></span>').join('')}</span>
  </nav>${tryPart ? `
  <section class="part try" data-part="try">
    <label for="try-in">${esc(tryPart.label)}</label>
    <input id="try-in" value="${esc(tryPart.value)}" autocomplete="off" spellcheck="false">
    <output id="try-out"></output>
  </section>` : ''}${codePart}
</main>
<script>
(() => {
  const beats = ${JSON.stringify(beats)}
  const svg = document.querySelector('.picture svg')
  let line = document.querySelector('.narration p')
  const dots = [...document.querySelectorAll('.dots span')]
  const play = document.querySelector('[data-act=play]')
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  let at = 0, timer = null, playing = !still
  const show = (i) => {
    at = (i + beats.length) % beats.length
    const lit = new Set(beats[at].lit)
    for (const el of svg.querySelectorAll('[data-id]')) el.classList.toggle('lit', lit.has(el.dataset.id))
    // a fresh line each beat, so it rises in again
    const p = document.createElement('p'); p.textContent = beats[at].say; line.replaceWith(p); line = p
    dots.forEach((d, j) => d.classList.toggle('on', j === at))
  }
  const tick = () => { clearTimeout(timer); if (playing) timer = setTimeout(() => { if (at < beats.length - 1) { show(at + 1); tick() } else { playing = false; play.textContent = 'Play again' } }, 4200) }
  const setPlaying = (on) => { playing = on; play.textContent = on ? 'Pause' : (at === beats.length - 1 ? 'Play again' : 'Play'); tick() }
  document.querySelector('[data-act=back]').onclick = () => { setPlaying(false); show(at - 1) }
  document.querySelector('[data-act=next]').onclick = () => { setPlaying(false); show(at + 1) }
  play.onclick = () => { if (!playing && at === beats.length - 1) show(0); setPlaying(!playing) }
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return
    if (e.key === 'ArrowRight') { setPlaying(false); show(at + 1) }
    else if (e.key === 'ArrowLeft') { setPlaying(false); show(at - 1) }
    else if (e.key === ' ') { e.preventDefault(); play.click() }
  })
  show(0); setPlaying(playing)
})()${tryPart ? `
;(() => {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const input = document.getElementById('try-in')
  const out = document.getElementById('try-out')
  ${tryPart.script}
  input.addEventListener('input', () => show(input.value))
  show(input.value)
})()` : ''}
</script>
</body>
</html>
`
}

module.exports = { render }
