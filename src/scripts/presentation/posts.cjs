// A series of social posts — one short MP4 each, each linking to its own scene.
//
// Same machinery as teaser.cjs, but it emits one file per POST plus posts.md
// with the copy and the deep link to go with it. One post, one idea, one link.
//
//   node scripts/presentation/posts.cjs
//   → posts/NN-<id>.mp4  +  posts/posts.md
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const ROOT = __dirname
const OUT = path.join(ROOT, 'posts')
const FRAMES = path.join(OUT, 'frames')
const CACHE = path.join(ROOT, 'teaser', 'audio')   // shared with the teaser
const VOICE = 'en-US-AndrewMultilingualNeural'
const RATE = '+2%'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const SITE = 'https://www.hypercomb.com'   // the presentation
const APP = 'https://hypercomb.io'         // the thing itself
const W = 1280, H = 720

// Fill this in once post 1 is up, then re-run with --copy-only: every later
// post will carry a link back to the start of the series.
const FIRST_POST_URL = process.env.FIRST_POST_URL || '<paste the URL of post 1 here>'

for (const d of [OUT, FRAMES, CACHE]) fs.mkdirSync(d, { recursive: true })
const shell = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8')
const STYLE = (shell.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || ''

// Each post: a hook beat, the substance, and a close. scene = where the link lands.
const POSTS = [
  {
    id: 'a-new-way-to-be', scene: 1,
    title: 'Where does your work actually live?',
    copy: `For most software the honest answer is: on someone else's computer, behind someone else's login, in someone else's format.

Hypercomb starts somewhere else. Your work lives on a hexagonal grid on your own machine — no server, no account. Presence is permission: it is here because you are.

I recorded the whole thing live from a real hive. This is the opening.`,
    beats: [
      { kind: 'still', body: `<div class="eyebrow">hypercomb</div><h1>A new way to <b>be</b>.</h1>
          <p class="sub">Not a new place to keep your work — a different way of being present with it.</p>`,
        say: `Hypercomb. A new way to be.` },
      { kind: 'clip', clip: 'hive-navigate.mp4',
        say: `Your work lives on a grid of hexagons, on your own machine. Click a tile and you travel into it — every tile opens into a whole honeycomb of its own.` },
      { kind: 'still', body: `<div class="eyebrow">no server, no account</div><h1><b>Presence</b> is permission.</h1>
          <p class="sub">It runs entirely in your browser. Publishing is optional, and explicit.</p>
          <div class="golink" style="margin-top:1.5vh">www.hypercomb.com</div>`,
        say: `There is no server and no account. Nothing leaves your machine until you say so.` },
    ],
  },
  {
    id: 'signatures', scene: 5,
    title: 'One kind of name for everything',
    copy: `Every piece of content in Hypercomb is named by a signature — the SHA-256 of its own bytes. Sixty-four characters that are identical on every machine, forever.

That one substitution does an enormous amount of work: content verifies itself, identical things store once, caches never go stale, and sharing a hash is sharing a proof.

You verify instead of trusting.`,
    beats: [
      { kind: 'still', body: `<div class="eyebrow">one kind of name</div><h1>Everything is a <b>signature</b>.</h1>
          <div class="sig">sign(content) → <em>e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</em></div>`,
        say: `Everything in Hypercomb has one kind of name: a signature, computed from the content itself.` },
      { kind: 'still', body: `<div class="eyebrow">proof, not trust</div><h1>Same content. <b>Same name.</b></h1>
          <p class="sub">On every machine, forever. Identical content stores once. A cache never goes stale.</p>
          <div class="golink" style="margin-top:1.5vh">www.hypercomb.com</div>`,
        say: `Same content, same name, on every machine, forever. Share a signature and you have shared a proof — the receiver's own machine checks every byte.` },
    ],
  },
  {
    id: 'history', scene: 7,
    title: 'History is the data structure',
    copy: `Nothing in Hypercomb is ever overwritten. Every change becomes a new immutable layer, and the newest marker IS the current state.

Which means undo is not a trick — it is just reading an older layer. Rewind a page, restore any moment, name a revision, snapshot the whole thing before an experiment.

Your history is not a log about the data. It is the data.`,
    beats: [
      { kind: 'still', body: `<div class="eyebrow">nothing is overwritten</div><h1>History <b>is</b> the data structure.</h1>
          <div class="stack">
            <div class="lay"><span>0000</span><span>first layer</span></div>
            <div class="lay"><span>0001</span><span>added a tile</span></div>
            <div class="lay"><span>0002</span><span>changed a picture</span></div>
            <div class="lay head"><span class="m">0003</span><span class="m">← the newest marker is the current state</span></div>
          </div>`,
        say: `Every change you make becomes a new layer, and nothing is ever overwritten. The newest marker is the current state.` },
      { kind: 'still', body: `<div class="eyebrow">time is a feature</div><h1>Undo isn't a trick. It's a <b>read</b>.</h1>
          <p class="sub">Rewind any page. Restore any moment. Snapshot the hive before an experiment.</p>
          <div class="golink" style="margin-top:1.5vh">www.hypercomb.com</div>`,
        say: `So undo isn't a trick — it's just reading an older layer. The past is always one signature away, and it never rots.` },
    ],
  },
  {
    id: 'open-source', scene: 15,
    title: 'Open source, as a promise',
    copy: `Hypercomb is AGPL, the documentation is Creative Commons, and every module carries a signature — so a fork is verifiable. You can prove exactly what you are running, byte for byte.

If it ever goes in a direction you don't like, you can take it in yours. And your hive still opens.

That is what open has to mean.`,
    beats: [
      { kind: 'still', body: `<div class="eyebrow">an open platform</div><h1><b>Open source</b>, as a promise.</h1>
          <div class="hexrow">
            <div class="hexb"><span class="g">⌘</span><span class="t">AGPL-3.0</span></div>
            <div class="hexb"><span class="g">✎</span><span class="t">CC BY-SA</span></div>
            <div class="hexb"><span class="g">⑂</span><span class="t">fork it</span></div>
          </div>`,
        say: `Hypercomb is open source, and here that's a promise rather than a marketing line.` },
      { kind: 'clip', clip: 'hive-zoom.mp4',
        say: `Every feature is a signed module, so a fork is verifiable — you can prove exactly what you're running, byte for byte.` },
      { kind: 'still', body: `<div class="eyebrow">yours to take</div><h1>Your hive <b>still opens</b>.</h1>
          <p class="sub">If the project goes somewhere you don't like, you can take it somewhere you do.</p>
          <div class="golink" style="margin-top:1.5vh">www.hypercomb.com</div>`,
        say: `And if it ever goes in a direction you don't like, you can take it in yours — and your hive still opens.` },
    ],
  },
  {
    id: 'how-to-bee', scene: 24,
    title: 'Type a name. Press Enter.',
    copy: `Creating in Hypercomb is one gesture: type a name, press Enter — that's a tile. Type three more and that's a structure.

And you are not dropped in cold. /help is a curriculum rather than a manual: six gestures to begin with, then the everyday verbs, then the rest when you're ready. Or type /tutorial and a bee flies the whole thing with you.

A new way to be — so here is how to bee.`,
    beats: [
      { kind: 'clip', clip: 'hive-children.mp4',
        say: `Creating is one gesture: type a name, press Enter — that's a tile. Type three more names, and that's a structure.` },
      { kind: 'still', body: `<div class="eyebrow">your first day</div><h1>How to <b>bee</b>.</h1>
          <p class="sub">You are not dropped in cold. Type /help and you get a curriculum, not a manual.</p>
          <div class="golink" style="margin-top:1.5vh">www.hypercomb.com</div>`,
        say: `And you're not dropped in cold — slash help is a curriculum, not a manual, and slash tutorial flies a bee through it with you. Hypercomb. The hive is yours.` },
    ],
  },
]

// ---------- narration --------------------------------------------------------
const hashOf = say => crypto.createHash('sha256').update(`${VOICE}|${RATE}|${say}`).digest('hex').slice(0, 16)
const audioPath = say => path.join(CACHE, hashOf(say) + '.mp3')

async function ensureAudio(beats) {
  const stale = beats.filter(b => !fs.existsSync(audioPath(b.say)))
  if (!stale.length) return
  const { MsEdgeTTS, OUTPUT_FORMAT, ProsodyOptions } = require('msedge-tts')
  for (const b of stale) {
    const tts = new MsEdgeTTS()
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    const pros = new ProsodyOptions(); pros.rate = RATE
    const { audioStream } = await tts.toStream(b.say, pros)
    const chunks = []
    await new Promise((res, rej) => { audioStream.on('data', c => chunks.push(c)); audioStream.on('end', res); audioStream.on('error', rej) })
    fs.writeFileSync(audioPath(b.say), Buffer.concat(chunks))
    tts.close()
  }
}

// ---------- frames -----------------------------------------------------------
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const pageFor = (b, captionOnly) => `<meta charset="utf-8"><style>${STYLE}
  html,body{width:${W}px;height:${H}px;overflow:hidden}
  html,body{background:${captionOnly ? 'transparent !important' : 'var(--bg)'}}
  #comb{opacity:${captionOnly ? 0 : 0.5};animation:none}
  .frame{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:22px;padding:64px 90px 210px;text-align:center}
  .frame h1{font-weight:200;font-size:70px;line-height:1.05;margin:0;letter-spacing:-.01em;text-wrap:balance}
  .frame h1 b{font-weight:600;color:var(--honey)}
  .frame .sub{color:var(--dim);font-weight:300;font-size:23px;max-width:58ch;margin:0;text-wrap:balance}
  .frame .eyebrow{font-size:13px} .frame .sig{font-size:12px}
  .frame .lay{width:560px;font-size:14px} .frame .hexb{width:150px}
  #cap{position:fixed;left:50%;bottom:44px;transform:translateX(-50%);width:1040px;text-align:center;
    color:var(--ink);font-weight:400;font-size:25px;line-height:1.45;
    background:rgba(9,12,18,.86);border:1px solid var(--line);border-radius:12px;padding:20px 26px}
  .golink{border-color:var(--honey-deep);color:var(--honey);font-size:15px}
</style>
${captionOnly ? '' : `<svg id="comb"><defs>
  <pattern id="hexp" width="56" height="97" patternUnits="userSpaceOnUse" patternTransform="scale(1.6)">
    <polygon points="28,0 56,16.2 56,48.5 28,64.7 0,48.5 0,16.2" fill="none" stroke="#141d2b" stroke-width="1"/>
    <polygon points="28,0 56,16.2 56,48.5 28,64.7 0,48.5 0,16.2" fill="none" stroke="#141d2b" stroke-width="1" transform="translate(28,48.5)"/>
    <polygon points="28,0 56,16.2 56,48.5 28,64.7 0,48.5 0,16.2" fill="none" stroke="#141d2b" stroke-width="1" transform="translate(-28,48.5)"/>
  </pattern></defs><rect width="120%" height="120%" fill="url(#hexp)"/></svg>
<div class="frame">${b.body}</div>`}
<div id="cap">${esc(b.say)}</div>`

function shoot(html, pngName, transparent) {
  const htmlPath = path.join(FRAMES, pngName.replace(/\.png$/, '.html'))
  fs.writeFileSync(htmlPath, html)
  const png = path.join(FRAMES, pngName)
  try { fs.unlinkSync(png) } catch {}
  execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${W},${H}`,
    ...(transparent ? ['--default-background-color=00000000'] : []),
    `--screenshot=${png}`, `file:///${htmlPath.replace(/\\/g, '/')}`], { stdio: 'ignore' })
  const deadline = Date.now() + 30_000
  let size = -1
  for (;;) {
    if (Date.now() > deadline) throw new Error(`frame never appeared: ${pngName}`)
    let s = -1; try { s = fs.statSync(png).size } catch {}
    if (s > 0 && s === size) break
    size = s
    execFileSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 250'], { stdio: 'ignore' })
  }
  return png
}

const ff = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' })
const durationOf = f => parseFloat(execFileSync('ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim())

// Where each post sends people. LinkedIn only unfurls one link and suppresses
// it entirely when a video is attached, so the link block belongs in the first
// comment — that is what the "first comment" line below is for.
function linksFor(post, pi) {
  const deep = `${SITE}/?scene=${post.scene}`
  const lines = [
    `▸ This bit in full: ${deep}`,
    `▸ The whole presentation (~19 min, narrated): ${SITE}`,
    `▸ Try Hypercomb itself: ${APP}`,
  ]
  if (pi > 0) lines.push(`▸ Start of the series: ${FIRST_POST_URL}`)
  return lines
}

;(async () => {
  const copyOnly = process.argv.includes('--copy-only')
  const md = ['# Post series — one idea, one clip, one link', '',
    'Each post is a standalone MP4 with the narration burned in (feeds autoplay muted).',
    'Every link drops the viewer at that idea inside the full presentation.', '',
    '**Posting note.** Attach the MP4 to the post and put the link block in the',
    'FIRST COMMENT — LinkedIn suppresses link previews on video posts and damps',
    'reach on posts with outbound links in the body. Once post 1 is live, put its',
    'URL in `FIRST_POST_URL` and re-run `node posts.cjs --copy-only` so every later',
    'post links back to the start.', '',
    '---', '',
    '## 0. The hub post — the series in one place', '',
    `**video:** \`teaser/hypercomb-teaser.mp4\` · 38s`, '',
    'I built a thing and then I built the tour of it.',
    '',
    'Hypercomb is an open software platform where your work lives on a hexagonal',
    'grid on your own machine. No server. No account. Presence is permission —',
    'your work is here because you are.',
    '',
    'Rather than write a manifesto, I recorded the whole thing live from a real',
    'hive and narrated it. Nineteen minutes, twenty-four scenes, three acts: what',
    'it is, why you would want it, and where it goes next.',
    '',
    'Over the next while I\'ll post one idea at a time. Each one links to its own',
    'moment in the full piece, so you can go as deep as you like:',
    '',
    ...POSTS.map(p => `▸ ${p.title} — ${SITE}/?scene=${p.scene}`),
    '',
    `▸ The whole presentation: ${SITE}`,
    `▸ Hypercomb itself: ${APP}`,
    '',
    '---', '']
  for (const [pi, post] of POSTS.entries()) {
    if (!copyOnly) await ensureAudio(post.beats)
    const segs = []
    if (!copyOnly) post.beats.forEach((b, i) => {
      const audio = audioPath(b.say)
      const dur = durationOf(audio) + 0.5
      const seg = path.join(OUT, `.seg-${pi}-${i}.mp4`)
      const fadeOut = Math.max(1, Math.round(dur * 30) - 12)
      if (b.kind === 'still') {
        const png = shoot(pageFor(b, false), `${post.id}-${i}.png`, false)
        ff('-loop', '1', '-i', png, '-i', audio, '-t', String(dur),
           '-vf', `fps=30,format=yuv420p,fade=in:0:12,fade=out:${fadeOut}:12`,
           '-c:v', 'libx264', '-crf', '20', '-preset', 'medium',
           '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-shortest', seg)
      } else {
        const overlay = shoot(pageFor(b, true), `${post.id}-${i}-cap.png`, true)
        ff('-stream_loop', '-1', '-i', path.join(ROOT, 'media', b.clip), '-i', overlay, '-i', audio, '-t', String(dur),
           '-filter_complex',
           `[0:v]fps=30,scale=${W}:-2:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=#0a0e15[bg];` +
           `[bg][1:v]overlay=0:0,format=yuv420p,fade=in:0:12,fade=out:${fadeOut}:12[v]`,
           '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium',
           '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-shortest', seg)
      }
      segs.push(seg)
    })
    const file = path.join(OUT, `${String(pi + 1).padStart(2, '0')}-${post.id}.mp4`)
    if (!copyOnly) {
      const list = path.join(OUT, `.list-${pi}.txt`)
      fs.writeFileSync(list, segs.map(s => `file '${s.replace(/\\/g, '/')}'`).join('\n'))
      ff('-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', file)
      for (const s of segs) { try { fs.unlinkSync(s) } catch {} }
      try { fs.unlinkSync(list) } catch {}
    }
    const dur = fs.existsSync(file) ? durationOf(file) : 0
    console.log(`${path.basename(file)} · ${dur.toFixed(1)}s${copyOnly ? ' (copy only)' : ` · ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`}`)
    md.push(`## ${pi + 1}. ${post.title}`, '',
      `**video:** \`posts/${path.basename(file)}\` · ${dur.toFixed(0)}s`, '',
      post.copy, '',
      '**First comment:**', '', ...linksFor(post, pi), '', '---', '')
  }
  fs.writeFileSync(path.join(OUT, 'posts.md'), md.join('\n'))
  console.log(`\n${path.join(OUT, 'posts.md')}`)
})().catch(e => { console.error('posts failed:', e.message); process.exit(1) })
