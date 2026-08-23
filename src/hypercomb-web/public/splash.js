/* Hypercomb loading page — "Point to Sphere" (pure canvas, zero dependencies).
 *
 * Paints instantly from inside <app-root>, then RE-PARENTS itself to <body> so it
 * survives Angular's bootstrap, and stays up until the hive is ready to show — the
 * first tiles on screen (EffectBus 'render:cell-count' with count>0), OR a genuinely
 * empty layer (count===0 with settled:true — pixi + data were up, the location just
 * has no tiles), OR the install-needed welcome card (boot:status) whose "Start" button
 * the splash must not cover. Then it finishes the animation down to the honey dot,
 * holds ~1s, and fades to reveal the hive. It never blocks on an event that may not
 * fire: an empty page reveals via settled, and after MAXLOOPS (3) plays with no signal
 * it rests on the dot and offers "click to enter" — the user always has a way in.
 * Resting is never a dead stop: the dot dances a faint waggle — the bee's figure-
 * eight — with a breathing glow (position pinned under prefers-reduced-motion).
 *
 * SMOOTHNESS: the animation runs in a dedicated Worker on an OffscreenCanvas when the
 * browser supports it, so main-thread boot work (module parse/exec, pixi warmup, OPFS
 * install) cannot stall or slow the frames. The choreography clock is wall-clock (dt
 * clamped at 0.25s, not 0.05s), so even when frames DO drop the run keeps true pace
 * instead of sliding into slow motion. Fallback chain: no OffscreenCanvas → inline on
 * the element (as before); worker dies after the canvas was transferred (e.g. a CSP
 * that blocks blob: workers) → swap in a fresh canvas and run the same core inline.
 * All DOM policy — ready signals, hidden-tab rules, click-to-enter, the fade — stays
 * on the main thread; the core only animates and reports 'resting' / 'done'.
 * A/B check: load with ?splash=inline to force the inline path.
 *
 * Keep in sync with hypercomb-dev/public/splash.js. The #hc-splash styles live in
 * <head> (index.html) so they persist after we move out of <app-root>.
 *
 * MODEL — ported from the authored design piece ("Point to Sphere", 3 scenes /
 * 5s authored: Inflate 2.2 · Fill 1.95 · Return 0.85). ONE cosine wave over the
 * loop governs every metric — zoom, arrival rate, and the red seam — which is why
 * it reads as a single continuous breath and loops with zero slope at both ends:
 *
 *   • a Fibonacci lattice of N points, ordered by FARTHEST-POINT INSERTION, so
 *     every arriving point lands at the position most distant from all the points
 *     already there — the set is maximally balanced at every single iteration.
 *   • arrivals follow the wave itself (slow open, fastest mid-loop, tapering out),
 *     drawn from its inverse-CDF, while the sphere grows from a point to full size.
 *   • the Return scene zooms back down so the sphere reads solid at exactly the
 *     starting size and position, then fades into a honey dot — which IS the point
 *     the next loop opens from. The seam is red/honey on both sides and cools to
 *     blue as it inflates, so the loop has no visible cut.
 *
 * The whole thing is closed-form in T: there is no simulation, no relaxation pass,
 * no per-frame state. The lattice and its arrival schedule are computed ONCE at
 * construction; every frame is a pure function of the clock. (The previous genesis
 * core ran an O(n²) repulsion solve per frame — this one is strictly cheaper.)
 */
(function () {
  "use strict";
  var splash = document.getElementById('hc-splash');
  var cv = document.getElementById('hc-splash-cv');
  if (!splash || !cv || !cv.getContext) return;
  if (splash.parentNode !== document.body) document.body.appendChild(splash);   // survive bootstrap
  var reduce = false;
  try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var forceInline = false;
  try { forceInline = /[?&]splash=inline\b/.test(location.search); } catch (e) {}

  /* ---- animation core -------------------------------------------------------
   * Self-contained ON PURPOSE: GenesisCore.toString() is shipped into the worker,
   * so it may only touch its parameters and worker-safe globals (Math, performance,
   * requestAnimationFrame). The same function runs inline when there is no worker.
   * Outward through post():
   *   {t:'resting'} — loop cap hit with no ready signal; pinned on the dot, waiting
   *   {t:'done'}    — finishing run reached the dot and held ~1s → reveal the hive
   * Inward through handle():
   *   {t:'size',w,h,dpr} · {t:'exit'} ready → finish + auto-reveal · {t:'rest'}
   *   finish + wait for a click (the 20s wall-clock backstop).
   */
  function GenesisCore(canvas, opts, post) {
    var ctx = canvas.getContext('2d');
    var reduce = !!opts.reduce;

    // ---- authored composition -------------------------------------------------
    // Authored space is the piece's 1920x1080 frame; R/FOV/START_R are in those
    // units and everything scales to the viewport by S (see resize()). Keeping the
    // authored numbers verbatim is what makes this a faithful port rather than a
    // lookalike — the proportions between dot size, sphere radius and perspective
    // are all tuned against R=120.
    var R = 120, FOV = 1600, START_R = 8, DEG = Math.PI / 180;
    var TOTAL = 5.0;                                  // authoredTotal — Inflate 2.2 + Fill 1.95 + Return 0.85
    var CUE_RETURN = 4.15;                            // start of the Return scene (the zoom back down)
    var K = TOTAL / 15;                               // scales the piece's fixed micro-durations with total length
    var BUILD_END = TOTAL - 0.35 * K;                 // last arrival lands; the end fade begins
    var BUILD_SPAN = BUILD_END;                       // CUES.Inflate is 0, so the build spans the whole run
    var FADE = 0.3 * K;                               // dots → honey dot
    var ARRIVE = 0.5 * K;                             // how long one point takes to pop in
    var SEED_GROW = 0.6 * K;                          // the opening point growing out to the sphere
    var SEAM = BUILD_END * 0.18;                      // how long the honey seam takes to cool to blue
    var SPIN = reduce ? 0.12 : 0.35, PITCH = 18 * DEG;
    var N = 260;
    var SPEED = 1.4;                                  // 5s authored → ~3.6s per play, matching the old core's cadence
    var MAXLOOPS = 3;                                 // play at most this many times before offering click-to-enter
    var FIT = 0.225;                                  // sphere's widest radius as a fraction of min(W,H) — clears the title at top:66%
    var TONES = [[116, 157, 196], [148, 188, 227], [89, 128, 166], [181, 217, 253], [242, 242, 243]];
    var GLOW_C = [232, 166, 61];                      // honey-sun the collapse converges to, and the next loop opens from

    function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
    function easeOutCubic(t) { t -= 1; return t * t * t + 1; }
    function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1; }
    function easeInOutSine(t) { return -(Math.cos(Math.PI * t) - 1) / 2; }
    function lerp(a, b, t) { return a + (b - a) * t; }
    // the one wave: zero slope at both ends → seamless loop, creamy zoom
    function wave(t) { return Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * t), 0.7); }
    function rnd(i) { var s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

    // ---- lattice + arrival schedule (computed ONCE) ---------------------------
    // Fibonacci lattice for the positions; farthest-point insertion for the ORDER
    // they arrive in. Cost is O(N²) ≈ 135k ops once at construction, not per frame.
    var UX = new Float64Array(N), UY = new Float64Array(N), UZ = new Float64Array(N);
    var AT = new Float64Array(N), SZ = new Float64Array(N);
    var TONE_R = new Float64Array(N), TONE_G = new Float64Array(N), TONE_B = new Float64Array(N);
    (function buildLattice() {
      var GA = Math.PI * (3 - Math.sqrt(5)), EPS = 0.36, i, c;
      for (i = 0; i < N; i++) {
        var y = 1 - 2 * (i + EPS) / (N - 1 + 2 * EPS);
        var rr = Math.sqrt(Math.max(0, 1 - y * y)), th = i * GA;
        UX[i] = rr * Math.cos(th); UY[i] = y; UZ[i] = rr * Math.sin(th);
      }
      var minD = new Float64Array(N), rank = new Float64Array(N), used = new Uint8Array(N);
      used[0] = 1; rank[0] = 0;
      for (i = 0; i < N; i++) { var dx = UX[i] - UX[0], dy = UY[i] - UY[0], dz = UZ[i] - UZ[0]; minD[i] = dx * dx + dy * dy + dz * dz; }
      for (var step = 1; step < N; step++) {
        var best = -1, bd = -1;
        for (i = 0; i < N; i++) if (!used[i] && minD[i] > bd) { bd = minD[i]; best = i; }
        used[best] = 1; rank[best] = step;
        for (i = 0; i < N; i++) if (!used[i]) {
          var ex = UX[i] - UX[best], ey = UY[i] - UY[best], ez = UZ[i] - UZ[best], d = ex * ex + ey * ey + ez * ez;
          if (d < minD[i]) minD[i] = d;
        }
      }
      // arrivals follow the SAME wave: sample its inverse CDF so the rate IS the
      // zoom curve — slow open, fastest mid-loop, tapering out.
      var M = 512, cum = new Float64Array(M + 1);
      for (c = 1; c <= M; c++) cum[c] = cum[c - 1] + wave((c - 0.5) / M);
      for (c = 1; c <= M; c++) cum[c] /= cum[M];
      for (i = 0; i < N; i++) {
        var f = rank[i] / N, lo = 0, hi = M;
        while (lo < hi) { var mid = (lo + hi) >> 1; if (cum[mid] < f) lo = mid + 1; else hi = mid; }
        AT[i] = (lo / M) * 0.97;
        // normal size shrinks as the sphere fills; each point a random size below it
        SZ[i] = lerp(6, 2.6, AT[i]) * (0.45 + 0.55 * rnd(i));
        var tn = TONES[Math.floor(rnd(i + 7) * TONES.length)];
        TONE_R[i] = tn[0]; TONE_G[i] = tn[1]; TONE_B[i] = tn[2];
      }
    })();

    // per-frame scratch, preallocated — the frame path allocates nothing
    var PX = new Float64Array(N), PY = new Float64Array(N), PR = new Float64Array(N), PZ = new Float64Array(N);
    var PC = new Array(N), ORDER = new Array(N);
    for (var _i = 0; _i < N; _i++) { PC[_i] = ''; ORDER[_i] = _i; }
    function byDepth(a, b) { return PZ[b] - PZ[a]; }   // far side first — painter's order

    // ---- timeline -------------------------------------------------------------
    var nowSec = 0, loops = 0, finishing = false, awaitEnter = false;
    var dotReal = 0, restSent = false, doneSent = false;
    var waggleT = 0;                                      // real seconds resting on the dot — drives the waggle dance

    function timeline(dt, realDt) {
      nowSec += dt;
      if (finishing && nowSec >= TOTAL) {                 // the finishing run has reached the honey dot
        nowSec = TOTAL;                                   // pin on the dot — but it rests DANCING, never dead (see the waggle in render())
        waggleT += realDt;
        if (awaitEnter) { if (!restSent) { restSent = true; post({ t: 'resting' }); } }   // cap hit with no ready signal → rest here, wait for a click
        else { dotReal += realDt; if (dotReal >= 1.0 && !doneSent) { doneSent = true; post({ t: 'done' }); } }   // real signal → hold ~1s, then hand off to the hive
      } else if (nowSec >= TOTAL) {
        if (++loops >= MAXLOOPS) { finishing = true; awaitEnter = true; nowSec = TOTAL; }   // played MAXLOOPS times, still no ready signal → rest on the dot
        else nowSec -= TOTAL;                             // the loop is seamless: dot out, dot in
      }
    }

    // ---- render ---------------------------------------------------------------
    var W = 0, H = 0, S = 1, cx = 0, cy = 0;
    function resize() {
      cx = W / 2;
      cy = H * 0.46 - 10;                                  // sphere a touch above centre; the title (index.html #hc-splash .m, top:66%) hugs beneath it — the pair balanced as one vertically-centred group
      S = Math.min(W, H) * FIT / (R * 1.08 * 1.08);        // 1.08 zoom peak × 1.08 perspective peak = the widest the sphere ever gets
    }

    function render() {
      ctx.clearRect(0, 0, W, H);
      var T = nowSec;
      var fallP = easeInOutSine(clamp01((T - CUE_RETURN) / (BUILD_END - CUE_RETURN)));
      var endFade = clamp01((T - BUILD_END) / FADE);
      // red at the seam on both sides: ends red, opens red, cools as it inflates
      var redP = Math.max(fallP, 1 - easeInOutSine(clamp01(T / SEAM)));
      var zoom = START_R / R + (1.08 - START_R / R) * wave(clamp01(T / TOTAL));
      var yaw = SPIN * T;
      var cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(PITCH), sp = Math.sin(PITCH);
      var seedGrow = easeInOutCubic(clamp01(T / SEED_GROW));
      var shrink = 1 - 0.2 * fallP, i, vn = 0;

      for (i = 0; i < N; i++) {
        var at = AT[i];
        var ap = clamp01((T - at * BUILD_SPAN) / ARRIVE);
        if (ap <= 0 && at > 0) continue;                   // not born yet
        var grow = at === 0 ? seedGrow : easeOutCubic(ap);
        var vx = UX[i] * R * grow, vy = UY[i] * R * grow, vz = UZ[i] * R * grow;
        var x1 = vx * cyw + vz * syw, z1 = -vx * syw + vz * cyw;
        var y2 = vy * cp - z1 * sp, z2 = vy * sp + z1 * cp;
        var sc = FOV / (FOV + z2);
        // the opening point starts at START_R and settles to its own size
        var r0 = at === 0 ? lerp(START_R, SZ[i], clamp01(T / SEED_GROW)) : SZ[i];
        var k = vn++;
        PX[k] = cx + x1 * sc * zoom * S;
        PY[k] = cy + y2 * sc * zoom * S;
        PR[k] = Math.max(0.05, r0 * sc * shrink * S);
        PZ[k] = z2;
        PC[k] = redP > 0.001
          ? 'rgb(' + Math.round(lerp(TONE_R[i], GLOW_C[0], redP)) + ',' + Math.round(lerp(TONE_G[i], GLOW_C[1], redP)) + ',' + Math.round(lerp(TONE_B[i], GLOW_C[2], redP)) + ')'
          : 'rgb(' + TONE_R[i] + ',' + TONE_G[i] + ',' + TONE_B[i] + ')';
      }

      if (ORDER.length !== vn) ORDER.length = vn;
      for (i = 0; i < vn; i++) ORDER[i] = i;
      ORDER.sort(byDepth);

      ctx.globalAlpha = 1 - endFade;
      // The piece's redglow filter is feGaussianBlur merged twice under the source.
      // A shadowBlur per circle would cost 260 blurred fills a frame; an additive
      // oversized pass underneath reads the same and is a plain fill.
      if (redP > 0.02) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (1 - endFade) * 0.11 * redP;
        var spread = 1 + 2.4 * redP;
        for (i = 0; i < vn; i++) {
          var g = ORDER[i];
          ctx.beginPath(); ctx.arc(PX[g], PY[g], PR[g] * spread, 0, 6.2832);
          ctx.fillStyle = PC[g]; ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1 - endFade;
      }
      for (i = 0; i < vn; i++) {
        var d = ORDER[i];
        ctx.beginPath(); ctx.arc(PX[d], PY[d], PR[d], 0, 6.2832);
        ctx.fillStyle = PC[d]; ctx.fill();
      }

      // the honey dot the run converges to — and the point the next loop opens from.
      // WAGGLE DANCE: pinned at TOTAL the dot never turns into a stopped object — it
      // dances the bee's figure-eight, ever so slightly, glow breathing. waggleT only
      // accrues while finishing rests on the dot, so the mid-loop seams (where the dot
      // also shows) stay perfectly still and the loop keeps its zero-slope seam.
      if (endFade > 0) {
        var dr = START_R * S;
        var wx = cx, wy = cy, wg = 0;
        if (waggleT > 0) {
          var wIn = easeInOutSine(clamp01(waggleT / 1.6));            // settle into the dance — no jump off the convergence
          var wt = waggleT * 1.7;                                     // dance tempo: one figure-eight ≈ 3.7s
          wg = wIn * (0.5 - 0.5 * Math.cos(wt * 0.83));               // the glow breath, from 0 so nothing pops
          if (!reduce) {                                              // reduced motion: the glow may breathe, the dot holds still
            var amp = dr * 0.5 * wIn;
            wx += (Math.sin(wt) + 0.14 * Math.sin(wt * 4.7)) * amp;   // the figure-eight run + the waggle tremor along it
            wy += Math.sin(wt * 2) * amp * 0.45;                      // half-height lobes — an ∞ lying on its side
          }
        }
        ctx.globalAlpha = endFade;
        var glowR = dr * (4 + 1.1 * wg);
        var gr = ctx.createRadialGradient(wx, wy, 0, wx, wy, glowR);
        gr.addColorStop(0, 'rgba(232,166,61,' + (0.55 + 0.13 * wg).toFixed(3) + ')');
        gr.addColorStop(1, 'rgba(232,166,61,0)');
        ctx.beginPath(); ctx.arc(wx, wy, glowR, 0, 6.2832); ctx.fillStyle = gr; ctx.fill();
        ctx.beginPath(); ctx.arc(wx, wy, dr * (1 + 0.05 * wg), 0, 6.2832); ctx.fillStyle = 'rgb(232,166,61)'; ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Wall-clock choreography: the clamp only guards against a monster lurch after a
    // long stall, and is generous (0.25s) so dropped frames DON'T stretch the run into
    // slow motion — a 0.05s cap would make 10fps play at ~half speed, which reads as
    // "the animation slowed down" whenever boot work contends for the thread.
    var raf = 0, stopped = false, last = 0;
    var rafFn = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
    var cancelFn = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;
    function frame(now) {
      if (stopped || (opts.alive && !opts.alive())) return;
      var realDt = Math.min(0.25, (now - last) / 1000); last = now;
      timeline(realDt * SPEED, realDt); render();
      raf = rafFn(frame);
    }
    function handle(m) {
      if (!m) return;
      if (m.t === 'size') { W = m.w; H = m.h; canvas.width = Math.round(W * m.dpr); canvas.height = Math.round(H * m.dpr); ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0); resize(); }
      else if (m.t === 'exit') { finishing = true; awaitEnter = false; }
      else if (m.t === 'rest') { finishing = true; awaitEnter = true; }
    }
    function start() { last = performance.now(); raf = rafFn(frame); }
    function stop() { stopped = true; cancelFn(raf); }
    return { start: start, stop: stop, handle: handle };
  }

  // ---- main-thread side: where the core runs, and the DOM policy around it ----
  var mode = 'inline', worker = null, core = null;
  var dismissed = false, readySeen = false, awaitEnter = false, enterHint = null;

  function measure() { return { t: 'size', w: cv.clientWidth || window.innerWidth, h: cv.clientHeight || window.innerHeight, dpr: Math.min(2, window.devicePixelRatio || 1) }; }
  function coreSend(m) { if (worker) worker.postMessage(m); else if (core) core.handle(m); }
  function onCoreMsg(m) {
    if (!m || dismissed) return;
    if (m.t === 'resting') { awaitEnter = true; showEnter(); }   // loop cap on the dot → offer a way in
    else if (m.t === 'done') dismiss();                          // finished + held ~1s → reveal the hive
  }
  function startInline() {
    core = GenesisCore(cv, { reduce: reduce, alive: function () { return splash.isConnected; } }, onCoreMsg);
    core.handle(measure());
    core.start();
  }
  // The worker died AFTER the canvas gave up its context (transferControlToOffscreen is
  // irreversible — e.g. a CSP that blocks blob: workers errors the worker async): swap
  // in a fresh canvas and run the same core inline. Idempotent — onerror may repeat.
  function rescueInline() {
    if (dismissed || core) return;
    try { if (worker) worker.terminate(); } catch (e) {}
    worker = null;
    var fresh = cv.cloneNode(false);
    if (cv.parentNode) cv.parentNode.replaceChild(fresh, cv);
    cv = fresh;
    mode = 'inline-rescue'; splash.dataset.mode = mode;
    startInline();
  }
  function startWorker() {
    if (forceInline || typeof Worker !== 'function' || typeof OffscreenCanvas === 'undefined' || !cv.transferControlToOffscreen) return false;
    var off = null;
    try {
      var boot = 'var core=null,post=function(m){self.postMessage(m)};' + GenesisCore.toString() +
        ';self.onmessage=function(e){var m=e.data;if(m.t==="init"){core=GenesisCore(m.canvas,{reduce:m.reduce},post);core.handle(m.size);core.start();}else if(core)core.handle(m);};';
      worker = new Worker(URL.createObjectURL(new Blob([boot], { type: 'text/javascript' })));
      worker.onmessage = function (e) { onCoreMsg(e.data); };
      worker.onerror = function () { rescueInline(); };
      off = cv.transferControlToOffscreen();
      worker.postMessage({ t: 'init', canvas: off, reduce: reduce, size: measure() }, [off]);
      mode = 'worker';
      return true;
    } catch (e) {
      try { if (worker) worker.terminate(); } catch (e2) {}
      worker = null;
      if (off) { rescueInline(); return true; }   // context already transferred — inline needs the fresh canvas
      return false;
    }
  }
  function unplug() {
    try { if (worker) worker.terminate(); } catch (e) {}
    worker = null;
    if (core) { core.stop(); core = null; }
  }

  // ---- dismissal: wait for real tiles, finish down to the dot, then fade to the hive ----
  // 'exit' → core finishes + auto-reveals ('done'). 'rest' → core finishes + waits.
  // awaitEnter here gates the click/key entry; readySeen means a real ready signal
  // arrived (regardless of animation state).
  // HIDDEN-TAB RULE: the finishing run and the rAF-deferred dismiss ride frames,
  // which are PARKED in a hidden tab (worker rAF included — no compositor, no
  // frames) — a backgrounded boot would strand the splash over a fully-ready hive
  // (observed 2026-07-16 on a driver tab). Nobody is watching the animation in a
  // hidden tab, so reveal immediately instead of waiting on frames.
  function requestExit() {
    readySeen = true;
    if (document.hidden) { dismiss(); return; }
    awaitEnter = false;                                         // a real ready signal wins over click-to-enter
    coreSend({ t: 'exit' });
  }
  function dismiss() {
    if (dismissed) return; dismissed = true;
    if (document.hidden) {                                      // frames are parked — remove now, no fade (it isn't visible)
      unplug();
      if (splash.parentNode) splash.parentNode.removeChild(splash);
      return;
    }
    requestAnimationFrame(function () {                         // let the tile frame flip to pixels first
      splash.style.transition = 'opacity .45s ease';
      splash.style.opacity = '0';
      setTimeout(function () { unplug(); if (splash.parentNode) splash.parentNode.removeChild(splash); }, 520);
    });
  }
  // Tab hidden after the ready signal landed mid-animation: the finishing run
  // can no longer advance (frames parked) — reveal so the hive is there on return.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && readySeen && !dismissed) dismiss();
  });
  // WALL-CLOCK BACKSTOP (frame-independent): the 3-play cap only accrues while
  // frames run, so a hidden/throttled boot could outlive it indefinitely.
  // After 20s real time: ready → reveal; not ready → rest on click-to-enter
  // (built directly in the DOM — no frame needed) so there is ALWAYS a way in.
  setTimeout(function () {
    if (dismissed) return;
    if (readySeen) { dismiss(); return; }
    awaitEnter = true;
    coreSend({ t: 'rest' });
    showEnter();
  }, 20000);
  // After MAXLOOPS plays with no ready signal, the core rests on the solid dot and we
  // offer a way in instead of looping forever OR auto-revealing a not-yet-ready hive.
  // A click anywhere or any keypress enters. Built once (idempotent).
  function showEnter() {
    if (enterHint) return;
    splash.style.cursor = 'pointer';
    enterHint = document.createElement('div');
    enterHint.textContent = 'click to enter';
    enterHint.setAttribute('style',
      'position:absolute;left:0;right:0;top:calc(66% + 76px);text-align:center;pointer-events:none;' +
      'user-select:none;color:#8ea0b4;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;' +
      'font-size:11px;letter-spacing:.42em;text-indent:.42em;text-transform:uppercase;opacity:0;transition:opacity .8s ease');
    splash.appendChild(enterHint);
    requestAnimationFrame(function () { if (enterHint) enterHint.style.opacity = '0.6'; });
  }
  function enterNow() { if (awaitEnter && !dismissed) dismiss(); }   // click/key only bites once we're resting on the dot
  splash.addEventListener('click', enterNow);
  window.addEventListener('keydown', function (e) { if (awaitEnter && !dismissed) { e.preventDefault(); dismiss(); } });

  // ---- start the core (worker when possible), then subscribe for ready signals ----
  window.addEventListener('resize', function () { if (!dismissed) coreSend(measure()); });
  if (!startWorker()) startInline();
  splash.dataset.mode = mode;
  try { console.debug('[hc-splash] mode: ' + mode); } catch (e) {}

  (function waitBus() {
    if (dismissed) return;
    var bus = window.__hypercombEffectBus;
    if (bus && bus.on) {
      // Reveal the hive when the renderer reports it is ready. Two ready shapes:
      //   • count > 0             — real tiles are on screen.
      //   • count === 0 && settled — a GENUINELY empty layer (pixi + data were up,
      //     the location simply has no tiles). Without the settled case an empty
      //     tile page would just loop the animation until the 3-play cap drops it
      //     to click-to-enter — settled reveals it promptly instead.
      // A count:0 WITHOUT settled is a not-ready transient (pixi still warming —
      // clearMesh's early "not ready" bails) and is IGNORED, so a populated hive
      // never flashes an empty canvas before its tiles paint.
      bus.on('render:cell-count', function (pl) { if (pl && (pl.count > 0 || pl.settled)) requestExit(); });
      // A location that OPENS AS a view (its layer carries a view:default
      // mark): the hexagons are deliberately never painted, so the
      // cell-count signal above will not fire — the arrival verdict IS the
      // ready signal. An empty view means "opens as hexagons after all";
      // only a real view name reveals. (EffectBus replays the last value,
      // so a verdict emitted before this subscription still lands.)
      bus.on('view:arrival', function (p) { if (p && p.view) requestExit(); });
      bus.on('render:unsupported', function () { dismiss(); });                                 // GPU blocked → tiles never paint
      // install-needed → the welcome card's "Start" button is behind the splash.
      // Reveal it NOW so the user can click Start to load the libraries. Holding
      // the splash here is a hard deadlock: no Start → no libraries → no hive.
      bus.on('boot:status', function (s) { if (s && s.kind === 'install-needed') dismiss(); });
      // Same rule for the first-boot EXAMPLE HIVES offer: its buttons sit behind
      // the splash, and an empty root may never produce a ready signal the splash
      // trusts — so it rested on the dot with the offer unreachable underneath.
      bus.on('examples:offer', function (o) { if (o && o.active && (o.examples || []).length) dismiss(); });
    } else { setTimeout(waitBus, 250); }   // TIMER, not rAF: a hidden tab parks rAF, so an rAF retry never subscribes at all — the splash would go deaf to every ready signal (incl. the last-value replay)
  })();
  // No blind auto-hide timer: the 3-play cap is the terminal fallback — it rests on
  // the dot and shows "click to enter" so we never reveal a not-ready hive on a
  // timer, and the user always has a guaranteed way in.
})();
