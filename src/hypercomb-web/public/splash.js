/* Hypercomb loading page — "Point to Sphere" (pure canvas, zero dependencies).
 *
 * Paints instantly from inside <app-root>, then RE-PARENTS itself to <body> so it
 * survives Angular's bootstrap, and stays up until the hive is ready to show — the
 * first tiles on screen (EffectBus 'render:cell-count' with count>0), OR a genuinely
 * empty layer (count===0 with settled:true — pixi + data were up, the location just
 * has no tiles), OR the install-needed welcome card (boot:status) whose "Start" button
 * the splash must not cover. Then it fades out at once to reveal the hive: the
 * animation covers real loading only, never a hive that is already ready (jwize
 * 2026-10-18 — finishing the loop down to the dot and holding ~1s kept a ready hive
 * covered 2.6–3.4s on every load). It never blocks on an event that may not
 * fire: an empty page reveals via settled, and after MAXLOOPS (2) plays with no signal
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
 * on the main thread; the core only animates and reports 'resting'.
 * A/B check: load with ?splash=inline to force the inline path.
 *
 * Keep in sync with hypercomb-dev/public/splash.js. The #hc-splash styles live in
 * <head> (index.html) so they persist after we move out of <app-root>.
 *
 * THE PIECE (jwize 2026-10-18: "1 2 3 on 2d space and then 3d space triangle then
 * 6 pointed primitive then 7 is the first not balanced dot starts the next phase").
 *   • one dot, two (a LINE), three (a TRIANGLE): the flat world;
 *   • the FOURTH dot opens in the triangle's middle — the first chance to go 3D:
 *     a triangle in space (a tetrahedron), the view tilting just enough to show it;
 *   • each of the four expands in THREE directions until they meet as a CUBE. The
 *     four were half a cube's corners all along, so the three directions land on
 *     the other four exactly. Seen down its diagonal the cube IS the six-pointed
 *     primitive — the hexagon, the comb's cell — and it holds there, balanced;
 *   • the SEVENTH beat is the first unbalanced dot: it breaks the symmetry, the
 *     cube turns, and the next phase begins. Its corners sit on the sphere, and the SPHERE fills
 * on the same rule: each new dot splits off its nearest neighbour (farthest-point
 * insertion over a Fibonacci lattice, so every dot lands where the sphere is
 * emptiest) and glides to its place — a few at first, slowly enough to follow,
 * then faster, then very fast — and everything returns to the one honey dot, the
 * point the next play opens from. Every frame is a pure function of the clock:
 * the order, the parents and the schedule are computed once at construction.
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
   * Inward through handle():
   *   {t:'size',w,h,dpr} · {t:'rest'} finish + wait for a click (the 20s
   *   wall-clock backstop). A ready signal never reaches the core: the main
   *   thread fades the splash out over whatever frame it is on.
   */
  function GenesisCore(canvas, opts, post) {
    var ctx = canvas.getContext('2d');
    var reduce = !!opts.reduce;

    // ---- authored composition -------------------------------------------------
    // Units are the piece's own — R = 120 is the sphere's radius — and S scales
    // them to the viewport (see resize()). Times are real seconds.
    var R = 120, FOV = 1600, DOT_R = 8, DEG = Math.PI / 180;
    var A = R / Math.sqrt(3);                         // half the cube's edge: its corners sit ON the sphere
    var T_LINE = 0.45, T_TRI = 1.25, T_MID = 2.05, T_EXP = 3.0, T_TURN = 4.55;
    var STEP = 0.75, EXP_STEP = 1.05;                 // each parting takes this long — slow enough to watch
    var T_FILL = 5.1, FILL = 3.2;                     // the seventh beat: the first unbalanced dot, then the fill: slow → fast → very fast
    var T_RETURN = T_FILL + FILL, RETURN = 0.7;       // everything back to the one dot
    var DOT_IN = T_RETURN + RETURN - 0.2;             // the honey dot takes over as the last dots arrive home
    var TOTAL = T_RETURN + RETURN + 0.25;             // ≈ 8s a play; the dot holds a beat at the seam
    var SPIN = reduce ? 0.12 : 0.35, PITCH = 18 * DEG;
    var N = 260, NG = 8;                              // N dots in all; the first NG are the cube's corners
    var FILL_POW = 2.6;                               // the j-th fill dot arrives at (j/M)^(1/FILL_POW): few, then a flood
    var MAXLOOPS = 2;                                 // play at most this many times before offering click-to-enter
    var FIT = 0.225;                                  // sphere's widest radius as a fraction of min(W,H) — clears the title at top:66%
    var TONES = [[116, 157, 196], [148, 188, 227], [89, 128, 166], [181, 217, 253], [242, 242, 243]];
    var GLOW_C = [232, 166, 61];                      // honey: the dot the piece opens from and returns to
    var EDGE_C = [148, 188, 227];                     // the cube's edges once they cool

    function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
    function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1; }
    function easeInOutSine(t) { return -(Math.cos(Math.PI * t) - 1) / 2; }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function rnd(i) { var s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
    function part(T, at, span) { return easeInOutCubic(clamp01((T - at) / span)); }

    // ---- the dots, their parents and their arrival schedule (computed ONCE) ----
    // Dots 0..7 are the cube's corners, corner k at (±A, ±A, ±A) by its bits (1 = x,
    // 2 = y, 4 = z). The rest are a Fibonacci lattice, put in order by FARTHEST-POINT
    // INSERTION seeded with the corners — every new dot lands where the sphere is
    // emptiest — and each dot's PARENT is the nearest dot already there: the one it
    // splits off from. O(N²) once at construction, nothing per frame.
    var UX = new Float64Array(N), UY = new Float64Array(N), UZ = new Float64Array(N);
    var AT = new Float64Array(N), GL = new Float64Array(N), SZ = new Float64Array(N);
    var PARENT = new Int32Array(N), RANKED = new Int32Array(N);
    var TONE_R = new Float64Array(N), TONE_G = new Float64Array(N), TONE_B = new Float64Array(N);
    var EDGES = [];                                   // the cube's 12 edges: corners one bit apart, listed EVEN → ODD
    var TETRA = [0, 3, 0, 5, 0, 6, 3, 5, 3, 6, 5, 6]; // the triangle in space: the four even corners, all joined
    function parity(k) { return ((k & 1) + ((k >> 1) & 1) + ((k >> 2) & 1)) & 1; }
    // THE DIAGONAL VIEW: a basis that looks straight down the cube's diagonal (1,1,1),
    // corner 7 toward the viewer — from there the cube reads as a hexagon. Up is
    // (-1,-1,2), so the first triangle (corners 3, 5, 6) opens with two dots above
    // and one below.
    var s3 = Math.sqrt(3), s6 = Math.sqrt(6), s2 = Math.sqrt(2);
    var BZ = [-1 / s3, -1 / s3, -1 / s3], BY = [-1 / s6, -1 / s6, 2 / s6], BX = [1 / s2, -1 / s2, 0];
    (function build() {
      var GA = Math.PI * (3 - Math.sqrt(5)), EPS = 0.36, M = N - NG, i, j, k, inv = 1 / Math.sqrt(3);
      for (k = 0; k < NG; k++) {
        UX[k] = (k & 1 ? 1 : -1) * inv; UY[k] = (k & 2 ? 1 : -1) * inv; UZ[k] = (k & 4 ? 1 : -1) * inv;
        if (!parity(k)) for (var bit = 1; bit < 8; bit <<= 1) EDGES.push(k, k ^ bit);   // each even corner: its three directions
      }
      for (i = 0; i < M; i++) {
        var y = 1 - 2 * (i + EPS) / (M - 1 + 2 * EPS);
        var rr = Math.sqrt(Math.max(0, 1 - y * y)), th = i * GA;
        UX[NG + i] = rr * Math.cos(th); UY[NG + i] = y; UZ[NG + i] = rr * Math.sin(th);
      }
      var minD = new Float64Array(N), near = new Int32Array(N), used = new Uint8Array(N), n = 0;
      for (i = 0; i < N; i++) { minD[i] = Infinity; near[i] = -1; }
      function settle(b) {
        for (var q = 0; q < N; q++) if (!used[q]) {
          var ex = UX[q] - UX[b], ey = UY[q] - UY[b], ez = UZ[q] - UZ[b], d = ex * ex + ey * ey + ez * ez;
          if (d < minD[q]) { minD[q] = d; near[q] = b; }
        }
      }
      for (k = 0; k < NG; k++) { used[k] = 1; PARENT[k] = -1; RANKED[n++] = k; settle(k); }
      while (n < N) {
        var best = -1, bd = -1;
        for (i = 0; i < N; i++) if (!used[i] && minD[i] > bd) { bd = minD[i]; best = i; }
        used[best] = 1; PARENT[best] = near[best]; RANKED[n++] = best; settle(best);
      }
      for (k = 0; k < NG; k++) SZ[k] = 5.2;
      for (j = 0; j < M; j++) {
        var idx = RANKED[NG + j], u = Math.pow((j + 0.5) / M, 1 / FILL_POW);
        // the seventh beat: the first unbalanced dot arrives ALONE, then the flood
        AT[idx] = j === 0 ? T_FILL : T_FILL + 0.6 + u * (FILL * 0.92 - 0.6);
        GL[idx] = lerp(0.75, 0.18, u);                // early dots glide slowly enough to follow
        SZ[idx] = lerp(5, 2.6, u) * (0.45 + 0.55 * rnd(idx));
      }
      for (i = 0; i < N; i++) {
        var tn = TONES[Math.floor(rnd(i + 7) * TONES.length)];
        TONE_R[i] = tn[0]; TONE_G[i] = tn[1]; TONE_B[i] = tn[2];
      }
    })();

    // per-frame scratch, preallocated — the frame path allocates nothing
    var VX = new Float64Array(N), VY = new Float64Array(N), VZ = new Float64Array(N);   // where each dot is, unprojected
    var BORN = new Uint8Array(N), HEAT = new Float64Array(N);
    var PX = new Float64Array(N), PY = new Float64Array(N), PR = new Float64Array(N), PZ = new Float64Array(N);
    var PC = new Array(N), PH = new Float64Array(N), ORDER = new Array(N);
    var QX = new Float64Array(NG), QY = new Float64Array(NG);                            // the corners, projected
    for (var _i = 0; _i < N; _i++) { PC[_i] = ''; ORDER[_i] = _i; }
    function byDepth(a, b) { return PZ[b] - PZ[a]; }   // far side first — painter's order

    // ---- timeline -------------------------------------------------------------
    var nowSec = 0, loops = 0, finishing = false;
    var restSent = false;
    var waggleT = 0;                                      // real seconds resting on the dot — drives the waggle dance

    function timeline(dt, realDt) {
      nowSec += dt;
      if (finishing && nowSec >= TOTAL) {                 // the finishing run has reached the honey dot
        nowSec = TOTAL;                                   // pin on the dot — but it rests DANCING, never dead (see the waggle in render())
        waggleT += realDt;
        if (!restSent) { restSent = true; post({ t: 'resting' }); }   // no ready signal → rest here, wait for a click
      } else if (nowSec >= TOTAL) {
        if (++loops >= MAXLOOPS) { finishing = true; nowSec = TOTAL; }   // played MAXLOOPS times, still no ready signal → rest on the dot
        else nowSec -= TOTAL;                             // the loop is seamless: dot out, dot in
      }
    }

    // ---- render ---------------------------------------------------------------
    var W = 0, H = 0, S = 1, cx = 0, cy = 0;
    function resize() {
      cx = W / 2;
      cy = H * 0.46 - 10;                                  // sphere a touch above centre; the title (index.html #hc-splash .m, top:66%) hugs beneath it — the pair balanced as one vertically-centred group
      S = Math.min(W, H) * FIT / (R * 1.08);               // 1.08 = the perspective peak: the widest the sphere ever gets
    }
    function colour(i, h) {
      return h > 0.001
        ? 'rgb(' + Math.round(lerp(TONE_R[i], GLOW_C[0], h)) + ',' + Math.round(lerp(TONE_G[i], GLOW_C[1], h)) + ',' + Math.round(lerp(TONE_B[i], GLOW_C[2], h)) + ')'
        : 'rgb(' + TONE_R[i] + ',' + TONE_G[i] + ',' + TONE_B[i] + ')';
    }

    // cube space → screen: down the diagonal (BX, BY, BZ), then the turn (yaw about
    // screen-vertical, pitch about screen-horizontal), then perspective
    var PJX = 0, PJY = 0, PJZ = 0, PJS = 1, cyw = 1, syw = 0, cp = 1, sp = 0;
    function project(x, y, z) {
      var dx = x * BX[0] + y * BX[1] + z * BX[2], dy = x * BY[0] + y * BY[1] + z * BY[2], dz = x * BZ[0] + y * BZ[1] + z * BZ[2];
      var x1 = dx * cyw + dz * syw, z1 = -dx * syw + dz * cyw;
      var y2 = dy * cp - z1 * sp, z2 = dy * sp + z1 * cp;
      PJS = FOV / (FOV + z2); PJX = cx + x1 * PJS * S; PJY = cy - y2 * PJS * S; PJZ = z2;
    }
    function render() {
      ctx.clearRect(0, 0, W, H);
      var T = nowSec, i, j, k;
      // THE BEATS. Even corners (3, 5, 6, then 0) are the flat world and the triangle
      // in space; each opens from the centre. The odd corners (1, 2, 4, 7) are where
      // the even ones' three directions meet — they appear as the edges arrive.
      var eL = part(T, T_LINE, STEP), eT = part(T, T_TRI, STEP), eM = part(T, T_MID, STEP);
      var eX = part(T, T_EXP, EXP_STEP), eTurn = part(T, T_TURN, 1.1);
      var back = clamp01((T - T_RETURN) / RETURN), keep = 1 - back * back * back;   // the way home starts slow and ends fast
      var heat = Math.max(1 - eTurn, back);                // honey while the shape is young and on the way home, cool blue once it turns
      var endFade = clamp01((T - DOT_IN) / 0.2);
      // the view: straight down the diagonal, so the cube reads as a hexagon. The
      // fourth dot tilts it just enough to show depth, then it settles back; after
      // the hexagon has held, the seventh beat breaks the balance and it turns.
      var tiltP = clamp01((T - T_MID) / (T_EXP + EXP_STEP - T_MID));
      var tilt = Math.sin(Math.PI * tiltP) * 15 * DEG;
      var tau = Math.max(0, T - T_TURN), RAMP = 1.2;
      var yaw = SPIN * (tau < RAMP ? tau * tau / (2 * RAMP) : tau - RAMP / 2) + tilt * 0.6;
      var pitch = PITCH * eTurn + tilt; cyw = Math.cos(yaw); syw = Math.sin(yaw); cp = Math.cos(pitch); sp = Math.sin(pitch);
      var vn = 0;

      for (j = 0; j < N; j++) {                            // in arrival order: a parent is placed before its children
        i = RANKED[j];
        if (i < NG) {
          var bx = i & 1 ? A : -A, by = i & 2 ? A : -A, bz = i & 4 ? A : -A, f;
          if (parity(i)) { if (eX < 0.9) { BORN[i] = 0; continue; } f = 1; HEAT[i] = Math.max(heat, 1 - clamp01((eX - 0.9) / 0.1)); }
          else {
            f = i === 5 || i === 6 ? eL : (i === 3 ? eT : eM);
            if (f <= 0) { BORN[i] = 0; continue; }       // still inside the dot it parts from
            HEAT[i] = heat;
          }
          VX[i] = bx * f; VY[i] = by * f; VZ[i] = bz * f;
        } else {
          var gp = (T - AT[i]) / GL[i];
          if (gp <= 0) { BORN[i] = 0; continue; }          // not split off yet
          var g = easeInOutSine(clamp01(gp)), p = PARENT[i];
          // from where its parent is right now to its own place, over the sphere
          var x = lerp(VX[p], UX[i] * R, g), y = lerp(VY[p], UY[i] * R, g), z = lerp(VZ[p], UZ[i] * R, g);
          var len = Math.sqrt(x * x + y * y + z * z) || 1;
          VX[i] = x * R / len; VY[i] = y * R / len; VZ[i] = z * R / len;
          HEAT[i] = Math.max(back, 1 - g);                 // born honey, cools as it settles
        }
        BORN[i] = 1;
        var q = vn++;
        project(VX[i] * keep, VY[i] * keep, VZ[i] * keep);
        if (i < NG) { QX[i] = PJX; QY[i] = PJY; }
        PX[q] = PJX; PY[q] = PJY; PZ[q] = PJZ;
        PR[q] = Math.max(0.05, SZ[i] * PJS * lerp(1, 0.5, back) * S);
        PH[q] = HEAT[i]; PC[q] = colour(i, HEAT[i]);
      }

      // THE EDGES. The triangle in space joins the four even corners: while two of
      // them still share the centre their edge has no length, so the line and the
      // flat triangle appear on their own. From the fourth beat each even corner
      // reaches out in its three directions; where three reaches meet, a corner.
      var edgeA = clamp01(eL * 3) * (1 - clamp01((T - T_FILL - 0.6) / 1.4)) * (1 - endFade);
      if (edgeA > 0.003) {
        ctx.strokeStyle = 'rgb(' + Math.round(lerp(EDGE_C[0], GLOW_C[0], heat)) + ',' + Math.round(lerp(EDGE_C[1], GLOW_C[1], heat)) + ',' + Math.round(lerp(EDGE_C[2], GLOW_C[2], heat)) + ')';
        ctx.lineWidth = Math.max(1, 1.1 * S);
        var tetA = edgeA * (1 - clamp01((eX - 0.2) / 0.6));
        if (tetA > 0.003) {
          ctx.globalAlpha = 0.5 * tetA;
          ctx.beginPath();
          for (k = 0; k < TETRA.length; k += 2) {
            var t0 = TETRA[k], t1 = TETRA[k + 1];
            if (!BORN[t0] || !BORN[t1] || Math.abs(QX[t0] - QX[t1]) + Math.abs(QY[t0] - QY[t1]) < 0.5) continue;
            ctx.moveTo(QX[t0], QY[t0]); ctx.lineTo(QX[t1], QY[t1]);
          }
          ctx.stroke();
        }
        if (eX > 0) {
          ctx.globalAlpha = 0.5 * edgeA;
          ctx.beginPath();
          for (k = 0; k < EDGES.length; k += 2) {
            var a0 = EDGES[k], a1 = EDGES[k + 1];                   // even → odd: the reach grows from the even corner
            var ox = (a1 & 1 ? A : -A), oy = (a1 & 2 ? A : -A), oz = (a1 & 4 ? A : -A);
            project((VX[a0] + (ox - VX[a0]) * eX) * keep, (VY[a0] + (oy - VY[a0]) * eX) * keep, (VZ[a0] + (oz - VZ[a0]) * eX) * keep);
            if (Math.abs(QX[a0] - PJX) + Math.abs(QY[a0] - PJY) < 0.5) continue;
            ctx.moveTo(QX[a0], QY[a0]); ctx.lineTo(PJX, PJY);
          }
          ctx.stroke();
        }
      }

      if (ORDER.length !== vn) ORDER.length = vn;
      for (i = 0; i < vn; i++) ORDER[i] = i;
      ORDER.sort(byDepth);
      var dotsA = 1 - endFade;
      // The honey glow under a hot dot: an additive oversized pass. A shadowBlur per
      // circle would cost 260 blurred fills a frame; this reads the same as a plain fill.
      ctx.globalCompositeOperation = 'lighter';
      for (i = 0; i < vn; i++) {
        var hg = ORDER[i];
        if (PH[hg] <= 0.02) continue;
        ctx.globalAlpha = dotsA * 0.11 * PH[hg];
        ctx.beginPath(); ctx.arc(PX[hg], PY[hg], PR[hg] * (1 + 2.4 * PH[hg]), 0, 6.2832);
        ctx.fillStyle = PC[hg]; ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = dotsA;
      for (i = 0; i < vn; i++) {
        var d = ORDER[i];
        ctx.beginPath(); ctx.arc(PX[d], PY[d], PR[d], 0, 6.2832);
        ctx.fillStyle = PC[d]; ctx.fill();
      }

      // THE HONEY DOT: the piece opens from it (it parts into the line) and returns
      // to it — the loop's seam. WAGGLE DANCE: pinned at TOTAL the dot never turns
      // into a stopped object — it dances the bee's figure-eight, ever so slightly,
      // glow breathing. waggleT only accrues while finishing rests on the dot, so the
      // seam between plays stays perfectly still.
      var dotA = Math.max(1 - clamp01(eL * 2.5), endFade);
      if (dotA > 0) {
        var dr = DOT_R * S;
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
        ctx.globalAlpha = dotA;
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
      timeline(realDt, realDt); render();
      raf = rafFn(frame);
    }
    function handle(m) {
      if (!m) return;
      if (m.t === 'size') { W = m.w; H = m.h; canvas.width = Math.round(W * m.dpr); canvas.height = Math.round(H * m.dpr); ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0); resize(); }
      else if (m.t === 'rest') finishing = true;
    }
    function start() { last = performance.now(); raf = rafFn(frame); }
    function stop() { stopped = true; cancelFn(raf); }
    return { start: start, stop: stop, handle: handle };
  }

  // ---- main-thread side: where the core runs, and the DOM policy around it ----
  var mode = 'inline', worker = null, core = null;
  var dismissed = false, awaitEnter = false, enterHint = null;

  function measure() { return { t: 'size', w: cv.clientWidth || window.innerWidth, h: cv.clientHeight || window.innerHeight, dpr: Math.min(2, window.devicePixelRatio || 1) }; }
  function coreSend(m) { if (worker) worker.postMessage(m); else if (core) core.handle(m); }
  function onCoreMsg(m) {
    if (!m || dismissed) return;
    if (m.t === 'resting') { awaitEnter = true; showEnter(); }   // loop cap on the dot → offer a way in
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

  // ---- dismissal: wait for real tiles, then fade to the hive ----
  // A real ready signal reveals at once, over whatever frame the animation is on:
  // the hive is never kept waiting on the choreography. awaitEnter gates the
  // click/key entry, which exists only while no ready signal has come.
  // HIDDEN-TAB RULE: the fade rides a frame, and frames are PARKED in a hidden tab
  // (worker rAF included — no compositor) — a backgrounded boot would strand the
  // splash over a fully-ready hive (observed 2026-07-16 on a driver tab). Nobody is
  // watching a hidden tab, so dismiss() removes it there without the fade.
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
  // WALL-CLOCK BACKSTOP (frame-independent): the 3-play cap only accrues while
  // frames run, so a hidden/throttled boot could outlive it indefinitely.
  // After 20s real time with no ready signal: rest on click-to-enter (built
  // directly in the DOM — no frame needed) so there is ALWAYS a way in.
  setTimeout(function () {
    if (dismissed) return;
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
      bus.on('render:cell-count', function (pl) { if (pl && (pl.count > 0 || pl.settled)) dismiss(); });
      // A location that OPENS AS a view (its layer carries a view:default
      // mark): the hexagons are deliberately never painted, so the
      // cell-count signal above will not fire — the arrival verdict IS the
      // ready signal. An empty view means "opens as hexagons after all";
      // only a real view name reveals. (EffectBus replays the last value,
      // so a verdict emitted before this subscription still lands.)
      bus.on('view:arrival', function (p) { if (p && p.view) dismiss(); });
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
