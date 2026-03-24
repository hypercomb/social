// src/diamondcoreprocessor.com/presentation/avatars/avatar-swarm.drone.ts
import { Drone } from "@hypercomb/core";
import { Container, Geometry, Mesh, Texture } from "pixi.js";

// src/diamondcoreprocessor.com/presentation/avatars/bee-swarm.shader.ts
import { Shader } from "pixi.js";
var BeeSwarmShader = class _BeeSwarmShader {
  shader;
  #ug;
  constructor() {
    const uniformDefs = {
      u_time: { value: 0, type: "f32" },
      u_scale: { value: 1, type: "f32" }
    };
    this.shader = Shader.from({
      gl: { vertex: _BeeSwarmShader.vertexSource, fragment: _BeeSwarmShader.fragmentSource },
      resources: { uniforms: uniformDefs }
    });
    this.#ug = this.shader.resources.uniforms;
  }
  setTime = (t) => {
    this.#ug.uniforms.u_time = t;
    this.#ug.update();
  };
  setScale = (s) => {
    this.#ug.uniforms.u_scale = s;
    this.#ug.update();
  };
  // ─── vertex shader ───────────────────────────────────────────
  // Each bee is a quad (4 verts, 6 indices). Per-instance data is
  // duplicated across the 4 verts of each quad (same pattern as
  // show-honeycomb's hex quads).
  static vertexSource = `
    in vec2 aPosition;
    in vec2 aUV;
    in vec2 aBeePos;
    in vec3 aBeeColor;
    in vec3 aWingColor;
    in float aBeePhase;
    in float aBeeVariant;
    in float aBeeAlpha;
    in float aBeeFacing;

    out vec2 vUV;
    out vec3 vBodyColor;
    out vec3 vWingColor;
    out float vPhase;
    out float vVariant;
    out float vAlpha;
    out float vFacing;
    out float vTime;

    uniform mat3 uProjectionMatrix;
    uniform mat3 uWorldTransformMatrix;
    uniform mat3 uTransformMatrix;
    uniform float u_time;
    uniform float u_scale;

    void main() {
      // body bob \u2014 subtle vertical oscillation
      float bob = sin(u_time * 3.0 + aBeePhase) * 2.0;
      vec2 worldPos = aBeePos + aPosition * u_scale + vec2(0.0, bob);

      mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
      gl_Position = vec4((mvp * vec3(worldPos, 1.0)).xy, 0.0, 1.0);

      vUV = aUV;
      vBodyColor = aBeeColor;
      vWingColor = aWingColor;
      vPhase = aBeePhase;
      vVariant = aBeeVariant;
      vAlpha = aBeeAlpha;
      vFacing = aBeeFacing;
      vTime = u_time;
    }
  `;
  // ─── fragment shader ─────────────────────────────────────────
  // Draws bee shape entirely via SDF composition:
  //   - body ellipse (aspect varies by variant)
  //   - two wing ellipses with flutter animation
  //   - stripe bands on body
  //   - two dot eyes
  static fragmentSource = `
    precision highp float;

    in vec2 vUV;
    in vec3 vBodyColor;
    in vec3 vWingColor;
    in float vPhase;
    in float vVariant;
    in float vAlpha;
    in float vFacing;
    in float vTime;

    // SDF ellipse (approximate \u2014 fast)
    float sdEllipse(vec2 p, vec2 r) {
      vec2 q = p / r;
      float d = length(q) - 1.0;
      return d * min(r.x, r.y);
    }

    // SDF circle
    float sdCircle(vec2 p, float r) {
      return length(p) - r;
    }

    void main() {
      // local coordinates: center of quad is (0,0), range roughly -1..1
      vec2 uv = (vUV - 0.5) * 2.0;

      // mirror X based on facing direction (negative = facing left)
      uv.x *= vFacing >= 0.0 ? 1.0 : -1.0;

      // \u2500\u2500 variant-dependent body proportions \u2500\u2500
      // variant 0: classic bee (balanced)
      // variant 1: round bumble (wider, shorter)
      // variant 2: elongated wasp (narrow, longer)
      float v = floor(vVariant + 0.5);
      vec2 bodyR = v < 0.5 ? vec2(0.35, 0.50)     // classic
               : v < 1.5 ? vec2(0.45, 0.42)     // bumble
               :            vec2(0.28, 0.58);    // wasp

      // stripe count varies by variant
      float stripeFreq = v < 0.5 ? 6.0 : v < 1.5 ? 5.0 : 8.0;

      // \u2500\u2500 body \u2500\u2500
      float dBody = sdEllipse(uv, bodyR);

      // \u2500\u2500 wings \u2500\u2500 flutter via time + phase
      float flutter = sin(vTime * 12.0 + vPhase * 6.28) * 0.15;
      vec2 wingOffset = vec2(bodyR.x * 0.7, -bodyR.y * 0.35 + flutter);
      vec2 wingR = vec2(0.28, 0.18);

      float dWingL = sdEllipse(uv - vec2(-wingOffset.x, wingOffset.y), wingR);
      float dWingR = sdEllipse(uv - vec2( wingOffset.x, wingOffset.y), wingR);
      float dWings = min(dWingL, dWingR);

      // \u2500\u2500 eyes \u2500\u2500 two small dots near top of body
      float eyeSpacing = bodyR.x * 0.45;
      float eyeY = -bodyR.y * 0.35;
      float eyeR = 0.06;
      float dEyeL = sdCircle(uv - vec2(-eyeSpacing, eyeY), eyeR);
      float dEyeR = sdCircle(uv - vec2( eyeSpacing, eyeY), eyeR);
      float dEyes = min(dEyeL, dEyeR);

      // \u2500\u2500 composite \u2500\u2500
      float aa = 0.04; // anti-aliasing width

      // wings (behind body)
      float wingAlpha = 1.0 - smoothstep(-aa, aa, dWings);
      vec3 wingCol = vWingColor * 1.2; // slightly brighter
      float wingOpacity = 0.55; // translucent wings

      // body
      float bodyAlpha = 1.0 - smoothstep(-aa, aa, dBody);

      // stripes on body
      float stripeMask = smoothstep(-0.02, 0.02, sin(uv.y * stripeFreq * 3.14159));
      vec3 stripeColor = vBodyColor * 0.3; // dark stripes
      vec3 bodyCol = mix(vBodyColor, stripeColor, stripeMask * 0.7);

      // eyes
      float eyeAlpha = 1.0 - smoothstep(-aa, aa, dEyes);

      // layer: wings behind, body on top, eyes on top of body
      vec3 color = vec3(0.0);
      float alpha = 0.0;

      // wings layer
      color = wingCol * wingOpacity;
      alpha = wingAlpha * wingOpacity;

      // body layer (over wings)
      color = mix(color, bodyCol, bodyAlpha);
      alpha = mix(alpha, 1.0, bodyAlpha);

      // eyes layer (over body)
      color = mix(color, vec3(0.05), eyeAlpha);
      alpha = mix(alpha, 1.0, eyeAlpha);

      // overall opacity (fade in/out)
      alpha *= vAlpha;

      if (alpha < 0.005) discard;

      // premultiplied alpha
      gl_FragColor = vec4(color * alpha, alpha);
    }
  `;
};

// src/diamondcoreprocessor.com/presentation/grid/simplex-noise.ts
var F2 = 0.5 * (Math.sqrt(3) - 1);
var G2 = (3 - Math.sqrt(3)) / 6;
var grad2 = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1]
];
var perm = new Uint8Array(512);
var grad = new Uint8Array(512);
(() => {
  let s = 0;
  for (let i = 0; i < 256; i++) {
    s = s * 1664525 + 1013904223 + i >>> 0;
    perm[i] = perm[i + 256] = s >>> 16 & 255;
    grad[i] = grad[i + 256] = perm[i] % 12;
  }
})();
function dot2(gi, x, y) {
  const g = grad2[gi];
  return g[0] * x + g[1] * y;
}
function noise2D(xin, yin) {
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - (i - t);
  const y0 = yin - (j - t);
  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;
  const ii = i & 255;
  const jj = j & 255;
  let n0 = 0, n1 = 0, n2 = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) {
    t0 *= t0;
    n0 = t0 * t0 * dot2(grad[ii + perm[jj]], x0, y0);
  }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) {
    t1 *= t1;
    n1 = t1 * t1 * dot2(grad[ii + i1 + perm[jj + j1]], x1, y1);
  }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) {
    t2 *= t2;
    n2 = t2 * t2 * dot2(grad[ii + 1 + perm[jj + 1]], x2, y2);
  }
  return 70 * (n0 + n1 + n2);
}

// src/diamondcoreprocessor.com/presentation/avatars/avatar-swarm.drone.ts
var MAX_BEES = 2048;
var QUAD_HALF = 16;
var PUBLISH_INTERVAL_MS = 3e3;
var PEER_EXPIRY_MS = 15e3;
var FADE_SPEED = 0.03;
function pubkeyToAvatar(id) {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = (h << 5) + h + id.charCodeAt(i) | 0;
  h = h >>> 0;
  const hue1 = h % 360 / 360;
  const hue2 = (h >>> 8) % 360 / 360;
  const variant = (h >>> 16) % 3;
  return {
    bodyColor: hslToRgb(hue1, 0.7, 0.55),
    wingColor: hslToRgb(hue2, 0.4, 0.75),
    variant
  };
}
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(h * 6 % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  const sector = h * 6 | 0;
  if (sector === 0) {
    r = c;
    g = x;
  } else if (sector === 1) {
    r = x;
    g = c;
  } else if (sector === 2) {
    g = c;
    b = x;
  } else if (sector === 3) {
    g = x;
    b = c;
  } else if (sector === 4) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return [r + m, g + m, b + m];
}
var AvatarSwarmDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  deps = {
    mesh: "@diamondcoreprocessor.com/NostrMeshWorker",
    lineage: "@hypercomb.social/Lineage"
  };
  listens = ["render:host-ready", "render:geometry-changed", "mesh:ensure-started"];
  emits = ["swarm:peer-count"];
  #app = null;
  #container = null;
  #layer = null;
  #mesh = null;
  #shader = null;
  #geom = null;
  #tickerBound = false;
  // per-instance buffers (4 verts per bee × MAX_BEES)
  #posBuf = new Float32Array(MAX_BEES * 8);
  // aPosition (quad corners relative)
  #uvBuf = new Float32Array(MAX_BEES * 8);
  // aUV
  #beePosBuf = new Float32Array(MAX_BEES * 8);
  // aBeePos (world pos, duplicated per 4 verts)
  #colorBuf = new Float32Array(MAX_BEES * 12);
  // aBeeColor (rgb × 4 verts)
  #wingBuf = new Float32Array(MAX_BEES * 12);
  // aWingColor
  #phaseBuf = new Float32Array(MAX_BEES * 4);
  // aBeePhase
  #variantBuf = new Float32Array(MAX_BEES * 4);
  // aBeeVariant
  #alphaBuf = new Float32Array(MAX_BEES * 4);
  // aBeeAlpha
  #facingBuf = new Float32Array(MAX_BEES * 4);
  // aBeeFacing
  #idxBuf = new Uint32Array(MAX_BEES * 6);
  // index buffer
  // peer state
  #peers = /* @__PURE__ */ new Map();
  #freeSlots = [];
  #activeCount = 0;
  // hex geometry for axial → pixel
  #hexGeo = { circumRadiusPx: 32, gapPx: 6, padPx: 10, spacing: 38 };
  #flat = false;
  // mesh subscription
  #meshSub = null;
  #currentSig = "";
  // publish state
  #lastPublishMs = 0;
  #viewingSeed = "";
  #viewingQ = 0;
  #viewingR = 0;
  // own identity
  #publisherId = "";
  #ownAvatar = { bodyColor: [1, 0.8, 0.2], wingColor: [0.8, 0.9, 1], variant: 0 };
  // time accumulator for shader
  #time = 0;
  constructor() {
    super();
    for (let i = MAX_BEES - 1; i >= 0; i--) this.#freeSlots.push(i);
    this.#initStaticBuffers();
  }
  #initStaticBuffers = () => {
    const hw = QUAD_HALF;
    const hh = QUAD_HALF;
    for (let i = 0; i < MAX_BEES; i++) {
      const p = i * 8;
      this.#posBuf[p] = -hw;
      this.#posBuf[p + 1] = -hh;
      this.#posBuf[p + 2] = hw;
      this.#posBuf[p + 3] = -hh;
      this.#posBuf[p + 4] = hw;
      this.#posBuf[p + 5] = hh;
      this.#posBuf[p + 6] = -hw;
      this.#posBuf[p + 7] = hh;
      const u = i * 8;
      this.#uvBuf[u] = 0;
      this.#uvBuf[u + 1] = 0;
      this.#uvBuf[u + 2] = 1;
      this.#uvBuf[u + 3] = 0;
      this.#uvBuf[u + 4] = 1;
      this.#uvBuf[u + 5] = 1;
      this.#uvBuf[u + 6] = 0;
      this.#uvBuf[u + 7] = 1;
      const ii = i * 6;
      const base = i * 4;
      this.#idxBuf[ii] = base;
      this.#idxBuf[ii + 1] = base + 1;
      this.#idxBuf[ii + 2] = base + 2;
      this.#idxBuf[ii + 3] = base;
      this.#idxBuf[ii + 4] = base + 2;
      this.#idxBuf[ii + 5] = base + 3;
      this.#alphaBuf[i * 4] = 0;
      this.#alphaBuf[i * 4 + 1] = 0;
      this.#alphaBuf[i * 4 + 2] = 0;
      this.#alphaBuf[i * 4 + 3] = 0;
      this.#facingBuf[i * 4] = 1;
      this.#facingBuf[i * 4 + 1] = 1;
      this.#facingBuf[i * 4 + 2] = 1;
      this.#facingBuf[i * 4 + 3] = 1;
    }
  };
  sense = () => true;
  heartbeat = async () => {
    this.#ensurePixi();
    this.#ensureMeshSubscription();
    this.#publishOwnPresence();
    this.#pruneExpiredPeers();
  };
  // ─── pixi setup ──────────────────────────────────────────────
  #effectsRegistered = false;
  #ensurePixi = () => {
    if (this.#effectsRegistered) return;
    this.#effectsRegistered = true;
    this.onEffect("render:host-ready", (payload) => {
      if (this.#app) return;
      this.#app = payload.app;
      this.#container = payload.container;
      this.#initRendering();
    });
    this.onEffect("render:geometry-changed", (geo) => {
      this.#hexGeo = geo;
    });
    this.onEffect("tile:hover", ({ label, q, r }) => {
      this.#viewingSeed = label;
      this.#viewingQ = q;
      this.#viewingR = r;
    });
  };
  #initRendering = () => {
    if (!this.#app || !this.#container) return;
    this.#shader = new BeeSwarmShader();
    this.#layer = new Container();
    this.#layer.zIndex = 10;
    this.#buildGeometry();
    const MeshCtor = Mesh;
    this.#mesh = new MeshCtor({ geometry: this.#geom, shader: this.#shader.shader, texture: Texture.WHITE });
    this.#mesh.blendMode = "pre-multiply";
    this.#layer.addChild(this.#mesh);
    this.#container.addChild(this.#layer);
    if (!this.#tickerBound) {
      this.#tickerBound = true;
      this.#app.ticker.add(this.#onTick);
    }
  };
  #buildGeometry = () => {
    this.#geom = new Geometry();
    this.#geom.addAttribute("aPosition", this.#posBuf, 2);
    this.#geom.addAttribute("aUV", this.#uvBuf, 2);
    this.#geom.addAttribute("aBeePos", this.#beePosBuf, 2);
    this.#geom.addAttribute("aBeeColor", this.#colorBuf, 3);
    this.#geom.addAttribute("aWingColor", this.#wingBuf, 3);
    this.#geom.addAttribute("aBeePhase", this.#phaseBuf, 1);
    this.#geom.addAttribute("aBeeVariant", this.#variantBuf, 1);
    this.#geom.addAttribute("aBeeAlpha", this.#alphaBuf, 1);
    this.#geom.addAttribute("aBeeFacing", this.#facingBuf, 1);
    this.#geom.addIndex(this.#idxBuf);
  };
  // ─── per-frame tick ──────────────────────────────────────────
  #onTick = () => {
    if (!this.#shader || !this.#geom || this.#peers.size === 0) return;
    const dt = this.#app.ticker.deltaMS / 1e3;
    this.#time += dt;
    this.#shader.setTime(this.#time);
    let dirty = false;
    for (const peer of this.#peers.values()) {
      const dx = (peer.targetX - peer.x) * 0.02;
      const dy = (peer.targetY - peer.y) * 0.02;
      const wx = noise2D(this.#time * 0.3 + peer.phase, peer.phase * 10) * 18;
      const wy = noise2D(peer.phase * 10, this.#time * 0.3 + peer.phase) * 18;
      peer.x += dx + wx * dt;
      peer.y += dy + wy * dt;
      const vx = dx + wx * dt;
      peer.facing = vx >= 0 ? 1 : -1;
      if (Math.abs(peer.alpha - peer.fadeTarget) > 1e-3) {
        peer.alpha += (peer.fadeTarget - peer.alpha) * FADE_SPEED * (dt * 60);
        if (peer.alpha < 5e-3 && peer.fadeTarget === 0) {
          this.#removePeer(peer.publisherId);
          continue;
        }
      }
      this.#writeSlotPosition(peer.slot, peer.x, peer.y);
      this.#writeSlotAlpha(peer.slot, peer.alpha);
      this.#writeSlotFacing(peer.slot, peer.facing);
      dirty = true;
    }
    if (dirty) {
      const g = this.#geom;
      g.getBuffer("aBeePos")?.update(this.#beePosBuf);
      g.getBuffer("aBeeAlpha")?.update(this.#alphaBuf);
      g.getBuffer("aBeeFacing")?.update(this.#facingBuf);
    }
  };
  // ─── mesh subscription ───────────────────────────────────────
  #ensureMeshSubscription = () => {
    if (!this.#publisherId) {
      const key = "hc:show-honeycomb:publisher-id";
      try {
        this.#publisherId = localStorage.getItem(key) ?? "";
      } catch {
      }
      if (!this.#publisherId) return;
      this.#ownAvatar = pubkeyToAvatar(this.#publisherId);
    }
    this.onEffect("mesh:ensure-started", ({ signature }) => {
      if (signature === this.#currentSig) return;
      this.#switchSig(signature);
    });
  };
  #switchSig = (sig) => {
    if (this.#meshSub) {
      try {
        this.#meshSub.close();
      } catch {
      }
      this.#meshSub = null;
    }
    for (const peer of this.#peers.values()) {
      this.#clearSlot(peer.slot);
      this.#freeSlots.push(peer.slot);
    }
    this.#peers.clear();
    this.#activeCount = 0;
    this.#currentSig = sig;
    const mesh = this.resolve("mesh");
    if (!mesh || typeof mesh.subscribe !== "function") return;
    this.#meshSub = mesh.subscribe(sig, (evt) => this.#onMeshEvent(evt));
  };
  #onMeshEvent = (evt) => {
    const p = evt.payload;
    if (!p || p.type !== "swarm-presence") return;
    const id = p.publisherId;
    if (!id || typeof id !== "string") return;
    if (id === this.#publisherId) return;
    const viewingQ = typeof p.viewingQ === "number" ? p.viewingQ : 0;
    const viewingR = typeof p.viewingR === "number" ? p.viewingR : 0;
    const variant = typeof p.avatar?.variant === "number" ? Math.max(0, Math.min(2, Math.floor(p.avatar.variant))) : 0;
    const { x: tx, y: ty } = this.#axialToPixel(viewingQ, viewingR);
    const existing = this.#peers.get(id);
    if (existing) {
      existing.targetX = tx;
      existing.targetY = ty;
      existing.lastSeenMs = Date.now();
      existing.fadeTarget = 1;
      return;
    }
    if (this.#freeSlots.length === 0) return;
    const slot = this.#freeSlots.pop();
    const avatar = this.#parseAvatar(p.avatar, id);
    const phase = (slot * 2.399 + 0.7) % 6.28;
    const peer = {
      publisherId: id,
      avatar,
      x: tx + (Math.random() - 0.5) * 40,
      y: ty + (Math.random() - 0.5) * 40,
      targetX: tx,
      targetY: ty,
      phase,
      facing: 1,
      alpha: 0,
      fadeTarget: 1,
      lastSeenMs: Date.now(),
      slot
    };
    this.#peers.set(id, peer);
    this.#activeCount++;
    this.#writeSlotColor(slot, avatar.bodyColor, avatar.wingColor);
    this.#writeSlotPhase(slot, phase);
    this.#writeSlotVariant(slot, avatar.variant);
    this.#writeSlotPosition(slot, peer.x, peer.y);
    this.#writeSlotAlpha(slot, 0);
    this.#writeSlotFacing(slot, 1);
    const g = this.#geom;
    g.getBuffer("aBeeColor")?.update(this.#colorBuf);
    g.getBuffer("aWingColor")?.update(this.#wingBuf);
    g.getBuffer("aBeePhase")?.update(this.#phaseBuf);
    g.getBuffer("aBeeVariant")?.update(this.#variantBuf);
    this.emitEffect("swarm:peer-count", { count: this.#activeCount });
  };
  #parseAvatar = (raw, fallbackId) => {
    if (raw && Array.isArray(raw.bodyColor) && raw.bodyColor.length === 3 && Array.isArray(raw.wingColor) && raw.wingColor.length === 3 && typeof raw.variant === "number") {
      return {
        bodyColor: [clamp01(raw.bodyColor[0]), clamp01(raw.bodyColor[1]), clamp01(raw.bodyColor[2])],
        wingColor: [clamp01(raw.wingColor[0]), clamp01(raw.wingColor[1]), clamp01(raw.wingColor[2])],
        variant: Math.max(0, Math.min(2, Math.floor(raw.variant)))
      };
    }
    return pubkeyToAvatar(fallbackId);
  };
  // ─── publishing own presence ─────────────────────────────────
  #publishOwnPresence = () => {
    const now = Date.now();
    if (now - this.#lastPublishMs < PUBLISH_INTERVAL_MS) return;
    if (!this.#currentSig || !this.#publisherId) return;
    const mesh = this.resolve("mesh");
    if (!mesh || typeof mesh.publish !== "function") return;
    this.#lastPublishMs = now;
    const payload = {
      type: "swarm-presence",
      publisherId: this.#publisherId,
      avatar: this.#ownAvatar,
      viewingSeed: this.#viewingSeed,
      viewingQ: this.#viewingQ,
      viewingR: this.#viewingR,
      ts: now
    };
    void mesh.publish(29010, this.#currentSig, payload, [
      ["publisher", this.#publisherId],
      ["mode", "swarm-presence"]
    ]);
  };
  // ─── peer expiry ─────────────────────────────────────────────
  #pruneExpiredPeers = () => {
    const now = Date.now();
    for (const [id, peer] of this.#peers) {
      if (now - peer.lastSeenMs > PEER_EXPIRY_MS) {
        peer.fadeTarget = 0;
      }
    }
  };
  #removePeer = (id) => {
    const peer = this.#peers.get(id);
    if (!peer) return;
    this.#clearSlot(peer.slot);
    this.#freeSlots.push(peer.slot);
    this.#peers.delete(id);
    this.#activeCount--;
    this.emitEffect("swarm:peer-count", { count: this.#activeCount });
  };
  // ─── buffer writers ──────────────────────────────────────────
  #writeSlotPosition = (slot, x, y) => {
    const o = slot * 8;
    this.#beePosBuf[o] = x;
    this.#beePosBuf[o + 1] = y;
    this.#beePosBuf[o + 2] = x;
    this.#beePosBuf[o + 3] = y;
    this.#beePosBuf[o + 4] = x;
    this.#beePosBuf[o + 5] = y;
    this.#beePosBuf[o + 6] = x;
    this.#beePosBuf[o + 7] = y;
  };
  #writeSlotColor = (slot, body, wing) => {
    const o = slot * 12;
    for (let v = 0; v < 4; v++) {
      const p = o + v * 3;
      this.#colorBuf[p] = body[0];
      this.#colorBuf[p + 1] = body[1];
      this.#colorBuf[p + 2] = body[2];
      this.#wingBuf[p] = wing[0];
      this.#wingBuf[p + 1] = wing[1];
      this.#wingBuf[p + 2] = wing[2];
    }
  };
  #writeSlotPhase = (slot, phase) => {
    const o = slot * 4;
    this.#phaseBuf[o] = this.#phaseBuf[o + 1] = this.#phaseBuf[o + 2] = this.#phaseBuf[o + 3] = phase;
  };
  #writeSlotVariant = (slot, variant) => {
    const o = slot * 4;
    this.#variantBuf[o] = this.#variantBuf[o + 1] = this.#variantBuf[o + 2] = this.#variantBuf[o + 3] = variant;
  };
  #writeSlotAlpha = (slot, alpha) => {
    const o = slot * 4;
    this.#alphaBuf[o] = this.#alphaBuf[o + 1] = this.#alphaBuf[o + 2] = this.#alphaBuf[o + 3] = alpha;
  };
  #writeSlotFacing = (slot, facing) => {
    const o = slot * 4;
    this.#facingBuf[o] = this.#facingBuf[o + 1] = this.#facingBuf[o + 2] = this.#facingBuf[o + 3] = facing;
  };
  #clearSlot = (slot) => {
    this.#writeSlotAlpha(slot, 0);
    this.#writeSlotPosition(slot, 0, 0);
  };
  // ─── helpers ─────────────────────────────────────────────────
  #axialToPixel = (q, r) => {
    const s = this.#hexGeo.spacing;
    return this.#flat ? { x: 1.5 * s * q, y: Math.sqrt(3) * s * (r + q / 2) } : { x: Math.sqrt(3) * s * (q + r / 2), y: s * 1.5 * r };
  };
  dispose = () => {
    if (this.#meshSub) {
      try {
        this.#meshSub.close();
      } catch {
      }
    }
    if (this.#app && this.#tickerBound) {
      this.#app.ticker.remove(this.#onTick);
    }
    if (this.#layer && this.#container) {
      this.#container.removeChild(this.#layer);
    }
  };
};
function clamp01(v) {
  return typeof v === "number" ? Math.max(0, Math.min(1, v)) : 0;
}
var _avatarSwarm = new AvatarSwarmDrone();
window.ioc.register("@diamondcoreprocessor.com/AvatarSwarmDrone", _avatarSwarm);
export {
  AvatarSwarmDrone
};
