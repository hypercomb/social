// @diamondcoreprocessor.com/recording
// src/diamondcoreprocessor.com/recording/recording.queen.ts
import { QueenBee, EffectBus } from "@hypercomb/core";
var RecordingQueenBee = class extends QueenBee {
  namespace = "diamondcoreprocessor.com";
  genotype = "recording";
  command = "record";
  aliases = [];
  description = "Start AI-powered meeting recording with live hierarchy compilation";
  descriptionKey = "slash.record";
  slashComplete(args) {
    const q = args.toLowerCase().trim();
    const options = ["start", "stop", "interval", "model"];
    if (!q) return options;
    return options.filter((s) => s.startsWith(q));
  }
  async execute(args) {
    const trimmed = args.trim().toLowerCase();
    if (!trimmed || trimmed === "start" || trimmed === "stop") {
      const selection = get("@diamondcoreprocessor.com/SelectionService");
      const selectedLabels = selection ? Array.from(selection.selected) : [];
      if (trimmed === "stop") {
        EffectBus.emit("recording:toggle", { cell: selectedLabels[0] });
        return;
      }
      EffectBus.emit("recording:toggle", { cell: selectedLabels[0] });
      return;
    }
    if (trimmed.startsWith("interval")) {
      const seconds = parseInt(trimmed.replace("interval", "").trim(), 10);
      if (isNaN(seconds) || seconds < 5) {
        console.warn("[/record] Interval must be at least 5 seconds");
        return;
      }
      EffectBus.emit("recording:configure", { compileIntervalMs: seconds * 1e3 });
      console.log(`[/record] Compile interval set to ${seconds}s`);
      return;
    }
    if (trimmed.startsWith("model")) {
      const model = trimmed.replace("model", "").trim();
      if (!model) {
        console.warn("[/record] Usage: /record model haiku|sonnet|opus");
        return;
      }
      EffectBus.emit("recording:configure", { model });
      console.log(`[/record] AI model set to ${model}`);
      return;
    }
    console.warn(`[/record] Unknown argument: ${trimmed}`);
  }
};
var _recording = new RecordingQueenBee();
window.ioc.register("@diamondcoreprocessor.com/RecordingQueenBee", _recording);

// src/diamondcoreprocessor.com/recording/recording.types.ts
var DEFAULT_RECORDING_CONFIG = {
  compileIntervalMs: 3e4
};

// src/diamondcoreprocessor.com/recording/transcription.provider.ts
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
var ChunkedAudioTranscriptionProvider = class {
  #recorders = /* @__PURE__ */ new Map();
  #labels = /* @__PURE__ */ new Map();
  #chunkHandler;
  onSegment = null;
  constructor(chunkHandler) {
    this.#chunkHandler = chunkHandler;
  }
  start(stream, peerId, label) {
    if (this.#recorders.has(peerId)) return;
    this.#labels.set(peerId, label);
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      console.warn(`[transcription-chunked] No audio tracks for ${peerId}`);
      return;
    }
    const audioStream = new MediaStream(audioTracks);
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    const recorder = new MediaRecorder(audioStream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size === 0) return;
      void this.#processChunk(peerId, event.data);
    };
    this.#recorders.set(peerId, recorder);
    recorder.start(5e3);
  }
  async #processChunk(peerId, audioBlob) {
    const label = this.#labels.get(peerId) ?? peerId.slice(0, 8);
    try {
      const text = await this.#chunkHandler(peerId, label, audioBlob);
      if (!text.trim()) return;
      this.onSegment?.({
        peerId,
        speakerLabel: label,
        text: text.trim(),
        timestamp: Date.now(),
        isFinal: true
      });
    } catch (e) {
      console.warn(`[transcription-chunked] Chunk processing failed for ${peerId}:`, e);
    }
  }
  stop(peerId) {
    const recorder = this.#recorders.get(peerId);
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
      }
    }
    this.#recorders.delete(peerId);
    this.#labels.delete(peerId);
  }
  stopAll() {
    for (const peerId of [...this.#recorders.keys()]) {
      this.stop(peerId);
    }
  }
};
export {
  ChunkedAudioTranscriptionProvider,
  DEFAULT_RECORDING_CONFIG,
  RecordingQueenBee,
  WebSpeechTranscriptionProvider
};
