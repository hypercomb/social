// src/diamondcoreprocessor.com/sharing/mesh-adapter.drone.ts
import { Drone } from "@hypercomb/core";
var MeshAdapterDrone = class extends Drone {
  namespace = "diamondcoreprocessor.com";
  genotype = "sharing";
  description = "Posts a Hypercomb signature to the Nostr mesh";
  grammar = [
    { example: "share" },
    { example: "publish" },
    { example: "broadcast" }
  ];
  // optional future use (auditable intent)
  effects = ["network"];
  // default relays (can be overridden later)
  config = {
    relays: [
      "wss://relay.damus.io",
      "wss://nostr.wine",
      "wss://relay.snort.social"
    ]
  };
  // Mesh is private by default (idle). When the user toggles to
  // public via the mesh control or `mesh.togglePublic` keymap, we
  // start publishing; otherwise this drone is silent — no
  // WebSockets, no network traffic, no warnings. Initial value is
  // read from localStorage so a refresh of an already-public mesh
  // doesn't have a transient idle window before the first
  // mesh:public-changed event arrives.
  #meshPublic = (() => {
    try {
      return localStorage.getItem("hc:mesh-public") === "true";
    } catch {
      return false;
    }
  })();
  constructor() {
    super();
    this.onEffect("mesh:public-changed", (payload) => {
      this.#meshPublic = !!payload?.public;
    });
  }
  // -------------------------------------------------
  // execution
  // -------------------------------------------------
  heartbeat = async (grammar) => {
    if (!this.#meshPublic) return;
    const signature = grammar?.signature;
    if (!signature || typeof signature !== "string") {
      return;
    }
    void this.publishSignature(signature);
  };
  // -------------------------------------------------
  // nostr publish
  // -------------------------------------------------
  /** Per-relay connect/send timeout. Public Nostr relays are
   *  best-effort — a slow or unresponsive relay should not delay the
   *  publish. 2s is generous for a successful WebSocket open + send;
   *  anything slower we'd rather drop than wait on. */
  RELAY_TIMEOUT_MS = 2e3;
  publishSignature = async (signature) => {
    const event = this.createEvent(signature);
    const results = await Promise.allSettled(
      this.config.relays.map((relay) => this.sendToRelay(relay, event))
    );
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "rejected") {
        console.warn("[mesh-adapter] relay failed", this.config.relays[i], r.reason);
      }
    }
  };
  createEvent = (signature) => {
    return {
      kind: 1,
      // text note
      created_at: Math.floor(Date.now() / 1e3),
      tags: [
        ["hypercomb", "signature"]
      ],
      content: signature
    };
  };
  sendToRelay = async (relayUrl, event) => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(relayUrl);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          ws.close();
        } catch {
        }
        reject(new Error(`relay timeout after ${this.RELAY_TIMEOUT_MS}ms`));
      }, this.RELAY_TIMEOUT_MS);
      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.send(JSON.stringify(["EVENT", event]));
        } catch (err) {
          try {
            ws.close();
          } catch {
          }
          reject(err);
          return;
        }
        try {
          ws.close();
        } catch {
        }
        resolve();
      };
      ws.onerror = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
        }
        reject(err);
      };
    });
  };
};
var _meshAdapter = new MeshAdapterDrone();
window.ioc.register("@diamondcoreprocessor.com/MeshAdapterDrone", _meshAdapter);
export {
  MeshAdapterDrone
};
