// What the post will look like when it lands — rendered from the same record
// the hive will hold.
//
// This is the renderer half of the OUTCOME idea: an idea is a branch, and a
// LinkedIn post is one outcome you can decorate it with. Seeing the destination
// is what makes the draft improvable, so the preview is faithful about the
// things that actually bite: the ~140-character "…see more" fold, links in the
// body versus the first comment, and the fact that a video post autoplays muted.
//
//   node preview-post.cjs            → posts/preview.html
const fs = require('fs')
const path = require('path')

const ROOT = __dirname
const POSTS = path.join(ROOT, 'posts')
const FOLD = 140          // where the feed truncates before "…see more"

const md = fs.readFileSync(path.join(POSTS, 'posts.md'), 'utf8')
const records = md.split(/\n## /).slice(1).map(block => {
  const title = block.split('\n')[0].replace(/^\d+\.\s*/, '').trim()
  const video = (block.match(/\*\*video:\*\* `([^`]+)`/) || [])[1] || ''
  const rest = block.split('\n').slice(1).join('\n')
  const copy = rest.split('**First comment:**')[0].replace(/\*\*video:\*\*[^\n]*\n/, '').trim()
  const comment = (rest.split('**First comment:**')[1] || '').split('---')[0].trim()
  return { title, video, copy, comment }
}).filter(r => r.video)

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const URL_RE = /(https?:\/\/[^\s]+)/g

function body(copy) {
  const flat = copy.replace(/\n{2,}/g, '\n\n')
  const head = flat.slice(0, FOLD)
  const tail = flat.slice(FOLD)
  const paint = s => esc(s).replace(URL_RE, '<span class="u">$1</span>').replace(/\n/g, '<br>')
  return paint(head) + (tail ? `<span class="fold">… <b>see more</b></span><span class="rest">${paint(tail)}</span>` : '')
}

const warnings = r => {
  const w = []
  const inBody = (r.copy.match(URL_RE) || []).length
  if (inBody) w.push(`${inBody} link${inBody > 1 ? 's' : ''} in the body — LinkedIn damps reach on these, and a video post shows no preview card anyway. Move them to the first comment.`)
  if (r.comment.includes('<paste')) w.push('the first comment still has a placeholder link in it')
  if (r.copy.length > 3000) w.push(`${r.copy.length} characters — the limit is 3000`)
  const firstLine = r.copy.split('\n')[0]
  if (firstLine.length > FOLD) w.push('the first line runs past the fold — the hook is what people decide on')
  return w
}

const cards = records.map((r, i) => `
<section class="card">
  <div class="idx">${i + 1}</div>
  <div class="post">
    <div class="who"><div class="pic">JW</div><div>
      <div class="name">Jaime Wize</div>
      <div class="meta">Now · <span class="globe">🌐</span></div></div></div>
    <div class="copy">${body(r.copy)}</div>
    <div class="media"><video src="../${esc(r.video)}" muted playsinline loop controls preload="metadata"></video>
      <span class="muted">autoplays muted — captions are burned in</span></div>
    <div class="actions"><span>👍 Like</span><span>💬 Comment</span><span>↻ Repost</span><span>➤ Send</span></div>
    ${r.comment ? `<div class="comment"><div class="pic sm">JW</div><div class="cbody">
      <div class="name sm">Jaime Wize <span class="tag">author</span></div>
      <div>${esc(r.comment).replace(URL_RE, '<span class="u">$1</span>').replace(/\n/g, '<br>')}</div></div></div>` : ''}
  </div>
  <div class="side">
    <div class="h">${esc(r.title)}</div>
    <div class="stat"><b>${r.copy.length}</b> characters <span>/ 3000</span></div>
    <div class="stat"><b>${r.copy.split('\n')[0].length}</b> in the first line <span>/ ${FOLD} before the fold</span></div>
    <div class="stat"><b>${(r.comment.match(URL_RE) || []).length}</b> links in the first comment</div>
    ${warnings(r).length
      ? warnings(r).map(w => `<div class="warn">${esc(w)}</div>`).join('')
      : '<div class="ok">nothing to flag</div>'}
  </div>
</section>`).join('')

const html = `<meta charset="utf-8">
<title>Post previews — how they will land</title>
<style>
  :root{--bg:#f4f2ee;--card:#fff;--ink:#191919;--dim:#666;--line:#e0dfdc;--blue:#0a66c2;--warn:#915907;--warnbg:#fff4e0;--ok:#0b6b3a;--okbg:#e8f5ee}
  @media (prefers-color-scheme: dark){:root{--bg:#1b1f23;--card:#25292d;--ink:#e8e6e3;--dim:#9aa0a6;--line:#3a3f44;--warnbg:#3a2f16;--warn:#f0b95c;--okbg:#16301f;--ok:#7bd6a0}}
  :root[data-theme="dark"]{--bg:#1b1f23;--card:#25292d;--ink:#e8e6e3;--dim:#9aa0a6;--line:#3a3f44;--warnbg:#3a2f16;--warn:#f0b95c;--okbg:#16301f;--ok:#7bd6a0}
  :root[data-theme="light"]{--bg:#f4f2ee;--card:#fff;--ink:#191919;--dim:#666;--line:#e0dfdc;--warnbg:#fff4e0;--warn:#915907;--okbg:#e8f5ee;--ok:#0b6b3a}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"Segoe UI",system-ui,sans-serif;padding:28px 20px 60px}
  h1{font-size:24px;font-weight:600;margin:0 0 6px;max-width:1180px;margin-inline:auto}
  .lede{color:var(--dim);max-width:1180px;margin:0 auto 26px}
  .card{display:grid;grid-template-columns:34px minmax(0,555px) minmax(240px,1fr);gap:18px;align-items:start;
    max-width:1180px;margin:0 auto 30px}
  .idx{font:600 13px/1 ui-monospace,monospace;color:var(--dim);padding-top:14px;text-align:right}
  .post{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .who{display:flex;gap:10px;align-items:center;padding:12px 16px 8px}
  .pic{width:44px;height:44px;border-radius:50%;background:var(--blue);color:#fff;display:grid;place-items:center;font-weight:600;flex:none}
  .pic.sm{width:30px;height:30px;font-size:12px}
  .name{font-weight:600;font-size:14px}
  .name.sm{font-size:13px}
  .tag{font-weight:400;font-size:11px;color:var(--dim);border:1px solid var(--line);border-radius:3px;padding:0 4px}
  .meta{color:var(--dim);font-size:12px}
  .copy{padding:4px 16px 12px;white-space:normal;word-wrap:break-word}
  .u{color:var(--blue)}
  .fold{color:var(--dim)} .fold b{color:var(--dim);font-weight:600}
  .rest{display:block;margin-top:6px;opacity:.62;border-left:2px solid var(--line);padding-left:10px}
  .media{position:relative;background:#000;border-block:1px solid var(--line)}
  .media video{display:block;width:100%}
  .muted{position:absolute;left:10px;bottom:10px;background:rgba(0,0,0,.7);color:#fff;font-size:11px;padding:4px 8px;border-radius:4px}
  .actions{display:flex;justify-content:space-around;padding:8px 4px;color:var(--dim);font-size:13px;font-weight:600}
  .comment{display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--line);font-size:13px}
  .cbody{min-width:0}
  .side{padding-top:10px;font-size:13px}
  .side .h{font-weight:600;margin-bottom:10px}
  .stat{color:var(--dim);margin-bottom:5px} .stat b{color:var(--ink);font-variant-numeric:tabular-nums}
  .warn{background:var(--warnbg);color:var(--warn);border-radius:6px;padding:9px 11px;margin-top:9px;line-height:1.4}
  .ok{background:var(--okbg);color:var(--ok);border-radius:6px;padding:9px 11px;margin-top:9px}
  @media(max-width:900px){.card{grid-template-columns:1fr}.idx{display:none}}
</style>
<h1>How these land</h1>
<p class="lede">The same records the hive will hold, drawn as the feed will draw them —
the fold, the first comment, and anything worth fixing before it goes out.</p>
${cards}`

fs.writeFileSync(path.join(POSTS, 'preview.html'), html)
console.log(`posts/preview.html — ${records.length} posts`)
for (const r of records) {
  const w = warnings(r)
  console.log(`  ${r.title.slice(0, 44).padEnd(46)} ${r.copy.length} chars${w.length ? `  ⚠ ${w.length}` : '  ok'}`)
}
