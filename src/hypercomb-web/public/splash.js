/* Hypercomb loading page — genesis animation (pure canvas, zero dependencies).
 *
 * Paints instantly from inside <app-root>, then RE-PARENTS itself to <body> so it
 * survives Angular's bootstrap, and stays up until the hive is ready to show — the
 * first tiles on screen (EffectBus 'render:cell-count' with count>0), OR a genuinely
 * empty layer (count===0 with settled:true — pixi + data were up, the location just
 * has no tiles), OR the install-needed welcome card (boot:status) whose "Start" button
 * the splash must not cover. Then it finishes the animation down to the white dot,
 * holds ~1s, and fades to reveal the hive. It never blocks on an event that may not
 * fire: an empty page reveals via settled, and after MAXLOOPS (3) plays with no signal
 * it rests on the dot and offers "click to enter" — the user always has a way in.
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
 * Model: N points repel on a sphere; the equilibrium for N IS the maximally-spread
 * shape (3→triangle, 4→tetrahedron, 6→octahedron … → sphere). Forward only: dot →
 * line → apex-up triangle → 3D → accelerating fill → dense sphere → collapse straight
 * down to a solid white dot (never fades).
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
    var NMAX = 280, PHI = Math.PI * (3 - Math.sqrt(5)), S3 = Math.sqrt(3) / 2;
    var PIN = { 1: [[0, 0.2571, 0.9664]], 2: [[0, 1, 0], [0, -1, 0]], 3: [[0, 1, 0], [-S3, -0.5, 0], [S3, -0.5, 0]] };
    var BIRTH = { 2: [0, 0.2571, 0.9664], 3: [0, -1, 0] };
    var pts = [], fx = new Float64Array(NMAX), fy = new Float64Array(NMAX), fz = new Float64Array(NMAX);
    var GAIN = 0.02, MAXSTEP = 0.07, ITERS = 10;
    var candX = new Float64Array(128), candY = new Float64Array(128), candZ = new Float64Array(128), minD = new Float64Array(128);

    // Grow to n. Points spawn at the emptiest spot on a 128-slot Fibonacci probe.
    // The whole batch for a frame scores the slots against existing points ONCE
    // (O(128·n)); each birth then refreshes the scores against itself only (O(128)).
    // The old per-point rescan was O(128·n) PER BIRTH and spiked in late fill —
    // ~18 births/frame at n≈280 — exactly while boot has the CPU busiest.
    function setCount(n) {
      if (pts.length > n) { pts.length = n; return; }
      while (pts.length < n && n <= 3) pts.push({ p: (BIRTH[n] || PIN[n][pts.length]).slice(), s: (n === 1 ? 1 : 0) });
      if (pts.length >= n) return;
      var m = pts.length, c, i;
      for (c = 0; c < 128; c++) {
        var y = 1 - (c + 0.5) / 128 * 2, r = Math.sqrt(Math.max(0, 1 - y * y)), t = PHI * c;
        candX[c] = Math.cos(t) * r; candY[c] = Math.sin(t) * r; candZ[c] = y;
        var mn = Infinity;
        for (i = 0; i < m; i++) { var b = pts[i].p, dx = candX[c] - b[0], dy = candY[c] - b[1], dz = candZ[c] - b[2], d = dx * dx + dy * dy + dz * dz; if (d < mn) mn = d; }
        minD[c] = mn;
      }
      while (pts.length < n) {
        var best = -Infinity, bi = 0;
        for (c = 0; c < 128; c++) if (minD[c] > best) { best = minD[c]; bi = c; }
        var px = candX[bi], py = candY[bi], pz = candZ[bi];
        pts.push({ p: [px, py, pz], s: 0 });
        for (c = 0; c < 128; c++) { var ddx = candX[c] - px, ddy = candY[c] - py, ddz = candZ[c] - pz, dd = ddx * ddx + ddy * ddy + ddz * ddz; if (dd < minD[c]) minD[c] = dd; }
      }
    }
    function relax(iters) {
      var n = pts.length; if (n < 2) return;
      for (var it = 0; it < iters; it++) {
        for (var i = 0; i < n; i++) { fx[i] = 0; fy[i] = 0; fz[i] = 0; }
        for (i = 0; i < n; i++) {
          var a = pts[i].p;
          for (var j = i + 1; j < n; j++) {
            var b = pts[j].p, dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2], d2 = dx * dx + dy * dy + dz * dz; if (d2 < 1e-6) d2 = 1e-6;
            var inv = 1 / (d2 * Math.sqrt(d2)); dx *= inv; dy *= inv; dz *= inv;
            fx[i] += dx; fy[i] += dy; fz[i] += dz; fx[j] -= dx; fy[j] -= dy; fz[j] -= dz;
          }
        }
        for (i = 0; i < n; i++) {
          var p = pts[i].p, gx = fx[i], gy = fy[i], gz = fz[i], dot = gx * p[0] + gy * p[1] + gz * p[2];
          gx -= dot * p[0]; gy -= dot * p[1]; gz -= dot * p[2];
          var mL = Math.sqrt(gx * gx + gy * gy + gz * gz);
          if (mL > 1e-9) {
            var k = Math.min(MAXSTEP, mL * GAIN) / mL, nx = p[0] + gx * k, ny = p[1] + gy * k, nz = p[2] + gz * k, L = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            p[0] = nx / L; p[1] = ny / L; p[2] = nz / L;
          }
        }
      }
    }

    // timeline — forward: fill, then collapse straight DOWN to an opaque white dot. Played at 1.25x.
    var HOLD0 = 0.3, STEP_DT = 0.2, STEP_END = HOLD0 + 5 * STEP_DT;
    var BALL_T = 1.5, BALL_END = STEP_END + BALL_T;                 // sphere fully formed
    var COLLAPSE = 0.7, COLLAPSE_END = BALL_END + COLLAPSE;         // shrink down to the white dot
    var DOT_FILL = 0.45, TOTAL = COLLAPSE_END;                      // fill during the end of collapse, then loop directly to the first dot
    var SPIN = 0.45, TILT = 0.26, ZOOM0 = 0.75, ZOOM_STEP = 0.62, ZOOM_MIN = 0.30, ZOOM_DOT = 0.045, SPEED = 1.25;
    function ease(x) { return x * x * (3 - 2 * x); }
    function smooth(a, b, x) { var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
    var lastN = -1, nowSec = 0, zoom = 1, backCull = 0, solidify = 0;   // solidify: 0 everywhere except the end dot, where the small circle fills solid
    var finishing = false, awaitEnter = false, loops = 0, dotReal = 0, restSent = false, doneSent = false;
    var MAXLOOPS = 3;                                               // play the genesis animation at most this many times

    function computeState() {
      var t = nowSec, N;
      if (t < HOLD0) { N = 1; zoom = ZOOM0 - (ZOOM0 - ZOOM_STEP) * ease(t / STEP_END); }
      else if (t < STEP_END) { N = Math.min(6, 2 + Math.floor((t - HOLD0) / STEP_DT)); zoom = ZOOM0 - (ZOOM0 - ZOOM_STEP) * ease(t / STEP_END); }
      else if (t < BALL_END) { var tau = (t - STEP_END) / BALL_T; N = Math.min(NMAX, Math.round(6 * Math.pow(NMAX / 6, tau))); zoom = ZOOM_STEP - (ZOOM_STEP - ZOOM_MIN) * ease(tau); }
      else if (t < COLLAPSE_END) { var r = (t - BALL_END) / COLLAPSE; N = NMAX; zoom = ZOOM_MIN - (ZOOM_MIN - ZOOM_DOT) * ease(r); }
      else { N = NMAX; zoom = ZOOM_DOT; }
      backCull = smooth(8, 34, pts.length);
      if (N !== lastN) { setCount(N); lastN = N; }
    }
    function timeline(dt, realDt) {
      nowSec += dt;
      if (finishing && nowSec >= COLLAPSE_END) {          // the finishing run has reached the white dot
        nowSec = COLLAPSE_END;                            // pin on the dot
        if (awaitEnter) { if (!restSent) { restSent = true; post({ t: 'resting' }); } }   // cap hit with no ready signal → rest here, wait for a click
        else { dotReal += realDt; if (dotReal >= 1.0 && !doneSent) { doneSent = true; post({ t: 'done' }); } }   // real signal → hold ~1s, then hand off to the hive
      } else if (nowSec >= TOTAL) {
        if (++loops >= MAXLOOPS && !finishing) {          // played the animation MAXLOOPS times, still no ready signal:
          finishing = true; awaitEnter = true;            //   finish this run down to the dot and offer click-to-enter
        } else {
          nowSec -= TOTAL; pts = []; lastN = -1; solidify = 0;   // keep looping; start the next run sparse again
        }
      }
      computeState();
      solidify = smooth(COLLAPSE_END - DOT_FILL, COLLAPSE_END, nowSec);   // fill into the solid white dot before the loop resets
    }
    function integrate(dt) {
      var n = pts.length; if (!n) return;
      var kPos = 1 - Math.pow(0.004, dt), kS = 1 - Math.pow(0.0016, dt);
      if (n <= 3 && PIN[n]) {
        var H = PIN[n];
        for (var i = 0; i < n; i++) {
          var p = pts[i].p, h = H[i];
          p[0] += (h[0] - p[0]) * kPos; p[1] += (h[1] - p[1]) * kPos; p[2] += (h[2] - p[2]) * kPos;
          var L = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]) || 1; p[0] /= L; p[1] /= L; p[2] /= L;
        }
        // Dense sphere needs few sweeps per frame — the equilibrium spread is identical,
        // it just settles over a couple more frames. Full ITERS at n=280 burned ~10× the
        // CPU of the whole render for no visible difference.
      } else relax(n > 64 ? Math.max(3, Math.round(640 / n)) : ITERS);
      for (var j = 0; j < pts.length; j++) pts[j].s += (1 - pts[j].s) * kS;
    }

    // render — solid white discs, far side culled once it reads as a solid
    var W = 0, H = 0;
    var proj = []; for (var _i = 0; _i < NMAX; _i++) proj.push({ sx: 0, sy: 0, z: 0, persp: 1, s: 0, front: 1 });

    function render() {
      ctx.clearRect(0, 0, W, H);
      var cx = W / 2, cy = H * 0.46 - 10, R = Math.min(W, H) * 0.30 * zoom;   // up 10px; title (index.html .m) down 10px → +20px gap, group stays centred   // sphere a touch above centre; the title (index.html #hc-splash .m, top:66%) hugs beneath it — the pair balanced as one vertically-centred group
      var yaw = Math.max(0, nowSec - HOLD0) * (reduce ? 0.15 : SPIN);
      var cyw = Math.cos(yaw), syw = Math.sin(yaw), ctl = Math.cos(TILT), stl = Math.sin(TILT), n = pts.length, i;
      for (i = 0; i < n; i++) {
        var p = pts[i].p, q = proj[i];
        var x1 = p[0] * cyw + p[2] * syw, z1 = -p[0] * syw + p[2] * cyw;
        var y2 = p[1] * ctl - z1 * stl, z2 = p[1] * stl + z1 * ctl, persp = 3.2 / (3.2 - z2);
        q.sx = cx + x1 * R * persp; q.sy = cy - y2 * R * persp; q.z = z2; q.persp = persp; q.s = pts[i].s;
        q.front = 1 - backCull + backCull * smooth(-0.05, 0.28, z2);
      }
      // Original sparse render EVERYWHERE; only at the end dot does 'solidify' (see timeline) grow the dots a
      // little — just enough to merge and close the gaps — CLIPPED to the circle so white can never flood past
      // the outline. FILLK = how much the dots grow (bigger = fills sooner, but risks looking flooded).
      var FILLK = 0.07;
      var order = proj.slice(0, n).sort(function (u, v) { return u.z - v.z; });
      var clipped = solidify > 0.01;
      if (clipped) { ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.clip(); }
      for (var k = 0; k < order.length; k++) {
        var o = order[k], vis = o.s * o.front; if (vis <= 0.006) continue;
        var sparse = (n <= 6 ? 7.5 : 3.2) * o.persp * zoom;                     // untouched — how it was before
        var radPx = Math.max(0.8, (sparse + (R * FILLK - sparse) * solidify) * (0.5 + 0.5 * o.s));
        var shade = Math.min(1, Math.max(0, (o.z + 1) * 0.5));
        var a = Math.min(1, ((0.5 + 0.5 * shade) + 0.35 * solidify) * vis);
        ctx.beginPath(); ctx.arc(o.sx, o.sy, radPx, 0, 6.2832); ctx.fillStyle = 'rgba(245,249,252,' + a + ')'; ctx.fill();
      }
      if (clipped) ctx.restore();
    }

    // Wall-clock choreography: the clamp only guards against a monster lurch after a
    // long stall, and is generous (0.25s) so dropped frames DON'T stretch the run into
    // slow motion — the old 0.05s cap made 10fps play at ~half speed, which read as
    // "the animation slowed down" whenever boot work contended for the thread.
    var raf = 0, stopped = false, last = 0;
    var rafFn = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
    var cancelFn = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;
    function frame(now) {
      if (stopped || (opts.alive && !opts.alive())) return;
      var realDt = Math.min(0.25, (now - last) / 1000); last = now;
      timeline(realDt * SPEED, realDt); integrate(realDt * SPEED); render();
      raf = rafFn(frame);
    }
    function handle(m) {
      if (!m) return;
      if (m.t === 'size') { W = m.w; H = m.h; canvas.width = Math.round(W * m.dpr); canvas.height = Math.round(H * m.dpr); ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0); }
      else if (m.t === 'exit') { finishing = true; awaitEnter = false; }
      else if (m.t === 'rest') { finishing = true; awaitEnter = true; }
    }
    function start() { setCount(1); last = performance.now(); raf = rafFn(frame); }
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
      bus.on('render:unsupported', function () { dismiss(); });                                 // GPU blocked → tiles never paint
      // install-needed → the welcome card's "Start" button is behind the splash.
      // Reveal it NOW so the user can click Start to load the libraries. Holding
      // the splash here is a hard deadlock: no Start → no libraries → no hive.
      bus.on('boot:status', function (s) { if (s && s.kind === 'install-needed') dismiss(); });
    } else { setTimeout(waitBus, 250); }   // TIMER, not rAF: a hidden tab parks rAF, so an rAF retry never subscribes at all — the splash would go deaf to every ready signal (incl. the last-value replay)
  })();
  // No blind auto-hide timer: the 3-play cap is the terminal fallback — it rests on
  // the dot and shows "click to enter" so we never reveal a not-ready hive on a
  // timer, and the user always has a guaranteed way in.
})();
