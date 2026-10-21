// Renders one proposal page as a standalone HTML document.
//
// Each page carries its own styles inline: a tile's page must stand alone
// (website-artifact-paradigm.md, rule 1), so there is no shared stylesheet
// for a page to depend on. Rebranding is data — `site.brand` — never a fork
// of this file.
//
//   mode 'app'     → links are site-relative (`/`, `/plan`), which the site
//                    view resolves under the site's own root, so the same
//                    bytes work at any lineage and on any domain.
//   mode 'preview' → links are local files (`index.html`, `plan.html`).

const DEFAULT_BRAND = {
  name: 'Hypercomb',
  accent: { light: '#a85f47', dark: '#d9906f' },
  second: { light: '#4f6b55', dark: '#93b39a' },
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const isExternal = (href) => /^(https?:|mailto:|wss?:)/i.test(href)

function linkFor(href, mode) {
  if (!href || isExternal(href) || href.startsWith('#')) return href
  const slug = href.replace(/^\/+/, '')
  if (mode === 'preview') return slug ? `${slug}.html` : 'index.html'
  return '/' + slug
}

function anchor(href, label, mode, cls = '') {
  const ext = isExternal(href)
  const c = cls ? ` class="${cls}"` : ''
  return `<a${c} href="${esc(linkFor(href, mode))}"${ext ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`
}

// **bold**, `code`, [label](href) — nothing else.
function rich(s, mode) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => anchor(href.replace(/&amp;/g, '&'), label, mode))
}

const HEX = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 20.2 7.25v9.5L12 21.5 3.8 16.75v-9.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 8.2 15.3 10.1v3.8L12 15.8 8.7 13.9v-3.8Z" fill="currentColor"/></svg>'

const STATUS = {
  built: 'Built',
  partial: 'Partly built',
  designed: 'Designed',
  new: 'Not started',
  support: 'NLnet support',
}

function renderBlock(b, ctx) {
  const { mode } = ctx
  const head = b.h ? `<h2>${rich(b.h, mode)}</h2>` : ''
  const intro = b.intro ? `<p class="intro">${rich(b.intro, mode)}</p>` : ''
  switch (b.type) {
    case 'prose':
      return `<section class="blk">${head}${(b.p || []).map(p => `<p>${rich(p, mode)}</p>`).join('')}</section>`
    case 'stats':
      return `<section class="blk">${head}<dl class="stats">${b.items.map(s =>
        `<div><dt>${esc(s.n)}</dt><dd>${rich(s.label, mode)}</dd></div>`).join('')}</dl>${b.note ? `<p class="note">${rich(b.note, mode)}</p>` : ''}</section>`
    case 'cards':
      return `<section class="blk">${head}${intro}<div class="cards">${b.items.map(c => {
        const inner = `${c.kicker ? `<span class="kicker">${esc(c.kicker)}</span>` : ''}<strong>${esc(c.title)}</strong><span>${rich(c.text, mode)}</span>`
        return c.href ? anchor(c.href, inner, mode, 'card') : `<div class="card">${inner}</div>`
      }).join('')}</div></section>`
    case 'list':
      return `<section class="blk">${head}${intro}<ul class="${b.style === 'check' ? 'checks' : 'points'}">${b.items.map(i => `<li>${rich(i, mode)}</li>`).join('')}</ul></section>`
    case 'table': {
      // data-label lets a narrow screen stack each row as a labelled block.
      const row = (r) => `<tr>${r.map((cell, i) => i === 0
        ? `<th scope="row">${rich(cell, mode)}</th>`
        : `<td data-label="${esc(b.cols[i])}"${cell === '' ? ' class="empty"' : ''}>${rich(cell, mode)}</td>`).join('')}</tr>`
      return `<section class="blk">${head}${intro}<div class="tablewrap"><table><thead><tr>${b.cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(row).join('')}</tbody>${b.foot ? `<tfoot>${row(b.foot)}</tfoot>` : ''}</table></div></section>`
    }
    case 'milestones':
      return `<section class="blk">${head}${intro}<ol class="milestones">${b.items.map(m => `<li>
  <div class="m-top"><span class="m-n">${esc(m.n)}</span><h3>${esc(m.title)}</h3><span class="pill pill-${esc(m.status)}">${esc(STATUS[m.status] || m.status)}</span></div>
  <p>${rich(m.text, mode)}</p>
  ${m.deliverable ? `<p class="deliver"><span>Done when</span>${rich(m.deliverable, mode)}</p>` : ''}
  ${m.refs?.length ? `<p class="refs">${m.refs.map(r => anchor(ctx.doc(r), esc(r), mode)).join('')}</p>` : ''}
</li>`).join('')}</ol></section>`
    case 'callout':
      return `<aside class="callout callout-${esc(b.tone || 'info')}">${b.title ? `<strong>${esc(b.title)}</strong>` : ''}${(b.p || []).map(p => `<p>${rich(p, mode)}</p>`).join('')}</aside>`
    case 'compare':
      return `<section class="blk">${head}${intro}<div class="compare">${b.items.map(c => `<div class="cmp">
  <h3>${esc(c.name)}</h3>
  <p class="cmp-same"><span>Shared</span>${rich(c.same, mode)}</p>
  <p class="cmp-diff"><span>Different</span>${rich(c.diff, mode)}</p>
</div>`).join('')}</div></section>`
    default:
      throw new Error(`unknown block type: ${b.type}`)
  }
}

function css(brand) {
  const a = brand.accent, s = brand.second
  return `
:root{color-scheme:light;--paper:#f7f0e5;--surface:#fffcf7;--soft:#f0e7d9;--ink:#211a13;--muted:#6b6155;--line:#dccfbd;--accent:${a.light};--second:${s.light};--warn:#9a6a12;--warn-bg:#fbf0d9;--serif:Georgia,"Iowan Old Style","Times New Roman",serif;--sans:"Segoe UI",system-ui,-apple-system,"Helvetica Neue",sans-serif;--mono:ui-monospace,"Cascadia Code",Consolas,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--paper:#13110e;--surface:#1c1915;--soft:#24201b;--ink:#efe6d8;--muted:#a99d8d;--line:#373029;--accent:${a.dark};--second:${s.dark};--warn:#e3b45c;--warn-bg:#2a2214}}
:root[data-theme="dark"]{color-scheme:dark;--paper:#13110e;--surface:#1c1915;--soft:#24201b;--ink:#efe6d8;--muted:#a99d8d;--line:#373029;--accent:${a.dark};--second:${s.dark};--warn:#e3b45c;--warn-bg:#2a2214}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.62 var(--sans);-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-underline-offset:3px;text-decoration-thickness:1px}
code{font:.86em var(--mono);background:var(--soft);border:1px solid var(--line);border-radius:5px;padding:.05em .35em;word-break:break-word}
.draft{background:var(--warn-bg);color:var(--warn);font-size:14px;text-align:center;padding:8px 16px;border-bottom:1px solid var(--line)}
.top{display:flex;align-items:center;gap:14px;max-width:1180px;margin:0 auto;padding:18px 24px}
.brand{display:flex;align-items:center;gap:10px;color:var(--ink);text-decoration:none;font:600 18px/1 var(--serif);letter-spacing:.01em}
.brand svg{width:26px;height:26px;color:var(--accent)}
.funder{margin-left:auto;font-size:13px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:5px 12px;white-space:nowrap}
.frame{display:grid;grid-template-columns:230px minmax(0,1fr);gap:56px;max-width:1180px;margin:0 auto;padding:8px 24px 64px}
.toc{position:sticky;top:24px;align-self:start}
.toc ol{list-style:none;margin:0;padding:0;border-left:1px solid var(--line)}
.toc a{display:flex;gap:10px;padding:7px 0 7px 16px;margin-left:-1px;border-left:2px solid transparent;color:var(--muted);text-decoration:none;font-size:15px;line-height:1.35}
.toc a span{font:12px/1.6 var(--mono);opacity:.7;min-width:1.6em}
.toc a:hover{color:var(--ink)}
.toc a[aria-current]{color:var(--ink);border-left-color:var(--accent);font-weight:600}
.toc-m{display:none}
main{min-width:0;max-width:760px}
.eyebrow{font:13px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin:12px 0 14px}
h1{font:400 clamp(32px,5vw,50px)/1.08 var(--serif);letter-spacing:-.015em;margin:0 0 18px;text-wrap:balance}
.lede{font-size:20px;line-height:1.55;color:var(--muted);margin:0 0 34px;text-wrap:pretty}
h2{font:400 26px/1.2 var(--serif);margin:0 0 14px;letter-spacing:-.01em}
h3{font:600 17px/1.35 var(--sans);margin:0}
.blk{margin:0 0 44px}
.blk p{margin:0 0 14px;text-wrap:pretty}
.intro{color:var(--muted)}
.note{font-size:14px;color:var(--muted);margin-top:12px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;margin:0;background:var(--line);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.stats div{background:var(--surface);padding:18px 18px 16px}
.stats dt{font:400 30px/1.1 var(--serif);color:var(--ink)}
.stats dd{margin:6px 0 0;font-size:14px;line-height:1.4;color:var(--muted)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.card{display:flex;flex-direction:column;gap:6px;padding:18px;background:var(--surface);border:1px solid var(--line);border-radius:14px;color:var(--ink);text-decoration:none;transition:border-color .15s,transform .15s}
a.card:hover{border-color:var(--accent);transform:translateY(-1px)}
.card strong{font:600 16px/1.3 var(--sans)}
.card span{font-size:15px;line-height:1.5;color:var(--muted)}
.card .kicker{font:12px/1 var(--mono);color:var(--accent);letter-spacing:.06em}
.points,.checks{margin:0;padding:0;list-style:none}
.points li,.checks li{position:relative;padding:0 0 10px 26px}
.points li::before{content:"";position:absolute;left:4px;top:.62em;width:8px;height:8px;background:var(--accent);clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}
.checks li::before{content:"✓";position:absolute;left:2px;top:0;color:var(--second);font-weight:700}
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
table{width:100%;border-collapse:collapse;font-size:15px;line-height:1.45}
th,td{text-align:left;vertical-align:top;padding:12px 16px;border-bottom:1px solid var(--line)}
thead th{font:600 12px/1.3 var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted);background:var(--soft)}
tbody th{font-weight:600}
tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}
tfoot th,tfoot td{font-weight:600;border-top:2px solid var(--line);border-bottom:0}
.milestones{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.milestones li{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
.m-top{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px}
.m-n{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--accent);color:var(--surface);font:600 14px/1 var(--mono);flex:none}
.m-top h3{flex:1 1 260px}
.pill{font:12px/1 var(--mono);padding:5px 9px;border-radius:999px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.pill-built{color:var(--second);border-color:currentColor}
.pill-designed,.pill-partial{color:var(--accent);border-color:currentColor}
.milestones p{margin:0 0 8px;font-size:15.5px}
.deliver{display:flex;gap:10px;align-items:baseline}
.deliver span,.cmp p span{font:11px/1.6 var(--mono);text-transform:uppercase;letter-spacing:.07em;color:var(--muted);flex:none}
.refs{display:flex;flex-wrap:wrap;gap:6px 14px;font:13px/1.5 var(--mono);margin:6px 0 0!important}
.compare{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.cmp{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
.cmp h3{margin-bottom:10px}
.cmp p{margin:0 0 8px;font-size:15px}
.cmp p span{display:block}
.callout{margin:0 0 44px;padding:18px 20px;border-radius:14px;background:var(--soft);border-left:3px solid var(--second)}
.callout-warn{border-left-color:var(--warn);background:var(--warn-bg)}
.callout strong{display:block;margin-bottom:6px}
.callout p{margin:0 0 8px}.callout p:last-child{margin:0}
.pager{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:56px 0 0;padding-top:28px;border-top:1px solid var(--line)}
.pager a{display:flex;flex-direction:column;gap:4px;padding:14px 16px;border:1px solid var(--line);border-radius:12px;text-decoration:none;color:var(--ink);background:var(--surface)}
.pager a:hover{border-color:var(--accent)}
.pager small{font:12px/1 var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.pager .next{text-align:right;grid-column:2}
.foot{max-width:1180px;margin:0 auto;padding:22px 24px 40px;border-top:1px solid var(--line);font-size:13.5px;color:var(--muted);display:flex;flex-wrap:wrap;gap:6px 22px}
.foot a{color:var(--muted)}
@media (max-width:900px){
  .frame{grid-template-columns:minmax(0,1fr);gap:0;padding:0 16px 48px}
  .toc{display:none}
  .toc-m{display:block;margin:0 0 22px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
  .toc-m summary{cursor:pointer;padding:12px 16px;font-size:15px;list-style:none;display:flex;justify-content:space-between}
  .toc-m summary::after{content:"+";color:var(--muted)}
  .toc-m[open] summary::after{content:"–"}
  .toc-m ol{list-style:none;margin:0;padding:4px 8px 10px}
  .toc-m a{display:flex;gap:10px;padding:8px;color:var(--ink);text-decoration:none;font-size:15px;border-radius:8px}
  .toc-m a span{font:12px/1.7 var(--mono);color:var(--muted);min-width:1.6em}
  .toc-m a[aria-current]{background:var(--soft);font-weight:600}
  .top{padding:14px 16px}
  .foot{padding:20px 16px 32px}
  .lede{font-size:18px}
}
@media (max-width:600px){
  thead{display:none}
  table,tbody,tfoot,tr,th,td{display:block}
  tr{padding:14px 16px;border-bottom:1px solid var(--line)}
  tbody tr:last-child{border-bottom:0}
  tfoot tr{border-top:2px solid var(--line);border-bottom:0}
  th,td,tfoot th,tfoot td{padding:0;border:0}
  th{margin-bottom:4px}
  td{margin-top:6px}
  td::before{content:attr(data-label);display:block;font:11px/1.6 var(--mono);text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
  td.empty{display:none}
}
@media (max-width:520px){.funder{display:none}.pager{grid-template-columns:1fr}.pager .next{grid-column:1}}
`.replace(/\n\s*/g, '\n').trim()
}

function renderPage(site, page, mode) {
  const brand = { ...DEFAULT_BRAND, ...(site.brand || {}) }
  const pages = site.pages
  const at = pages.indexOf(page)
  const num = (i) => String(i).padStart(2, '0')
  const href = (p) => '/' + p.slug
  const tocItems = pages.map((p, i) =>
    `<li><a href="${esc(linkFor(href(p), mode))}"${p === page ? ' aria-current="page"' : ''}><span>${num(i)}</span>${esc(p.nav)}</a></li>`).join('')
  const ctx = { mode, doc: (file) => `${site.docsBase}/${file}` }
  const prev = pages[at - 1], next = pages[at + 1]
  const pager = `<nav class="pager" aria-label="Pages">${prev ? `<a href="${esc(linkFor(href(prev), mode))}"><small>Previous</small>${esc(prev.nav)}</a>` : ''}${next ? `<a class="next" href="${esc(linkFor(href(next), mode))}"><small>Next</small>${esc(next.nav)}</a>` : ''}</nav>`
  const title = at === 0 ? site.title : `${page.title} · ${site.title}`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(page.lede || site.summary)}">
<style>${css(brand)}</style>
</head>
<body>
${site.draft ? `<div class="draft">${esc(site.draft)}</div>` : ''}
<header class="top">${anchor('/', `${HEX}<span>${esc(brand.name)}</span>`, mode, 'brand')}<span class="funder">${esc(site.funder)}</span></header>
<div class="frame">
<nav class="toc" aria-label="Contents"><ol>${tocItems}</ol></nav>
<main>
<details class="toc-m"><summary>Contents · ${num(at)} ${esc(page.nav)}</summary><ol>${tocItems}</ol></details>
<p class="eyebrow">${num(at)} · ${esc(page.eyebrow || page.nav)}</p>
<h1>${esc(page.title)}</h1>
${page.lede ? `<p class="lede">${rich(page.lede, mode)}</p>` : ''}
${page.blocks.map(b => renderBlock(b, ctx)).join('\n')}
${pager}
</main>
</div>
<footer class="foot">${(site.footer || []).map(f => `<span>${rich(f, mode)}</span>`).join('')}</footer>
</body>
</html>
`
}

module.exports = { renderPage }
