// src/diamondcoreprocessor.com/sharing/swarm-adopt.drone.ts
import { Drone, EffectBus as EffectBus2 } from "@hypercomb/core";

// src/diamondcoreprocessor.com/editor/tile-properties.ts
import { EffectBus, SignatureService } from "@hypercomb/core";
var TILE_PROPERTIES_FILE = "0000";
var cellLocationSig = async (parentSegments, cellName) => {
  const path = [...parentSegments, cellName].join("/");
  const sigStore = window.ioc?.get("@hypercomb/SignatureStore");
  if (sigStore?.signText) return sigStore.signText(path);
  return SignatureService.sign(new TextEncoder().encode(path).buffer);
};
var readCellProperties = async (cellDir) => {
  let fileHandle;
  try {
    fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE);
  } catch {
    return {};
  }
  try {
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch (err) {
    console.warn("[tile-properties] failed to read/parse 0000 in", cellDir.name, err);
    return {};
  }
};
var writeCellProperties = async (cellDir, updates, cacheKey) => {
  const existing = await readCellProperties(cellDir);
  const merged = { ...existing, ...updates };
  const fileHandle = await cellDir.getFileHandle(TILE_PROPERTIES_FILE, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(merged));
  await writable.close();
  EffectBus.emit("cell:0000-changed", {
    cacheKey: cacheKey ?? cellDir.name,
    keys: Object.keys(updates)
  });
};

// src/diamondcoreprocessor.com/sharing/swarm-adopt.drone.ts
var SWARM_DRONE_KEY = "@diamondcoreprocessor.com/SwarmDrone";
var LINEAGE_KEY = "@hypercomb.social/Lineage";
var SUBSTRATE_SERVICE_KEY = "@diamondcoreprocessor.com/SubstrateService";
var STORE_KEY = "@hypercomb.social/Store";
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
    const dir = await lineage?.explorerDir?.();
    if (!dir) return;
    let cellDir;
    try {
      cellDir = await dir.getDirectoryHandle(label, { create: true });
    } catch (err) {
      console.warn("[swarm-adopt] failed to create/open local dir for", label, err);
      return;
    }
    let localProps = {};
    let localHas0000 = false;
    try {
      const h = await cellDir.getFileHandle("0000", { create: false });
      const f = await h.getFile();
      localHas0000 = f.size > 0;
      if (localHas0000) {
        try {
          localProps = JSON.parse(await f.text());
        } catch {
          localProps = {};
        }
      }
    } catch {
    }
    const parentSegments = lineage?.explorerSegments?.() ?? [];
    const cacheKey = await cellLocationSig(parentSegments, label);
    let seededAnything = false;
    if (!localHas0000 && peerEntry.propsSig) {
      const store = window.ioc?.get?.(
        STORE_KEY
      );
      try {
        const blob = await store?.getResource?.(peerEntry.propsSig) ?? null;
        if (blob && blob.size > 0) {
          const fileHandle = await cellDir.getFileHandle("0000", { create: true });
          const writable = await fileHandle.createWritable();
          try {
            await writable.write(blob);
          } finally {
            await writable.close();
          }
          EffectBus2.emit("cell:0000-changed", { cacheKey, keys: ["index", "imageSig", "small", "flat"] });
          seededAnything = true;
          try {
            localProps = await readCellProperties(cellDir);
          } catch {
          }
          localHas0000 = true;
        }
      } catch (err) {
        console.warn("[swarm-adopt] failed to seed peer 0000 for", label, err);
      }
    }
    const hasLocalIndex = typeof localProps["index"] === "number" && Number.isFinite(localProps["index"]);
    if (localHas0000 && !hasLocalIndex) {
      let hostIndex = null;
      if (typeof peerEntry.index === "number" && Number.isFinite(peerEntry.index) && peerEntry.index >= 0) {
        hostIndex = peerEntry.index;
      } else if (peerEntry.propsSig) {
        const store = window.ioc?.get?.(
          STORE_KEY
        );
        try {
          const blob = await store?.getResource?.(peerEntry.propsSig) ?? null;
          if (blob && blob.size > 0) {
            const peerProps = JSON.parse(await blob.text());
            const idx = Number(peerProps?.index);
            if (Number.isFinite(idx) && idx >= 0) hostIndex = idx;
          }
        } catch {
        }
      }
      if (hostIndex !== null) {
        try {
          await writeCellProperties(cellDir, { index: hostIndex }, cacheKey);
          seededAnything = true;
        } catch (err) {
          console.warn("[swarm-adopt] failed to merge host index for", label, err);
        }
      }
    }
    if (peerEntry.imageSig) {
      try {
        const indexKey = "hc:tile-props-index";
        const index = JSON.parse(localStorage.getItem(indexKey) ?? "{}");
        if (!index[label]) {
          index[label] = peerEntry.imageSig;
          localStorage.setItem(indexKey, JSON.stringify(index));
          seededAnything = true;
        }
      } catch (err) {
        console.warn("[swarm-adopt] failed to seed peer imageSig for", label, err);
      }
    }
    if (!peerEntry.propsSig && typeof peerEntry.index === "number" && peerEntry.index >= 0 && !localHas0000) {
      try {
        await writeCellProperties(cellDir, { index: peerEntry.index }, cacheKey);
        seededAnything = true;
      } catch (err) {
        console.warn("[swarm-adopt] failed to seed peer index for", label, err);
      }
    }
    EffectBus2.emit("cell:added", { cell: label });
    if (seededAnything) {
      EffectBus2.emit("tile:saved", { cell: label });
    }
    const substrate = window.ioc?.get?.(
      SUBSTRATE_SERVICE_KEY
    );
    if (substrate?.applyToCell) {
      try {
        if (substrate.applyToCell(label)) {
          EffectBus2.emit("substrate:applied", { cell: label });
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
