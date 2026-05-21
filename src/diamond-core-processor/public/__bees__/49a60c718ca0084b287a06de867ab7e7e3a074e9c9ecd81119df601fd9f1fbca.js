// src/diamondcoreprocessor.com/sharing/swarm-adopt.drone.ts
import { Drone, EffectBus } from "@hypercomb/core";
var SWARM_DRONE_KEY = "@diamondcoreprocessor.com/SwarmDrone";
var LINEAGE_KEY = "@hypercomb.social/Lineage";
var SUBSTRATE_SERVICE_KEY = "@diamondcoreprocessor.com/SubstrateService";
var SwarmAdoptDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  genotype = "sharing";
  description = "Adopts unadopted swarm peer tiles into the local OPFS when the user invokes the sync action on a peer-rendered tile.";
  listens = ["tile:action"];
  emits = ["cell:added", "cell:0000-changed", "tile:saved", "substrate:applied"];
  constructor() {
    super();
    this.onEffect("tile:action", (payload) => {
      const action = String(payload?.action ?? "");
      if (action !== "sync" && action !== "adopt") return;
      const label = String(payload?.label ?? "").trim();
      if (!label) return;
      void this.#adoptPeerTile(label);
    });
  }
  sense = () => true;
  heartbeat = async () => {
  };
  #adoptPeerTile = async (label) => {
    const swarm = window.ioc?.get?.(
      SWARM_DRONE_KEY
    );
    if (!swarm?.peerTilesAtCurrentSig) return;
    const peerTiles = swarm.peerTilesAtCurrentSig();
    const peerEntry = peerTiles.find((p) => p.name === label);
    if (!peerEntry) return;
    const lineage = window.ioc?.get?.(
      LINEAGE_KEY
    );
    const segments = lineage?.explorerSegments?.() ?? [];
    const segmentsClean = (Array.isArray(segments) ? segments : []).map((s) => String(s ?? "").trim()).filter(Boolean);
    EffectBus.emit("cell:added", { cell: label, segments: segmentsClean });
    EffectBus.emit("tile:saved", { cell: label });
    const substrate = window.ioc?.get?.(
      SUBSTRATE_SERVICE_KEY
    );
    if (substrate?.applyToCell) {
      try {
        if (substrate.applyToCell(label)) {
          EffectBus.emit("substrate:applied", { cell: label });
        }
      } catch (err) {
        console.warn("[swarm-adopt] substrate.applyToCell failed for", label, err);
      }
    }
  };
};
var _swarmAdopt = new SwarmAdoptDrone();
window.ioc?.register?.(
  "@diamondcoreprocessor.com/SwarmAdoptDrone",
  _swarmAdopt
);
export {
  SwarmAdoptDrone
};
