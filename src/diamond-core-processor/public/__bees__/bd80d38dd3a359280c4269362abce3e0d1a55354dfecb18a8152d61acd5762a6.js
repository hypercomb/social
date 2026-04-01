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
  // -------------------------------------------------
  // execution
  // -------------------------------------------------
  heartbeat = async (grammar) => {
    const signature = grammar?.signature;
    if (!signature || typeof signature !== "string") {
      console.warn("[mesh-adapter] no signature provided");
      return;
    }
    await this.publishSignature(signature);
  };
  // -------------------------------------------------
  // nostr publish
  // -------------------------------------------------
  publishSignature = async (signature) => {
    const event = this.createEvent(signature);
    for (const relay of this.config.relays) {
      try {
        await this.sendToRelay(relay, event);
      } catch (err) {
        console.warn("[mesh-adapter] relay failed", relay, err);
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
      ws.onopen = () => {
        ws.send(JSON.stringify(["EVENT", event]));
        ws.close();
        resolve();
      };
      ws.onerror = (err) => {
        ws.close();
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
