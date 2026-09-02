// hypercomb-story.jsx — the Hypercomb ecosystem in one continuous composition.
// Built on animations-v3.jsx (CompositionStage / useComposition) + tweaks-panel.jsx.
const { useComposition, Captions, Easing, clamp, CompositionStage, TweaksPanel, useTweaks, TweakSection, TweakToggle } = window;

// Hypercomb "bloom" theme tokens — [data-theme=bloom] in the shell stylesheet, inlined so the exported svg is self-describing.
// accent = --md-primary, "sage" slot = --md-secondary (coral), violet = --md-tertiary / --hc-status-branch.
const C = { bg:'#f2fbf7', surface:'#e3f3ec', text:'#0f2a22', accent:'#0d7a5f', a100:'#e6f6ef', a200:'#b6ecd9', a300:'#8fdcc0', a400:'#5cc4a0', a700:'#0a5f4a',
  sage:'#e0563f', s100:'#fff0ec', s200:'#ffd9d0', s300:'#ffbfb0', s400:'#f39a86', s700:'#8a2a18', n200:'#ecf8f2', n300:'#d6ece2', n400:'#c5e2d5', n500:'#7e9c90', n700:'#3f6357', n900:'#04160f',
  violet:'#6b4fd1', violetC:'#ded4ff', branch:'#6b3a86', ok:'#08745a', swarm:'#175f8a', glass:'rgba(246,253,250,0.86)', pane:'rgba(249,254,252,0.96)', rule:'rgba(46,100,84,0.35)', line:'rgba(15,42,34,0.14)', lineFirm:'rgba(15,42,34,0.26)', tint:'rgba(15,42,34,0.045)' };
const HEAD = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
const BODY = '"Source Sans 3", "Source Sans Pro", "Segoe UI", system-ui, sans-serif';
const MONO = '"JetBrains Mono", "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';
const R = { control: 2, card: 3, floating: 4 }; // --hc-radius-*

// The only three motion helpers.
const MOTION = {
  enter(T, start, dur = 0.8) { const e = Easing.easeOutCubic(clamp((T - start) / dur, 0, 1)); return { opacity: e, transform: `translateY(${(1 - e) * 28}px)` }; },
  draw(T, start, dur = 1) { return Easing.easeInOutCubic(clamp((T - start) / dur, 0, 1)); },
  pop(T, start, dur = 0.6) { const u = clamp((T - start) / dur, 0, 1); return u <= 0 ? 0 : Easing.easeOutBack(u); },
};
const lerp = (a, b, u) => a + (b - a) * u;

// ── hex geometry ─────────────────────────────────────────────────────────────
const SQ3 = Math.sqrt(3);
function hexD(r) { let d = ''; for (let k = 0; k < 6; k++) { const a = (Math.PI / 180) * (60 * k - 30); d += (k ? 'L' : 'M') + (r * Math.cos(a)).toFixed(2) + ' ' + (r * Math.sin(a)).toFixed(2); } return d + 'Z'; }
function axialXY(q, r, s) { return { x: s * SQ3 * (q + r / 2), y: s * 1.5 * r }; }
function rings(n) { const out = []; for (let q = -n; q <= n; q++) for (let r = -n; r <= n; r++) { const s = -q - r; const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(s)); if (ring <= n) out.push({ q, r, ring, ang: Math.atan2(r, q) }); } return out.sort((a, b) => a.ring - b.ring || a.ang - b.ang); }
function Hex({ x, y, r, fill = C.surface, stroke = C.n400, sw = 3, scale = 1, opacity = 1, dash }) {
  if (scale <= 0 || opacity <= 0) return null;
  return <path d={hexD(r)} transform={`translate(${x} ${y}) scale(${scale})`} fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" opacity={opacity} strokeDasharray={dash} />;
}
function fakeSig(seed, n = 64) { let x = (seed * 2654435761) >>> 0, s = ''; for (let i = 0; i < n; i++) { x = (x * 1664525 + 1013904223) >>> 0; s += (x >>> 28).toString(16); } return s; }
const short = (s) => s.slice(0, 4) + '…' + s.slice(-4);
function bez(p0, p1, p2, u) { const a = 1 - u; return { x: a * a * p0.x + 2 * a * u * p1.x + u * u * p2.x, y: a * a * p0.y + 2 * a * u * p1.y + u * u * p2.y }; }

// ── small typographic atoms ─────────────────────────────────────────────────
const SLOT = 2200;
function Slot({ i, children, opacity = 1 }) { return <div style={{ position: 'absolute', left: i * SLOT, top: 0, width: 1920, height: 1080, opacity }}>{children}</div>; }
function Kicker({ x, y, children, T, at, show = true, color = C.accent, align = 'left', w = 760 }) {
  const m = MOTION.enter(T, at);
  return <div style={{ position: 'absolute', left: x, top: y, width: w, whiteSpace: 'nowrap', textAlign: align, font: `400 22px ${BODY}`, letterSpacing: '0.16em', textTransform: 'uppercase', color, opacity: show ? m.opacity : 0, transform: m.transform }}>{children}</div>;
}
function Mono({ x, y, w = 800, children, T, at, size = 26, color = C.n700, align = 'left' }) {
  const m = MOTION.enter(T, at);
  return <div style={{ position: 'absolute', left: x, top: y, width: w, textAlign: align, font: `400 ${size}px ${MONO}`, color, opacity: m.opacity, transform: m.transform, whiteSpace: 'nowrap' }}>{children}</div>;
}
function Pill({ x, y, children, T, at, bg = C.a100, color = C.a700, size = 22, w }) {
  const p = MOTION.pop(T, at);
  return <div style={{ position: 'absolute', left: x, top: y, width: w, padding: '10px 22px', borderRadius: R.card, background: bg, border: `1px solid ${C.lineFirm}`, color, font: `300 ${size}px ${BODY}`, whiteSpace: 'nowrap', transform: `scale(${p})`, opacity: p > 0 ? 1 : 0, transformOrigin: 'center', boxSizing: 'border-box', textAlign: 'center' }}>{children}</div>;
}

// ── tool window (the docked panel every shell surface uses) ──
function ToolWindow({ x, y, w, h, T, at, icon, title, crumb, children, compact, bare }) {
  const m = MOTION.enter(T, at, 0.7);
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, borderRadius: R.floating, background: bare ? 'transparent' : C.pane, border: `1px solid ${C.line}`, boxShadow: bare ? 'none' : '0 4px 8px 3px rgba(10,70,55,.08), 0 1px 3px rgba(10,70,55,.12)', boxSizing: 'border-box', padding: compact ? '14px 18px' : '18px 22px', ...m }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: compact ? 10 : 16 }}>
        <div style={{ width: 34, height: 34, borderRadius: R.card, background: C.a200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Glyph d={icon} on size={20} /></div>
        <span style={{ font: `300 24px ${BODY}`, color: C.text }}>{title}</span><span style={{ font: `300 24px ${BODY}`, color: C.n500 }}>/</span><span style={{ font: `300 24px ${BODY}`, color: C.n700 }}>{crumb}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 14 }}><Glyph d="M4 6h16M7 12h10M10 18h4" size={20} /><Glyph d="M6 6l12 12M18 6L6 18" size={20} /></div>
      </div>
      {children}
    </div>
  );
}
function Row({ name, cmd, desc, on, lit, T, at, compact }) {
  const m = MOTION.enter(T, at, 0.5);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: compact ? '8px 14px' : '12px 16px', marginBottom: compact ? 6 : 10, borderRadius: R.card, background: on ? C.a100 : C.n200, border: `1px solid ${on ? C.a300 : C.line}`, ...m }}>
      <div style={{ width: compact ? 30 : 38, height: compact ? 30 : 38, borderRadius: R.card, background: C.pane, border: `1px solid ${C.line}`, flex: 'none' }} />
      <span style={{ font: `400 ${compact ? 19 : 21}px ${MONO}`, color: on ? C.text : C.n700, whiteSpace: 'nowrap', flex: 'none' }}>{name}</span>
      <span style={{ font: `300 13px ${MONO}`, color: on ? C.a700 : C.n500, border: `1px solid ${on ? C.a300 : C.line}`, borderRadius: R.control, padding: '2px 7px' }}>{cmd}</span>
      {desc && <span style={{ font: `400 14px ${MONO}`, color: C.n500, marginLeft: 6, whiteSpace: 'nowrap' }}>{desc}</span>}
      <svg width="20" height="20" viewBox="0 0 24 24" style={{ marginLeft: 'auto', flex: 'none' }} fill={lit ? '#f3c24a' : 'none'} stroke={lit ? '#b8860b' : C.n500} strokeWidth="1.6"><path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A6 6 0 0012 3z" /></svg>
    </div>
  );
}

// ── 1. Cell ──────────────────────────────────────────────────────────────────
const SIG0 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
function CellSec({ T, t0, labels }) {
  const p = MOTION.pop(T, t0 + 0.2, 0.9);
  const typed = Math.floor(MOTION.draw(T, t0 + 2.0, 1.8) * 64);
  return (
    <Slot i={0}>
      <svg width="1920" height="1080" style={{ position: 'absolute', inset: 0 }}>
        <g transform={`translate(960 470) scale(${p})`}>
          <path d={hexD(190)} fill={C.surface} stroke={C.accent} strokeWidth="7" strokeLinejoin="round" />
          {[0, 1, 2].map(k => { const d = MOTION.draw(T, t0 + 1.0 + k * 0.25, 0.45); return <rect key={k} x={-96} y={-44 + k * 34} width={Math.max(0.01, (k === 1 ? 140 : 192) * d)} height={16} rx={8} fill={k === 0 ? C.accent : C.n500} />; })}
        </g>
      </svg>
      <Kicker x={660} y={200} T={T} at={t0 + 0.5} show={labels} align="center">one cell · its content</Kicker>
      <Mono x={160} y={720} w={1600} align="center" T={T} at={t0 + 1.9} size={30} color={C.n700}>
        <span style={{ color: C.accent }}>sha-256 → </span>{SIG0.slice(0, typed)}<span style={{ opacity: typed < 64 && Math.floor(T * 3) % 2 ? 1 : 0 }}>▍</span>
      </Mono>
    </Slot>
  );
}

// ── 2. Hive ──────────────────────────────────────────────────────────────────
const HIVE = rings(2);
const SIG1 = fakeSig(9);
function HiveSec({ T, t0, labels }) {
  const L = T - t0;
  const size = lerp(190, 62, MOTION.draw(T, t0 - 0.3, 1.1));
  const gap = 68;
  const cx = 960, cy = 470;
  const leaf = { q: 2, r: -1 }, mid = { q: 1, r: 0 };
  const isLeaf = c => c.q === leaf.q && c.r === leaf.r, isMid = c => c.q === mid.q && c.r === mid.r;
  const wLeaf = MOTION.draw(T, t0 + 3.2, 0.35), wMid = MOTION.draw(T, t0 + 3.75, 0.35), wRoot = MOTION.draw(T, t0 + 4.3, 0.4);
  const pl = axialXY(leaf.q, leaf.r, gap), pm = axialXY(mid.q, mid.r, gap);
  const lineD = MOTION.draw(T, t0 + 3.4, 1.1);
  const lineLen = Math.hypot(pl.x, pl.y) + Math.hypot(pm.x, pm.y);
  const sigSwap = MOTION.draw(T, t0 + 4.6, 0.6);
  return (
    <Slot i={1}>
      <svg width="1920" height="1080" style={{ position: 'absolute', inset: 0 }}>
        <g transform={`translate(${cx} ${cy})`}>
          {HIVE.map((c, k) => {
            const { x, y } = axialXY(c.q, c.r, gap);
            const s = c.ring === 0 ? 1 : MOTION.pop(T, t0 + 0.5 + c.ring * 0.55 + k * 0.045, 0.7);
            let fill = C.surface, stroke = C.n400, sw = 3;
            if (isLeaf(c) && wLeaf > 0) { fill = C.a300; stroke = C.accent; sw = 5; }
            if (isMid(c) && wMid > 0) { fill = C.a200; stroke = C.accent; sw = 5; }
            if (c.ring === 0) { fill = wRoot > 0 ? C.a300 : C.surface; stroke = C.accent; sw = 6; }
            return <Hex key={k} x={x} y={y} r={c.ring === 0 ? size : 62} fill={fill} stroke={stroke} sw={sw} scale={s} />;
          })}
          <path d={`M${pl.x} ${pl.y} L${pm.x} ${pm.y} L0 0`} fill="none" stroke={C.accent} strokeWidth="6" strokeLinecap="round" strokeDasharray={lineLen} strokeDashoffset={lineLen * (1 - lineD)} opacity={lineD > 0 ? 1 : 0} />
        </g>
      </svg>
      <Kicker x={160} y={200} T={T} at={t0 + 1.2} show={labels}>the hive · cells compose</Kicker>
      <Kicker x={cx + pl.x + 60} y={cy + pl.y - 16} T={T} at={t0 + 3.0} show={labels && L > 3.0}>write in a leaf</Kicker>
      <Kicker x={cx - 300} y={cy + 280} T={T} at={t0 + 4.3} show={labels && L > 4.3} align="center">root re-signed</Kicker>
      <div style={{ position: 'absolute', left: 160, top: 860, width: 1600, textAlign: 'center', font: `400 30px ${MONO}`, color: C.n700 }}>
        <span style={{ position: 'absolute', left: 0, right: 0, ...MOTION.enter(T, t0 + 1.4), opacity: Math.min(MOTION.enter(T, t0 + 1.4).opacity, 1 - Math.min(1, sigSwap * 2)) }}>root · {SIG0}</span>
        <span style={{ opacity: Math.max(0, sigSwap * 2 - 1), position: 'absolute', left: 0, right: 0, color: C.accent }}>root · {SIG1}</span>
      </div>
    </Slot>
  );
}

// ── 3. Pools of meaning ──────────────────────────────────────────────────────
const ROWS = Array.from({ length: 12 }, (_, i) => fakeSig(100 + i));
const POOLS = [
  { x: 1300, y: 330, r: 110, label: "sign('bees')", rows: [1, 4, 7] },
  { x: 1600, y: 560, r: 92, label: "sign('manifests')", rows: [2, 9] },
  { x: 1290, y: 760, r: 100, label: "sign('optimization')", rows: [5, 10] },
];
function PoolsSec({ T, t0, labels }) {
  const L = T - t0;
  const rowY = i => 262 + i * 46;
  const strike = MOTION.draw(T, t0 + 6.0, 0.5);
  const gone = MOTION.draw(T, t0 + 6.8, 0.6);
  return (
    <Slot i={2}>
      <ToolWindow x={170} y={140} w={900} h={720} T={T} at={t0 + 0.1} icon="M4 6h16v12H4zM4 10h16" title="Store" crumb="opfs root" bare />
      <Kicker x={220} y={205} T={T} at={t0 + 0.2} show={labels} color={C.n500}>flat · sig-named · no folders</Kicker>
      {ROWS.map((s, i) => { const m = MOTION.enter(T, t0 + 0.4 + i * 0.11, 0.6); return (
        <div key={i} style={{ position: 'absolute', left: 200, top: rowY(i), width: 840, height: 38, display: 'flex', alignItems: 'center', gap: 16, borderRadius: R.control, background: i % 2 ? 'transparent' : C.n200, padding: '0 18px', boxSizing: 'border-box', ...m }}>
          <svg width="22" height="22" viewBox="-11 -11 22 22"><path d={hexD(10)} fill={C.n400} /></svg>
          <span style={{ font: `400 17px ${MONO}`, color: C.n700, whiteSpace: 'nowrap' }}>{s}</span>
        </div>); })}
      <svg width="1920" height="1080" style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <radialGradient id="oasisWater" cx="45%" cy="40%" r="65%"><stop offset="0" stopColor="#dff7ef" /><stop offset="0.7" stopColor="#8fdcc0" /><stop offset="1" stopColor="#3aa88a" /></radialGradient>
          <radialGradient id="oasisShore" cx="50%" cy="50%" r="50%"><stop offset="0.72" stopColor="#f6e7b8" stopOpacity="0" /><stop offset="0.86" stopColor="#f6e7b8" stopOpacity="0.9" /><stop offset="1" stopColor="#e8d39a" stopOpacity="0" /></radialGradient>
        </defs>
        {POOLS.map((p, k) => { const s = MOTION.pop(T, t0 + 2.0 + k * 0.4, 0.8); const ph = T * 0.8 + k;
          const blob = `M${-p.r} 0 C${-p.r} ${-p.r * 0.62} ${-p.r * 0.55} ${-p.r * 1.02} ${p.r * 0.1} ${-p.r * 0.92} C${p.r * 0.75} ${-p.r * 0.82} ${p.r * 1.06} ${-p.r * 0.3} ${p.r * 0.94} ${p.r * 0.32} C${p.r * 0.82} ${p.r * 0.95} ${p.r * 0.1} ${p.r * 1.05} ${-p.r * 0.45} ${p.r * 0.85} C${-p.r * 0.95} ${p.r * 0.62} ${-p.r} ${p.r * 0.3} ${-p.r} 0Z`;
          return (
          <g key={k} transform={`translate(${p.x} ${p.y}) scale(${s})`} opacity={s > 0 ? 1 : 0}>
            <circle r={p.r * 1.22} fill="url(#oasisShore)" />
            <path d={blob} fill="url(#oasisWater)" stroke="#2f9a7c" strokeWidth="2" opacity="0.95" />
            {[0, 1, 2].map(i => { const u = ((ph * 0.35 + i / 3) % 1); return <ellipse key={i} rx={p.r * (0.15 + 0.7 * u)} ry={p.r * (0.09 + 0.42 * u)} cx={-p.r * 0.05} cy={p.r * 0.05} fill="none" stroke="#ffffff" strokeWidth="1.6" opacity={(1 - u) * 0.75} />; })}
            <ellipse cx={-p.r * 0.3} cy={-p.r * 0.35} rx={p.r * 0.22} ry={p.r * 0.09} fill="#ffffff" opacity="0.45" />
            {p.rows.map((ri, j) => <g key={j} transform={`translate(${-p.r * 0.35 + j * p.r * 0.32} ${-p.r * 0.05 + Math.sin(ph * 1.6 + j) * 3})`}><path d={hexD(11)} fill={C.pane} stroke={C.a700} strokeWidth="1.5" /></g>)}
            {/* reeds and a small palm on the shore */}
            <g transform={`translate(${-p.r * 0.92} ${p.r * 0.55})`} stroke="#2a7a5c" strokeWidth="2.2" strokeLinecap="round" fill="none"><path d={`M0 0q-4 -22 -2 -40`} transform={`rotate(${Math.sin(ph) * 3})`} /><path d="M6 2q2 -20 10 -34" transform={`rotate(${Math.sin(ph + 1) * 3})`} /><path d="M-6 3q-8 -14 -14 -26" transform={`rotate(${Math.sin(ph + 2) * 3})`} /></g>
            <g transform={`translate(${p.r * 0.86} ${-p.r * 0.62})`}><path d="M0 26q-2 -14 0 -26" stroke="#6b4a2b" strokeWidth="3" strokeLinecap="round" fill="none" />{[-70, -30, 10, 50, 100, 150].map((a, i) => <path key={i} d="M0 0q14 -6 28 -2q-12 6 -28 2z" fill="#2a7a5c" transform={`rotate(${a + Math.sin(ph + i) * 2})`} />)}</g>
            <text y={p.r * 1.42} textAnchor="middle" fill={C.a700} style={{ font: `400 20px ${MONO}` }}>{p.label}</text>
          </g>); })}
        {POOLS.map((p, k) => p.rows.map((ri, j) => {
          const d = MOTION.draw(T, t0 + 3.4 + k * 0.5 + j * 0.25, 0.7);
          const x0 = p.x - p.r * 0.35 + j * p.r * 0.32, y0 = p.y - p.r * 0.05, x1 = 1045, y1 = rowY(ri) + 19;
          const c1 = { x: x0 - 260, y: y0 }, len = 700;
          return <g key={k + '-' + j} opacity={d > 0 ? 1 : 0}>
            <path d={`M${x0} ${y0} Q${c1.x} ${c1.y} ${x1} ${y1}`} fill="none" stroke="#3aa88a" strokeWidth="5" strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - d)} opacity="0.35" />
            <path d={`M${x0} ${y0} Q${c1.x} ${c1.y} ${x1} ${y1}`} fill="none" stroke="#ffffff" strokeWidth="1.6" strokeDasharray={`6 ${len}`} strokeDashoffset={-((T * 90) % (len + 6)) + len * (1 - d)} opacity="0.9" />
          </g>;
        }))}
      </svg>
      <div style={{ position: 'absolute', left: 1500, top: 150, whiteSpace: 'nowrap', ...MOTION.enter(T, t0 + 5.4), opacity: Math.min(MOTION.enter(T, t0 + 5.4).opacity, 1 - gone) }}>
        <div style={{ position: 'relative', display: 'inline-block', padding: '10px 22px', borderRadius: R.control, background: C.n300, color: C.n700, font: `300 24px ${MONO}` }}>__bees__/
          <div style={{ position: 'absolute', left: 8, right: 8, top: '50%', height: 4, borderRadius: 2, background: C.accent, transform: `scaleX(${strike})`, transformOrigin: 'left' }} />
        </div>
        <div style={{ font: `400 20px ${BODY}`, color: C.a700, marginTop: 8, opacity: strike }}>meaning is never a folder name</div>
      </div>
      <Kicker x={1130} y={960} T={T} at={t0 + 2.4} show={labels && L > 2.4} color={C.a700}>pools of meaning · an oasis for information</Kicker>
    </Slot>
  );
}

// ── 4. Views ─────────────────────────────────────────────────────────────────
const VIEWS = ['Living Brief', 'Evidence Atlas', 'Knowledge Studio'];
const VKIND = ['visual:document:living-brief', 'visual:document:evidence-atlas', 'visual:document:knowledge-studio'];
const CATS = ['lounge', 'flavor', 'history'];
function ViewsSec({ T, t0, labels }) {
  const L = T - t0;
  const vi = L < 4.2 ? 0 : L < 7.2 ? 1 : 2;
  const fadeAt = [t0 + 1.4, t0 + 4.2, t0 + 7.2];
  const vo = k => { const on = MOTION.draw(T, fadeAt[k], 0.5); const off = k < 2 ? MOTION.draw(T, fadeAt[k + 1], 0.5) : 0; return Math.max(0, on - off); };
  const cardM = MOTION.enter(T, t0 + 1.2, 1);
  const nodeS = (k) => MOTION.pop(T, t0 + 0.3 + k * 0.12, 0.6);
  const Node = ({ x, y, w, h, s, fill, stroke, children, font }) => (
    <div style={{ position: 'absolute', left: x - w / 2, top: y - h / 2, width: w, height: h, borderRadius: R.card, background: fill, border: `2px solid ${stroke}`, display: 'flex', alignItems: 'center', justifyContent: 'center', font: font || `600 22px ${BODY}`, color: C.text, transform: `scale(${s})`, opacity: s > 0 ? 1 : 0, boxSizing: 'border-box' }}>{children}</div>
  );
  return (
    <Slot i={3}>
      <Kicker x={980} y={150} T={T} at={t0 + 0.2} show={labels}>one hierarchy · /views</Kicker>
      <svg width="1920" height="1080" style={{ position: 'absolute', inset: 0 }}>
        {CATS.map((c, k) => { const d = MOTION.draw(T, t0 + 0.6 + k * 0.12, 0.5); const x = 1080 + k * 200; return <g key={k}>
          <path d={`M1280 340 C1280 400 ${x} 380 ${x} 450`} fill="none" stroke={C.n400} strokeWidth="3" strokeDasharray="200" strokeDashoffset={200 * (1 - d)} />
          {[0, 1].map(j => { const d2 = MOTION.draw(T, t0 + 0.9 + k * 0.12 + j * 0.1, 0.5); return <path key={j} d={`M${x} 480 C${x} 530 ${x - 40 + j * 80} 520 ${x - 40 + j * 80} 570`} fill="none" stroke={C.n400} strokeWidth="3" strokeDasharray="120" strokeDashoffset={120 * (1 - d2)} />; })}
        </g>; })}
      </svg>
      <Node x={1280} y={310} w={220} h={62} s={nodeS(0)} fill={C.a200} stroke={C.accent} font={`400 26px ${HEAD}`}>journal</Node>
      {CATS.map((c, k) => <Node key={c} x={1080 + k * 200} y={465} w={150} h={50} s={nodeS(1 + k)} fill={C.surface} stroke={C.n400}>{c}</Node>)}
      {CATS.map((c, k) => [0, 1].map(j => <Node key={c + j} x={1040 + k * 200 + j * 80} y={590} w={58} h={34} s={nodeS(4 + k * 2 + j)} fill={j ? C.s200 : C.n200} stroke={j ? C.s400 : C.n300} font={`500 14px ${BODY}`}>{j ? 'tag' : 'note'}</Node>))}
      <div style={{ position: 'absolute', left: 1000, top: 640, width: 760, whiteSpace: 'nowrap', font: `400 19px ${MONO}`, color: C.a700, background: C.a100, border: `1px solid ${C.line}`, borderRadius: R.control, padding: '10px 18px', textAlign: 'center', ...MOTION.enter(T, t0 + 1.6) }}>
        declaration on root · {VKIND[vi]}
      </div>
      <Kicker x={1000} y={700} T={T} at={t0 + 1.9} show={labels} color={C.n700}>no html, no scripts — a trusted kind</Kicker>
      <ToolWindow x={1010} y={740} w={780} h={236} T={T} at={t0 + 0.9} icon="M12 3l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6L7.1 18.2l.9-5.5-4-3.9L9.5 8z" title="Views" crumb="journal" compact>
        {VIEWS.map((v, k) => <Row key={v} name={v} cmd={['/brief', '/atlas', '/studio'][k]} on={vi === k} lit={vi === k} T={T} at={t0 + 1.0 + k * 0.12} compact />)}
      </ToolWindow>
      {/* the document card */}
      <div style={{ position: 'absolute', left: 120, top: 120, width: 800, height: 800, borderRadius: R.floating, background: C.pane, border: `1px solid ${C.line}`, boxShadow: '0 6px 10px 4px rgba(10,70,55,.08), 0 2px 3px rgba(10,70,55,.12)', overflow: 'hidden', ...cardM }}>
        {/* brief */}
        <div style={{ position: 'absolute', inset: 0, padding: 56, opacity: vo(0), boxSizing: 'border-box' }}>
          <div style={{ font: `300 20px ${BODY}`, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.accent }}>Living Brief</div>
          <div style={{ font: `300 64px ${HEAD}`, color: C.text, marginTop: 8 }}>Journal</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>{CATS.map((c, k) => <span key={c} style={{ font: `400 16px ${BODY}`, color: C.n700, background: C.n200, borderRadius: R.control, padding: '4px 12px' }}>{k + 1} · {c}</span>)}</div>
          {CATS.map((c, k) => <div key={c} style={{ marginTop: 34 }}>
            <div style={{ font: `300 30px ${HEAD}`, color: C.text }}>{k + 1}. {c}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}><span style={{ font: `400 14px ${BODY}`, color: C.s700, background: C.s100, borderRadius: R.control, padding: '3px 10px' }}>pheromone</span><span style={{ font: `400 14px ${BODY}`, color: C.a700, background: C.a100, borderRadius: R.control, padding: '3px 10px' }}>decision</span></div>
            {[0, 1].map(j => <div key={j} style={{ height: 12, borderRadius: 6, background: C.n300, width: j ? '62%' : '88%', marginTop: 12 }} />)}
          </div>)}
        </div>
        {/* atlas */}
        <div style={{ position: 'absolute', inset: 0, padding: 56, opacity: vo(1), boxSizing: 'border-box' }}>
          <div style={{ font: `300 20px ${BODY}`, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.accent }}>Evidence Atlas</div>
          <div style={{ font: `300 48px ${HEAD}`, color: C.text, marginTop: 8 }}>coverage &amp; gaps</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginTop: 30 }}>
            {[['question', 4, C.a200], ['answer', 3, C.s200], ['decision', 2, C.a100], ['evidence', 0, C.n200]].map(([name, n, bg]) => <div key={name} style={{ borderRadius: R.card, background: bg, padding: 16, minHeight: 440, boxSizing: 'border-box' }}>
              <div style={{ font: `400 16px ${BODY}`, color: C.n700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{name}</div>
              <div style={{ font: `300 44px ${HEAD}`, color: n ? C.text : C.n500 }}>{n}</div>
              {Array.from({ length: n }, (_, j) => <div key={j} style={{ marginTop: 12, borderRadius: R.control, background: 'rgba(255,255,255,0.7)', padding: 10 }}><div style={{ height: 8, borderRadius: 4, background: C.n400, width: '80%' }} /><div style={{ font: `400 12px ${BODY}`, color: C.n500, marginTop: 6 }}>journal / {CATS[j % 3]}</div></div>)}
              {!n && <div style={{ marginTop: 12, font: `400 15px ${BODY}`, color: C.n500, fontStyle: 'italic' }}>empty lane stays visible</div>}
            </div>)}
          </div>
        </div>
        {/* studio */}
        <div style={{ position: 'absolute', inset: 0, padding: 56, opacity: vo(2), boxSizing: 'border-box', display: 'flex', gap: 28 }}>
          <div style={{ width: 200 }}>
            <div style={{ font: `300 20px ${BODY}`, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.accent }}>Knowledge Studio</div>
            {CATS.map((c, k) => <div key={c} style={{ marginTop: 18, padding: '14px 16px', borderRadius: R.card, background: k === 0 ? C.a200 : 'transparent', font: `400 20px ${BODY}`, color: C.text }}>scene {k + 1}<div style={{ font: `300 16px ${BODY}`, color: C.n700 }}>{c}</div></div>)}
          </div>
          <div style={{ flex: 1, paddingTop: 40 }}>
            <div style={{ font: `300 56px ${HEAD}`, color: C.text }}>The lounge</div>
            <div style={{ font: `300 22px ${BODY}`, color: C.n700, marginTop: 10 }}>first note becomes the lead</div>
            <div style={{ marginTop: 26, height: 200, borderRadius: R.card, background: C.a200 }} />
            {[0, 1, 2].map(j => <div key={j} style={{ height: 12, borderRadius: 6, background: C.n300, width: ['92%', '70%', '84%'][j], marginTop: 16 }} />)}
          </div>
        </div>
      </div>
    </Slot>
  );
}

// ── 5. Orthogonal touch ──────────────────────────────────────────────────────
function TouchSec({ T, t0, labels }) {
  const L = T - t0;
  const px = 380, py = 130, pw = 400, ph = 820;
  const scroll = MOTION.draw(T, t0 + 0.8, 1.4) * 520;
  const across = MOTION.draw(T, t0 + 3.8, 1.3);
  const sheet = MOTION.draw(T, t0 + 7.0, 0.9);
  const tapPulse = MOTION.pop(T, t0 + 6.6, 0.5);
  const fingerVis = (L > 0.5 && L < 2.5) || (L > 3.5 && L < 5.4) || (L > 6.4 && L < 7.4);
  const fx = L < 3 ? px + 200 : L < 6 ? px + 300 - across * 210 : px + 200;
  const fy = L < 3 ? py + 640 - (scroll / 520) * 380 : L < 6 ? py + 520 : py + 500;
  const active = L < 3.3 ? 0 : L < 6.3 ? 1 : 2;
  const Deck = ({ tint, title, dx }) => (
    <div style={{ position: 'absolute', left: dx, top: 96, width: pw - 16, height: ph - 112, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: -scroll }}>
        {[0, 1, 2].map(k => <div key={k} style={{ height: 500, margin: '0 0 20px', borderRadius: R.floating, background: tint, padding: 28, boxSizing: 'border-box' }}>
          <div style={{ font: `300 34px ${HEAD}`, color: C.text }}>{title} · {k + 1}</div>
          <div style={{ height: 10, borderRadius: 5, background: 'rgba(32,30,29,0.18)', width: '80%', marginTop: 18 }} /><div style={{ height: 10, borderRadius: 5, background: 'rgba(32,30,29,0.18)', width: '55%', marginTop: 12 }} />
          <div style={{ marginTop: 30, height: 240, borderRadius: R.card, background: 'rgba(255,255,255,0.6)' }} />
        </div>)}
      </div>
    </div>
  );
  const Axis = ({ y, glyph, title, sub, on, at }) => (
    <div style={{ position: 'absolute', left: 1020, top: y, display: 'flex', alignItems: 'center', gap: 28, ...MOTION.enter(T, at) }}>
      <div style={{ width: 96, height: 96, borderRadius: R.floating, border: `1px solid ${C.line}`, background: on ? C.accent : C.pane, color: on ? C.bg : C.n700, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `300 46px ${HEAD}`, transition: 'none' }}>{glyph}</div>
      <div><div style={{ font: `300 40px ${HEAD}`, color: on ? C.text : C.n700 }}>{title}</div><div style={{ font: `300 24px ${BODY}`, color: C.n700 }}>{sub}</div></div>
    </div>
  );
  return (
    <Slot i={4}>
      <Kicker x={1020} y={150} T={T} at={t0 + 0.2} show={labels}>orthogonal touch · three axes</Kicker>
      <div style={{ position: 'absolute', left: px, top: py, width: pw, height: ph, borderRadius: 44, background: C.n900, padding: 8, boxSizing: 'border-box', ...MOTION.enter(T, t0, 0.8) }}>
        <div style={{ position: 'absolute', left: 8, top: 8, right: 8, bottom: 8, borderRadius: 38, background: C.bg, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 26, display: 'flex', justifyContent: 'center', gap: 10 }}>
            {[0, 1, 2, 3, 4].map(k => { const hi = k === (across > 0.5 ? 3 : 2); return <svg key={k} width="46" height="46" viewBox="-23 -23 46 46"><path d={hexD(20)} fill={hi ? C.accent : C.surface} stroke={hi ? C.accent : C.n400} strokeWidth="2.5" /></svg>; })}
          </div>
          <Deck tint={C.a200} title="lounge deck" dx={8 - across * (pw - 8)} />
          <Deck tint={C.s200} title="flavor deck" dx={pw + 8 - across * (pw - 8)} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 400, transform: `translateY(${(1 - sheet) * 420}px)`, borderRadius: '8px 8px 0 0', background: C.pane, borderTop: `1px solid ${C.line}`, boxShadow: '0 -6px 14px -6px rgba(10,70,55,0.25)', padding: '24px 28px', boxSizing: 'border-box' }}>
            <div style={{ font: `400 15px ${BODY}`, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.accent }}>flavor · open as</div>
            {['slides', 'living brief', 'evidence atlas', 'tutor'].map((v, k) => <div key={v} style={{ marginTop: 14, padding: '14px 18px', borderRadius: R.card, border: `1px solid ${C.line}`, background: k === 0 ? C.a200 : C.bg, font: `400 22px ${BODY}`, color: C.text }}>{v}</div>)}
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: fx - 34, top: fy - 34, width: 68, height: 68, borderRadius: 999, background: 'rgba(198,113,57,0.35)', border: `4px solid ${C.accent}`, opacity: fingerVis ? 1 : 0, transform: `scale(${L > 6.4 && L < 7.4 ? 0.7 + 0.5 * tapPulse : 1})` }} />
      <Axis y={330} glyph="↕" title="within" sub="the next slide, in the same viewer" on={active === 0} at={t0 + 0.6} />
      <Axis y={510} glyph="↔" title="across" sub="the next tile — the viewer stays" on={active === 1} at={t0 + 0.9} />
      <Axis y={690} glyph="●" title="between" sub="the close-up · which viewer you are in" on={active === 2} at={t0 + 1.2} />
    </Slot>
  );
}

// ── 6. Publish ───────────────────────────────────────────────────────────────
const SUB = rings(1);
const ATOMS = Array.from({ length: 12 }, (_, k) => ({ sig: fakeSig(300 + k), tx: 1315 + (k % 4) * 90, ty: 520 + Math.floor(k / 4) * 70 }));
const SEAL = fakeSig(77);
function PublishSec({ T, t0, labels }) {
  const L = T - t0;
  const cx = 520, cy = 540;
  const collapse = MOTION.draw(T, t0 + 1.2, 1.3);
  const hostS = MOTION.pop(T, t0 + 2.2, 0.9);
  const proof = MOTION.draw(T, t0 + 6.2, 0.8);
  return (
    <Slot i={5}>
      <Kicker x={160} y={150} T={T} at={t0 + 0.2} show={labels}>publish · seal, then push the closure</Kicker>
      <ToolWindow x={1230} y={110} w={640} h={300} T={T} at={t0 + 0.4} icon="M12 3v12M6 9l6-6 6 6M4 17v3h16v-3" title="Publish" crumb="revolucion">
        <div style={{ font: `300 14px ${MONO}`, color: C.n500, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>community:hosts · pick the door</div>
        <Row name="jwize.com" cmd="host:jwize.com" on lit={L > 2.2} T={T} at={t0 + 0.6} desc="primary door" />
        <Row name="hypercomb.com" cmd="host:hypercomb.com" on={false} lit={false} T={T} at={t0 + 0.75} desc="not carried" />
      </ToolWindow>
      <svg width="1920" height="1080" style={{ position: 'absolute', inset: 0 }}>
        <g transform={`translate(1450 540) scale(${hostS})`} opacity={hostS > 0 ? 1 : 0}>
          <rect x="-200" y="-110" width="400" height="300" rx="4" fill={C.pane} stroke={C.line} /><rect x="-200" y="-110" width="400" height="40" rx="4" fill={C.a100} stroke={C.line} />
          <text y="-82" textAnchor="middle" fill={C.a700} style={{ font: `300 16px ${MONO}`, letterSpacing: '0.12em' }}>jwize.com · GET /&lt;sig&gt;</text>
        </g>
        <g transform={`translate(${cx} ${cy})`}>
          {SUB.map((c, k) => { const p = axialXY(c.q, c.r, 56); const s = MOTION.pop(T, t0 + 0.2 + k * 0.08, 0.6); const f = 1 - collapse;
            return c.ring === 0 ? null : <Hex key={k} x={p.x * f} y={p.y * f} r={50} scale={s * (0.3 + 0.7 * f)} opacity={f} fill={C.surface} stroke={C.n400} />; })}
          <Hex x={0} y={0} r={50} scale={MOTION.pop(T, t0 + 0.2, 0.6) * (1 + 0.8 * collapse)} fill={collapse > 0.5 ? C.a300 : C.surface} stroke={C.accent} sw={6} />
        </g>
        {ATOMS.map((a, k) => { const u = MOTION.draw(T, t0 + 2.9 + k * 0.2, 0.9); if (u <= 0) return null; const p = bez({ x: cx, y: cy }, { x: 950, y: 300 + (k % 3) * 120 }, { x: a.tx, y: a.ty }, u); const ok = MOTION.draw(T, t0 + 3.8 + k * 0.2, 0.3);
          return <g key={k} transform={`translate(${p.x} ${p.y})`}><path d={hexD(22)} fill={u < 1 ? C.a300 : C.s400} stroke={u < 1 ? C.accent : C.sage} strokeWidth="3" /><path d="M-9 1 L-3 7 L10 -7" fill="none" stroke={C.bg} strokeWidth="4" strokeLinecap="round" strokeDasharray="28" strokeDashoffset={28 * (1 - ok)} /></g>; })}
        <path d={`M${cx + 60} ${cy + 260} Q 900 900 1250 700`} fill="none" stroke={C.accent} strokeWidth="4" strokeDasharray="12 14" opacity={proof} />
      </svg>
      <Mono x={cx - 400} y={cy + 140} w={800} align="center" T={T} at={t0 + 2.0} size={26} color={C.a700}>seal → {short(SEAL)}</Mono>
      <Kicker x={cx - 380} y={cy + 190} w={760} T={T} at={t0 + 2.3} show={labels} align="center" color={C.n700}>one signature names the whole branch</Kicker>
      <Pill x={520} y={860} T={T} at={t0 + 6.4} bg={C.a200} color={C.a700} size={24}>head proof · GET /{short(SEAL)} · 200 ✓</Pill>
      <Kicker x={1180} y={860} T={T} at={t0 + 4.0} show={labels && L > 4} color={C.a700}>every atom sha-256 verified before write</Kicker>
    </Slot>
  );
}

// ── 7. Replicate ─────────────────────────────────────────────────────────────
const HEAP = Array.from({ length: 30 }, (_, k) => ({ c: k % 6, r: Math.floor(k / 6) }));
const CHANGED = [4, 11, 17], HOLE = 22;
function ReplicateSec({ T, t0, labels }) {
  const L = T - t0;
  const lx = 300, rx = 1160, ty = 330, gap = 76;
  const verb = L < 3.4 ? 0 : L < 5.8 ? 1 : L < 7.4 ? 2 : 3;
  const Tag = ({ x, on, at, children, bg = C.a200, color = C.a700 }) => <div style={{ position: 'absolute', left: x, top: 232, padding: '8px 22px', borderRadius: R.card, background: on ? C.accent : bg, color: on ? C.bg : color, font: `400 22px ${BODY}`, ...MOTION.enter(T, at) }}>{children}</div>;
  return (
    <Slot i={6}>
      <Mono x={160} y={150} w={1600} align="center" T={T} at={t0 + 0.1} size={44} color={C.text}>replicate(<span style={{ color: C.accent }}>root</span>)</Mono>
      <Tag x={640} on={verb === 0} at={t0 + 0.3}>install</Tag><Tag x={800} on={verb === 1} at={t0 + 0.45}>update</Tag><Tag x={960} on={verb === 2} at={t0 + 0.6}>repair</Tag><Tag x={1120} on={verb === 3} at={t0 + 0.75} bg={C.s200} color={C.s700}>backup</Tag>
      <Kicker x={lx} y={ty - 40} T={T} at={t0 + 0.2} show={labels} color={C.n700}>publisher host</Kicker>
      <Kicker x={rx} y={ty - 40} T={T} at={t0 + 0.2} show={labels} color={C.n700}>your device · heap</Kicker>
      <div style={{ position: 'absolute', left: rx + 400, top: ty - 46, width: 34, height: 34, borderRadius: R.card, border: `1px solid ${verb === 1 ? C.a300 : C.line}`, background: verb === 1 ? C.a200 : C.pane, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Glyph d="M12 3v12M7 10l5 5 5-5M4 19h16" on={verb === 1} size={20} /></div>
      <svg width="1920" height="1080" style={{ position: 'absolute', inset: 0 }}>
        {HEAP.map((h, k) => { const x0 = lx + h.c * gap + 30, y0 = ty + h.r * gap + 30, x1 = rx + h.c * gap + 30, y1 = y0;
          const changed = CHANGED.includes(k), chg = changed ? MOTION.draw(T, t0 + 3.6, 0.4) : 0;
          const install = MOTION.draw(T, t0 + 0.7 + k * 0.07, 0.6);
          const upd = changed ? MOTION.draw(T, t0 + 4.1 + CHANGED.indexOf(k) * 0.25, 0.7) : 0;
          const hole = k === HOLE ? MOTION.draw(T, t0 + 6.0, 0.4) : 0, fix = k === HOLE ? MOTION.draw(T, t0 + 6.6, 0.7) : 0;
          const fl = (u) => bez({ x: x0, y: y0 }, { x: (x0 + x1) / 2, y: y0 - 160 }, { x: x1, y: y1 }, u);
          const src = <path d={hexD(26)} transform={`translate(${x0} ${y0})`} fill={chg > 0 ? C.a300 : C.s200} stroke={chg > 0 ? C.accent : C.s400} strokeWidth="3" />;
          const dstOn = install >= 1, dstFill = upd >= 1 ? C.a300 : C.s200, dstStroke = upd >= 1 ? C.accent : C.s400;
          const dstOpacity = hole > 0 && fix < 1 ? 1 - hole : 1;
          const flying = [];
          if (install > 0 && install < 1) { const p = fl(install); flying.push(<path key="i" d={hexD(26)} transform={`translate(${p.x} ${p.y})`} fill={C.s300} stroke={C.sage} strokeWidth="3" />); }
          if (upd > 0 && upd < 1) { const p = fl(upd); flying.push(<path key="u" d={hexD(26)} transform={`translate(${p.x} ${p.y})`} fill={C.a300} stroke={C.accent} strokeWidth="3" />); }
          if (fix > 0 && fix < 1) { const p = fl(fix); flying.push(<path key="f" d={hexD(26)} transform={`translate(${p.x} ${p.y})`} fill={C.s300} stroke={C.sage} strokeWidth="3" />); }
          return <g key={k}>{src}
            <path d={hexD(26)} transform={`translate(${x1} ${y1})`} fill={dstOn ? dstFill : 'none'} stroke={dstOn ? dstStroke : C.n300} strokeWidth="3" strokeDasharray={dstOn ? undefined : '6 6'} opacity={dstOpacity} />
            {flying}</g>; })}
      </svg>
      <div style={{ position: 'absolute', left: 460, top: 726, width: 1000, textAlign: 'center', font: `300 30px ${BODY}`, color: C.a700, opacity: verb === 1 ? 1 : 0 }}>new root → only the changed subtree fetches</div>
      <div style={{ position: 'absolute', left: 460, top: 726, width: 1000, textAlign: 'center', font: `300 30px ${BODY}`, color: C.s700, opacity: verb === 2 ? 1 : 0 }}>same root → holes refetched, idempotent</div>
      <div style={{ position: 'absolute', left: 460, top: 830, width: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22, padding: '18px 34px', borderRadius: R.floating, background: C.pane, border: `1px solid ${C.line}`, boxShadow: '0 6px 10px 4px rgba(10,70,55,.10), 0 2px 3px rgba(10,70,55,.15)', boxSizing: 'border-box', transform: `scale(${MOTION.pop(T, t0 + 7.6, 0.8)})`, opacity: L > 7.6 ? 1 : 0 }}>
        <svg width="44" height="44" viewBox="-22 -22 44 44"><path d={hexD(20)} fill={C.a300} stroke={C.accent} strokeWidth="3" /></svg>
        <span style={{ font: `300 30px ${HEAD}`, color: C.text }}>“before the redesign”</span>
        <span style={{ font: `400 24px ${MONO}`, color: C.n700 }}>· seal {short(SEAL)}</span>
      </div>
      <Kicker x={460} y={920} T={T} at={t0 + 8.2} show={labels && L > 8.2} align="center" color={C.s700}>a snapshot is one signature and a name</Kicker>
    </Slot>
  );
}

// ── 8. Share ─────────────────────────────────────────────────────────────────
function ShareSec({ T, t0, labels }) {
  const L = T - t0;
  const travel = MOTION.draw(T, t0 + 0.8, 1.4);
  const ghost = MOTION.draw(T, t0 + 2.3, 0.9);
  const adopt = MOTION.draw(T, t0 + 5.6, 0.7);
  const Cluster = ({ x, y, opacity, dashed, fill }) => <g transform={`translate(${x} ${y})`} opacity={opacity}>{SUB.map((c, k) => { const p = axialXY(c.q, c.r, 58); return <Hex key={k} x={p.x} y={p.y} r={52} fill={fill} stroke={c.ring ? C.n400 : C.accent} sw={c.ring ? 3 : 5} dash={dashed ? '10 8' : undefined} />; })}</g>;
  const lx = 460, rx = 1460;
  return (
    <Slot i={7}>
      <Kicker x={160} y={180} T={T} at={t0 + 0.2} show={labels}>share · a link is a signature</Kicker>
      <svg width="1920" height="1080" style={{ position: 'absolute', inset: 0 }}>
        <circle cx={lx} cy={330} r={64 * MOTION.pop(T, t0 + 0.2)} fill={C.accent} />
        <circle cx={rx} cy={330} r={64 * MOTION.pop(T, t0 + 0.5)} fill={C.sage} />
        <Cluster x={lx} y={640} opacity={MOTION.draw(T, t0 + 0.4, 0.6)} fill={C.surface} />
        <Cluster x={rx} y={640} opacity={ghost * 0.45 + adopt * 0.55} dashed={adopt < 0.5} fill={adopt >= 0.5 ? C.surface : 'none'} />
      </svg>
      <div style={{ position: 'absolute', left: lerp(lx + 90, rx - 470, travel), top: 300, padding: '12px 26px', borderRadius: R.control, background: C.pane, border: `1px solid ${C.lineFirm}`, color: C.a700, font: `300 24px ${MONO}`, whiteSpace: 'nowrap', opacity: travel > 0 && travel < 1 ? 1 : travel >= 1 ? 1 : 0, boxShadow: '0 12px 30px -16px rgba(32,30,29,0.5)' }}>hypercomb.io/#hive={short(SEAL)}</div>
      <Kicker x={lx - 300} y={420} T={T} at={t0 + 0.4} show={labels} align="center" color={C.n700}>you · publisher</Kicker>
      <Kicker x={rx - 300} y={420} T={T} at={t0 + 0.7} show={labels} align="center" color={C.n700}>a visitor</Kicker>
      <div style={{ position: 'absolute', left: rx - 300, top: 800, width: 600, textAlign: 'center', font: `300 30px ${BODY}`, color: C.n700, opacity: ghost * (1 - adopt) }}>preview · session-only head · zero writes</div>
      <div style={{ position: 'absolute', left: rx - 300, top: 800, width: 600, textAlign: 'center', font: `300 30px ${BODY}`, color: C.s700, opacity: adopt }}>adopted · a new lineage, theirs to grow</div>
      <Pill x={rx - 130} y={860} T={T} at={t0 + 4.6} bg={C.pane} color={C.accent} size={24} w={260}>Adopt this hive</Pill>
    </Slot>
  );
}

// ── 9. Swarm ─────────────────────────────────────────────────────────────────
const GRID = rings(3);
const PATH = 'hypercomb.io / science / chemistry / organic';
const SWSIG = fakeSig(4242);
const BEES = [
  { col: C.accent, from: { x: -200, y: 200 }, cell: [1, 0] }, { col: C.sage, from: { x: 2100, y: 300 }, cell: [-2, 1] }, { col: C.a400, from: { x: 900, y: -200 }, cell: [0, -2] },
  { col: C.s400, from: { x: 2100, y: 900 }, cell: [2, -1] }, { col: C.a700, from: { x: -200, y: 800 }, cell: [-1, 2] }, { col: C.s700, from: { x: 400, y: 1300 }, cell: [1, 1] },
  { col: C.violet, from: { x: 1500, y: 1300 }, cell: [-2, -1] }, { col: C.accent, from: { x: 2100, y: 600 }, cell: [3, -2] }, { col: C.sage, from: { x: -200, y: 500 }, cell: [-3, 2] },
];
function Bee({ x, y, col, T, k, opacity, hover }) {
  const face = [1, -1, 1, -1, 1, 1, -1, 1, -1][k % 9]; // which way it looks
  const tilt = [-14, 12, 0, -8, 18, -20, 6, -10, 14][k % 9] * (hover ? 1 : 0.5); // a little lean
  const gaze = face * 2.2; // eyes and smile slide toward where it looks
  const w = Math.sin(T * (hover ? 18 : 34) + k) * (hover ? 0.3 : 0.5); // wing beat
  const bob = hover ? Math.sin(T * 1.6 + k) * 2 : 0;
  const blink = ((T * 0.6 + k * 0.29) % 1) > 0.94 ? 0.15 : 1; // an occasional blink
  const GOLD = '#f7c548', GOLD2 = '#ffdf7e', BLACK = '#23190f', CHEEK = '#f7a08a';
  return (
    <g transform={`translate(${x} ${y + bob}) rotate(${tilt}) scale(${face * 0.6} 0.6)`} opacity={opacity}>
      <ellipse cy="30" rx="15" ry="4" fill={BLACK} opacity="0.10" />
      {/* wings — big, round, translucent */}
      <ellipse cx="-14" cy="-6" rx="13" ry="9" fill="#ffffff" stroke={col} strokeWidth="1.2" opacity="0.85" transform={`rotate(${-18 + w * 22} -14 -6)`} />
      <ellipse cx="14" cy="-6" rx="13" ry="9" fill="#ffffff" stroke={col} strokeWidth="1.2" opacity="0.85" transform={`rotate(${18 - w * 22} 14 -6)`} />
      {/* chubby body */}
      <ellipse cy="8" rx="14" ry="15" fill={GOLD} stroke={BLACK} strokeWidth="1.6" />
      <ellipse cx="-4" cy="2" rx="5" ry="6" fill={GOLD2} opacity="0.7" />
      <path d="M-12.4 8h24.8M-9.6 16h19.2" stroke={BLACK} strokeWidth="3.4" strokeLinecap="round" />
      <path d="M-2.6 22.4L0 28.4L2.6 22.4Z" fill={BLACK} />
      {/* big round head */}
      <circle cy="-11" r="11" fill={BLACK} />
      <g transform={`translate(${gaze} 0)`}>
        <ellipse cx="-3.8" cy="-12" rx="2.6" ry={3.2 * blink} fill="#ffffff" /><ellipse cx="3.8" cy="-12" rx="2.4" ry={3.0 * blink} fill="#ffffff" />
        <circle cx="-3.0" cy="-12.6" r="0.9" fill={BLACK} opacity={blink} /><circle cx="4.6" cy="-12.6" r="0.9" fill={BLACK} opacity={blink} />
        <circle cx="-7.5" cy="-7.5" r="2" fill={CHEEK} opacity="0.8" /><circle cx="7.5" cy="-7.5" r="2" fill={CHEEK} opacity="0.8" />
        <path d="M-2.4 -6.2q2.4 2.2 4.8 0" stroke="#ffffff" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      </g>
      {/* springy antennae with bobbles */}
      <path d="M-4 -21q-3 -7 -8 -9M4 -21q3 -7 8 -9" stroke={BLACK} strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <circle cx="-12" cy="-30" r="2.4" fill={GOLD} stroke={BLACK} strokeWidth="1.2" /><circle cx="12" cy="-30" r="2.4" fill={GOLD} stroke={BLACK} strokeWidth="1.2" />
      {/* little feet */}
      <path d="M-6 24q-1 4 -4 5M6 24q1 4 4 5" stroke={BLACK} strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </g>
  );
}
function SwarmSec({ T, t0, labels }) {
  const L = T - t0;
  const cx = 960, cy = 590, gap = 50;
  const typed = Math.floor(MOTION.draw(T, t0 + 0.2, 1.6) * PATH.length);
  const bees = BEES.map((b, k) => {
    const arrive = MOTION.draw(T, t0 + 2.4 + k * 0.42, 2.0);
    const leave = k >= 7 ? MOTION.draw(T, t0 + 8.6 + (k - 7) * 0.4, 1.2) : 0;
    const home = axialXY(b.cell[0], b.cell[1], gap);
    const tgt = { x: cx + home.x, y: cy + home.y };
    const u = arrive * (1 - leave);
    const p = bez(b.from, { x: (b.from.x + tgt.x) / 2 + 200 * Math.sin(k), y: (b.from.y + tgt.y) / 2 - 220 }, tgt, arrive);
    const q = leave > 0 ? bez(tgt, { x: tgt.x + 200, y: tgt.y - 300 }, { x: b.from.x, y: b.from.y - 200 }, leave) : p;
    const landed = arrive >= 1 && leave <= 0;
    // a slow waggle: a short run (~10px) with a gentle sway, a lazy loop back, then a rest — about a 6s cycle
    const phase = ((T / 6 + k * 0.23) % 1);
    let wag = { x: 0, y: 0 }, sway = 0;
    if (landed) {
      if (phase < 0.35) { const u = Easing.easeInOutSine(phase / 0.35); sway = Math.sin(phase * 6 * Math.PI * 2) * 2.2 * Math.sin(u * Math.PI); wag = { x: u * 10, y: sway }; }
      else if (phase < 0.7) { const u = (phase - 0.35) / 0.35; const a = u * Math.PI; wag = { x: 10 - (1 - Math.cos(a)) * 5, y: -Math.sin(a) * 6 }; }
      wag.x += 3 * Math.sin(T * 0.4 + k); wag.y += 2 * Math.cos(T * 0.6 + k * 2);
    }
    const wob = wag;
    return { ...b, k, x: q.x + wob.x, y: q.y + wob.y - 6, vis: u, arrive, leave, hover: landed };
  });
  const tileTint = {};
  bees.forEach(b => { const [q, r] = b.cell; const nb = [[q + 1, r], [q, r + 1], [q - 1, r + 1]]; const o = MOTION.draw(T, t0 + 3.9 + b.k * 0.42, 0.6) * (1 - b.leave); nb.forEach(([a, c2], j) => { if (o > 0 && j < 2) tileTint[a + ',' + c2] = { col: b.col, o }; }); });
  return (
    <Slot i={8}>
      <div style={{ position: 'absolute', left: 240, top: 170, font: `300 44px ${BODY}`, color: C.text, whiteSpace: 'nowrap' }}>{PATH.slice(0, typed)}<span style={{ opacity: typed < PATH.length ? 1 : 0, color: C.accent }}>▍</span></div>
      <Mono x={240} y={240} w={1200} T={T} at={t0 + 2.0} size={26} color={C.a700}>sign(segments) → x:{short(SWSIG)} · the rendezvous key</Mono>
      <svg width="1920" height="1080" style={{ position: 'absolute', inset: 0 }}>
        <g transform={`translate(${cx} ${cy})`}>
          {GRID.map((c, k) => { const p = axialXY(c.q, c.r, gap); const s = MOTION.pop(T, t0 + 0.3 + c.ring * 0.25 + k * 0.015, 0.6); const tint = tileTint[c.q + ',' + c.r];
            return <Hex key={k} x={p.x} y={p.y} r={47} scale={s} fill={tint ? tint.col : c.ring === 0 ? C.surface : C.bg} opacity={tint ? 0.35 + 0.65 * tint.o : 1} stroke={c.ring === 0 ? C.accent : C.n300} sw={c.ring === 0 ? 4 : 2.5} />; })}
        </g>
        {bees.map(b => b.vis > 0 && <Bee key={b.k} x={b.x} y={b.y} col={b.col} T={T} k={b.k} hover={b.hover} opacity={Math.min(1, b.vis * 3)} />)}
      </svg>
      <Kicker x={1080} y={860} T={T} at={t0 + 4.4} show={labels && L > 4.4} color={C.n700}>avatars, not accounts · tiles land like pollen</Kicker>
      <Kicker x={240} y={860} T={T} at={t0 + 8.8} show={labels && L > 8.8} color={C.n700}>the swarm thins · your comb returns</Kicker>
    </Slot>
  );
}

// ── 10. Close ────────────────────────────────────────────────────────────────
function CloseSec({ T, t0, total }) {
  const fade = 1 - MOTION.draw(T, total - 0.7, 0.7);
  return (
    <Slot i={9} opacity={fade}>
      <svg width="1920" height="1080" style={{ position: 'absolute', inset: 0 }}>
        <g transform={`translate(960 400) scale(${MOTION.pop(T, t0 + 0.2, 0.9)})`}><path d={hexD(150)} fill={C.surface} stroke={C.accent} strokeWidth="7" strokeLinejoin="round" /></g>
      </svg>
      <Mono x={160} y={590} w={1600} align="center" T={T} at={t0 + 0.6} size={26} color={C.n700}>{SIG0}</Mono>
      <div style={{ position: 'absolute', left: 160, top: 690, width: 1600, textAlign: 'center', font: `300 92px ${HEAD}`, color: C.text, ...MOTION.enter(T, t0 + 1.1, 1) }}>Hypercomb is a computer.</div>
      <div style={{ position: 'absolute', left: 160, top: 830, width: 1600, textAlign: 'center', font: `400 28px ${BODY}`, letterSpacing: '0.24em', textTransform: 'uppercase', color: C.accent, ...MOTION.enter(T, t0 + 2.0) }}>hypercomb</div>
    </Slot>
  );
}

// ── the shell: header bar + command line, left rail, status line, concentric rings, activity log ──
const CMDS = { Cell: '/add cell', Hive: '/hive', Pools: '/opfs', Views: '/views', Touch: '/present', Publish: '/publish revolucion', Replicate: '/snapshot before the redesign', Share: '/share', Swarm: '/swarm', Close: '' };
const TOASTS = [
  { sec: 'Pools', dt: 6.6, text: '__bees__/ absorbed into sign(\'bees\') · legacy folder removed' },
  { sec: 'Views', dt: 1.6, text: 'Living Brief turned on for journal' },
  { sec: 'Publish', dt: 6.6, text: 'revolucion published · 12 atoms · head verified on jwize.com' },
  { sec: 'Replicate', dt: 7.9, text: 'snapshot saved · “before the redesign”' },
  { sec: 'Share', dt: 5.8, text: 'journal adopted · new lineage' },
  { sec: 'Swarm', dt: 4.2, text: '9 bees at science / chemistry / organic' },
];
function Glyph({ d, on, size = 26 }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={on ? C.accent : C.n700} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity={on ? 1 : 0.7}><path d={d} /></svg>; }
const RAIL = ['M12 3l8 5v8l-8 5-8-5V8z', 'M3 12h18M12 3v18', 'M4 10l8-6 8 6v9H4z', 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 17h6M17 14v6', 'M12 3l9 9-9 9-9-9z', 'M5 8V5h3M19 8V5h-3M5 16v3h3M19 16v3h-3M12 9a3 3 0 100 6 3 3 0 000-6', 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'];
function Chrome({ T, CUES, total }) {
  const secs = NAMES.filter(n => T >= CUES[n]); const sec = secs[secs.length - 1] || 'Cell';
  const cmd = CMDS[sec] || ''; const n = Math.floor(clamp((T - CUES[sec]) / 0.9, 0, 1) * cmd.length);
  const toast = TOASTS.map(t => ({ ...t, at: CUES[t.sec] + t.dt })).find(t => T >= t.at && T < t.at + 3.2);
  const to = toast ? Math.min(MOTION.draw(T, toast.at, 0.35), 1 - MOTION.draw(T, toast.at + 2.8, 0.4)) : 0;
  const railOn = { Cell: 3, Hive: 2, Pools: 1, Views: 5, Touch: 6, Publish: 0, Replicate: 0, Share: 0, Swarm: 4, Close: 2 }[sec];
  const branch = { Cell: 'cell', Hive: 'hive', Pools: 'store', Views: 'journal', Touch: 'journal / flavor', Publish: 'revolucion', Replicate: 'revolucion', Share: 'journal', Swarm: 'organic', Close: 'hive' }[sec];
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: sec === 'Close' ? 1 - MOTION.draw(T, total - 1.2, 0.8) : 1 }}>
      <div style={{ position: 'absolute', left: 0, top: 0, right: 0, height: 52, background: C.glass, borderBottom: `1px solid ${C.rule}`, display: 'flex', alignItems: 'center', padding: '0 18px', gap: 14, boxSizing: 'border-box' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg>
        <span style={{ font: `300 24px ${BODY}`, color: cmd ? C.text : C.n500, letterSpacing: '0.01em' }}>{cmd ? cmd.slice(0, n) : 'share intent…'}<span style={{ color: C.accent, opacity: Math.floor(T * 2.4) % 2 ? 1 : 0.15 }}>|</span></span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 22, alignItems: 'center' }}>
          <Glyph d="M4 5h16v11H8l-4 3z" on={false} size={22} /><Glyph d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6L7.1 18.2l.9-5.5-4-3.9L9.5 8z" on={sec === 'Views' || sec === 'Touch'} size={22} /><Glyph d="M5 4h14v14H5zM8 9h8M8 13h5" on={false} size={22} /><Glyph d="M4 4h4v4H4zM10 4h4v4h-4zM16 4h4v4h-4zM4 10h4v4H4zM10 10h4v4h-4zM16 10h4v4h-4zM4 16h4v4H4zM10 16h4v4h-4zM16 16h4v4h-4z" on={false} size={22} />
          <div style={{ width: 30, height: 30, borderRadius: R.card, border: `1px solid ${C.s400}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.sage} strokeWidth="2"><path d="M6 11V8a6 6 0 0112 0v3M5 11h14v10H5z" /></svg></div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, top: 52, bottom: 0, width: 56, background: C.glass, borderRight: `1px solid ${C.rule}`, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 14, gap: 22, boxSizing: 'border-box' }}>
        <div style={{ width: 22, height: 2, background: C.n500, opacity: 0.5, marginBottom: 6 }} />
        {RAIL.map((d, i) => <Glyph key={i} d={d} on={i === railOn} />)}
        <div style={{ marginTop: 'auto', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 26 }}><Glyph d="M8 5l10 7-10 7z" on={false} /><Glyph d="M19 12H5M12 19l-7-7 7-7" on={false} /></div>
      </div>
      <div style={{ position: 'absolute', right: 26, top: 62, font: `300 15px ${MONO}`, fontStyle: 'italic', letterSpacing: '0.04em', display: 'flex', gap: 6 }}>
        <span style={{ color: C.n500 }}>private</span><span style={{ color: C.n500 }}>·</span><span style={{ color: C.n700 }}>localhost</span><span style={{ color: C.n500 }}>·</span><span style={{ color: C.branch }}>[{branch}]</span><span style={{ color: C.n500 }}>·</span><span style={{ color: C.sage }}>bloom</span><span style={{ color: C.n500 }}>·</span><span style={{ color: C.ok }}>secure</span>
      </div>
      <div style={{ position: 'absolute', right: 26, bottom: 22, display: 'flex', gap: 18 }}><Glyph d="M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3" size={22} /><Glyph d="M4 5h16v11H8l-4 3z" size={22} /><Glyph d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.2 2.2M16.2 16.2l2.2 2.2M5.6 18.4l2.2-2.2M16.2 7.8l2.2-2.2" size={22} /></div>
      {toast && <div style={{ position: 'absolute', left: 80, top: 62, width: 760, padding: '8px 16px', whiteSpace: 'nowrap', borderRadius: R.floating, background: C.pane, border: `1px solid ${C.line}`, boxShadow: '0 4px 8px 3px rgba(10,70,55,.10), 0 1px 3px rgba(10,70,55,.15)', font: `300 20px ${BODY}`, color: C.text, display: 'flex', alignItems: 'center', gap: 14, opacity: to, transform: `translateY(${(to - 1) * 10}px)` }}><span style={{ width: 8, height: 8, borderRadius: 999, background: C.accent, flex: 'none' }} />{toast.text}<span style={{ marginLeft: 'auto', font: `300 16px ${BODY}`, color: C.accent, border: `1px solid ${C.a300}`, borderRadius: R.card, padding: '3px 10px' }}>revert</span></div>}
    </div>
  );
}

// ── camera ───────────────────────────────────────────────────────────────────
const NAMES = ['Cell', 'Hive', 'Pools', 'Views', 'Touch', 'Publish', 'Replicate', 'Share', 'Swarm', 'Close'];
const PUSH = { Cell: 1800, Hive: 1720, Pools: 1820, Views: 1800, Touch: 1780, Publish: 1800, Replicate: 1820, Share: 1800, Swarm: 1760, Close: 1860 };
function camera(T, CUES, total) {
  const K = [];
  NAMES.forEach((n, i) => {
    const t0 = CUES[n], t1 = i < NAMES.length - 1 ? CUES[NAMES[i + 1]] : total;
    const frame = w => ({ x: i * SLOT + (1920 - w) / 2, y: (1080 - w * 1080 / 1920) / 2, w });
    K.push({ t: t0 + 0.35, ...frame(1920) });
    K.push({ t: Math.max(t0 + 0.4, t1 - 0.75), ...frame(PUSH[n]) });
  });
  if (T <= K[0].t) return K[0];
  for (let i = 0; i < K.length - 1; i++) {
    const a = K[i], b = K[i + 1];
    if (T >= a.t && T < b.t) { const u = Easing.easeInOutCubic((T - a.t) / Math.max(b.t - a.t, 0.001)); return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), w: lerp(a.w, b.w, u) }; }
  }
  return K[K.length - 1];
}

// ── the voice ────────────────────────────────────────────────────────────────
// Narration is not a track laid over the film: it is one line per scene, each
// cued to the playback clock. Seeking, pausing and looping are the same
// operation for the voice as for the picture — read the clock, put the clip
// where the clock is. window.OM_NARRATION carries [{at, dur, src}] with the
// mp3s inlined as data uris (scripts/presentation/ecosystem.cjs writes them,
// from the same cache and the same narrator as the full presentation). With
// none present the composition is exactly what it was: silent.
const NARRATION = (() => {
  const raw = typeof window !== 'undefined' && window.OM_NARRATION;
  if (!raw) return [];
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return []; }
})();

function Narration({ on = true }) {
  const { time, playing } = useComposition();
  const [blocked, setBlocked] = React.useState(false);
  const clips = React.useRef(null);
  const cur = React.useRef(-1);
  if (!clips.current) clips.current = NARRATION.map(n => { const a = new Audio(n.src); a.preload = 'auto'; return a; });

  // Runs after every frame: the clock is the only state the voice reads.
  React.useEffect(() => {
    const list = clips.current;
    if (!list.length) return;
    const want = (on && playing)
      ? NARRATION.findIndex(n => time >= n.at && time < n.at + n.dur)
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
    <div onClick={() => setBlocked(false)} style={{ position: 'absolute', right: 40, bottom: 40, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 22px', borderRadius: R.floating, background: C.pane, border: `1px solid ${C.line}`, boxShadow: '0 4px 8px 3px rgba(10,70,55,.08)', font: `400 22px ${BODY}`, color: C.n700, cursor: 'pointer' }}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4zM17 8.5a5 5 0 010 7M20 6a9 9 0 010 12" /></svg>
      click for sound
    </div>
  );
}

function Piece({ tweaks }) {
  const { T, CUES, authoredTotal } = useComposition();
  const total = authoredTotal;
  const cam = camera(T, CUES, total);
  const s = 1920 / cam.w;
  const labels = tweaks.labels !== false;
  // The words are the narration's — one place for them, spoken and shown. The
  // canvas has no narration, so the authored list below is what it still uses.
  const caps = NARRATION.length ? NARRATION.map(n => ({ at: n.T, text: n.text })) : [
    { at: CUES.Cell + 1.6, text: "A cell's content is hashed. The signature is its address — the same on every machine." },
    { at: CUES.Hive + 1.0, text: 'Cells compose into layers. A parent is a function of its children’s signatures; one write re-signs the path to the root.' },
    { at: CUES.Pools + 0.8, text: 'No folders. Flat sig-named files, plus pools of meaning — sets addressed by sign(meaning).' },
    { at: CUES.Views + 1.2, text: 'One hierarchy, many views. Tiles, notes and pheromones render as a brief, an atlas, a studio.' },
    { at: CUES.Touch + 0.8, text: 'Three orthogonal axes: ↕ within the viewer, ↔ across tiles, tap to move between viewers.' },
    { at: CUES.Publish + 0.8, text: 'Publishing seals a subtree into one signature and pushes its closure to hosts — every atom verified.' },
    { at: CUES.Replicate + 0.6, text: 'Install, update, repair: one verb. Backup is one signature and a name.' },
    { at: CUES.Share + 0.8, text: 'Share a link. Visitors preview without writing a thing; adopting makes it theirs.' },
    { at: CUES.Swarm + 2.2, text: 'Same path, same swarm. Presence is the only credential; tiles arrive by proximity.' },
    { at: CUES.Close, until: CUES.Close + 0.01, text: '' },
  ];
  return (
    <div data-screen-label={`t=${Math.floor(T)}s`} style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: C.bg, color: C.text, fontFamily: BODY }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: SLOT * 10, height: 1080, transformOrigin: '0 0', transform: `scale(${s}) translate(${-cam.x}px, ${-cam.y}px)` }}>
        <CellSec T={T} t0={CUES.Cell} labels={labels} />
        <HiveSec T={T} t0={CUES.Hive} labels={labels} />
        <PoolsSec T={T} t0={CUES.Pools} labels={labels} />
        <ViewsSec T={T} t0={CUES.Views} labels={labels} />
        <TouchSec T={T} t0={CUES.Touch} labels={labels} />
        <PublishSec T={T} t0={CUES.Publish} labels={labels} />
        <ReplicateSec T={T} t0={CUES.Replicate} labels={labels} />
        <ShareSec T={T} t0={CUES.Share} labels={labels} />
        <SwarmSec T={T} t0={CUES.Swarm} labels={labels} />
        <CloseSec T={T} t0={CUES.Close} total={total} />
      </div>
      {tweaks.captions !== false && <Captions items={caps} style={{ font: `300 34px ${BODY}`, color: C.text, textShadow: 'none', bottom: '3%', left: '14%', right: '14%', lineHeight: 1.35 }} />}
      <Narration on={tweaks.narration !== false} />
      <Chrome T={T} CUES={CUES} total={total} />
    </div>
  );
}

function HypercombStory() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS || { motionEditor: true, captions: true, labels: true, narration: true });
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <CompositionStage width="1920" height="1080" bg={C.bg} scenes={window.OM_SCENES} playback={window.OM_PLAYBACK}>
        <Piece tweaks={t} />
      </CompositionStage>
      <TweaksPanel>
        <TweakSection label="Story" />
        <TweakToggle label="Captions" value={t.captions !== false} onChange={v => setTweak('captions', v)} />
        <TweakToggle label="Narration" value={t.narration !== false} onChange={v => setTweak('narration', v)} />
        <TweakToggle label="Scene labels" value={t.labels !== false} onChange={v => setTweak('labels', v)} />
        <TweakSection label="Editor" />
        <TweakToggle label="Motion editor" value={t.motionEditor !== false} onChange={v => setTweak('motionEditor', v)} />
      </TweaksPanel>
    </div>
  );
}
window.HypercombStory = HypercombStory;
