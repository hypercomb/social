// src/diamondcoreprocessor.com/meeting/hive-meeting.drone.ts
import { Drone } from "@hypercomb/core";
var RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};
var AVAILABILITY_TTL_MS = 3e4;
var AVAILABILITY_PUBLISH_MS = 5e3;
var DEFAULT_THRESHOLD = 7;
var HiveMeetingDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  genotype = "meeting";
  description = "Orchestrates hive meetings \u2014 availability tracking, WebRTC signaling, peer connections.";
  effects = ["network"];
  deps = {
    mesh: "@diamondcoreprocessor.com/NostrMeshDrone"
  };
  listens = [
    "render:cell-count",
    "mesh:ensure-started",
    "meeting:toggle-camera",
    "meeting:toggle-available"
  ];
  emits = ["meeting:state", "meeting:streams", "meeting:local-camera"];
  #state = "idle";
  #threshold = DEFAULT_THRESHOLD;
  #cellCount = 0;
  #currentSig = "";
  #meshSub = null;
  // own identity
  #publisherId = "";
  #localAvailable = false;
  #lastAvailPublishMs = 0;
  // peer availability tracking
  #availability = /* @__PURE__ */ new Map();
  // WebRTC
  #peers = /* @__PURE__ */ new Map();
  #localStream = null;
  #cameraOn = false;
  // effect registration guard
  #effectsRegistered = false;
  constructor() {
    super();
    try {
      const override = localStorage.getItem("hc:meeting:threshold");
      if (override) this.#threshold = Math.max(1, parseInt(override, 10) || DEFAULT_THRESHOLD);
    } catch {
    }
  }
  sense = () => true;
  heartbeat = async () => {
    this.#ensureEffects();
    this.#ensureIdentity();
    this.#pruneExpiredAvailability();
    this.#publishAvailability();
    this.#evaluateState();
  };
  // ─── effect subscriptions ────────────────────────────────────
  #ensureEffects = () => {
    if (this.#effectsRegistered) return;
    this.#effectsRegistered = true;
    this.onEffect("render:cell-count", ({ count }) => {
      this.#cellCount = count;
    });
    this.onEffect("mesh:ensure-started", ({ signature }) => {
      if (signature === this.#currentSig) return;
      this.#switchSig(signature);
    });
    const handleToggleAvailable = (preAcquiredStream) => {
      this.#localAvailable = !this.#localAvailable;
      if (this.#localAvailable) {
        if (preAcquiredStream) {
          this.#acceptStream(preAcquiredStream);
        } else {
          void this.#toggleCamera();
        }
      } else {
        this.#endMeeting();
      }
      this.#lastAvailPublishMs = 0;
    };
    const handleToggleCamera = () => {
      if (!this.#localAvailable) return;
      void this.#toggleCamera();
    };
    this.onEffect("meeting:toggle-available", handleToggleAvailable);
    this.onEffect("meeting:toggle-camera", handleToggleCamera);
    window.addEventListener("meeting:toggle-available", ((e) => {
      handleToggleAvailable(e.detail?.stream);
    }));
    window.addEventListener("meeting:toggle-camera", handleToggleCamera);
  };
  #ensureIdentity = () => {
    if (this.#publisherId) return;
    try {
      this.#publisherId = localStorage.getItem("hc:show-honeycomb:publisher-id") ?? "";
    } catch {
    }
  };
  // ─── mesh subscription ───────────────────────────────────────
  #switchSig = (sig) => {
    if (this.#meshSub) {
      try {
        this.#meshSub.close();
      } catch {
      }
      this.#meshSub = null;
    }
    this.#endMeeting();
    this.#availability.clear();
    this.#localAvailable = false;
    this.#currentSig = sig;
    const mesh = this.resolve("mesh");
    if (!mesh || typeof mesh.subscribe !== "function") return;
    this.#meshSub = mesh.subscribe(sig, (evt) => this.#onMeshEvent(evt));
  };
  #onMeshEvent = (evt) => {
    const p = evt.payload;
    if (!p || typeof p.type !== "string") return;
    switch (p.type) {
      case "meeting-availability":
        this.#handleAvailability(p);
        break;
      case "meeting-signal":
        this.#handleSignal(p);
        break;
    }
  };
  // ─── availability ────────────────────────────────────────────
  #handleAvailability = (p) => {
    const id = p.publisherId;
    if (!id || typeof id !== "string") return;
    if (id === this.#publisherId) return;
    this.#availability.set(id, {
      publisherId: id,
      lastSeenMs: Date.now(),
      cell: p.cell ?? p.seed ?? ""
    });
  };
  #publishAvailability = () => {
    if (!this.#localAvailable || !this.#currentSig || !this.#publisherId) return;
    const now = Date.now();
    if (now - this.#lastAvailPublishMs < AVAILABILITY_PUBLISH_MS) return;
    this.#lastAvailPublishMs = now;
    const mesh = this.resolve("mesh");
    if (!mesh || typeof mesh.publish !== "function") return;
    void mesh.publish(29010, this.#currentSig, {
      type: "meeting-availability",
      publisherId: this.#publisherId,
      ts: now
    }, [
      ["publisher", this.#publisherId],
      ["mode", "meeting-availability"]
    ]);
  };
  #pruneExpiredAvailability = () => {
    const now = Date.now();
    for (const [id, entry] of this.#availability) {
      if (now - entry.lastSeenMs > AVAILABILITY_TTL_MS) {
        this.#availability.delete(id);
      }
    }
  };
  // ─── state machine ──────────────────────────────────────────
  #evaluateState = () => {
    const prev = this.#state;
    switch (this.#state) {
      case "idle":
        if (this.#cellCount >= this.#threshold && this.#localAvailable) {
          this.#setState("gathering");
        }
        break;
      case "gathering": {
        if (!this.#localAvailable) {
          this.#setState("idle");
          break;
        }
        const total = this.#availability.size + (this.#localAvailable ? 1 : 0);
        if (total >= this.#threshold) {
          this.#startMeeting();
          this.#setState("active");
        }
        break;
      }
      case "active":
        if (!this.#localAvailable) {
          this.#endMeeting();
          this.#setState("ended");
        }
        break;
      case "ended":
        this.#setState("idle");
        break;
    }
    if (this.#state !== prev) {
      this.emitEffect("meeting:state", { state: this.#state, threshold: this.#threshold });
      window.dispatchEvent(new CustomEvent("meeting:state", { detail: { state: this.#state, threshold: this.#threshold } }));
    }
  };
  #setState = (next) => {
    this.#state = next;
  };
  // ─── WebRTC connection management ───────────────────────────
  #startMeeting = () => {
    for (const [id] of this.#availability) {
      if (this.#peers.has(id)) continue;
      this.#createPeerConnection(id, true);
    }
  };
  #endMeeting = () => {
    for (const [, peer] of this.#peers) {
      try {
        peer.pc.close();
      } catch {
      }
    }
    this.#peers.clear();
    if (this.#localStream) {
      for (const track of this.#localStream.getTracks()) track.stop();
      this.#localStream = null;
    }
    this.#cameraOn = false;
    this.emitEffect("meeting:streams", { streams: /* @__PURE__ */ new Map() });
    this.emitEffect("meeting:local-camera", { on: false });
    window.dispatchEvent(new CustomEvent("meeting:local-camera", { detail: { on: false } }));
  };
  #createPeerConnection = (remoteId, initiator) => {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const remoteStream = new MediaStream();
    const entry = { publisherId: remoteId, pc, remoteStream };
    this.#peers.set(remoteId, entry);
    pc.ontrack = (e) => {
      for (const track of e.streams[0]?.getTracks() ?? [e.track]) {
        remoteStream.addTrack(track);
      }
      this.#emitStreams();
    };
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      this.#sendSignal(remoteId, {
        subtype: "ice-candidate",
        candidate: e.candidate.toJSON()
      });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.#removePeer(remoteId);
      }
    };
    if (this.#localStream) {
      for (const track of this.#localStream.getTracks()) {
        pc.addTrack(track, this.#localStream);
      }
    }
    if (initiator) {
      if (this.#publisherId < remoteId) {
        void this.#createOffer(remoteId, pc);
      }
    }
  };
  #createOffer = async (remoteId, pc) => {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.#sendSignal(remoteId, { subtype: "offer", sdp: offer.sdp });
    } catch (e) {
      console.warn("[hive-meeting] offer error:", e);
    }
  };
  #handleSignal = (p) => {
    const from = p.from;
    const to = p.to;
    if (!from || !to) return;
    if (to !== this.#publisherId) return;
    if (from === this.#publisherId) return;
    switch (p.subtype) {
      case "offer":
        void this.#handleOffer(from, p.sdp);
        break;
      case "answer":
        void this.#handleAnswer(from, p.sdp);
        break;
      case "ice-candidate":
        void this.#handleIceCandidate(from, p.candidate);
        break;
    }
  };
  #handleOffer = async (from, sdp) => {
    if (!this.#peers.has(from)) {
      this.#createPeerConnection(from, false);
    }
    const peer = this.#peers.get(from);
    if (!peer) return;
    try {
      await peer.pc.setRemoteDescription({ type: "offer", sdp });
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      this.#sendSignal(from, { subtype: "answer", sdp: answer.sdp });
    } catch (e) {
      console.warn("[hive-meeting] answer error:", e);
    }
  };
  #handleAnswer = async (from, sdp) => {
    const peer = this.#peers.get(from);
    if (!peer) return;
    try {
      await peer.pc.setRemoteDescription({ type: "answer", sdp });
    } catch (e) {
      console.warn("[hive-meeting] set-answer error:", e);
    }
  };
  #handleIceCandidate = async (from, candidate) => {
    const peer = this.#peers.get(from);
    if (!peer) return;
    try {
      await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn("[hive-meeting] ice error:", e);
    }
  };
  #sendSignal = (to, data) => {
    const mesh = this.resolve("mesh");
    if (!mesh || typeof mesh.publish !== "function") return;
    void mesh.publish(29010, this.#currentSig, {
      type: "meeting-signal",
      from: this.#publisherId,
      to,
      ...data
    }, [
      ["publisher", this.#publisherId],
      ["mode", "meeting-signal"]
    ]);
  };
  #removePeer = (id) => {
    const peer = this.#peers.get(id);
    if (!peer) return;
    try {
      peer.pc.close();
    } catch {
    }
    this.#peers.delete(id);
    this.#emitStreams();
  };
  // ─── camera ──────────────────────────────────────────────────
  /** Accept a pre-acquired MediaStream (from UI user gesture) */
  #acceptStream = (stream) => {
    if (this.#localStream) {
      for (const track of this.#localStream.getTracks()) track.stop();
    }
    this.#localStream = stream;
    this.#cameraOn = true;
    for (const [, peer] of this.#peers) {
      for (const track of stream.getTracks()) {
        peer.pc.addTrack(track, stream);
      }
    }
    for (const [id, peer] of this.#peers) {
      if (this.#publisherId < id) {
        void this.#createOffer(id, peer.pc);
      }
    }
    this.emitEffect("meeting:local-camera", { on: true });
    window.dispatchEvent(new CustomEvent("meeting:local-camera", { detail: { on: true } }));
    this.#emitStreams();
  };
  #toggleCamera = async () => {
    if (this.#cameraOn) {
      if (this.#localStream) {
        for (const track of this.#localStream.getTracks()) track.stop();
        this.#localStream = null;
      }
      for (const [, peer] of this.#peers) {
        for (const sender of peer.pc.getSenders()) {
          if (sender.track) peer.pc.removeTrack(sender);
        }
      }
      this.#cameraOn = false;
    } else {
      try {
        this.#localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
      } catch (e) {
        console.warn("[hive-meeting] camera access denied:", e);
        this.#cameraOn = false;
        this.emitEffect("meeting:local-camera", { on: false });
        window.dispatchEvent(new CustomEvent("meeting:local-camera", { detail: { on: false } }));
        return;
      }
      this.#cameraOn = true;
      for (const [, peer] of this.#peers) {
        for (const track of this.#localStream.getTracks()) {
          peer.pc.addTrack(track, this.#localStream);
        }
      }
      for (const [id, peer] of this.#peers) {
        if (this.#publisherId < id) {
          void this.#createOffer(id, peer.pc);
        }
      }
    }
    this.emitEffect("meeting:local-camera", { on: this.#cameraOn });
    window.dispatchEvent(new CustomEvent("meeting:local-camera", { detail: { on: this.#cameraOn } }));
    this.#emitStreams();
  };
  #emitStreams = () => {
    const streams = /* @__PURE__ */ new Map();
    for (const [id, peer] of this.#peers) {
      if (peer.remoteStream.getTracks().length > 0) {
        streams.set(id, peer.remoteStream);
      }
    }
    if (this.#localStream && this.#cameraOn) {
      streams.set(this.#publisherId, this.#localStream);
    }
    this.emitEffect("meeting:streams", { streams });
  };
  // ─── public read-only accessors (for IoC consumers) ─────────
  get meetingState() {
    return this.#state;
  }
  get localAvailable() {
    return this.#localAvailable;
  }
  get cameraOn() {
    return this.#cameraOn;
  }
  get peerCount() {
    return this.#peers.size;
  }
  // ─── cleanup ─────────────────────────────────────────────────
  dispose = () => {
    this.#endMeeting();
    if (this.#meshSub) {
      try {
        this.#meshSub.close();
      } catch {
      }
    }
  };
};
var _hiveMeeting = new HiveMeetingDrone();
window.ioc.register("@diamondcoreprocessor.com/HiveMeetingDrone", _hiveMeeting);
export {
  HiveMeetingDrone
};
