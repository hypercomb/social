// hypercomb-essentials/src/diamondcoreprocessor.com/recording/recording.drone.ts
import { Drone, EffectBus } from "@hypercomb/core";

// hypercomb-essentials/src/diamondcoreprocessor.com/recording/recording.types.ts
var DEFAULT_RECORDING_CONFIG = {
  compileIntervalMs: 3e4
};

// hypercomb-essentials/src/diamondcoreprocessor.com/recording/transcription.provider.ts
function getSpeechRecognition() {
  const w = globalThis;
  return w["SpeechRecognition"] ?? w["webkitSpeechRecognition"] ?? null;
}
var WebSpeechTranscriptionProvider = class {
  #recognizers = /* @__PURE__ */ new Map();
  #labels = /* @__PURE__ */ new Map();
  #active = /* @__PURE__ */ new Map();
  onSegment = null;
  start(stream, peerId, label) {
    if (this.#recognizers.has(peerId)) return;
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      console.warn("[transcription] Web Speech API not available");
      return;
    }
    this.#labels.set(peerId, label);
    const recognizer = new SpeechRecognition();
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.lang = document.documentElement.lang || "en-US";
    recognizer.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript?.trim();
        if (!transcript) continue;
        this.onSegment?.({
          peerId,
          speakerLabel: this.#labels.get(peerId) ?? peerId.slice(0, 8),
          text: transcript,
          timestamp: Date.now(),
          isFinal: result.isFinal
        });
      }
    };
    recognizer.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      console.warn(`[transcription] ${peerId}: ${event.error}`);
    };
    recognizer.onend = () => {
      if (this.#active.get(peerId)) {
        try {
          recognizer.start();
        } catch {
        }
      }
    };
    this.#recognizers.set(peerId, recognizer);
    this.#active.set(peerId, true);
    try {
      recognizer.start();
    } catch (e) {
      console.warn(`[transcription] Failed to start for ${peerId}:`, e);
    }
  }
  stop(peerId) {
    this.#active.set(peerId, false);
    const recognizer = this.#recognizers.get(peerId);
    if (recognizer) {
      try {
        recognizer.abort();
      } catch {
      }
      this.#recognizers.delete(peerId);
    }
    this.#labels.delete(peerId);
    this.#active.delete(peerId);
  }
  stopAll() {
    for (const peerId of [...this.#recognizers.keys()]) {
      this.stop(peerId);
    }
  }
};

// hypercomb-essentials/src/diamondcoreprocessor.com/recording/recording.drone.ts
var BRIDGE_PORT = 2401;
var RecordingDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  genotype = "recording";
  description = "Transcribes speech in real-time and feeds transcript to the Claude bridge for live hierarchy building";
  deps = {};
  listens = ["meeting:stream-ready", "recording:toggle", "recording:configure"];
  emits = ["recording:started", "recording:stopped", "recording:transcript-update"];
  #effectsRegistered = false;
  #config = { ...DEFAULT_RECORDING_CONFIG };
  #state = null;
  #transcription = new WebSpeechTranscriptionProvider();
  #sendTimer = null;
  #ws = null;
  #msgId = 0;
  heartbeat = async () => {
    if (this.#effectsRegistered) return;
    this.#effectsRegistered = true;
    this.onEffect("meeting:stream-ready", (payload) => {
      if (this.#state?.active) {
        this.#transcription.start(payload.stream, payload.peerId, `speaker-${payload.peerId.slice(0, 6)}`);
      }
    });
    this.onEffect("recording:toggle", () => {
      if (this.#state?.active) {
        void this.#stopRecording();
      } else {
        void this.#startRecording();
      }
    });
    this.onEffect("recording:configure", (payload) => {
      if (payload.compileIntervalMs !== void 0) {
        this.#config.compileIntervalMs = payload.compileIntervalMs;
        if (this.#state?.active && this.#sendTimer) {
          clearInterval(this.#sendTimer);
          this.#sendTimer = setInterval(() => void this.#sendTranscriptBatch(), this.#config.compileIntervalMs);
        }
      }
      console.log("[recording] Config updated:", this.#config);
    });
  };
  // ── start recording (standalone mic) ────────────────────
  async #startRecording() {
    if (this.#state?.active) return;
    let localStream;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      });
    } catch (e) {
      console.warn("[recording] Microphone access denied:", e);
      return;
    }
    this.#ws = this.#connectBridge();
    this.#state = {
      active: true,
      localStream,
      segments: [],
      lastSentIndex: 0,
      startedAt: Date.now()
    };
    this.#transcription.onSegment = (segment) => {
      if (!this.#state) return;
      if (segment.isFinal) {
        this.#state.segments.push(segment);
      }
      EffectBus.emitTransient("recording:transcript-update", {
        text: segment.text,
        isFinal: segment.isFinal
      });
    };
    this.#transcription.start(localStream, "local", "you");
    this.#sendTimer = setInterval(
      () => void this.#sendTranscriptBatch(),
      this.#config.compileIntervalMs
    );
    EffectBus.emit("recording:started", {});
    console.log(`[recording] Started \u2014 interval ${this.#config.compileIntervalMs / 1e3}s`);
  }
  // ── bridge connection ───────────────────────────────────
  #connectBridge() {
    try {
      const ws = new WebSocket(`ws://localhost:${BRIDGE_PORT}`);
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "recorder" }));
        console.log("[recording] Bridge connected");
      };
      ws.onclose = () => console.log("[recording] Bridge disconnected");
      ws.onerror = () => {
      };
      return ws;
    } catch {
      console.warn("[recording] Bridge not available at localhost:" + BRIDGE_PORT);
      return null;
    }
  }
  #sendBridge(op, data) {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) return;
    const id = `rec-${++this.#msgId}`;
    this.#ws.send(JSON.stringify({ id, op, ...data }));
  }
  // ── send transcript batch to bridge ─────────────────────
  async #sendTranscriptBatch() {
    if (!this.#state?.active) return;
    const newSegments = this.#state.segments.slice(this.#state.lastSentIndex);
    if (newSegments.length === 0) return;
    this.#state.lastSentIndex = this.#state.segments.length;
    const transcript = newSegments.map((s) => `[${new Date(s.timestamp).toLocaleTimeString()}] ${s.speakerLabel}: ${s.text}`).join("\n");
    this.#sendBridge("transcript", {
      transcript,
      segmentCount: newSegments.length,
      totalSegments: this.#state.segments.length,
      elapsedMs: Date.now() - this.#state.startedAt
    });
    console.log(`[recording] Sent ${newSegments.length} segments to bridge`);
  }
  // ── stop recording ──────────────────────────────────────
  async #stopRecording() {
    if (!this.#state) return;
    const duration = Date.now() - this.#state.startedAt;
    await this.#sendTranscriptBatch();
    if (this.#sendTimer) {
      clearInterval(this.#sendTimer);
      this.#sendTimer = null;
    }
    this.#transcription.stopAll();
    this.#transcription.onSegment = null;
    if (this.#state.localStream) {
      for (const track of this.#state.localStream.getTracks()) track.stop();
    }
    this.#sendBridge("transcript-end", {
      totalSegments: this.#state.segments.length,
      durationMs: duration
    });
    if (this.#ws) {
      this.#ws.close();
      this.#ws = null;
    }
    this.#state = null;
    EffectBus.emit("recording:stopped", { duration });
    console.log(`[recording] Stopped. Duration: ${Math.round(duration / 1e3)}s`);
  }
};
var _recording = new RecordingDrone();
window.ioc.register("@diamondcoreprocessor.com/RecordingDrone", _recording);
export {
  RecordingDrone
};
