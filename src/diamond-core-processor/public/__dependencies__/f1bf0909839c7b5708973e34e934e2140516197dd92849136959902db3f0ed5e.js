// @diamondcoreprocessor.com/format
// src/diamondcoreprocessor.com/format/format.queen.ts
import { QueenBee, EffectBus } from "@hypercomb/core";
var FormatQueenBee = class extends QueenBee {
  namespace = "diamondcoreprocessor.com";
  genotype = "editor";
  command = "format";
  aliases = [];
  description = "Copy visual formatting from the active tile";
  async execute(_args) {
    const drone = window.ioc.get("@diamondcoreprocessor.com/FormatPainterDrone");
    if (drone?.state.open) {
      EffectBus.emit("format:close", {});
      return;
    }
    const selection = window.ioc.get("@diamondcoreprocessor.com/SelectionService");
    const active = selection?.active;
    let properties = {};
    if (active) {
      const store = window.ioc.get("@hypercomb.social/Store");
      if (store) {
        try {
          const indexKey = "hc:tile-props-index";
          const index = JSON.parse(localStorage.getItem(indexKey) ?? "{}");
          const propsSig = index[active];
          if (!propsSig) throw new Error("no index entry");
          const propsBlob = await store.getResource(propsSig);
          if (!propsBlob) throw new Error("props blob missing");
          properties = JSON.parse(await propsBlob.text());
        } catch {
        }
      }
    }
    EffectBus.emit("format:open", { cell: active ?? "", properties });
  }
};
var _format = new FormatQueenBee();
window.ioc.register("@diamondcoreprocessor.com/FormatQueenBee", _format);
export {
  FormatQueenBee
};
