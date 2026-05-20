// src/diamondcoreprocessor.com/dashboard/dashboard-q-open.worker.ts
import { Worker, EffectBus } from "@hypercomb/core";
var BINDING_KIND = "dashboard-q-binding";
var DashboardQOpenWorker = class extends Worker {
  namespace = "diamondcoreprocessor.com";
  genotype = "dashboard";
  description = "Routes tile clicks on /dashboard children to the QA modal instead of opening the source cell in a new tab.";
  emits = [];
  act = async () => {
    EffectBus.on("tile:action", (payload) => {
      if (payload.action !== "open") return;
      void this.#handleOpen(payload.label);
    });
  };
  async #handleOpen(label) {
    const lineage = get("@hypercomb.social/Lineage");
    const segments = lineage?.explorerSegments?.() ?? [];
    if (segments[0] !== "dashboard") return;
    const targetPath = [...segments, label];
    const binding = await this.#findBinding(targetPath);
    if (!binding) return;
    const modal = get("@diamondcoreprocessor.com/QaModalView");
    if (!modal) return;
    modal.show(binding);
  }
  async #findBinding(targetPath) {
    const store = get("@hypercomb.social/Store");
    if (!store?.listOptimizations || !store?.getOptimization) return null;
    const sigs = await store.listOptimizations();
    for (const sig of sigs) {
      const blob = await store.getOptimization(sig);
      if (!blob) continue;
      let parsed;
      try {
        parsed = JSON.parse(await blob.text());
      } catch {
        continue;
      }
      if (parsed.kind !== BINDING_KIND) continue;
      if (!Array.isArray(parsed.appliesTo)) continue;
      const ap = parsed.appliesTo;
      if (ap.length !== targetPath.length) continue;
      let match = true;
      for (let i = 0; i < ap.length; i++) {
        if (String(ap[i]) !== targetPath[i]) {
          match = false;
          break;
        }
      }
      if (!match) continue;
      const payload = parsed.payload;
      if (!payload || typeof payload.qId !== "string" || typeof payload.question !== "string") continue;
      return {
        qId: payload.qId,
        qSig: typeof payload.qSig === "string" ? payload.qSig : "",
        qPath: Array.isArray(payload.qPath) ? payload.qPath.map(String) : [],
        question: payload.question
      };
    }
    return null;
  }
};
var _dashboardQOpen = new DashboardQOpenWorker();
window.ioc.register("@diamondcoreprocessor.com/DashboardQOpenWorker", _dashboardQOpen);
export {
  DashboardQOpenWorker
};
