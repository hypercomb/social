// src/diamondcoreprocessor.com/editor/tile-editor.drone.ts
import { EffectBus, SignatureService } from "@hypercomb/core";
var EDIT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4L7 21H3v-4L17 3z"/></svg>`;
var TileEditorDrone = class {
  constructor() {
    EffectBus.on("tile:action", this.#onTileAction);
    EffectBus.on("controls:camera-open", this.#onCameraOpen);
    const isMobile = window.matchMedia("(max-width: 599px)").matches || "ontouchstart" in window;
    if (!isMobile) {
      const registry = window.ioc.get("@hypercomb.social/IconProviderRegistry");
      registry?.add({
        name: "edit",
        owner: "@diamondcoreprocessor.com/TileEditorDrone",
        svgMarkup: EDIT_ICON_SVG,
        profile: "private",
        hoverTint: 13162751,
        labelKey: "action.edit",
        descriptionKey: "action.edit.description"
      });
    }
  }
  // ── effect handler ─────────────────────────────────────────────
  #onTileAction = (payload) => {
    if (payload.action !== "edit") return;
    void this.#openEditing(payload.label);
  };
  #onCameraOpen = () => {
    const selection = window.ioc.get("@diamondcoreprocessor.com/SelectionService");
    const activeCell = selection?.active;
    if (activeCell) {
      void this.#openEditingWithCamera(activeCell);
    } else {
      void this.#createCellAndOpenCamera();
    }
  };
  #createCellAndOpenCamera = async () => {
    const newCell = `photo-${Date.now()}`;
    const lineage = window.ioc.get("@hypercomb.social/Lineage");
    const dir = lineage?.explorerDir ? await Promise.resolve(lineage.explorerDir()) : null;
    if (dir) await dir.getDirectoryHandle(newCell, { create: true });
    const service = window.ioc.get("@diamondcoreprocessor.com/TileEditorService");
    if (service) service.isNewCell = true;
    await this.#openEditingWithCamera(newCell);
  };
  async #openEditingWithCamera(cell) {
    const service = window.ioc.get("@diamondcoreprocessor.com/TileEditorService");
    if (!service) return;
    service.autoCamera = true;
    await this.#openEditing(cell);
  }
  // ── open editor ────────────────────────────────────────────────
  async #openEditing(cell) {
    const store = window.ioc.get("@hypercomb.social/Store");
    const service = window.ioc.get("@diamondcoreprocessor.com/TileEditorService");
    if (!store || !service) return;
    let properties = {};
    try {
      const indexKey = "hc:tile-props-index";
      const index = JSON.parse(localStorage.getItem(indexKey) ?? "{}");
      const propsSig = index[cell];
      if (!propsSig) throw new Error("no index entry");
      const propsBlob = await store.getResource(propsSig);
      if (!propsBlob) throw new Error("props blob missing");
      const text = await propsBlob.text();
      properties = JSON.parse(text);
    } catch {
    }
    let largeBlob = null;
    const largeSig = properties.large?.image;
    if (largeSig && typeof largeSig === "string") {
      largeBlob = await store.getResource(largeSig);
    }
    service.open(cell, properties, largeBlob);
  }
  // ── save (called by Angular component) ─────────────────────────
  saveAndComplete = async () => {
    const store = window.ioc.get("@hypercomb.social/Store");
    const service = window.ioc.get("@diamondcoreprocessor.com/TileEditorService");
    const imageEditor = window.ioc.get("@diamondcoreprocessor.com/ImageEditorService");
    const settings = window.ioc.get("@diamondcoreprocessor.com/Settings");
    if (!store || !service || !imageEditor || !settings) return;
    if (service.mode !== "editing") return;
    const props = { ...service.properties };
    const currentOrientation = imageEditor.orientation ?? "point-top";
    if (imageEditor.hasImage) {
      const currentTransform = imageEditor.getTransform();
      service.updateTransform(currentTransform.x, currentTransform.y, currentTransform.scale, currentOrientation);
      const curW = settings.hexWidth(currentOrientation);
      const curH = settings.hexHeight(currentOrientation);
      const currentBlob = await imageEditor.captureSmall(curW, curH);
      const currentSig = await store.putResource(currentBlob);
      const otherOrientation = currentOrientation === "point-top" ? "flat-top" : "point-top";
      const otherW = settings.hexWidth(otherOrientation);
      const otherH = settings.hexHeight(otherOrientation);
      const savedOtherTransform = otherOrientation === "flat-top" ? props.flat?.large : props.large;
      await imageEditor.setOrientation(
        otherOrientation,
        savedOtherTransform ? { x: savedOtherTransform.x ?? 0, y: savedOtherTransform.y ?? 0, scale: savedOtherTransform.scale ?? 1 } : void 0
      );
      const otherBlob = await imageEditor.captureSmall(otherW, otherH);
      const otherSig = await store.putResource(otherBlob);
      const otherActualTransform = imageEditor.getTransform();
      await imageEditor.setOrientation(
        currentOrientation,
        { x: currentTransform.x, y: currentTransform.y, scale: currentTransform.scale }
      );
      if (currentOrientation === "point-top") {
        ;
        props.small = { image: currentSig };
        if (!props.flat) props.flat = {};
        props.flat.small = { image: otherSig };
      } else {
        ;
        props.small = { image: otherSig };
        if (!props.flat) props.flat = {};
        props.flat.small = { image: currentSig };
      }
      if (service.largeBlob) {
        const largeSig = await store.putResource(service.largeBlob);
        const pointyTransform = currentOrientation === "point-top" ? currentTransform : otherActualTransform;
        const flatTransform = currentOrientation === "flat-top" ? currentTransform : otherActualTransform;
        props.large = {
          image: largeSig,
          x: pointyTransform.x,
          y: pointyTransform.y,
          scale: pointyTransform.scale
        };
        if (!props.flat) props.flat = {};
        props.flat.large = {
          x: flatTransform.x,
          y: flatTransform.y,
          scale: flatTransform.scale
        };
      }
    }
    const json = JSON.stringify(props, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const propsSig = await store.putResource(blob);
    const indexKey = "hc:tile-props-index";
    const index = JSON.parse(localStorage.getItem(indexKey) ?? "{}");
    index[service.cell] = propsSig;
    localStorage.setItem(indexKey, JSON.stringify(index));
    const pendingName = service.pendingName;
    let savedCell = service.cell;
    let renamed = false;
    if (pendingName && pendingName !== savedCell) {
      const result = await this.#renameCell(savedCell, pendingName, store, index, propsSig);
      if (result) {
        savedCell = pendingName;
        renamed = true;
      }
    }
    const wasNewCell = service.isNewCell;
    imageEditor.destroy();
    service.close();
    if (wasNewCell && !renamed) {
      EffectBus.emit("cell:added", { cell: savedCell });
    } else if (!wasNewCell) {
      EffectBus.emit("tile:saved", { cell: savedCell });
    }
  };
  // ── rename helpers ─────────────────────────────────────────────
  async #renameCell(oldName, newName, store, index, propsSig) {
    const lineage = window.ioc.get("@hypercomb.social/Lineage");
    const dir = lineage?.explorerDir ? await Promise.resolve(lineage.explorerDir()) : null;
    if (!dir) return false;
    try {
      const oldDir = await dir.getDirectoryHandle(oldName, { create: false });
      try {
        await dir.getDirectoryHandle(newName, { create: false });
        return false;
      } catch {
      }
      const newDir = await dir.getDirectoryHandle(newName, { create: true });
      await copyDirectory(oldDir, newDir);
      await dir.removeEntry(oldName, { recursive: true });
      delete index[oldName];
      index[newName] = propsSig;
      localStorage.setItem("hc:tile-props-index", JSON.stringify(index));
      await this.#recordRenameOp(oldName, newName, store);
      const groupId = `rename:${Date.now().toString(36)}`;
      EffectBus.emit("cell:removed", { cell: oldName, groupId });
      EffectBus.emit("cell:added", { cell: newName, groupId });
      EffectBus.emit("cell:renamed", { oldName, newName });
      return true;
    } catch {
      return false;
    }
  }
  async #recordRenameOp(oldName, newName, store) {
    const lineage = window.ioc.get("@hypercomb.social/Lineage");
    const historyService = window.ioc.get("@diamondcoreprocessor.com/HistoryService");
    if (!lineage || !historyService) return;
    const locationSig = await historyService.sign(lineage);
    const snapshot = { version: 1, oldName, newName, at: Date.now() };
    const json = JSON.stringify(snapshot, Object.keys(snapshot).sort(), 0);
    const blob = new Blob([json], { type: "application/json" });
    const resourceSig = await SignatureService.sign(await blob.arrayBuffer());
    await store.putResource(blob);
    await historyService.record(locationSig, { op: "rename", cell: resourceSig, at: snapshot.at });
  }
  // ── cancel ─────────────────────────────────────────────────────
  cancelEditing = async () => {
    const imageEditor = window.ioc.get("@diamondcoreprocessor.com/ImageEditorService");
    const service = window.ioc.get("@diamondcoreprocessor.com/TileEditorService");
    if (service?.isNewCell) {
      const cell = service.cell;
      const lineage = window.ioc.get("@hypercomb.social/Lineage");
      const dir = lineage?.explorerDir ? await Promise.resolve(lineage.explorerDir()) : null;
      if (dir && cell) {
        try {
          await dir.removeEntry(cell, { recursive: true });
        } catch {
        }
      }
    }
    imageEditor?.destroy();
    service?.close();
  };
};
window.ioc.register(
  "@diamondcoreprocessor.com/TileEditorDrone",
  new TileEditorDrone()
);
async function copyDirectory(src, dest) {
  for await (const [name, handle] of src.entries()) {
    if (handle.kind === "file") {
      const srcFile = await handle.getFile();
      const destFile = await dest.getFileHandle(name, { create: true });
      const writable = await destFile.createWritable();
      await writable.write(await srcFile.arrayBuffer());
      await writable.close();
    } else if (handle.kind === "directory") {
      const destSubDir = await dest.getDirectoryHandle(name, { create: true });
      await copyDirectory(handle, destSubDir);
    }
  }
}
export {
  TileEditorDrone
};
