// A teleprompter that keeps time.
//
// `record.cjs --script` prints the lines to read. This prints them at the SPEED
// they are read: each word lights as it is due, so reading with the light puts
// a take within a beat of the length the build expects. The pace is guidance,
// not a contract — every builder re-times its scene to whatever length the take
// actually is, so reading slower makes the scene longer, not the words faster.
//
// It is a plain file. Open it, press space, read. It can also hold the
// microphone for you and hand back a file named the way the loader wants it.
//
//   const { writePrompter } = require('./prompter.cjs')
//   writePrompter({ title, intro, out, lines: [{ name, say, seconds, file, done }] })
const fs = require('fs')
const path = require('path')

const PAUSE = /\[pause(?::(\d+))?\]/g

/** words and holds, each with the second it is due — holds take their own time,
 *  the words share what is left in proportion to how long they take to say */
function schedule(say, seconds) {
  const tokens = []
  let last = 0
  for (const m of say.matchAll(PAUSE)) {
    for (const w of say.slice(last, m.index).split(/\s+/).filter(Boolean)) tokens.push({ w })
    tokens.push({ hold: (Number(m[1]) || 700) / 1000 })
    last = m.index + m[0].length
  }
  for (const w of say.slice(last).split(/\s+/).filter(Boolean)) tokens.push({ w })

  const held = tokens.reduce((t, k) => t + (k.hold || 0), 0)
  const speech = Math.max(seconds - held, 0.5)
  const weigh = w => w.length + 1
    + (/[,;:]$/.test(w) ? 3 : 0) + (/[.!?]["'’]?$/.test(w) ? 6 : 0) + (/[—–]$/.test(w) ? 4 : 0)
  const total = tokens.reduce((t, k) => t + (k.hold ? 0 : weigh(k.w)), 0) || 1

  let at = 0
  return tokens.map(k => {
    const dur = k.hold != null ? k.hold : weigh(k.w) / total * speech
    const cue = { ...k, at, dur }
    at += dur
    return cue
  })
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function writePrompter({ title, intro, out, lines }) {
  const cards = lines.map((l, i) => ({
    i,
    name: l.name,
    file: l.file,
    done: !!l.done,
    seconds: Math.round(l.seconds * 100) / 100,
    cues: schedule(l.say, l.seconds),
  }))

  const html = `<meta charset="utf-8"><title>${esc(title)}</title><style>
  :root{--bg:#0f1115;--ink:#f2efe6;--dim:#8b93a0;--honey:#f2b632;--line:#242a33;--ok:#7bd6a0}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:400 16px/1.5 "Segoe UI",system-ui,sans-serif;
    height:100vh;display:grid;grid-template-rows:auto 1fr auto;overflow:hidden}
  header{padding:16px 5vw 10px;border-bottom:1px solid var(--line);display:flex;gap:18px;align-items:baseline;flex-wrap:wrap}
  h1{margin:0;font-size:17px;font-weight:600}
  .how{color:var(--dim);font-size:13px;max-width:76ch}
  .how b{color:var(--honey);font-weight:600}
  main{position:relative;display:flex;align-items:center;justify-content:center;padding:2vh 6vw;overflow:hidden}
  #line{max-width:26ch;font:300 clamp(30px,4.2vw,60px)/1.4 "Iowan Old Style",Georgia,serif;text-align:left}
  #line span{color:#4a5361;transition:color .12s linear}
  #line span.said{color:var(--ink)}
  #line span.now{color:var(--honey)}
  #line .hold{display:inline-block;margin:0 .25em;padding:0 .4em;border:1px dashed var(--honey);border-radius:6px;
    color:var(--honey);font:600 .32em/1.9 ui-monospace,monospace;letter-spacing:.1em;vertical-align:middle}
  #count{position:absolute;inset:0;display:none;align-items:center;justify-content:center;
    font:200 22vh/1 "Iowan Old Style",Georgia,serif;color:var(--honey);background:rgba(15,17,21,.86)}
  #count.on{display:flex}
  footer{padding:12px 5vw 18px;border-top:1px solid var(--line);display:flex;gap:18px;align-items:center;flex-wrap:wrap;
    font:600 11px/1 ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
  .who{color:var(--honey)} .file{text-transform:none;letter-spacing:.04em}
  .tick{color:var(--ok)}
  #rail{position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--line)}
  #fill{height:100%;width:0;background:var(--honey)}
  button{background:#1a1f27;color:var(--ink);border:1px solid var(--line);border-radius:7px;
    padding:8px 14px;font:600 11px/1 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;cursor:pointer}
  button:hover{border-color:var(--honey)}
  button[disabled]{opacity:.4;cursor:default}
  a.get{color:var(--ok);text-transform:none;letter-spacing:.04em;font-size:12px}
  input[type=range]{width:120px;accent-color:var(--honey)}
  .keys{margin-left:auto;color:#5c6675}
</style>
<header>
  <h1>${esc(title)}</h1>
  <div class="how">${intro}</div>
</header>
<main>
  <div id="line"></div>
  <div id="count"></div>
  <div id="rail"><div id="fill"></div></div>
</main>
<footer>
  <span class="who" id="who"></span>
  <span class="file" id="file"></span>
  <span id="target"></span>
  <button id="go">space — read</button>
  <button id="prev">←</button><button id="next">→</button>
  <label>pace <input type="range" id="pace" min="0.7" max="1.4" step="0.05" value="1"></label>
  <span id="paceval">1.00×</span>
  <button id="mic">hold the mic</button>
  <span id="rec"></span>
  <span class="keys">space start · ← → line · r restart</span>
</footer>
<script>
const LINES = ${JSON.stringify(cards)};
const line = document.getElementById('line'), count = document.getElementById('count');
const fill = document.getElementById('fill');
let i = 0, running = false, t0 = 0, raf = 0, pace = 1;

function paint() {
  const l = LINES[i];
  document.getElementById('who').textContent = l.name;
  document.getElementById('file').textContent = l.file;
  document.getElementById('target').textContent = (l.seconds * pace).toFixed(1) + 's' + (l.done ? '' : '');
  document.getElementById('rec').innerHTML = l.done ? '<span class="tick">take on file</span>' : '';
  line.innerHTML = l.cues.map((c, k) => c.hold != null
    ? '<span data-k="' + k + '" class="hold">hold ' + c.hold.toFixed(1) + 's</span>'
    : '<span data-k="' + k + '">' + c.w.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</span>').join(' ');
  fill.style.width = '0%';
}

function tick() {
  const l = LINES[i], t = (performance.now() - t0) / 1000;
  const span = l.seconds * pace;
  let now = -1;
  for (let k = 0; k < l.cues.length; k++) if (t >= l.cues[k].at * pace) now = k;
  for (const el of line.children) {
    const k = +el.dataset.k;
    el.className = (el.classList.contains('hold') ? 'hold ' : '') + (k < now ? 'said' : k === now ? 'now' : '');
  }
  fill.style.width = Math.min(100, t / span * 100) + '%';
  if (t < span + 0.6) raf = requestAnimationFrame(tick);
  else { running = false; document.getElementById('go').textContent = 'space — read'; }
}

function start() {
  if (running) { cancelAnimationFrame(raf); running = false; stopRec(); document.getElementById('go').textContent = 'space — read'; return; }
  let n = 3;
  count.classList.add('on'); count.textContent = n;
  const id = setInterval(() => {
    if (--n > 0) { count.textContent = n; return; }
    clearInterval(id); count.classList.remove('on');
    startRec(); running = true; t0 = performance.now();
    document.getElementById('go').textContent = 'space — stop';
    raf = requestAnimationFrame(tick);
  }, 800);
}

const go = (d) => { cancelAnimationFrame(raf); running = false; stopRec();
  i = (i + d + LINES.length) % LINES.length; paint(); document.getElementById('go').textContent = 'space — read'; };

document.getElementById('go').onclick = start;
document.getElementById('next').onclick = () => go(1);
document.getElementById('prev').onclick = () => go(-1);
document.getElementById('pace').oninput = e => { pace = +e.target.value;
  document.getElementById('paceval').textContent = pace.toFixed(2) + '×'; paint(); };
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); start(); }
  if (e.key === 'ArrowRight') go(1);
  if (e.key === 'ArrowLeft') go(-1);
  if (e.key === 'r' || e.key === 'R') { cancelAnimationFrame(raf); running = false; stopRec(); paint(); }
});

// --- the microphone, if it will have us -------------------------------------
// Raw is what the mastering chain wants: it has its own de-noise, de-esser and
// two-pass loudness, and browser cleanup only fights it.
let stream = null, recorder = null, chunks = [];
document.getElementById('mic').onclick = async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    document.getElementById('mic').textContent = 'mic held';
    document.getElementById('mic').disabled = true;
  } catch (e) {
    document.getElementById('rec').innerHTML =
      '<span style="color:#e07a5f;text-transform:none;letter-spacing:.04em">no mic (' + e.name +
      ') — record in your own app and save as the filename above</span>';
  }
};
function startRec() {
  if (!stream) return;
  chunks = [];
  recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  recorder.ondataavailable = e => chunks.push(e.data);
  recorder.onstop = () => {
    const l = LINES[i];
    const url = URL.createObjectURL(new Blob(chunks, { type: 'audio/webm' }));
    const name = l.file.replace(/\\.[^.]+$/, '.webm').split('/').pop();
    document.getElementById('rec').innerHTML =
      '<a class="get" href="' + url + '" download="' + name + '">save ' + name + '</a>';
  };
  recorder.start();
}
function stopRec() { if (recorder && recorder.state === 'recording') recorder.stop(); recorder = null; }

paint();
</script>`

  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, html)
  return { file: out, lines: cards.length, seconds: Math.round(cards.reduce((t, c) => t + c.seconds, 0)) }
}

module.exports = { writePrompter, schedule }
