// src/diamondcoreprocessor.com/meeting/meeting.drone.ts
import { Drone } from "@hypercomb/core";

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

// src/diamondcoreprocessor.com/meeting/meeting.drone.ts
var MEETING_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96"><circle fill="white" cx="48" cy="32" r="10"/><circle fill="white" cx="28" cy="56" r="7"/><circle fill="white" cx="68" cy="56" r="7"/><path fill="white" d="M36 44c-2 0-4 2-4 4v16h32V48c0-2-2-4-4-4z"/><path fill="white" d="M16 64c-1 0-3 1-3 3v10h22V64z"/><path fill="white" d="M61 64v13h22V67c0-2-2-3-3-3z"/></svg>`;
var MEETING_TEMPLATES = {
  cascade: { maxSlots: 6 }
  // 1 leader + 6 ring-1 = the Hypercomb
};
function isMeetingTag(tag) {
  if (MEETING_TEMPLATES[tag]) return tag;
  const [base, param] = tag.split(":");
  if (MEETING_TEMPLATES[base]) return tag;
  return null;
}
function templateForTag(tag) {
  const [base, param] = tag.split(":");
  const tpl = MEETING_TEMPLATES[base];
  if (!tpl) return { maxSlots: 6, name: "cascade" };
  const maxSlots = param ? Math.max(1, parseInt(param, 10) - 1) || tpl.maxSlots : tpl.maxSlots;
  return { maxSlots, name: base };
}
async function deriveRoomSig(seed) {
  const data = new TextEncoder().encode(seed + "/meeting");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
var HypercombMeetingDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  description = "Enables video meetings on tiles tagged with meeting keywords (e.g. cascade).";
  deps = { mesh: "@diamondcoreprocessor.com/NostrMeshDrone" };
  listens = ["tags:changed", "render:host-ready", "tile:action"];
  emits = ["overlay:register-action", "meeting:stream-ready", "meeting:slot-assigned", "mesh:publish", "mesh:subscribe"];
  #localPeerId = meetingPeerId();
  #rooms = /* @__PURE__ */ new Map();
  // seed → room
  #meetingSeeds = /* @__PURE__ */ new Set();
  // seeds that have a meeting tag
  #seedTemplates = /* @__PURE__ */ new Map();
  // seed → tag (e.g. 'cascade')
  #effectsRegistered = false;
  #iconRegistered = false;
  heartbeat = async () => {
    if (this.#effectsRegistered) return;
    this.#effectsRegistered = true;
    this.onEffect("tags:changed", ({ updates }) => {
      for (const u of updates) {
        const mtag = isMeetingTag(u.tag);
        if (!mtag) continue;
        this.#meetingSeeds.add(u.seed);
        this.#seedTemplates.set(u.seed, u.tag);
        void this.#ensureRoomSubscription(u.seed, u.tag);
      }
    });
    this.onEffect("render:host-ready", () => {
      if (this.#iconRegistered) return;
      this.#iconRegistered = true;
      this.emitEffect("overlay:register-action", [{
        name: "meeting",
        svgMarkup: MEETING_ICON_SVG,
        x: -14,
        y: -10,
        hoverTint: 11075544,
        profile: "private",
        visibleWhen: (ctx) => this.#meetingSeeds.has(ctx.label)
      }]);
    });
    this.onEffect("tile:action", (payload) => {
      if (payload.action !== "meeting") return;
      void this.#toggleMeeting(payload.label);
    });
  };
  // ── room subscription (passive, before joining) ────────────
  async #ensureRoomSubscription(seed, tag) {
    if (this.#rooms.has(seed)) return;
    const roomSig = await deriveRoomSig(seed);
    const tpl = templateForTag(tag);
    const room = {
      seed,
      roomSig,
      template: tpl.name,
      localStream: null,
      peers: /* @__PURE__ */ new Map(),
      slotAssignment: /* @__PURE__ */ new Map(),
      nextSlot: 0,
      maxSlots: tpl.maxSlots,
      meshSub: null,
      audio: new MeetingSpatialAudio(),
      active: false
    };
    this.#rooms.set(seed, room);
    const mesh = this.resolve("mesh");
    if (!mesh) return;
    room.meshSub = mesh.subscribe(roomSig, (evt) => {
      this.#onSignal(room, evt);
    });
    this.emitEffect("mesh:ensure-started", { signature: roomSig });
  }
  // ── toggle join/leave ──────────────────────────────────────
  async #toggleMeeting(seed) {
    const room = this.#rooms.get(seed);
    if (!room) return;
    if (room.active) {
      this.#leaveRoom(room);
    } else {
      await this.#joinRoom(room);
    }
  }
  async #joinRoom(room) {
    try {
      room.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: {
          sampleRate: 48e3,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    } catch (e) {
      console.warn("[HypercombMeeting] getUserMedia failed:", e);
      return;
    }
    room.active = true;
    const mesh = this.resolve("mesh");
    if (mesh) {
      await mesh.publish(
        MEETING_KIND,
        room.roomSig,
        { peerId: this.#localPeerId },
        meetingExtraTags("join")
      );
    }
    this.emitEffect("meeting:stream-ready", {
      seed: room.seed,
      slot: -1,
      // -1 = leader/self (center hex)
      stream: room.localStream,
      peerId: this.#localPeerId
    });
  }
  #leaveRoom(room) {
    room.active = false;
    const mesh = this.resolve("mesh");
    if (mesh) {
      void mesh.publish(
        MEETING_KIND,
        room.roomSig,
        { peerId: this.#localPeerId },
        meetingExtraTags("leave")
      );
    }
    for (const [id, peer] of room.peers) {
      peer.close();
      room.audio.removeParticipant(id);
    }
    room.peers.clear();
    room.slotAssignment.clear();
    room.nextSlot = 0;
    if (room.localStream) {
      for (const track of room.localStream.getTracks()) track.stop();
      room.localStream = null;
    }
    room.audio.dispose();
    room.audio = new MeetingSpatialAudio();
  }
  // ── inbound signal handling ────────────────────────────────
  #onSignal(room, evt) {
    const signal = parseMeetingSignal(evt.event, room.roomSig);
    if (!signal) return;
    const payload = signal.payload;
    if (payload.peerId === this.#localPeerId || payload.fromPeerId === this.#localPeerId) return;
    if (signal.targetPeerId && signal.targetPeerId !== this.#localPeerId) return;
    switch (signal.type) {
      case "join":
        this.#handleJoin(room, payload);
        break;
      case "leave":
        this.#handleLeave(room, payload);
        break;
      case "offer":
        this.#handleOffer(room, payload);
        break;
      case "answer":
        this.#handleAnswer(room, payload);
        break;
      case "ice":
        this.#handleIce(room, payload);
        break;
    }
  }
  #handleJoin(room, payload) {
    if (!room.active || !room.localStream) return;
    if (room.peers.has(payload.peerId)) return;
    if (room.peers.size >= room.maxSlots) return;
    void this.#createPeerAndOffer(room, payload.peerId);
  }
  #handleLeave(room, payload) {
    const peer = room.peers.get(payload.peerId);
    if (!peer) return;
    peer.close();
    room.audio.removeParticipant(payload.peerId);
    room.peers.delete(payload.peerId);
    room.slotAssignment.delete(payload.peerId);
  }
  async #handleOffer(room, payload) {
    if (!room.active || !room.localStream) return;
    if (room.peers.has(payload.fromPeerId)) return;
    if (room.peers.size >= room.maxSlots) return;
    const peer = this.#createPeer(room, payload.fromPeerId);
    const answer = await peer.acceptOffer(payload.sdp);
    const mesh = this.resolve("mesh");
    if (mesh) {
      await mesh.publish(
        MEETING_KIND,
        room.roomSig,
        { sdp: answer, fromPeerId: this.#localPeerId },
        meetingExtraTags("answer", payload.fromPeerId)
      );
    }
  }
  async #handleAnswer(room, payload) {
    const peer = room.peers.get(payload.fromPeerId);
    if (!peer) return;
    await peer.acceptAnswer(payload.sdp);
  }
  async #handleIce(room, payload) {
    const peer = room.peers.get(payload.fromPeerId);
    if (!peer) return;
    await peer.addIceCandidate(payload.candidate);
  }
  // ── peer creation ──────────────────────────────────────────
  #createPeer(room, remotePeerId) {
    const slot = room.nextSlot++;
    room.slotAssignment.set(remotePeerId, slot);
    const callbacks = {
      onRemoteStream: (stream) => {
        room.audio.addParticipant(remotePeerId, slot, stream);
        this.emitEffect("meeting:stream-ready", {
          seed: room.seed,
          slot,
          stream,
          peerId: remotePeerId
        });
        this.emitEffect("meeting:slot-assigned", {
          seed: room.seed,
          slotIndex: slot,
          peerId: remotePeerId
        });
      },
      onIceCandidate: (candidate) => {
        const mesh = this.resolve("mesh");
        if (mesh) {
          void mesh.publish(
            MEETING_KIND,
            room.roomSig,
            { candidate, fromPeerId: this.#localPeerId },
            meetingExtraTags("ice", remotePeerId)
          );
        }
      },
      onDisconnected: () => {
        room.peers.delete(remotePeerId);
        room.audio.removeParticipant(remotePeerId);
        room.slotAssignment.delete(remotePeerId);
      }
    };
    const peer = new MeetingPeer(remotePeerId, room.localStream, callbacks);
    room.peers.set(remotePeerId, peer);
    return peer;
  }
  async #createPeerAndOffer(room, remotePeerId) {
    const peer = this.#createPeer(room, remotePeerId);
    const offer = await peer.createOffer();
    const mesh = this.resolve("mesh");
    if (mesh) {
      await mesh.publish(
        MEETING_KIND,
        room.roomSig,
        { sdp: offer, fromPeerId: this.#localPeerId },
        meetingExtraTags("offer", remotePeerId)
      );
    }
  }
  // ── cleanup ────────────────────────────────────────────────
  dispose = () => {
    for (const [, room] of this.#rooms) {
      if (room.active) this.#leaveRoom(room);
      room.meshSub?.close();
    }
    this.#rooms.clear();
  };
};
var _meeting = new HypercombMeetingDrone();
window.ioc.register("@diamondcoreprocessor.com/HypercombMeetingDrone", _meeting);
export {
  HypercombMeetingDrone
};
