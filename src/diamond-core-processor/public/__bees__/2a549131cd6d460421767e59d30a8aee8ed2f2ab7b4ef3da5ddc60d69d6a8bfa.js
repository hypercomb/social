// src/diamondcoreprocessor.com/navigation/zoom/auto-fit-first-add.drone.ts
import { Drone } from "@hypercomb/core";
var ZOOM_DRONE_KEY = "@diamondcoreprocessor.com/ZoomDrone";
var LINEAGE_KEY = "@hypercomb.social/Lineage";
var SIGNATURE_STORE_KEY = "@hypercomb/SignatureStore";
var AutoFitFirstAddDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  genotype = "navigation";
  description = "Fits the viewport to content the first time a tile is added at an empty lineage. Subsequent adds leave the screen still.";
  listens = ["cell:added"];
  emits = [];
  // Per-session memo of which lineage sigs we've already auto-fit at.
  // Once a lineage has been fit (or a tile was added there), we never
  // fit it again in this session. Cleared on page reload.
  #fittedSigs = /* @__PURE__ */ new Set();
  #initialized = false;
  sense = () => true;
  heartbeat = async () => {
    if (this.#initialized) return;
    this.#initialized = true;
    this.onEffect("cell:added", () => {
      void this.#maybeFit();
    });
  };
  #maybeFit = async () => {
    const lineage = window.ioc?.get?.(LINEAGE_KEY);
    const sigStore = window.ioc?.get?.(SIGNATURE_STORE_KEY);
    if (!lineage?.explorerDir || !sigStore?.signText) return;
    const segsRaw = lineage.explorerSegments?.() ?? [];
    const segments = (Array.isArray(segsRaw) ? segsRaw : []).map((x) => String(x ?? "").trim()).filter((x) => x.length > 0);
    const key = segments.join("/");
    let sig = "";
    try {
      sig = await sigStore.signText(key);
    } catch {
      return;
    }
    if (!sig) return;
    if (this.#fittedSigs.has(sig)) return;
    const dir = await lineage.explorerDir();
    if (!dir) return;
    let count = 0;
    try {
      for await (const [name, h] of dir.entries()) {
        if (h.kind !== "directory") continue;
        if (name.startsWith("__") && name.endsWith("__")) continue;
        count++;
        if (count > 1) break;
      }
    } catch {
      return;
    }
    if (count !== 1) return;
    this.#fittedSigs.add(sig);
    setTimeout(() => {
      const zoom = window.ioc?.get?.(ZOOM_DRONE_KEY);
      zoom?.zoomToFit?.(true);
    }, 80);
  };
};
var _autoFit = new AutoFitFirstAddDrone();
window.ioc?.register?.(
  "@diamondcoreprocessor.com/AutoFitFirstAddDrone",
  _autoFit
);
export {
  AutoFitFirstAddDrone
};
