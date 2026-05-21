// @diamondcoreprocessor.com/meeting
// src/diamondcoreprocessor.com/meeting/meeting-audio.ts
var MeetingSpatialAudio = class {
  #ctx = null;
  #nodes = /* @__PURE__ */ new Map();
  /** Lazily create AudioContext (must be called after user gesture). */
  #ensureCtx() {
    if (!this.#ctx) {
      this.#ctx = new AudioContext({ sampleRate: 48e3 });
      const l = this.#ctx.listener;
      if (l.positionX) {
        l.positionX.value = 0;
        l.positionY.value = 0;
        l.positionZ.value = 0;
        l.forwardX.value = 0;
        l.forwardY.value = 0;
        l.forwardZ.value = -1;
        l.upX.value = 0;
        l.upY.value = 1;
        l.upZ.value = 0;
      }
    }
    if (this.#ctx.state === "suspended") this.#ctx.resume();
    return this.#ctx;
  }
  /**
   * Compute 3D position for a slot.
   * Ring 1 slots (0–5) are at unit distance, ring 2 (6–17) at distance 2, etc.
   */
  #slotPosition(slotIndex) {
    let ring = 1;
    let ringStart = 0;
    let ringSize = 6;
    while (slotIndex >= ringStart + ringSize) {
      ringStart += ringSize;
      ring++;
      ringSize = ring * 6;
    }
    const posInRing = slotIndex - ringStart;
    const totalInRing = ring * 6;
    const angle = Math.PI - posInRing / totalInRing * 2 * Math.PI;
    const dist = ring;
    return [
      dist * Math.cos(angle),
      0,
      dist * Math.sin(angle)
    ];
  }
  addParticipant(peerId, slotIndex, stream) {
    this.removeParticipant(peerId);
    const ctx = this.#ensureCtx();
    const [x, y, z] = this.#slotPosition(slotIndex);
    const source = ctx.createMediaStreamSource(stream);
    const panner = ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 1;
    panner.maxDistance = 10;
    panner.rolloffFactor = 1;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 0;
    panner.coneOuterGain = 0;
    if (panner.positionX) {
      panner.positionX.value = x;
      panner.positionY.value = y;
      panner.positionZ.value = z;
    } else {
      panner.setPosition(x, y, z);
    }
    const gain = ctx.createGain();
    gain.gain.value = 1;
    source.connect(panner).connect(gain).connect(ctx.destination);
    this.#nodes.set(peerId, { source, panner, gain });
  }
  removeParticipant(peerId) {
    const node = this.#nodes.get(peerId);
    if (!node) return;
    node.source.disconnect();
    node.panner.disconnect();
    node.gain.disconnect();
    this.#nodes.delete(peerId);
  }
  setVolume(peerId, volume) {
    const node = this.#nodes.get(peerId);
    if (node) node.gain.gain.value = Math.max(0, Math.min(1, volume));
  }
  get participantCount() {
    return this.#nodes.size;
  }
  dispose() {
    for (const [id] of this.#nodes) this.removeParticipant(id);
    this.#ctx?.close();
    this.#ctx = null;
  }
};

// src/diamondcoreprocessor.com/meeting/meeting-peer.ts
var ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};
var SIMULCAST_ENCODINGS = [
  { rid: "low", maxBitrate: 15e4, scaleResolutionDownBy: 4 },
  { rid: "mid", maxBitrate: 5e5, scaleResolutionDownBy: 2 },
  { rid: "high", maxBitrate: 15e5 }
];
var STATS_INTERVAL_MS = 2e3;
var LOSS_THRESHOLD = 0.05;
var JITTER_THRESHOLD = 0.05;
var MeetingPeer = class {
  #pc;
  #remotePeerId;
  #remoteStream = null;
  #callbacks;
  #statsTimer = null;
  #lastPacketsReceived = 0;
  #lastPacketsLost = 0;
  constructor(remotePeerId, localStream, callbacks) {
    this.#remotePeerId = remotePeerId;
    this.#callbacks = callbacks;
    this.#pc = new RTCPeerConnection(ICE_CONFIG);
    for (const track of localStream.getTracks()) {
      if (track.kind === "video") {
        this.#pc.addTransceiver(track, {
          direction: "sendrecv",
          sendEncodings: SIMULCAST_ENCODINGS,
          streams: [localStream]
        });
      } else {
        this.#pc.addTrack(track, localStream);
      }
    }
    this.#pc.ontrack = (e) => {
      if (!this.#remoteStream) {
        this.#remoteStream = new MediaStream();
        this.#callbacks.onRemoteStream(this.#remoteStream);
      }
      this.#remoteStream.addTrack(e.track);
    };
    this.#pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.#callbacks.onIceCandidate(e.candidate.toJSON());
      }
    };
    this.#pc.onconnectionstatechange = () => {
      const state = this.#pc.connectionState;
      if (state === "disconnected" || state === "failed" || state === "closed") {
        this.#callbacks.onDisconnected();
      }
    };
    this.#pc.onconnectionstatechange = () => {
      if (this.#pc.connectionState === "connected") {
        this.#tuneOpus();
        this.#startStatsMonitor();
      }
    };
  }
  get remotePeerId() {
    return this.#remotePeerId;
  }
  get remoteStream() {
    return this.#remoteStream;
  }
  async createOffer() {
    const offer = await this.#pc.createOffer();
    await this.#pc.setLocalDescription(offer);
    return offer;
  }
  async acceptOffer(sdp) {
    await this.#pc.setRemoteDescription(sdp);
    const answer = await this.#pc.createAnswer();
    await this.#pc.setLocalDescription(answer);
    return answer;
  }
  async acceptAnswer(sdp) {
    await this.#pc.setRemoteDescription(sdp);
  }
  async addIceCandidate(candidate) {
    await this.#pc.addIceCandidate(candidate);
  }
  close() {
    if (this.#statsTimer != null) {
      clearInterval(this.#statsTimer);
      this.#statsTimer = null;
    }
    this.#pc.close();
    this.#remoteStream = null;
  }
  // ── Opus tuning ──────────────────────────────────────────
  #tuneOpus() {
    const sender = this.#pc.getSenders().find((s) => s.track?.kind === "audio");
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    params.encodings[0].maxBitrate = 64e3;
    params.encodings[0].dtx = true;
    sender.setParameters(params).catch(() => {
    });
  }
  // ── adaptive bitrate ─────────────────────────────────────
  #startStatsMonitor() {
    this.#statsTimer = setInterval(() => this.#checkStats(), STATS_INTERVAL_MS);
  }
  async #checkStats() {
    try {
      const stats = await this.#pc.getStats();
      let totalPacketsReceived = 0;
      let totalPacketsLost = 0;
      let jitter = 0;
      stats.forEach((report) => {
        if (report.type === "inbound-rtp" && report.kind === "video") {
          totalPacketsReceived += report.packetsReceived ?? 0;
          totalPacketsLost += report.packetsLost ?? 0;
          jitter = Math.max(jitter, report.jitter ?? 0);
        }
      });
      const deltaReceived = totalPacketsReceived - this.#lastPacketsReceived;
      const deltaLost = totalPacketsLost - this.#lastPacketsLost;
      this.#lastPacketsReceived = totalPacketsReceived;
      this.#lastPacketsLost = totalPacketsLost;
      if (deltaReceived <= 0) return;
      const lossRate = deltaLost / (deltaReceived + deltaLost);
      const senders = this.#pc.getSenders().filter((s) => s.track?.kind === "video");
      for (const sender of senders) {
        const params = sender.getParameters();
        if (!params.encodings?.length) continue;
        if (lossRate > LOSS_THRESHOLD || jitter > JITTER_THRESHOLD) {
          for (const enc of params.encodings) {
            if (enc.rid === "high") enc.active = false;
            if (lossRate > LOSS_THRESHOLD * 2 && enc.rid === "mid") enc.active = false;
          }
        } else {
          for (const enc of params.encodings) enc.active = true;
        }
        sender.setParameters(params).catch(() => {
        });
      }
    } catch {
    }
  }
};

// src/diamondcoreprocessor.com/meeting/meeting-signaling.ts
var MEETING_KIND = 29011;
function meetingExtraTags(type, targetPeerId) {
  const tags = [["t", type]];
  if (targetPeerId) tags.push(["p", targetPeerId]);
  return tags;
}
function parseMeetingSignal(event, roomSig) {
  const typeTag = event.tags.find((t) => t[0] === "t");
  if (!typeTag) return null;
  const type = typeTag[1];
  if (!["join", "leave", "offer", "answer", "ice"].includes(type)) return null;
  const pTag = event.tags.find((t) => t[0] === "p");
  let payload;
  try {
    payload = JSON.parse(event.content);
  } catch {
    return null;
  }
  return {
    type,
    roomSig,
    payload,
    targetPeerId: pTag?.[1],
    sourcePubkey: event.pubkey
  };
}
function meetingPeerId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// src/diamondcoreprocessor.com/meeting/meeting.queen.ts
import { QueenBee, EffectBus as EffectBus2, hypercomb } from "@hypercomb/core";

// src/diamondcoreprocessor.com/editor/tile-properties.ts
import { EffectBus } from "@hypercomb/core";
var TILE_PROPERTIES_SLOT = "properties";
window.ioc?.whenReady?.(
  "@diamondcoreprocessor.com/LayerSlotRegistry",
  (registry) => {
    try {
      registry.register({
        slot: TILE_PROPERTIES_SLOT,
        triggers: []
      });
    } catch (err) {
      console.warn("[tile-properties] slot register failed:", err);
    }
  }
);
var cellLocationSig = async (parentSegments, cellName) => {
  const history = window.ioc?.get?.(
    "@diamondcoreprocessor.com/HistoryService"
  );
  if (!history?.sign) {
    return "";
  }
  return history.sign({ explorerSegments: () => [...parentSegments, cellName] });
};
var HISTORY_KEY = "@diamondcoreprocessor.com/HistoryService";
var STORE_KEY = "@hypercomb.social/Store";
var COMMITTER_KEY = "@diamondcoreprocessor.com/LayerCommitter";
var iocGet = (key) => {
  const ioc = window.ioc;
  return ioc?.get?.(key);
};
var readTilePropertiesAt = async (parentSegments, cellName) => {
  const history = iocGet(HISTORY_KEY);
  const store = iocGet(STORE_KEY);
  if (!history?.sign || !history?.currentLayerAt || !store?.getResource) return {};
  const cellSig = await history.sign({
    explorerSegments: () => [...parentSegments, cellName]
  });
  if (!cellSig) return {};
  const layer = await history.currentLayerAt(cellSig);
  const slot = Array.isArray(layer?.properties) ? layer.properties : [];
  const propSig = slot.length > 0 ? slot[0] : void 0;
  if (typeof propSig !== "string" || propSig.length === 0) return {};
  try {
    const blob = await store.getResource(propSig);
    if (!blob) return {};
    const text = await blob.text();
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    console.warn("[tile-properties] failed to read/parse properties resource", propSig, err);
    return {};
  }
};
var writeTilePropertiesAt = async (parentSegments, cellName, updates) => {
  const history = iocGet(HISTORY_KEY);
  const store = iocGet(STORE_KEY);
  const committer = iocGet(COMMITTER_KEY);
  if (!history?.sign || !store?.putResource || !committer?.commitSlotSet) return;
  const existing = await readTilePropertiesAt(parentSegments, cellName);
  const merged = { ...existing, ...updates };
  for (const k of Object.keys(merged)) {
    if (merged[k] === void 0) delete merged[k];
  }
  const sortedKeys = Object.keys(merged).sort();
  const canonical = {};
  for (const k of sortedKeys) canonical[k] = merged[k];
  const blob = new Blob([JSON.stringify(canonical)], { type: "application/json" });
  const propSig = await store.putResource(blob);
  const cellSegments = [...parentSegments, cellName];
  await committer.commitSlotSet(cellSegments, TILE_PROPERTIES_SLOT, [propSig]);
  EffectBus.emit("cell:0000-changed", {
    cacheKey: await cellLocationSig(parentSegments, cellName),
    keys: Object.keys(updates)
  });
};

// src/diamondcoreprocessor.com/meeting/meeting.queen.ts
var MeetingQueenBee = class extends QueenBee {
  namespace = "diamondcoreprocessor.com";
  genotype = "meeting";
  command = "meeting";
  aliases = [];
  description = "Start or join a video meeting on the selected tile";
  descriptionKey = "slash.meeting";
  async execute(args) {
    const trimmed = args.trim().toLowerCase();
    const selection = get("@diamondcoreprocessor.com/SelectionService");
    const selectedLabels = selection ? Array.from(selection.selected) : [];
    if (trimmed === "leave") {
      for (const label of selectedLabels) {
        EffectBus2.emit("tile:action", { action: "meeting", label, q: 0, r: 0, index: 0 });
      }
      return;
    }
    const template = trimmed === "join" || !trimmed ? "cascade" : trimmed;
    if (selectedLabels.length === 0) {
      console.warn("[/meeting] No tiles selected. Select a tile first.");
      return;
    }
    const lineage = get("@hypercomb.social/Lineage");
    const parentSegments = lineage?.explorerSegments?.() ?? [];
    for (const label of selectedLabels) {
      const props = await readTilePropertiesAt(parentSegments, label);
      const tags = Array.isArray(props["tags"]) ? [...props["tags"]] : [];
      const hasMeetingTag = tags.some((t) => t === template || t.startsWith(template + ":"));
      if (!hasMeetingTag) {
        tags.push(template);
        await writeTilePropertiesAt(parentSegments, label, { tags });
        EffectBus2.emit("tags:changed", { updates: [{ cell: label, tag: template }] });
      }
      EffectBus2.emit("tile:action", { action: "meeting", label, q: 0, r: 0, index: 0 });
    }
    void new hypercomb().act();
  }
};
var _meeting = new MeetingQueenBee();
window.ioc.register("@diamondcoreprocessor.com/MeetingQueenBee", _meeting);
export {
  MEETING_KIND,
  MeetingPeer,
  MeetingQueenBee,
  MeetingSpatialAudio,
  meetingExtraTags,
  meetingPeerId,
  parseMeetingSignal
};
