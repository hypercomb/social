// src/diamondcoreprocessor.com/meeting/meeting-video.drone.ts
import { Drone } from "@hypercomb/core";
import { Container, Graphics, Sprite, Texture } from "pixi.js";
var FADE_SPEED = 0.04;
var MeetingVideoDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  genotype = "meeting";
  description = "Renders peer video streams into hex tiles \u2014 hex-clipped, faded in/out on connect/disconnect.";
  effects = ["render"];
  listens = [
    "meeting:streams",
    "meeting:state",
    "render:host-ready",
    "render:geometry-changed",
    "render:cell-count"
  ];
  #app = null;
  #renderContainer = null;
  #layer = null;
  #tickerBound = false;
  #hexGeo = { circumRadiusPx: 32, gapPx: 6, padPx: 10, spacing: 38 };
  #flat = false;
  #cellLabels = [];
  #slots = /* @__PURE__ */ new Map();
  #meetingActive = false;
  #latestStreams = /* @__PURE__ */ new Map();
  #effectsRegistered = false;
  sense = () => true;
  heartbeat = async () => {
    if (!this.#effectsRegistered) {
      this.#effectsRegistered = true;
      this.#registerEffects();
    }
  };
  #registerEffects = () => {
    this.onEffect("render:host-ready", (payload) => {
      if (this.#app) return;
      this.#app = payload.app;
      this.#renderContainer = payload.container;
      this.#initLayer();
    });
    this.onEffect("render:geometry-changed", (geo) => {
      this.#hexGeo = geo;
      this.#repositionAll();
    });
    this.onEffect("render:cell-count", (payload) => {
      this.#cellLabels = payload.labels;
    });
    this.onEffect("meeting:state", ({ state }) => {
      this.#meetingActive = state === "active" || state === "gathering";
      if (state === "ended" || state === "idle") {
        this.#fadeOutAll();
      }
    });
    this.onEffect("meeting:streams", ({ streams }) => {
      this.#latestStreams = streams;
      this.#syncSlots();
    });
  };
  // ─── pixi layer ──────────────────────────────────────────────
  #initLayer = () => {
    if (!this.#app || !this.#renderContainer) return;
    this.#layer = new Container();
    this.#layer.zIndex = 5;
    this.#layer.label = "meeting-video-layer";
    this.#renderContainer.addChild(this.#layer);
    if (!this.#tickerBound) {
      this.#tickerBound = true;
      this.#app.ticker.add(this.#onTick);
    }
  };
  // ─── sync video slots with streams ───────────────────────────
  #syncSlots = () => {
    if (!this.#layer) return;
    for (const [id, slot] of this.#slots) {
      if (!this.#latestStreams.has(id)) {
        slot.fadeTarget = 0;
      }
    }
    let idx = 0;
    for (const [id, stream] of this.#latestStreams) {
      const existing = this.#slots.get(id);
      if (existing) {
        if (existing.video.srcObject !== stream) {
          existing.video.srcObject = stream;
        }
        existing.fadeTarget = 1;
      } else {
        this.#createSlot(id, stream, idx);
      }
      idx++;
    }
  };
  #createSlot = (publisherId, stream, index) => {
    if (!this.#layer) return;
    const video = document.createElement("video");
    video.srcObject = stream;
    video.autoplay = true;
    video.muted = publisherId === this.#getOwnId();
    video.playsInline = true;
    video.style.display = "none";
    document.body.appendChild(video);
    void video.play().catch(() => {
    });
    const container = new Container();
    container.label = `video-${publisherId.slice(0, 8)}`;
    const mask = new Graphics();
    this.#drawHexMask(mask);
    container.addChild(mask);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const sprite = new Sprite(Texture.from(canvas));
    sprite.anchor.set(0.5, 0.5);
    sprite.width = this.#hexGeo.circumRadiusPx * 2;
    sprite.height = this.#hexGeo.circumRadiusPx * 2;
    sprite.mask = mask;
    sprite.alpha = 0;
    container.addChild(sprite);
    const pos = this.#indexToPixel(index);
    container.x = pos.x;
    container.y = pos.y;
    this.#layer.addChild(container);
    const slot = {
      publisherId,
      video,
      sprite,
      mask,
      container,
      alpha: 0,
      fadeTarget: 1
    };
    this.#slots.set(publisherId, slot);
  };
  // ─── per-frame tick ──────────────────────────────────────────
  #onTick = () => {
    const toRemove = [];
    for (const [id, slot] of this.#slots) {
      this.#updateVideoTexture(slot);
      if (Math.abs(slot.alpha - slot.fadeTarget) > 1e-3) {
        slot.alpha += (slot.fadeTarget - slot.alpha) * FADE_SPEED * 60 * (this.#app.ticker.deltaMS / 1e3);
        slot.sprite.alpha = slot.alpha;
        if (slot.alpha < 5e-3 && slot.fadeTarget === 0) {
          toRemove.push(id);
        }
      }
    }
    for (const id of toRemove) this.#removeSlot(id);
  };
  #updateVideoTexture = (slot) => {
    if (slot.video.readyState < 2) return;
    const tex = slot.sprite.texture;
    const source = tex.source;
    const canvas = source?.resource;
    if (!canvas || typeof canvas.getContext !== "function") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const vw = slot.video.videoWidth || 256;
    const vh = slot.video.videoHeight || 256;
    const side = Math.min(vw, vh);
    const sx = (vw - side) / 2;
    const sy = (vh - side) / 2;
    ctx.drawImage(slot.video, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
    source.update?.();
  };
  // ─── hex mask ────────────────────────────────────────────────
  #drawHexMask = (g) => {
    const r = this.#hexGeo.circumRadiusPx;
    g.clear();
    const verts = [];
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 3 * i - Math.PI / 6;
      verts.push(Math.cos(angle) * r, Math.sin(angle) * r);
    }
    g.poly(verts, true);
    g.fill({ color: 16777215, alpha: 1 });
  };
  // ─── positioning ─────────────────────────────────────────────
  #indexToPixel = (index) => {
    const { q, r } = this.#indexToAxial(index);
    return this.#axialToPixel(q, r);
  };
  #indexToAxial = (index) => {
    if (index === 0) return { q: 0, r: 0 };
    let ring = 1;
    let total = 1;
    while (total + ring * 6 <= index) {
      total += ring * 6;
      ring++;
    }
    const pos = index - total;
    const side = Math.floor(pos / ring);
    const offset = pos % ring;
    const dirs = [
      { dq: 1, dr: -1 },
      { dq: 0, dr: -1 },
      { dq: -1, dr: 0 },
      { dq: -1, dr: 1 },
      { dq: 0, dr: 1 },
      { dq: 1, dr: 0 }
    ];
    let q = 0, r = -ring;
    for (let s = 0; s < side; s++) {
      q += dirs[s].dq * ring;
      r += dirs[s].dr * ring;
    }
    q += dirs[side].dq * offset;
    r += dirs[side].dr * offset;
    return { q, r };
  };
  #axialToPixel = (q, r) => {
    const s = this.#hexGeo.spacing;
    return this.#flat ? { x: 1.5 * s * q, y: Math.sqrt(3) * s * (r + q / 2) } : { x: Math.sqrt(3) * s * (q + r / 2), y: s * 1.5 * r };
  };
  #repositionAll = () => {
    let idx = 0;
    for (const [, slot] of this.#slots) {
      const pos = this.#indexToPixel(idx);
      slot.container.x = pos.x;
      slot.container.y = pos.y;
      this.#drawHexMask(slot.mask);
      slot.sprite.width = this.#hexGeo.circumRadiusPx * 2;
      slot.sprite.height = this.#hexGeo.circumRadiusPx * 2;
      idx++;
    }
  };
  // ─── fade all out ────────────────────────────────────────────
  #fadeOutAll = () => {
    for (const [, slot] of this.#slots) {
      slot.fadeTarget = 0;
    }
  };
  // ─── cleanup ─────────────────────────────────────────────────
  #removeSlot = (id) => {
    const slot = this.#slots.get(id);
    if (!slot) return;
    slot.video.pause();
    slot.video.srcObject = null;
    slot.video.remove();
    slot.container.destroy({ children: true });
    this.#slots.delete(id);
  };
  #getOwnId = () => {
    try {
      return localStorage.getItem("hc:show-honeycomb:publisher-id") ?? "";
    } catch {
      return "";
    }
  };
  dispose = () => {
    for (const [id] of this.#slots) this.#removeSlot(id);
    if (this.#app && this.#tickerBound) {
      this.#app.ticker.remove(this.#onTick);
    }
    if (this.#layer && this.#renderContainer) {
      this.#renderContainer.removeChild(this.#layer);
    }
  };
};
var _meetingVideo = new MeetingVideoDrone();
window.ioc.register("@diamondcoreprocessor.com/MeetingVideoDrone", _meetingVideo);
export {
  MeetingVideoDrone
};
