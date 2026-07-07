import { Application, Container, Graphics, Sprite, Texture } from './vendor/pixi.min.mjs';

(async () => {
  "use strict";
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- pixi bootstrap ----------
  const app = new Application();
  await app.init({
    backgroundAlpha: 0, antialias: true, resizeTo: window, preference: 'webgl',
    powerPreference: 'high-performance', resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true,
  });
  document.getElementById('stage').appendChild(app.canvas);
  document.getElementById('r-badge').textContent = 'pixi.js — ' + (app.renderer?.name || 'webgl');

  // ================= model: N points repelling on a sphere =================
  // Every point pushes every other apart (1/d²). The equilibrium for N points is the
  // maximally-spread arrangement — which IS a triangle(3), tetrahedron(4), octahedron(6)…
  // Adding a point perturbs the field and everyone rebalances. That spreading is the animation.
  const NMAX = 280;
  const PHI = Math.PI*(3-Math.sqrt(5));
  const S3 = Math.sqrt(3)/2;

  // The first three are pinned to a readable, broadside pose (centered boom, clean split, apex-up
  // triangle). From N=4 on, repulsion takes over and finds the balance on its own.
  // Order matters: existing points keep their index, so map each to the NEAREST new vertex to avoid
  // a point sweeping across the shape. The apex (index 2) is the newcomer — it pops in at the top.
  const PIN = {
    1: [[0, 0.2571, 0.9664]],                // tilt-corrected front pole → projects to dead center
    2: [[0,1,0],[0,-1,0]],                   // vertical line: top, bottom
    3: [[0,1,0],[-S3,-0.5,0],[S3,-0.5,0]],   // apex stays on top; the bottom point splits left/right
  };
  const BIRTH = {                            // where a pinned newcomer is born, so it visibly splits off
    2: [0, 0.2571, 0.9664],                  // from the centre dot → pushes apart vertically
    3: [0, -1, 0],                           // from the bottom point → splits left ↔ right
  };

  let pts = [];                                  // { p:[x,y,z] unit vector, s, born }
  const fx=new Float64Array(NMAX), fy=new Float64Array(NMAX), fz=new Float64Array(NMAX);
  const GAIN=0.020, MAXSTEP=0.07, ITERS=10;

  function emptiestDir(){                         // farthest-point: place a newcomer where there's most room
    const n=pts.length; let bx=0,by=0,bz=1,bestMin=-1;
    for(let c=0;c<128;c++){
      const y=1-(c+0.5)/128*2, r=Math.sqrt(Math.max(0,1-y*y)), t=PHI*c;
      const cx=Math.cos(t)*r, cy=Math.sin(t)*r, cz=y;
      let mn=Infinity;
      for(let i=0;i<n;i++){ const b=pts[i].p, dx=cx-b[0],dy=cy-b[1],dz=cz-b[2], d=dx*dx+dy*dy+dz*dz; if(d<mn)mn=d; }
      if(mn>bestMin){ bestMin=mn; bx=cx;by=cy;bz=cz; }
    }
    return [bx,by,bz];
  }
  function setCount(n){
    while(pts.length < n){
      const i=pts.length;
      let pos;
      if(n<=3) pos = (BIRTH[n] || PIN[n][i]).slice();   // pinned newcomer births at the split origin, then glides
      else pos = emptiestDir();
      pts.push({ p:pos, s:0, born:nowSec });
    }
    if(pts.length > n) pts.length = n;
  }

  function relax(iters){
    const n=pts.length; if(n<2) return;
    for(let it=0; it<iters; it++){
      for(let i=0;i<n;i++){ fx[i]=0;fy[i]=0;fz[i]=0; }
      for(let i=0;i<n;i++){ const a=pts[i].p;
        for(let j=i+1;j<n;j++){ const b=pts[j].p;
          let dx=a[0]-b[0], dy=a[1]-b[1], dz=a[2]-b[2];
          let d2=dx*dx+dy*dy+dz*dz; if(d2<1e-6) d2=1e-6;
          const inv=1/(d2*Math.sqrt(d2));       // 1/d³ → force ∝ 1/d²
          dx*=inv;dy*=inv;dz*=inv;
          fx[i]+=dx;fy[i]+=dy;fz[i]+=dz; fx[j]-=dx;fy[j]-=dy;fz[j]-=dz;
        }
      }
      for(let i=0;i<n;i++){ const a=pts[i].p;
        let gx=fx[i],gy=fy[i],gz=fz[i];
        const dot=gx*a[0]+gy*a[1]+gz*a[2];       // keep motion tangent to the sphere
        gx-=dot*a[0]; gy-=dot*a[1]; gz-=dot*a[2];
        const mL=Math.sqrt(gx*gx+gy*gy+gz*gz);
        if(mL>1e-9){ const k=Math.min(MAXSTEP, mL*GAIN)/mL;
          let nx=a[0]+gx*k, ny=a[1]+gy*k, nz=a[2]+gz*k;
          const L=Math.sqrt(nx*nx+ny*ny+nz*nz)||1; a[0]=nx/L; a[1]=ny/L; a[2]=nz/L; }
      }
    }
  }

  // ================= timeline — forward: fill, then collapse straight DOWN to an opaque white dot =================
  const HOLD0=0.3, STEP_DT=0.2, STEP_END=HOLD0+5*STEP_DT;   // boom · step · step …
  const BALL_T=1.5, BALL_END=STEP_END+BALL_T;           // sphere fully formed
  const COLLAPSE=0.7, COLLAPSE_END=BALL_END+COLLAPSE;   // shrink straight down to the white dot (no fade)
  const DOT_HOLD=0.8, TOTAL=COLLAPSE_END+DOT_HOLD;      // hold on the white dot, then loop
  const SPIN=0.45, TILT=0.26;
  const ZOOM0=0.75, ZOOM_STEP=0.62, ZOOM_MIN=0.30, ZOOM_DOT=0.045;   // start ~0.75, work down, then down to the dot
  const ease = x => x*x*(3-2*x);
  const smooth = (a,b,x)=>{ const t=Math.min(1,Math.max(0,(x-a)/(b-a))); return t*t*(3-2*t); };

  let lastN=-1, nowSec=0, zoom=1, fade=1, edgeK=1, backCull=0, phaseName='2D';

  function timeline(dt){
    nowSec += dt;
    if(nowSec >= TOTAL){ nowSec -= TOTAL; pts=[]; lastN=-1; }
    const t=nowSec; let N;
    if(t < HOLD0){ N=1; zoom=ZOOM0-(ZOOM0-ZOOM_STEP)*ease(t/STEP_END); phaseName='start'; edgeK=1; }
    else if(t < STEP_END){ N=Math.min(6, 2+Math.floor((t-HOLD0)/STEP_DT)); zoom=ZOOM0-(ZOOM0-ZOOM_STEP)*ease(t/STEP_END); phaseName=N<3?'2D':'3D'; edgeK=1; }
    else if(t < BALL_END){ const tau=(t-STEP_END)/BALL_T; N=Math.min(NMAX, Math.round(6*Math.pow(NMAX/6, tau))); zoom=ZOOM_STEP-(ZOOM_STEP-ZOOM_MIN)*ease(tau); phaseName='fill'; edgeK=1-ease(tau); }
    else if(t < COLLAPSE_END){ const r=(t-BALL_END)/COLLAPSE; N=NMAX; zoom=ZOOM_MIN-(ZOOM_MIN-ZOOM_DOT)*ease(r); phaseName='collapse'; edgeK=0; }
    else { N=NMAX; zoom=ZOOM_DOT; phaseName='dot'; edgeK=0; }
    fade=1;                                             // never fades — no disappearance; ends on the opaque white dot
    backCull=smooth(8,34,pts.length);
    if(N!==lastN){ setCount(N); lastN=N; }
  }

  function integrate(dt){
    const n=pts.length; if(!n) return;
    const kPos = 1 - Math.pow(0.004, dt), kS = 1 - Math.pow(0.0016, dt);
    if(n<=3 && PIN[n]){                                  // glide to the pinned broadside pose
      const H=PIN[n];
      for(let i=0;i<n;i++){ const p=pts[i].p, h=H[i];
        p[0]+=(h[0]-p[0])*kPos; p[1]+=(h[1]-p[1])*kPos; p[2]+=(h[2]-p[2])*kPos;
        const L=Math.hypot(p[0],p[1],p[2])||1; p[0]/=L;p[1]/=L;p[2]/=L; }
    } else {
      relax(ITERS);                                      // N≥4 : find the balance
    }
    for(const p of pts) p.s += (1-p.s)*kS;               // pop new points in (in place)
  }

  // ================= edges (nearest-neighbour, rebuilt each frame) =================
  let edges=[];
  function buildEdges(){
    const n=pts.length; edges.length=0;
    if(n<2 || n>56) return;                              // wireframe only while it reads as a solid
    const K = n<24?4:3;
    const seen=new Set();
    for(let i=0;i<n;i++){ const a=pts[i].p, arr=[];
      for(let j=0;j<n;j++){ if(j===i) continue; const b=pts[j].p;
        const dx=a[0]-b[0],dy=a[1]-b[1],dz=a[2]-b[2]; arr.push([dx*dx+dy*dy+dz*dz,j]); }
      arr.sort((u,v)=>u[0]-v[0]);
      for(let k=0;k<Math.min(K,arr.length);k++){ const j=arr[k][1], key=i<j?i*512+j:j*512+i;
        if(!seen.has(key)){ seen.add(key); edges.push([Math.min(i,j),Math.max(i,j)]); } }
    }
  }

  // ================= pixi scene =================
  function makeDot(){                                    // crisp SOLID disc — "that is THE point"
    const c=document.createElement('canvas'); c.width=c.height=64; const g=c.getContext('2d');
    g.fillStyle='#fff'; g.beginPath(); g.arc(32,32,26,0,6.2832); g.fill();
    return Texture.from(c);
  }
  const DOT_R = 26;
  const dotTex = makeDot();
  const wire = new Graphics();
  const field = new Container(); field.sortableChildren = true;
  app.stage.addChild(wire, field);
  const sprites = new Array(NMAX);
  for(let i=0;i<NMAX;i++){ const s=new Sprite(dotTex); s.anchor.set(0.5); s.visible=false; field.addChild(s); sprites[i]=s; }
  const proj = Array.from({length:NMAX}, ()=>({sx:0,sy:0,z:0,persp:1,s:0,front:1}));

  const INK=[245,249,252], WARM=[255,176,48], DIM=[90,110,130];
  const packi = c => (Math.round(c[0])<<16)|(Math.round(c[1])<<8)|Math.round(c[2]);
  const mix = (a,b,t) => [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
  const clamp = (v,lo,hi) => v<lo?lo:v>hi?hi:v;
  const DIM_HEX = packi(DIM);
  const F = 3.2, BUCKETS = 6;
  const lanes = Array.from({length:BUCKETS}, ()=>[]);

  function render(){
    const cx=app.screen.width/2, cy=app.screen.height/2;
    const R=Math.min(app.screen.width, app.screen.height)*0.30*zoom;
    const yaw=Math.max(0,nowSec-HOLD0)*(reduce?0.15:SPIN);   // still during the opening pause
    const cyw=Math.cos(yaw), syw=Math.sin(yaw), ctl=Math.cos(TILT), stl=Math.sin(TILT);
    const n=pts.length;

    for(let i=0;i<n;i++){
      const p=pts[i].p, q=proj[i];
      const x1=p[0]*cyw + p[2]*syw, z1=-p[0]*syw + p[2]*cyw;
      const y2=p[1]*ctl - z1*stl, z2=p[1]*stl + z1*ctl;
      const persp=F/(F-z2);
      q.sx=cx+x1*R*persp; q.sy=cy-y2*R*persp; q.z=z2; q.persp=persp; q.s=pts[i].s;
      q.front = 1 - backCull + backCull*smooth(-0.05, 0.28, z2);   // hide the far side
    }

    wire.clear();
    const eK=edgeK*fade;
    if(showEdges && edges.length && eK>0.01){
      for(let b=0;b<BUCKETS;b++) lanes[b].length=0;
      for(let e=0;e<edges.length;e++){ const A=proj[edges[e][0]], B=proj[edges[e][1]]; if(!A||!B) continue;
        const a=clamp(0.12+((A.z+B.z)*0.5+1)*0.16, 0.05, 0.42)*Math.min(A.s,B.s)*Math.min(A.front,B.front)*eK;
        if(a<=0.02) continue;
        lanes[clamp(Math.floor(a/0.42*BUCKETS),0,BUCKETS-1)].push(A.sx,A.sy,B.sx,B.sy); }
      for(let b=0;b<BUCKETS;b++){ const L=lanes[b]; if(!L.length) continue;
        for(let k=0;k<L.length;k+=4){ wire.moveTo(L[k],L[k+1]).lineTo(L[k+2],L[k+3]); }
        wire.stroke({ width:1, color:DIM_HEX, alpha:(b+0.5)/BUCKETS*0.42 }); }
    }

    for(let i=0;i<NMAX;i++){
      const s=sprites[i];
      if(i>=n){ s.visible=false; continue; }
      const q=proj[i], p=pts[i];
      const vis=q.s*fade*q.front;
      if(vis<=0.006){ s.visible=false; continue; }
      const radPx=Math.max(0.8, (n<=6?7.5:3.2)*q.persp*zoom*(0.5+0.5*q.s));
      const shade=clamp((q.z+1)*0.5,0,1);
      const spark=warmOn ? clamp(1-(nowSec-p.born)/0.6,0,1) : 0;
      s.visible=true; s.x=q.sx; s.y=q.sy; s.scale.set(radPx/DOT_R);
      s.tint=packi(mix(INK,WARM,spark*0.9));
      s.alpha=clamp((0.5+0.5*shade)*vis, 0, 1);
      s.zIndex=q.z;
    }
    updateHud();
  }

  // ================= hud + controls =================
  const $ = id => document.getElementById(id);
  const rPhase=$('r-phase'), rShape=$('r-shape'), rN=$('r-n'), mark=$('mark');
  const NAME={1:'point',2:'line',3:'triangle',4:'tetrahedron',5:'bipyramid',6:'octahedron'};
  function updateHud(){
    const shape = pts.length<=6 ? (NAME[pts.length]||'')
                : (pts.length>=NMAX ? 'sphere' : 'fill');
    rPhase.textContent=phaseName; rShape.textContent=shape; rN.textContent=pts.length;
    // "hypercomb" stays on screen the whole time (loading brand) — opacity left at its inline 1
  }

  let running=true, showEdges=false, warmOn=false, speed=1.25;  // clean defaults: no edges, no spark
  const bPlay=$('b-play'), bSpd=$('b-spd');
  bPlay.onclick=()=>{ running=!running; bPlay.textContent=running?'Pause':'Play'; };
  $('b-slow').onclick=()=>{ speed=Math.max(0.25,+(speed-0.25).toFixed(2)); bSpd.textContent=speed.toFixed(2)+'×'; };
  $('b-fast').onclick=()=>{ speed=Math.min(3,+(speed+0.25).toFixed(2)); bSpd.textContent=speed.toFixed(2)+'×'; };
  $('b-edges').onclick=e=>{ showEdges=!showEdges; e.currentTarget.classList.toggle('on',showEdges); };
  $('b-warm').onclick=e=>{ warmOn=!warmOn; e.currentTarget.classList.toggle('on',warmOn); };
  $('b-restart').onclick=()=>{ nowSec=0; pts=[]; lastN=-1; };

  // ================= loop =================
  timeline(0);
  app.ticker.add((tk)=>{
    const dt=Math.min(0.05, tk.deltaMS/1000)*speed;
    if(running){ timeline(dt); integrate(dt); buildEdges(); }
    render();
  });

  // headless verification hook
  window.__genesis = {
    step(dt=1/60, times=1){
      for(let i=0;i<times;i++){ if(running){ timeline(dt); integrate(dt); buildEdges(); } render(); }
      const n=pts.length; let mn=Infinity, mx=0, front=0;
      for(let i=0;i<n;i++){ if(proj[i].front>0.5 && proj[i].z>0) front++;
        for(let j=i+1;j<n;j++){ const a=pts[i].p,b=pts[j].p, d=Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]); if(d<mn)mn=d; if(d>mx)mx=d; } }
      const screen = n<=6 ? proj.slice(0,n).map(q=>[Math.round(q.sx),Math.round(q.sy)]) : undefined;
      const yaw = +(Math.max(0,nowSec-HOLD0)*SPIN).toFixed(3);
      return { t:+nowSec.toFixed(2), phase:phaseName, n, edges:edges.length, zoom:+zoom.toFixed(2), fade:+fade.toFixed(2), yaw,
        backCull:+backCull.toFixed(2), minDist:n>1?+mn.toFixed(3):null, maxDist:n>1?+mx.toFixed(3):null, frontVisible:front, screen };
    },
    get info(){ return { renderer:app.renderer?.name, screen:{w:app.screen.width,h:app.screen.height}, cycle:+TOTAL.toFixed(2), nmax:NMAX }; }
  };
  console.log('[genesis] engine ready —', app.renderer?.name, 'NMAX', NMAX, 'cycle', +TOTAL.toFixed(2)+'s');
})();
