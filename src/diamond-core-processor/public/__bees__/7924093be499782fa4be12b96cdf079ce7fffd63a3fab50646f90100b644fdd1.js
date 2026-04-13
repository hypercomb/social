// src/diamondcoreprocessor.com/assistant/structure-drop.worker.ts
import { Bee, EffectBus } from "@hypercomb/core";
import { ATOMIZABLE_TARGET_PREFIX } from "@hypercomb/core";
var get = (key) => globalThis.ioc?.get(key);
var STRUCTURE_PREFIX = "__structure__";
var PROPS_FILE = "0000";
var TARGET_KEY = `${ATOMIZABLE_TARGET_PREFIX}structure:canvas`;
var StructureDropWorker = class extends Bee {
  namespace = "diamondcoreprocessor.com";
  genotype = "assistant";
  description = "Registers structure cells as atomizer drop targets";
  listens = ["render:host-ready", "drop:target"];
  emits = [];
  #canvas = null;
  #registered = false;
  #currentLabel = null;
  #structureProps = null;
  async pulse() {
  }
  constructor() {
    super();
    this.onEffect(
      "render:host-ready",
      ({ canvas }) => {
        this.#canvas = canvas;
        this.#checkRegistration();
      }
    );
    this.onEffect(
      "drop:target",
      ({ label }) => {
        if (label && label !== this.#currentLabel) {
          this.#currentLabel = label;
          this.#loadStructureProps(label);
        }
      }
    );
    EffectBus.on("tile:navigate-in", () => this.#checkRegistration());
    EffectBus.on("tile:navigate-back", () => this.#checkRegistration());
  }
  #isInStructureMode() {
    const lineage = get("@hypercomb.social/Lineage");
    if (!lineage) return false;
    const segments = lineage.explorerSegments?.() ?? lineage.explorerPath ?? [];
    return segments.length > 0 && segments[0] === STRUCTURE_PREFIX;
  }
  #checkRegistration() {
    const ioc = globalThis.ioc;
    if (!ioc || !this.#canvas) return;
    if (this.#isInStructureMode()) {
      if (!this.#registered) {
        ioc.register(TARGET_KEY, {
          targetType: "structure-cell",
          targetId: "structure:canvas",
          element: this.#canvas,
          tileLabel: void 0,
          get structureProps() {
            return workerRef.#structureProps;
          }
        });
        this.#registered = true;
      }
    } else {
      if (this.#registered) {
        try {
          ioc.unregister?.(TARGET_KEY);
        } catch {
        }
        this.#registered = false;
        this.#structureProps = null;
        this.#currentLabel = null;
      }
    }
  }
  async #loadStructureProps(label) {
    try {
      const lineage = get("@hypercomb.social/Lineage");
      const dir = await lineage?.explorerDir?.();
      if (!dir) return;
      const cellDir = await dir.getDirectoryHandle(label, { create: false });
      const handle = await cellDir.getFileHandle(PROPS_FILE);
      const file = await handle.getFile();
      this.#structureProps = JSON.parse(await file.text());
    } catch {
      this.#structureProps = { lineage: label, kind: "unknown", signature: "" };
    }
  }
};
var workerRef = new StructureDropWorker();
window.ioc.register("@diamondcoreprocessor.com/StructureDropWorker", workerRef);
console.log("[StructureDropWorker] Loaded");
export {
  StructureDropWorker
};
