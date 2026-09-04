// comparison-scenes.jsx — DeepSeek Harness (dsh) vs Hypercomb.
// One continuous composition on the Broadsheet system. All choreography is a
// pure function of T (authored seconds) and CUES from useComposition().

const SER = '"Source Serif 4", Georgia, serif';
const HEX_POLY = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';

const HASH_LINES = [
  '9f2ac41d7b6e0583', '4ca19d0fbe72a5d8',
  '4c3e1b90af58627d', '3e0c9a1b4d6f8e02',
];

function pal(theme) {
  const dark = theme === 'dark';
  return {
    dark,
    cool: dark ? '#151a1e' : '#edf1f3',
    warm: dark ? '#1e1b15' : '#f8f4ea',
    one: dark ? '#1a1918' : '#f3f2f2',
    ink: dark ? '#ecebe9' : '#201e1d',
    soft: dark ? '#9b9797' : '#605d5d',
    hair: dark ? '#4a4846' : '#c9c6c4',
    faint: dark ? '#232221' : '#e8e6e3',
    card: dark ? '#22201d' : '#faf8f6',
    blue: dark ? '#62c5ee' : '#0088b0',
    blueText: dark ? '#99e0ff' : '#006786',
    blueFill: dark ? 'rgba(98,197,238,0.16)' : 'rgba(0,136,176,0.10)',
    gold: '#edbb00',
    goldText: dark ? '#edbb00' : '#8a6600',
    goldFill: dark ? 'rgba(237,187,0,0.18)' : 'rgba(237,187,0,0.24)',
    cyan: '#0088b0',
    magenta: '#d6006c',
  };
}

function h2r(h) {
  h = String(h);
  if (h.charAt(0) === 'r') {
    const m = h.match(/\d+/g) || [0, 0, 0];
    return [+m[0], +m[1], +m[2]];
  }
  h = h.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// Numeric blend — kept out of color-mix() so serialized export frames match.
function mix(a, b, t) {
  const A = h2r(a), B = h2r(b), k = clamp(t, 0, 1);
  return 'rgb(' + [0, 1, 2].map((i) => Math.round(A[i] + (B[i] - A[i]) * k)).join(',') + ')';
}

// Exactly three motion helpers — everything eases through these.
const MOTION = {
  arrive: (start, from, to, dur) =>
    animate({ from: from, to: to, start: start, end: start + (dur || 0.7), ease: Easing.easeOutCubic }),
  draw: (start, dur) =>
    animate({ from: 0, to: 1, start: start, end: start + (dur || 0.6), ease: Easing.easeInOutQuad }),
  fade: (start, dur) =>
    animate({ from: 0, to: 1, start: start, end: start + (dur || 0.45), ease: Easing.easeOutSine }),
};

const txt = (o) => Object.assign({ position: 'absolute', fontFamily: SER, whiteSpace: 'nowrap' }, o);
const box = (o) => Object.assign({ position: 'absolute' }, o);

// ── geometry ────────────────────────────────────────────────────────────────

function segsOf(pts) {
  const s = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    s.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], len: len, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI });
    total += len;
  }
  return { s: s, total: total };
}

function pointOn(pts, u) {
  const g = segsOf(pts);
  let d = clamp(u, 0, 1) * g.total;
  for (let i = 0; i < g.s.length; i++) {
    const seg = g.s[i];
    if (d <= seg.len || i === g.s.length - 1) {
      const k = seg.len ? clamp(d / seg.len, 0, 1) : 0;
      return [seg.x1 + (seg.x2 - seg.x1) * k, seg.y1 + (seg.y2 - seg.y1) * k];
    }
    d -= seg.len;
  }
  return [pts[0][0], pts[0][1]];
}

function Path(props) {
  const w = props.w == null ? 1.5 : props.w;
  const g = segsOf(props.pts);
  let left = g.total * clamp(props.p == null ? 1 : props.p, 0, 1);
  const out = [];
  for (let i = 0; i < g.s.length && left > 0.02; i++) {
    const seg = g.s[i];
    const l = Math.min(seg.len, left);
    left -= l;
    out.push(React.createElement('div', {
      key: i,
      style: {
        position: 'absolute', left: seg.x1, top: seg.y1 - w / 2, width: l, height: w,
        transform: 'rotate(' + seg.ang + 'deg)', transformOrigin: '0 50%',
        background: props.dash ? 'none' : props.color,
        backgroundImage: props.dash
          ? 'repeating-linear-gradient(90deg,' + props.color + ' 0 ' + props.dash[0] + 'px,transparent ' + props.dash[0] + 'px ' + (props.dash[0] + props.dash[1]) + 'px)'
          : 'none',
        opacity: props.opacity == null ? 1 : props.opacity,
      },
    }));
  }
  return React.createElement(React.Fragment, null, out);
}

function Hex(props) {
  const w = props.w;
  const h = w * 1.1547;
  const sw = props.sw == null ? 1.5 : props.sw;
  return (
    <div style={box(Object.assign({ width: w, height: h }, props.style))}>
      <div style={{ position: 'absolute', inset: 0, clipPath: HEX_POLY, background: props.stroke || 'transparent' }} />
      <div style={{ position: 'absolute', left: sw, right: sw, top: sw * 1.15, bottom: sw * 1.15, clipPath: HEX_POLY, background: props.fill || 'transparent' }} />
      {props.children ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{props.children}</div>
      ) : null}
    </div>
  );
}

function Rect(props) {
  return (
    <div style={box(Object.assign({
      left: props.x, top: props.y, width: props.w, height: props.h,
      border: (props.sw == null ? 1.5 : props.sw) + 'px solid ' + props.stroke,
      background: props.fill || 'transparent',
      boxSizing: 'border-box',
    }, props.style))}>{props.children}</div>
  );
}

// The comb: a honeycomb lattice of cells, four levels deep. Cells touch
// edge to edge, so the hierarchy needs no boxes — and level 2's middle cell
// is shared by both parents, which a tree cannot express.
const HW = 96, HH = 96 * 1.1547, LX = 1260, LY = 330;
const cellAt = (r, c) => [LX + c * HW + (r % 2 ? HW / 2 : 0), LY + r * HH * 0.75];
const cellMid = (r, c) => { const p = cellAt(r, c); return [p[0] + HW / 2, p[1] + HH / 2]; };
const COMB = [[0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [2, 2], [3, 0], [3, 2]];
const STITCH = [
  [[0, 1], [1, 0]], [[0, 1], [1, 1]], [[1, 0], [2, 0]], [[1, 0], [2, 1]],
  [[1, 1], [2, 1]], [[1, 1], [2, 2]], [[2, 0], [3, 0]], [[2, 1], [3, 0]], [[2, 2], [3, 2]],
];
const DRONE_CELL = [3, 1];
const LIT_CELLS = [[2, 1], [2, 2], [3, 0], [3, 2]];

// ── persistent furniture ────────────────────────────────────────────────────

function Target(props) {
  const c = props.color;
  return (
    <div style={box({ left: props.x - 11, top: props.y - 11, width: 22, height: 22, opacity: 0.55 })}>
      <div style={{ position: 'absolute', inset: 3, borderRadius: '50%', border: '1px solid ' + c }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 10.5, height: 1, background: c }} />
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 10.5, width: 1, background: c }} />
    </div>
  );
}

function Furniture(props) {
  const P = props.P, on = props.on;
  if (!on) return null;
  return (
    <React.Fragment>
      <div style={box({ left: 104, top: 62, width: 1712, height: 3, background: P.ink })} />
      <div style={box({ left: 104, top: 106, width: 1712, height: 1, background: P.hair })} />
      <div style={txt({ left: 104, top: 74, fontSize: 15, letterSpacing: '0.22em', color: P.soft })}>
        MODULE ARCHITECTURES — A COMPARATIVE PLATE
      </div>
      <div style={txt({ left: 1416, top: 74, width: 400, textAlign: 'right', fontSize: 15, letterSpacing: '0.22em', color: P.soft, opacity: props.idxOpacity })}>
        PLATE {props.idx} OF 10
      </div>
      <Target x={44} y={44} color={P.cyan} />
      <Target x={1876} y={44} color={P.magenta} />
      <Target x={44} y={1036} color={P.magenta} />
      <Target x={1876} y={1036} color={P.cyan} />
    </React.Fragment>
  );
}

// ── scene 2 — the unit ──────────────────────────────────────────────────────

function SceneUnit(props) {
  const P = props.P, tl = props.tl;
  const nodes = [
    [380, 330, 140, 40], [250, 424, 120, 36], [500, 424, 120, 36],
    [190, 516, 96, 32], [330, 516, 96, 32], [452, 516, 96, 32], [590, 516, 96, 32],
  ];
  const links = [
    [[450, 370], [450, 400], [310, 400], [310, 424]],
    [[450, 370], [450, 400], [560, 400], [560, 424]],
    [[310, 460], [310, 490], [238, 490], [238, 516]],
    [[310, 460], [310, 490], [378, 490], [378, 516]],
    [[560, 460], [560, 490], [500, 490], [500, 516]],
    [[560, 460], [560, 490], [638, 490], [638, 516]],
  ];
  const plugX = MOTION.arrive(2.2, -230, 150, 0.8)(tl);
  const plugO = MOTION.fade(2.2, 0.5)(tl);
  const dockP = MOTION.draw(3.2, 0.7)(tl);
  const gifts = ['services', 'events', 'effects'];

  const dt = cellAt(DRONE_CELL[0], DRONE_CELL[1]);
  const droneX = MOTION.arrive(2.6, dt[0] + 236, dt[0], 0.9)(tl);
  const droneY = MOTION.arrive(2.6, dt[1] - 196, dt[1], 0.9)(tl);
  const droneO = MOTION.fade(2.6, 0.5)(tl);
  const senseLab = ['sense', 'heartbeat', 'emits'];

  return (
    <React.Fragment>
      {nodes.map((n, i) => (
        <Rect key={'n' + i} x={n[0]} y={n[1]} w={n[2]} h={n[3]} stroke={P.hair} sw={1.5}
              fill={P.faint} style={{ opacity: MOTION.fade(0.2 + i * 0.12, 0.5)(tl) }} />
      ))}
      {links.map((l, i) => (
        <Path key={'l' + i} pts={l} color={P.hair} w={1.5} p={MOTION.draw(0.5 + i * 0.13, 0.5)(tl)} />
      ))}

      <div style={box({ left: plugX, top: 590, width: 180, height: 96, opacity: plugO, border: '1.5px solid ' + P.blue, borderLeftWidth: 5, background: P.blueFill, boxSizing: 'border-box' })} />
      <Path pts={[[plugX + 90, 590], [plugX + 90, 560], [378, 560], [378, 548]]} color={P.blue} w={1.5} p={dockP} opacity={plugO} />
      {gifts.map((g, i) => {
        const y = 614 + i * 32;
        const o = MOTION.fade(3.9 + i * 0.34, 0.5)(tl);
        return (
          <React.Fragment key={g}>
            <Path pts={[[plugX + 180, y], [410, y]]} color={P.blue} w={1} p={MOTION.draw(3.8 + i * 0.34, 0.4)(tl)} opacity={0.8} />
            <div style={txt({ left: 424, top: y - 14, fontSize: 21, letterSpacing: '0.06em', color: P.blueText, opacity: o })}>{g}</div>
          </React.Fragment>
        );
      })}

      {COMB.map((rc, i) => {
        const p = cellAt(rc[0], rc[1]);
        const li = LIT_CELLS.findIndex((x) => x[0] === rc[0] && x[1] === rc[1]);
        const lit = li >= 0 ? MOTION.fade(3.7 + li * 0.24, 0.5)(tl) : 0;
        const sw = rc[0] === 0 ? 2.5 : rc[0] === 1 ? 2 : 1.5;
        return (
          <Hex key={'c' + i} w={HW} sw={sw}
               stroke={mix(mix(P.hair, P.gold, 0.4), P.gold, lit)}
               fill={mix(mix(P.warm, P.gold, 0.05), P.gold, lit * 0.3)}
               style={{ left: p[0], top: p[1], opacity: MOTION.fade(0.4 + i * 0.15, 0.5)(tl) }} />
        );
      })}
      {STITCH.map((st, i) => (
        <Path key={'s' + i} pts={[cellMid(st[0][0], st[0][1]), cellMid(st[1][0], st[1][1])]}
              color={P.goldText} w={1} opacity={0.45} p={MOTION.draw(1.2 + i * 0.09, 0.45)(tl)} />
      ))}
      <Hex w={HW} sw={3} stroke={P.gold} fill={P.gold}
           style={{ left: droneX, top: droneY, opacity: droneO }} />

      {senseLab.map((lab, i) => {
        const y = 724 + i * 42;
        return (
          <React.Fragment key={lab}>
            <Path pts={[[dt[0] + HW / 2, dt[1] + HH - 6], [dt[0] + HW / 2, y], [1520, y]]}
                  color={P.gold} w={1} p={MOTION.draw(4.5 + i * 0.32, 0.5)(tl)} opacity={0.85} />
            <div style={txt({ left: 1534, top: y - 14, fontSize: 21, letterSpacing: '0.06em', color: P.goldText, opacity: MOTION.fade(4.8 + i * 0.32, 0.5)(tl) })}>{lab}</div>
          </React.Fragment>
        );
      })}
    </React.Fragment>
  );
}

// ── scene 3 — identity ─────────────────────────────────────────────────────

function SceneIdentity(props) {
  const P = props.P, tl = props.tl;
  const cardO = MOTION.fade(0.3, 0.6)(tl);
  const cardY = MOTION.arrive(0.3, 442, 424, 0.8)(tl);
  const flip = MOTION.draw(3.2, 0.55)(tl);
  const brk = MOTION.draw(4.0, 0.7)(tl);
  const armP = MOTION.draw(1.5, 0.7)(tl);

  const gap = 62 * brk;
  const hashO = MOTION.fade(0.7, 0.6)(tl);
  const sep = MOTION.arrive(2.6, 0, 330, 0.9)(tl);
  const back = MOTION.arrive(5.2, 0, 1, 1.0)(tl);
  const copyX = 1140 + sep * (1 - back);
  const match = MOTION.fade(4.3, 0.5)(tl);
  const merged = MOTION.fade(5.9, 0.5)(tl);
  const goldStroke = 'color-mix(in srgb, ' + P.gold + ' ' + Math.round(Math.max(match, merged) * 100) + '%, ' + P.hair + ')';

  const face = (opacity) => (
    <div style={{ width: 208, textAlign: 'center', opacity: opacity }}>
      {HASH_LINES.map((l, i) => (
        <div key={i} style={{ fontFamily: SER, fontSize: 15, letterSpacing: '0.1em', lineHeight: 1.55, color: P.soft, fontVariantNumeric: 'tabular-nums' }}>{l}</div>
      ))}
    </div>
  );

  return (
    <React.Fragment>
      <div style={box({ left: 200, top: cardY, width: 460, height: 214, opacity: cardO, background: P.card, border: '1px solid ' + P.hair, boxSizing: 'border-box' })}>
        <div style={txt({ left: 30, top: 28, fontSize: 15, letterSpacing: '0.22em', color: P.soft })}>PACKAGE</div>
        <div style={txt({ left: 30, top: 60, fontSize: 34, color: P.ink })}>dsh-plugin-fs</div>
        <div style={box({ left: 30, top: 134, width: 104, height: 38, border: '1.5px solid ' + P.blue, overflow: 'hidden', boxSizing: 'border-box' })}>
          <div style={txt({ left: 0, right: 0, top: 6 - 26 * flip, width: 104, textAlign: 'center', fontSize: 21, color: P.blueText, fontVariantNumeric: 'tabular-nums', opacity: 1 - flip })}>1.2.0</div>
          <div style={txt({ left: 0, right: 0, top: 32 - 26 * flip, width: 104, textAlign: 'center', fontSize: 21, color: P.blueText, fontVariantNumeric: 'tabular-nums', opacity: flip })}>1.2.1</div>
        </div>
      </div>
      <Path pts={[[726, 700], [726, 577], [424 + gap, 577]]} color={P.blue} w={1.5} p={armP} opacity={cardO} />
      <Path pts={[[424, 577 + 11 * brk], [360, 577 + 11 * brk]]} color={P.blue} w={1.5}
            dash={brk > 0.02 ? [5, 5] : null} p={MOTION.draw(2.0, 0.25)(tl)} opacity={cardO * (1 - 0.5 * brk)} />
      <div style={box({
        left: 348, top: 571 + 11 * brk, width: 13, height: 13,
        background: P.blue, opacity: cardO * armP * (1 - 0.55 * brk),
        clipPath: 'polygon(100% 0, 100% 100%, 0 50%)',
      })} />

      <Hex w={300} sw={1.5 + 1.2 * merged} stroke={goldStroke} fill={P.card} style={{ left: 1140, top: 400, opacity: hashO }}>
        {face(1)}
      </Hex>
      <Hex w={300} sw={1.5} stroke={goldStroke} fill={P.card} style={{ left: copyX, top: 400, opacity: hashO * MOTION.fade(2.6, 0.4)(tl) * (1 - back * 0.92) }}>
        {face(1)}
      </Hex>
      {[1140, copyX].map((x, i) => (
        <div key={i} style={box({ left: x + 46, top: 638, width: 208 * match, height: 2, background: P.gold, opacity: (i === 1 ? 1 - back * 0.92 : 1 - merged) * 0.9 })} />
      ))}
    </React.Fragment>
  );
}

// ── scene 4 — memory ───────────────────────────────────────────────────────

function SceneMemory(props) {
  const P = props.P, tl = props.tl;
  const fileO = MOTION.fade(0.3, 0.6)(tl);
  const mig = MOTION.draw(4.0, 0.6)(tl);
  const reflow = MOTION.draw(4.6, 0.8)(tl);
  const w1 = [312, 258, 336, 210, 288, 246, 324, 198, 270];
  const w2 = [288, 336, 222, 300, 258, 342, 234, 312, 264];
  const shift = 12 * mig;

  return (
    <React.Fragment>
      <div style={box({ left: 240 + shift, top: 372, width: 420, height: 404, opacity: fileO, background: P.card, border: '1px solid ' + P.hair, boxSizing: 'border-box' })}>
        <div style={box({ left: 0, right: 0, top: 52, height: 1, background: P.hair })} />
        <div style={box({ left: 26, top: 14, width: 300, height: 30, overflow: 'hidden' })}>
          <div style={txt({ left: 0, top: 2 - 30 * mig, fontSize: 22, color: P.ink, opacity: 1 - mig })}>session.jsonl</div>
          <div style={txt({ left: 0, top: 32 - 30 * mig, fontSize: 22, color: P.ink, opacity: mig })}>session.v2.jsonl</div>
        </div>
        {w1.map((w, i) => {
          const inO = MOTION.fade(0.9 + i * 0.28, 0.4)(tl);
          const dy = 6 * (1 - MOTION.draw(0.9 + i * 0.28, 0.5)(tl));
          const rf = MOTION.fade(4.6 + i * 0.07, 0.32)(tl);
          const width = w + (w2[i] - w) * reflow;
          return (
            <div key={i} style={box({
              left: 30, top: 78 + i * 33 + dy, width: width, height: 9,
              background: P.blue, opacity: inO * (0.42 + 0.18 * rf),
            })} />
          );
        })}
      </div>
      <Path pts={[[214, 372], [200, 372], [200, 776], [214, 776]]} color={P.soft} w={1.5} p={mig} opacity={0.7 * mig} />

      {[0, 1, 2, 3, 4].map((i) => {
        const at = 1.0 + i * 0.92;
        const o = MOTION.fade(at, 0.5)(tl);
        const y = 764 - i * 62 + 28 * (1 - MOTION.draw(at, 0.7)(tl));
        const isHead = i === 4 ? MOTION.fade(at + 0.3, 0.5)(tl) : Math.max(0, MOTION.fade(at + 0.3, 0.5)(tl) - MOTION.fade(at + 1.22, 0.5)(tl));
        const breathe = i === 4 ? 0.9 + 0.1 * Math.sin(Math.max(0, tl - 5.4) * 1.9) : 1;
        return (
          <div key={i} style={box({
            left: 1298, top: y, width: 260, height: 52, opacity: o,
            border: (1 + 1.2 * isHead) + 'px solid ' + mix(P.hair, P.gold, isHead),
            background: mix(P.warm, P.gold, isHead * breathe * 0.3),
            boxSizing: 'border-box',
          })}>
            <div style={txt({ left: 18, top: 13, fontSize: 22, letterSpacing: '0.14em', color: isHead > 0.5 ? P.ink : P.soft, fontVariantNumeric: 'tabular-nums' })}>
              {'000' + i}
            </div>
          </div>
        );
      })}
    </React.Fragment>
  );
}

// ── scene 5 — distribution ─────────────────────────────────────────────────

function SceneDistribution(props) {
  const P = props.P, tl = props.tl;
  const sources = [
    { name: 'npm', pin: '@1.2.0', pts: [[212, 420], [400, 420], [400, 556], [560, 556]] },
    { name: 'GitHub', pin: '@0.9.4', pts: [[212, 532], [430, 532], [430, 560], [560, 560]] },
    { name: 'hub', pin: '@2.1.0', pts: [[212, 644], [400, 644], [400, 564], [560, 564]] },
  ];
  const machO = MOTION.fade(0.5, 0.6)(tl);

  const nodes = [[1120, 418], [1408, 386], [1660, 502], [1236, 664], [1524, 706]];
  const links = [[0, 1], [0, 3], [1, 2], [3, 4], [2, 4]];
  const reps = [
    { l: 0, at: 1.9 }, { l: 1, at: 2.9 }, { l: 2, at: 3.9 }, { l: 3, at: 4.9 }, { l: 4, at: 5.9 },
  ];
  const nodeMid = (i) => [nodes[i][0] + 48, nodes[i][1] + 36];
  const verify = [0, 0, 0, 0, 0];
  verify[0] = MOTION.fade(0.7, 0.5)(tl);
  reps.forEach((r) => {
    const to = links[r.l][1];
    verify[to] = Math.max(verify[to], MOTION.fade(r.at + 1.5, 0.5)(tl));
  });

  return (
    <React.Fragment>
      <Rect x={560} y={470} w={220} h={180} stroke={P.hair} sw={1.5} fill={P.faint} style={{ opacity: machO }} />
      <div style={box({ left: 560, top: 500, width: 220, height: 1, background: P.hair, opacity: machO })} />
      {sources.map((s, i) => {
        const o = MOTION.fade(0.2 + i * 0.2, 0.5)(tl);
        const travel = MOTION.arrive(1.7 + i * 0.65, 0, 1, 1.5)(tl);
        const pt = pointOn(s.pts, travel);
        const arrived = MOTION.fade(1.7 + i * 0.65 + 1.5, 0.4)(tl);
        return (
          <React.Fragment key={s.name}>
            <div style={txt({ left: 104, top: s.pts[0][1] - 30, fontSize: 22, letterSpacing: '0.08em', color: P.soft, opacity: o })}>{s.name}</div>
            <div style={txt({ left: 104, top: s.pts[0][1] + 2, fontSize: 15, letterSpacing: '0.1em', color: P.blueText, fontVariantNumeric: 'tabular-nums', opacity: o * 0.9 })}>{s.pin}</div>
            <Path pts={s.pts} color={P.hair} w={1} p={MOTION.draw(0.6 + i * 0.3, 0.6)(tl)} />
            <div style={box({
              left: pt[0] - 34, top: pt[1] - 14, width: 68, height: 28, opacity: (1 - arrived) * MOTION.fade(1.7 + i * 0.65, 0.35)(tl),
              border: '1.5px solid ' + P.blue, background: P.blueFill, boxSizing: 'border-box',
            })} />
            <div style={box({ left: 596, top: 522 + i * 32, width: 148, height: 18, background: P.blue, opacity: arrived * 0.55 })} />
          </React.Fragment>
        );
      })}

      {links.map((l, i) => (
        <Path key={'k' + i} pts={[nodeMid(l[0]), nodeMid(l[1])]} color={P.hair} w={1}
              p={MOTION.draw(1.3 + i * 0.5, 0.6)(tl)} opacity={0.8} />
      ))}
      {nodes.map((n, i) => (
        <React.Fragment key={'m' + i}>
          <Rect x={n[0]} y={n[1]} w={96} h={72} stroke={P.hair} sw={1.5} fill={P.faint}
                style={{ opacity: MOTION.fade(0.3 + i * 0.16, 0.5)(tl) }} />
          <Hex w={44} sw={1.5 + 1.5 * verify[i]}
               stroke={mix(P.hair, P.gold, verify[i])}
               fill={mix(P.faint, P.gold, verify[i])}
               style={{ left: n[0] + 26, top: n[1] + 11, opacity: verify[i] > 0.01 ? 1 : 0 }} />
          <div style={box({ left: n[0] + 22, top: n[1] + 82, width: 52, height: 1, opacity: verify[i], backgroundImage: 'repeating-linear-gradient(90deg,' + P.goldText + ' 0 3px,transparent 3px 6px)' })} />
        </React.Fragment>
      ))}
      {reps.map((r, i) => {
        const a = nodeMid(links[r.l][0]), b = nodeMid(links[r.l][1]);
        const u = MOTION.arrive(r.at, 0, 1, 1.2)(tl);
        const o = MOTION.fade(r.at, 0.3)(tl) * (1 - MOTION.fade(r.at + 1.2, 0.3)(tl));
        const x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u;
        return <Hex key={'r' + i} w={34} sw={1.5} stroke={P.goldText} fill={mix(P.warm, P.gold, 0.35)} style={{ left: x - 17, top: y - 20, opacity: o }} />;
      })}
    </React.Fragment>
  );
}

// ── scene 6 — the shared invariant ─────────────────────────────────────────

function SceneInvariant(props) {
  const P = props.P, tl = props.tl;
  const lineO = MOTION.fade(1.2, 0.8)(tl);
  const track = 0.07 - 0.06 * MOTION.draw(1.2, 1.4)(tl);
  const ruleP = MOTION.draw(0.8, 1.2)(tl);
  const seq = ['turn', 'step', 'tool'];
  const hashes = ['a41f9c', '7b3e08', 'c0d5a2'];
  const bx = [660, 896, 1132];
  const hx = [684, 920, 1156];

  return (
    <React.Fragment>
      <div style={txt({
        left: 104, top: 386, width: 1712, textAlign: 'center', whiteSpace: 'normal',
        fontSize: 54, lineHeight: 1.25, color: P.ink, opacity: lineO, letterSpacing: track + 'em',
        transform: 'translateY(' + (14 * (1 - lineO)) + 'px)',
      })}>Anything the model saw must be rebuildable from the log.</div>
      <div style={box({ left: 960 - 360 * ruleP, top: 488, width: 360 * ruleP, height: 3, background: P.blue })} />
      <div style={box({ left: 960, top: 488, width: 360 * ruleP, height: 3, background: P.gold })} />

      {seq.map((s, i) => {
        const o = MOTION.fade(2.6 + i * 0.6, 0.5)(tl);
        return (
          <React.Fragment key={'b' + s}>
            <div style={box({
              left: bx[i], top: 606, width: 168, height: 62, opacity: o,
              border: '1.5px solid ' + P.blue, background: P.blueFill, boxSizing: 'border-box',
            })}>
              <div style={txt({ left: 0, top: 15, width: 166, textAlign: 'center', fontSize: 24, color: P.blueText })}>{s}</div>
            </div>
            {i < 2 ? <Path pts={[[bx[i] + 168, 637], [bx[i] + 236, 637]]} color={P.blue} w={1.5} p={MOTION.draw(3.0 + i * 0.6, 0.4)(tl)} /> : null}
          </React.Fragment>
        );
      })}

      {seq.map((s, i) => {
        const o = MOTION.fade(4.7 + i * 0.6, 0.5)(tl);
        const tie = MOTION.draw(6.9 + i * 0.3, 0.5)(tl);
        return (
          <React.Fragment key={'h' + s}>
            <Hex w={120} sw={2} stroke={P.gold} fill={mix(P.one, P.gold, 0.26)} style={{ left: hx[i], top: 730, opacity: o }}>
              <div style={{ fontFamily: SER, fontSize: 21, color: P.ink }}>{s}</div>
            </Hex>
            <div style={txt({
              left: hx[i], top: 890, width: 120, textAlign: 'center', fontSize: 15, letterSpacing: '0.1em',
              color: P.goldText, fontVariantNumeric: 'tabular-nums', opacity: MOTION.fade(5.0 + i * 0.6, 0.5)(tl),
            })}>{hashes[i]}</div>
            <Path pts={[[hx[i] + 60, 672], [hx[i] + 60, 730]]} color={P.soft} w={1} dash={[4, 5]} p={tie} opacity={0.5} />
          </React.Fragment>
        );
      })}
    </React.Fragment>
  );
}

// ── shared: a tag whose face slides from one value to another ───────────────

function Flip(p) {
  const t = clamp(p.t, 0, 1);
  const inner = p.h - 3;
  const lab = (v, dy, o) => (
    <div style={txt({ left: 0, width: p.w - 3, textAlign: 'center', top: (inner - 24) / 2 + dy, lineHeight: '24px', fontSize: p.size || 19, color: p.text, fontVariantNumeric: 'tabular-nums', opacity: o })}>{v}</div>
  );
  return (
    <div style={box({ left: p.x, top: p.y, width: p.w, height: p.h, border: '1.5px solid ' + (p.color || 'transparent'), overflow: 'hidden', boxSizing: 'border-box', opacity: p.opacity == null ? 1 : p.opacity })}>
      {lab(p.a, -inner * t, 1 - t)}
      {lab(p.b, inner * (1 - t), t)}
    </div>
  );
}

// ── scene — the same problem ────────────────────────────────────────────────

function SceneQuestion(props) {
  const P = props.P, tl = props.tl;
  const hostO = MOTION.fade(0.3, 0.6)(tl);
  const ys = [380, 500, 620];
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const left = i < 3;
    const y = ys[i % 3];
    const from = left ? 300 : 1620, to = left ? 790 : 980;
    parts.push({
      left: left, y: y,
      x: MOTION.arrive(1.0 + i * 0.35, from, to, 0.9)(tl),
      o: MOTION.fade(1.0 + i * 0.35, 0.4)(tl),
      res: MOTION.fade(4.6 + i * 0.3, 0.6)(tl),
    });
  }
  return (
    <React.Fragment>
      <Rect x={760} y={340} w={400} h={420} stroke={P.hair} sw={1.5} fill={P.faint} style={{ opacity: hostO }} />
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          <div style={box({ left: p.x, top: p.y, width: 150, height: 74, border: '1.5px dashed ' + P.soft, boxSizing: 'border-box', opacity: p.o * (1 - p.res) })} />
          {p.left
            ? <Rect x={p.x} y={p.y} w={150} h={74} stroke={P.blue} sw={1.5} fill={P.blueFill} style={{ opacity: p.res }} />
            : <Hex w={64} sw={2} stroke={P.gold} fill={mix(P.one, P.gold, 0.3)} style={{ left: p.x + 43, top: p.y, opacity: p.res }} />}
        </React.Fragment>
      ))}
    </React.Fragment>
  );
}

// ── scene — when a fix ships ────────────────────────────────────────────────

function SceneFix(props) {
  const P = props.P, tl = props.tl;
  const regO = MOTION.fade(0.3, 0.6)(tl);
  const flip = MOTION.draw(2.6, 0.55)(tl);
  const mx = [200, 400, 600];
  const rx = [1180, 1400, 1620];
  const newO = MOTION.fade(2.6, 0.6)(tl);
  return (
    <React.Fragment>
      <Rect x={300} y={340} w={240} h={84} stroke={P.hair} sw={1.5} fill={P.faint} style={{ opacity: regO }} />
      <div style={txt({ left: 318, top: 366, fontSize: 15, letterSpacing: '0.22em', color: P.soft, opacity: regO })}>REGISTRY</div>
      <Flip x={420} y={364} w={96} h={36} a="1.2.0" b="1.2.1" t={flip} color={P.blue} text={P.blueText} opacity={regO} />
      {mx.map((x, i) => {
        const wire = [[420, 424], [420, 520], [x + 70, 520], [x + 70, 620]];
        const pulse = MOTION.arrive(3.3 + i * 0.35, 0, 1, 0.8)(tl);
        const pt = pointOn(wire, pulse);
        const live = pulse > 0.01 && pulse < 0.99 ? 1 : 0;
        return (
          <React.Fragment key={i}>
            <Path pts={wire} color={P.hair} w={1} p={MOTION.draw(1.2 + i * 0.2, 0.6)(tl)} />
            <div style={box({ left: pt[0] - 5, top: pt[1] - 5, width: 10, height: 10, background: P.blue, opacity: live })} />
            <Rect x={x} y={620} w={140} h={90} stroke={P.hair} sw={1.5} fill={P.faint} style={{ opacity: MOTION.fade(0.6 + i * 0.15, 0.5)(tl) }} />
            <Flip x={x + 22} y={647} w={96} h={36} a="1.2.0" b="1.2.1" t={MOTION.draw(3.95 + i * 0.35, 0.5)(tl)} color={P.blue} text={P.blueText} opacity={MOTION.fade(0.8 + i * 0.15, 0.5)(tl)} />
          </React.Fragment>
        );
      })}

      <Hex w={110} sw={2} stroke={P.gold} fill={P.card} style={{ left: 1220, top: 322, opacity: MOTION.fade(0.5, 0.6)(tl) }}>
        <div style={{ fontFamily: SER, fontSize: 17, letterSpacing: '0.08em', color: P.soft }}>9f2a</div>
      </Hex>
      <Hex w={110} sw={2} stroke={P.gold} fill={P.card} style={{ left: 1500, top: 322, opacity: newO }}>
        <div style={{ fontFamily: SER, fontSize: 17, letterSpacing: '0.08em', color: P.soft }}>c71e</div>
      </Hex>
      {rx.map((x, i) => {
        const told = i < 2 ? MOTION.draw(3.9 + i * 1.4, 0.7)(tl) : 0;
        const sw = i < 2 ? MOTION.fade(4.6 + i * 1.4, 0.5)(tl) : 0;
        return (
          <React.Fragment key={i}>
            <Path pts={[[1555, 449], [1555, 540], [x + 70, 540], [x + 70, 620]]} color={P.gold} w={1} dash={[5, 5]} p={told} opacity={0.85} />
            <Rect x={x} y={620} w={140} h={90} stroke={P.hair} sw={1.5} fill={P.faint} style={{ opacity: MOTION.fade(0.7 + i * 0.15, 0.5)(tl) }} />
            <Hex w={52} sw={1.5} stroke={P.gold} fill={mix(mix(P.warm, P.gold, 0.3), P.gold, sw)} style={{ left: x + 44, top: 635, opacity: MOTION.fade(0.9 + i * 0.15, 0.5)(tl) }} />
            <Flip x={x + 22} y={716} w={96} h={30} a="9f2a" b={i < 2 ? 'c71e' : '9f2a'} t={sw} text={P.goldText} size={15} opacity={MOTION.fade(1.1 + i * 0.15, 0.5)(tl)} />
          </React.Fragment>
        );
      })}
    </React.Fragment>
  );
}

// ── scene — a year later ────────────────────────────────────────────────────

function SceneLater(props) {
  const P = props.P, tl = props.tl;
  const rail = MOTION.draw(0.4, 0.9)(tl);
  const tick = (x, label, at) => (
    <React.Fragment>
      <div style={box({ left: x, top: 593, width: 1, height: 14, background: P.soft, opacity: MOTION.fade(at, 0.4)(tl) })} />
      <div style={txt({ left: x - 30, top: 620, width: 60, textAlign: 'center', fontSize: 15, letterSpacing: '0.12em', color: P.soft, fontVariantNumeric: 'tabular-nums', opacity: MOTION.fade(at + 0.1, 0.4)(tl) })}>{label}</div>
    </React.Fragment>
  );
  const thenO = MOTION.fade(1.0, 0.6)(tl);
  const nowO = MOTION.fade(3.0, 0.6)(tl);
  const ghost = MOTION.draw(4.4, 0.9)(tl);
  const back = MOTION.draw(3.8, 0.7)(tl);

  const nowX = MOTION.arrive(2.8, 1700, 1565, 1.0)(tl);
  const nowY = MOTION.arrive(2.8, 300, 410, 1.0)(tl);
  const hexO = MOTION.fade(2.8, 0.5)(tl);
  const verify = MOTION.fade(4.0, 0.6)(tl);
  const match = MOTION.draw(4.7, 0.6)(tl);
  const face = (
    <div style={{ width: 130, textAlign: 'center' }}>
      <div style={{ fontFamily: SER, fontSize: 13, letterSpacing: '0.08em', lineHeight: 1.6, color: P.soft, fontVariantNumeric: 'tabular-nums' }}>9f2ac41d</div>
      <div style={{ fontFamily: SER, fontSize: 13, letterSpacing: '0.08em', lineHeight: 1.6, color: P.soft, fontVariantNumeric: 'tabular-nums' }}>7b6e0583</div>
    </div>
  );
  return (
    <React.Fragment>
      <Path pts={[[200, 600], [760, 600]]} color={P.hair} w={1.5} p={rail} />
      {tick(280, '2025', 0.9)}
      {tick(680, '2026', 2.8)}
      <div style={box({ left: 210, top: 440, width: 140, height: 60, boxSizing: 'border-box', opacity: thenO * (1 - 0.65 * ghost), border: '1.5px ' + (ghost > 0.5 ? 'dashed' : 'solid') + ' ' + P.blue, background: mix(P.cool, P.blue, 0.1 * (1 - ghost)) })}>
        <div style={txt({ left: 0, width: 137, textAlign: 'center', top: 16, fontSize: 19, color: P.blueText, fontVariantNumeric: 'tabular-nums' })}>1.2.0</div>
      </div>
      <Path pts={[[280, 592], [280, 500]]} color={P.blue} w={1.5} p={MOTION.draw(1.4, 0.5)(tl)} opacity={thenO * (1 - 0.65 * ghost)} />
      <div style={box({ left: 610, top: 440, width: 140, height: 60, boxSizing: 'border-box', opacity: nowO, border: '1.5px solid ' + P.blue, background: P.blueFill })}>
        <div style={txt({ left: 0, width: 137, textAlign: 'center', top: 16, fontSize: 19, color: P.blueText, fontVariantNumeric: 'tabular-nums' })}>1.4.0</div>
      </div>
      <Path pts={[[680, 592], [680, 500]]} color={P.blue} w={1.5} p={MOTION.draw(3.3, 0.5)(tl)} opacity={nowO} />
      <Path pts={[[680, 560], [350, 560], [350, 500]]} color={P.blue} w={1} dash={[5, 5]} p={back} opacity={0.7 * (1 - 0.8 * ghost)} />

      <Path pts={[[1160, 600], [1720, 600]]} color={P.hair} w={1.5} p={rail} />
      {tick(1240, '2025', 0.9)}
      {tick(1640, '2026', 2.8)}
      <Hex w={150} sw={2} stroke={P.gold} fill={P.card} style={{ left: 1165, top: 410, opacity: thenO }}>{face}</Hex>
      <Hex w={150} sw={2 + 1.5 * verify} stroke={mix(P.hair, P.gold, verify)} fill={P.card} style={{ left: nowX, top: nowY, opacity: hexO }}>{face}</Hex>
      {[1165, 1565].map((x, i) => (
        <div key={i} style={box({ left: x + 24, top: 542, width: 102 * match, height: 2, background: P.gold, opacity: 0.9 })} />
      ))}
      <Path pts={[[1315, 496], [1565, 496]]} color={P.gold} w={1} p={match} opacity={0.7} />
    </React.Fragment>
  );
}

// ── scene — close ───────────────────────────────────────────────────────────

function SceneClose(props) {
  const P = props.P, tl = props.tl;
  const o1 = MOTION.fade(1.6, 0.6)(tl), o2 = MOTION.fade(2.0, 0.6)(tl);
  return (
    <React.Fragment>
      <Rect x={104} y={640} w={132} h={46} stroke={P.blue} sw={1.5} fill={P.blueFill} style={{ opacity: o1 }} />
      <Path pts={[[330, 663], [250, 663]]} color={P.blue} w={1.5} p={MOTION.draw(1.9, 0.5)(tl)} opacity={o1} />
      <div style={box({ left: 236, top: 657, width: 13, height: 13, background: P.blue, opacity: o1 * MOTION.fade(2.3, 0.3)(tl), clipPath: 'polygon(100% 0, 100% 100%, 0 50%)' })} />
      <Hex w={56} sw={2} stroke={P.gold} fill={mix(P.one, P.gold, 0.3)} style={{ left: 1040, top: 634, opacity: o2 }} />
    </React.Fragment>
  );
}

// ── the voice ───────────────────────────────────────────────────────────────
// Narration is not a track laid over the film: it is one line per scene, each
// cued to the playback clock. Seeking, pausing and looping are the same
// operation for the voice as for the picture — read the clock, put the clip
// where the clock is. window.OM_NARRATION carries [{at, T, dur, text, src}]
// with the mp3s inlined as data uris (scripts/presentation/deepseek.cjs writes
// them, from the same cache and the same narrator as every other piece). With
// none present the composition is exactly what the canvas exported: silent.

const NARRATION = (() => {
  const raw = typeof window !== 'undefined' && window.OM_NARRATION;
  if (!raw) return [];
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return []; }
})();

function Narration(props) {
  const P = props.P;
  const on = props.on !== false;
  const c = useComposition();
  const time = c.time, playing = c.playing;
  const [blocked, setBlocked] = React.useState(false);
  const clips = React.useRef(null);
  const cur = React.useRef(-1);
  if (!clips.current) clips.current = NARRATION.map((n) => { const a = new Audio(n.src); a.preload = 'auto'; return a; });

  // Runs after every frame: the clock is the only state the voice reads.
  React.useEffect(() => {
    const list = clips.current;
    if (!list.length) return;
    const want = (on && playing)
      ? NARRATION.findIndex((n) => time >= n.at && time < n.at + n.dur)
      : -1;
    if (cur.current !== want && cur.current >= 0) list[cur.current].pause();
    cur.current = want;
    if (want < 0) return;
    const a = list[want], into = time - NARRATION[want].at;
    if (Math.abs(a.currentTime - into) > 0.25) a.currentTime = into;
    if (a.paused) {
      const p = a.play();
      if (p && p.then) p.then(() => setBlocked(false), () => setBlocked(true));
    }
  });

  // A browser hands audio over only after a gesture. Any gesture will do, so
  // the chip is a hint, not a control — it leaves as soon as the voice starts.
  React.useEffect(() => {
    if (!blocked) return;
    const retry = () => { const a = clips.current[cur.current]; if (a) { const p = a.play(); if (p && p.then) p.then(() => setBlocked(false), () => {}); } };
    window.addEventListener('pointerdown', retry);
    window.addEventListener('keydown', retry);
    return () => { window.removeEventListener('pointerdown', retry); window.removeEventListener('keydown', retry); };
  }, [blocked]);

  React.useEffect(() => () => { for (const a of clips.current || []) a.pause(); }, []);

  if (!NARRATION.length || !blocked) return null;
  return (
    <div onClick={() => setBlocked(false)} style={{
      position: 'absolute', right: 48, bottom: 48, display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 22px', background: P.card, border: '1px solid ' + P.hair,
      fontFamily: SER, fontSize: 22, color: P.soft, cursor: 'pointer',
    }}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={P.gold} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4zM17 8.5a5 5 0 010 7M20 6a9 9 0 010 12" /></svg>
      click for sound
    </div>
  );
}

// ── the piece ───────────────────────────────────────────────────────────────

const ORDER = ['Title', 'Question', 'Unit', 'Identity', 'Fix', 'Later', 'Memory', 'Distribution', 'Invariant', 'Close'];
const HEADS = {
  Title: '', Question: 'The same problem', Unit: 'The unit', Identity: 'Identity',
  Fix: 'When a fix ships', Later: 'A year later', Memory: 'Memory', Distribution: 'Distribution',
  Invariant: 'The shared invariant', Close: 'Choose by what you fear',
};
const SCENES = {
  Question: SceneQuestion, Unit: SceneUnit, Identity: SceneIdentity, Fix: SceneFix, Later: SceneLater,
  Memory: SceneMemory, Distribution: SceneDistribution, Invariant: SceneInvariant, Close: SceneClose,
};

function Piece(props) {
  const c = useComposition();
  const T = c.T, CUES = c.CUES;
  const P = props.P;
  const at = (n) => CUES[n];
  const dur = {};
  ORDER.forEach((n, i) => { dur[n] = (i + 1 < ORDER.length ? at(ORDER[i + 1]) : c.authoredTotal) - at(n); });
  let hi = 0;
  ORDER.forEach((n, i) => { if (T >= at(n)) hi = i; });
  const cur = ORDER[hi];
  const next = hi + 1 < ORDER.length ? at(ORDER[hi + 1]) : Infinity;
  const gate = clamp(Math.min((T - at(cur)) / 0.3, (next - T) / 0.3), 0, 1);

  // names: title → column label → sequence label → back to title
  const cl = MOTION.draw(at('Close') - 0.3, 1.4)(T);
  const m = MOTION.draw(at('Question') - 0.7, 1.4)(T) * (1 - cl);
  const cv = MOTION.draw(at('Invariant') - 0.5, 1.6)(T) * (1 - cl);
  const size = 76 + (24 - 76) * m;
  const top = 470 + (248 - 470) * m;
  const L = { left: 104 + (360 - 104) * cv, top: top + (624 - 248) * cv };
  const R = { left: 1040 + (360 - 1040) * cv, top: top + (784 - 248) * cv };
  const conv = 1 - MOTION.fade(at('Invariant') + 0.4, 1.4)(T);
  const small = 1 - clamp(m * 2.5, 0, 1);

  const nameEl = (pos, label, accent) => (
    <React.Fragment>
      <div style={txt({ left: pos.left, top: pos.top, fontSize: size, fontWeight: 600, letterSpacing: '-0.012em', color: P.ink, opacity: 1 - m })}>{label}</div>
      <div style={txt({ left: pos.left, top: pos.top, fontSize: size, fontWeight: 600, letterSpacing: '0.02em', color: accent, opacity: m })}>{label}</div>
    </React.Fragment>
  );

  const sceneGate = (cue, len, hold) => {
    const tl = T - cue;
    const out = hold ? 0 : MOTION.fade(len - 0.45, 0.4)(tl);
    return clamp(Math.min(MOTION.fade(0.05, 0.4)(tl), 1 - out), 0, 1);
  };
  const camera = (cue, len) => {
    const u = clamp((T - cue) / len, 0, 1);
    return 'scale(' + (1 + 0.02 * u) + ') translateY(' + (-7 * u) + 'px)';
  };
  const layer = (cue, len, hold) => ({
    position: 'absolute', inset: 0, opacity: sceneGate(cue, len, hold),
    transform: camera(cue, len), transformOrigin: '50% 55%',
  });
  const idx = String(hi + 1).padStart(2, '0');

  // The words are the narration's — one place for them, spoken and shown. The
  // canvas has no narration, so the authored list below is what it still uses.
  const caps = NARRATION.length ? NARRATION.map((n) => ({ at: n.T, text: n.text })) : [
    { at: at('Title') + 2.1, until: at('Title') + 5.5, text: 'Two ways to say everything is a module.' },
    { at: at('Question') + 5.2, until: at('Question') + 7.6, text: 'Every agent runs code it did not write. How do you trust a part?' },
    { at: at('Unit') + 5.4, until: at('Unit') + 8.6, text: 'A plugin joins a tree. A drone lands on a grid.' },
    { at: at('Identity') + 5.6, until: at('Identity') + 8.6, text: 'A pointer can move. A hash cannot.' },
    { at: at('Fix') + 5.8, until: at('Fix') + 9.6, text: 'Move the pointer and everyone is patched. Move the hash and everyone must be told.' },
    { at: at('Later') + 5.6, until: at('Later') + 9.6, text: 'A pointer tells you what is current. A hash tells you what was.' },
    { at: at('Memory') + 5.8, until: at('Memory') + 8.6, text: 'Both append. Only one never migrates.' },
    { at: at('Distribution') + 6.2, until: at('Distribution') + 8.6, text: 'Install from a registry. Or replicate and verify.' },
    { at: at('Invariant') + 6.4, until: at('Invariant') + 9.6, text: 'One rule both systems agree on.' },
    { at: at('Close') + 2.6, text: 'Fear silent drift, pin by hash. Fear frozen bugs, point and move.' },
  ];

  return (
    <React.Fragment>
      <div style={box({ inset: 0, background: P.one })} />
      <div style={box({ left: 0, top: 0, width: 960, bottom: 0, background: P.cool, opacity: conv })} />
      <div style={box({ left: 960, top: 0, right: 0, bottom: 0, background: P.warm, opacity: conv })} />

      <Furniture P={P} on={props.furniture !== false} idx={idx} idxOpacity={gate} />

      <div style={txt({ left: 104, top: 138, fontSize: 62, fontWeight: 600, letterSpacing: '-0.014em', color: P.ink, opacity: gate })}>{HEADS[cur]}</div>

      {nameEl(L, 'DeepSeek Harness', P.blueText)}
      {nameEl(R, 'Hypercomb', P.goldText)}
      <div style={txt({ left: L.left, top: L.top - 70 + 50 * m, width: 200 * (1 - m) + 64 * m, height: 4 - 2 * m, background: P.blue, opacity: MOTION.fade(0.9, 0.8)(T) })} />
      <div style={txt({ left: R.left, top: R.top - 70 + 50 * m, width: 200 * (1 - m) + 64 * m, height: 4 - 2 * m, background: P.gold, opacity: MOTION.fade(1.4, 0.8)(T) })} />
      <div style={txt({ left: 104, top: 424, fontSize: 21, letterSpacing: '0.28em', color: P.blueText, opacity: MOTION.fade(0.5, 0.6)(T) * small })}>DSH</div>
      <div style={txt({ left: 1040, top: 424, fontSize: 21, letterSpacing: '0.28em', color: P.goldText, opacity: MOTION.fade(1.0, 0.6)(T) * small })}>HYPERCOMB</div>
      <Hex w={46} sw={0} stroke="none" fill={P.gold} style={{ left: 1502, top: 486, opacity: MOTION.fade(1.9, 0.7)(T) * small }}>
        <div style={{ fontFamily: SER, fontSize: 27, fontWeight: 600, color: P.warm, marginTop: -1 }}>H</div>
      </Hex>

      {ORDER.slice(1).map((n, i) => {
        const last = n === 'Close';
        return (
          <Shot key={n} from={at(n)} to={last ? undefined : at(ORDER[i + 2])}>
            <div style={layer(at(n), dur[n], last)}>{React.createElement(SCENES[n], { P: P, tl: T - at(n) })}</div>
          </Shot>
        );
      })}

      <Captions
        style={{
          left: '5.42%', right: '38%', bottom: '7.4%', textAlign: 'left',
          font: '400 30px ' + SER, color: P.soft, textShadow: 'none', lineHeight: 1.3,
          whiteSpace: 'normal',
        }}
        items={caps}
      />
    </React.Fragment>
  );
}

function ModuleComparison(props) {
  const P = pal(props.theme === 'dark' ? 'dark' : 'light');
  return (
    <CompositionStage width={1920} height={1080} scenes={window.OM_SCENES} playback={window.OM_PLAYBACK} bg={P.one}>
      <Piece P={P} furniture={props.furniture} />
      <Narration P={P} on={props.narration !== false} />
    </CompositionStage>
  );
}

window.ModuleComparison = ModuleComparison;
