// Cut a short MP4 teaser for social from the same parts as the full piece.
//
// LinkedIn will not host an interactive page, and it autoplays muted — so this
// renders a real video with the narration burned in as captions. Frames come
// from the actual design (headless Edge at 1280x720), and the product beats use
// the real hive captures, not a re-enactment.
//
//   node scripts/presentation/teaser.cjs
//   → teaser/hypercomb-teaser.mp4
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

const ROOT = __dirname
const OUT = path.join(ROOT, 'teaser')
const FRAMES = path.join(OUT, 'frames')
const CACHE = path.join(OUT, 'audio')
const VOICE = 'en-US-AndrewMultilingualNeural'
const RATE = '+2%'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const W = 1280, H = 720

for (const d of [OUT, FRAMES, CACHE]) fs.mkdirSync(d, { recursive: true })

// the shell's design tokens, lifted from the real template so the teaser cannot drift
const shell = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8')
const STYLE = (shell.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || ''

const BEATS = [
  { id: 'open', kind: 'still',
    body: `<div class="eyebrow">hypercomb</div><h1>A new way to <b>bee</b>.</h1>
           <p class="sub">Not a new place to keep your work — a different way of being present with it.</p>`,
    say: `Hypercomb. A new way to be.` },

  { id: 'hive', kind: 'clip', clip: 'hive-navigate.mp4',
    say: `Your work lives on a grid of hexagons, on your own machine. Click a tile and you travel into it.` },

  { id: 'presence', kind: 'still',
    body: `<div class="eyebrow">no server, no account</div><h1><b>Presence</b> is permission.</h1>
           <p class="sub">It runs entirely in your browser. Publishing is optional, and explicit.</p>`,
    say: `There is no server and no account. It runs in your browser, and nothing leaves until you say so.` },

  { id: 'signature', kind: 'still',
    body: `<div class="eyebrow">one kind of name</div><h1>Everything is a <b>signature</b>.</h1>
           <div class="sig">sign(content) → <em>e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</em></div>
           <p class="sub">Same content, same name, on every machine, forever. Verify instead of trust.</p>`,
    say: `Everything has one kind of name: a signature, computed from the content itself. Same content, same name, on every machine. You verify instead of trusting.` },

  { id: 'open-source', kind: 'still',
    body: `<div class="eyebrow">an open platform</div><h1><b>Open source</b>, and yours to fork.</h1>
           <p class="sub">Every feature is a signed module. Every fork is verifiable.</p>`,
    say: `It is open source, and every feature is a signed module — so a fork is something you can prove.` },

  { id: 'close', kind: 'still',
    body: `<div class="eyebrow">your first day</div><h1>How to <b>bee</b>.</h1>
           <p class="sub">Type a name. Press Enter. You have a hive.</p>
           <div class="golink" style="margin-top:1.5vh">hypercomb.io</div>`,
    say: `Type a name, press Enter, and you have a hive. Hypercomb — the hive is yours.` },
]

// ---------- narration (cached by the words, same rule as the full build) ------
const hashOf = say => crypto.createHash('sha256').update(`${VOICE}|${RATE}|${say}`).digest('hex').slice(0, 16)
const audioPath = b => path.join(CACHE, hashOf(b.say) + '.mp3')

async function ensureAudio() {
  const stale = BEATS.filter(b => !fs.existsSync(audioPath(b)))
  if (!stale.length) return
  const { MsEdgeTTS, OUTPUT_FORMAT, ProsodyOptions } = require('msedge-tts')
  for (const b of stale) {
    const tts = new MsEdgeTTS()
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    const pros = new ProsodyOptions(); pros.rate = RATE
    const { audioStream } = await tts.toStream(b.say, pros)
    const chunks = []
    await new Promise((res, rej) => { audioStream.on('data', c => chunks.push(c)); audioStream.on('end', res); audioStream.on('error', rej) })
    fs.writeFileSync(audioPath(b), Buffer.concat(chunks))
    tts.close()
    console.log(`  voiced: ${b.id}`)
  }
}

// ---------- frames -----------------------------------------------------------
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function pageFor(b, { captionOnly }) {
  const caption = `<div id="cap">${esc(b.say)}</div>`
  return `<meta charset="utf-8"><style>${STYLE}
    html,body{width:${W}px;height:${H}px;overflow:hidden}
    /* the shell paints html AND body — both must go transparent or the overlay
       becomes an opaque card that hides the footage underneath it */
    html,body{background:${captionOnly ? 'transparent !important' : 'var(--bg)'}}
    #comb{opacity:${captionOnly ? 0 : 0.5};animation:none}
    .frame{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
      gap:22px;padding:64px 90px 210px;text-align:center}
    .frame h1{font-weight:200;font-size:74px;line-height:1.04;margin:0;letter-spacing:-.01em;text-wrap:balance}
    .frame h1 b{font-weight:600;color:var(--honey)}
    .frame .sub{color:var(--dim);font-weight:300;font-size:23px;max-width:60ch;margin:0;text-wrap:balance}
    .frame .eyebrow{font-size:13px}
    .frame .sig{font-size:12px}
    #cap{position:fixed;left:50%;bottom:44px;transform:translateX(-50%);width:1040px;text-align:center;
      color:var(--ink);font-weight:400;font-size:25px;line-height:1.45;
      background:rgba(255,255,255,.94);border:1px solid var(--line);border-radius:12px;padding:20px 26px}
    .golink{border-color:var(--honey-deep);color:var(--honey);font-size:15px}
  </style>
  ${captionOnly ? '' : `<svg id="comb"><defs>
    <pattern id="hexp" width="56" height="97" patternUnits="userSpaceOnUse" patternTransform="scale(1.6)">
      <polygon points="28,0 56,16.2 56,48.5 28,64.7 0,48.5 0,16.2" fill="none" stroke="var(--hexline)" stroke-width="1"/>
      <polygon points="28,0 56,16.2 56,48.5 28,64.7 0,48.5 0,16.2" fill="none" stroke="var(--hexline)" stroke-width="1" transform="translate(28,48.5)"/>
      <polygon points="28,0 56,16.2 56,48.5 28,64.7 0,48.5 0,16.2" fill="none" stroke="var(--hexline)" stroke-width="1" transform="translate(-28,48.5)"/>
    </pattern></defs><rect width="120%" height="120%" fill="url(#hexp)"/></svg>
  <div class="frame">${b.body}</div>`}
  ${caption}`
}

function shoot(html, pngName, transparent) {
  const htmlPath = path.join(FRAMES, pngName.replace(/\.png$/, '.html'))
  fs.writeFileSync(htmlPath, html)
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${W},${H}`,
    ...(transparent ? ['--default-background-color=00000000'] : []),
    `--screenshot=${path.join(FRAMES, pngName)}`, `file:///${htmlPath.replace(/\\/g, '/')}`]
  const png = path.join(FRAMES, pngName)
  try { fs.unlinkSync(png) } catch {}
  execFileSync(EDGE, args, { stdio: 'ignore' })
  // headless Edge returns before the file has finished landing — wait for it
  const deadline = Date.now() + 30_000
  let size = -1
  for (;;) {
    if (Date.now() > deadline) throw new Error(`frame never appeared: ${pngName}`)
    let s = -1
    try { s = fs.statSync(png).size } catch {}
    if (s > 0 && s === size) break      // present and no longer growing
    size = s
    execFileSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 250'], { stdio: 'ignore' })
  }
  return png
}

// ---------- assemble ---------------------------------------------------------
const ff = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' })
const durationOf = f => parseFloat(execFileSync('ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim())

;(async () => {
  console.log('voicing…'); await ensureAudio()
  console.log('rendering frames…')
  const segs = []
  BEATS.forEach((b, i) => {
    const audio = audioPath(b)
    const dur = durationOf(audio) + 0.5   // a beat of air after each line
    const seg = path.join(OUT, `seg-${String(i).padStart(2, '0')}.mp4`)
    if (b.kind === 'still') {
      const png = shoot(pageFor(b, { captionOnly: false }), `${b.id}.png`, false)
      ff('-loop', '1', '-i', png, '-i', audio, '-t', String(dur),
         '-vf', `fps=30,format=yuv420p,fade=in:0:12,fade=out:${Math.round(dur * 30) - 12}:12`,
         '-c:v', 'libx264', '-crf', '20', '-preset', 'medium',
         '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-shortest', seg)
    } else {
      const overlay = shoot(pageFor(b, { captionOnly: true }), `${b.id}-cap.png`, true)
      const clip = path.join(ROOT, 'media', b.clip)
      ff('-stream_loop', '-1', '-i', clip, '-i', overlay, '-i', audio, '-t', String(dur),
         '-filter_complex',
         `[0:v]fps=30,scale=${W}:-2:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=white[bg];` +
         `[bg][1:v]overlay=0:0,format=yuv420p,fade=in:0:12,fade=out:${Math.round(dur * 30) - 12}:12[v]`,
         '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium',
         '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-shortest', seg)
    }
    segs.push(seg)
    console.log(`  ${b.id}: ${dur.toFixed(1)}s`)
  })

  const list = path.join(OUT, 'segments.txt')
  fs.writeFileSync(list, segs.map(s => `file '${s.replace(/\\/g, '/')}'`).join('\n'))
  const final = path.join(OUT, 'hypercomb-teaser.mp4')
  ff('-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', final)
  const total = durationOf(final)
  console.log(`\n${final}\n${total.toFixed(1)}s · ${(fs.statSync(final).size / 1e6).toFixed(1)} MB · ${W}x${H} · H.264/AAC`)
  if (total > 600) console.log('note: over 10 minutes — check the platform limit')
})().catch(e => { console.error('teaser failed:', e.message); process.exit(1) })
