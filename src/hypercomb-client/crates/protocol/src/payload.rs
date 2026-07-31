//! Bee payloads — a **different** canonical rule from layers.
//!
//! `PayloadCanonical` hashes the payload's JSON in **insertion order**. Keys are
//! **not** sorted.
//!
//! This is a genuinely different canonicalization from the layer form, and the
//! two are easy to confuse. An implementation that applies one rule to both will
//! mint wrong signatures for every module in the ecosystem, which is why they
//! live in separate modules with separate types rather than sharing a helper.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::sig::{sign, Sig};

/// A bee payload, version 1.
///
/// Field order in this struct **is** the canonical serialization order. Do not
/// reorder the fields — that changes every bee signature in existence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BeePayloadV1 {
    pub version: u32,
    pub bee: Map<String, Value>,
    pub source: Map<String, Value>,
}

impl BeePayloadV1 {
    /// The canonical JSON — insertion order preserved, no whitespace.
    ///
    /// Relies on `serde_json`'s `preserve_order` feature so that a payload
    /// parsed from JSON re-serializes in its original key order.
    pub fn canonical_json(&self) -> String {
        serde_json::to_string(self).expect("payload is always serializable")
    }

    pub fn sig(&self) -> Sig {
        sign(self.canonical_json().as_bytes())
    }
}

/// Sign an arbitrary payload value using the **insertion-order** rule.
///
/// Use for payload shapes not modelled by [`BeePayloadV1`]. Never use for
/// layers — see [`crate::layer::Layer::sig`].
pub fn sign_payload(payload: &Value) -> Sig {
    sign(
        serde_json::to_string(payload)
            .expect("payload is always serializable")
            .as_bytes(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keys_are_not_sorted() {
        // Under the LAYER rule these would be reordered. Under the payload rule
        // they must not be.
        let payload = json!({ "zebra": 1, "apple": 2 });
        assert_eq!(sign_payload(&payload), sign(br#"{"zebra":1,"apple":2}"#));
    }

    #[test]
    fn insertion_order_survives_a_parse() {
        let text = r#"{"version":1,"bee":{"name":"demo"},"source":{"entry":"index.js"}}"#;
        let payload: BeePayloadV1 = serde_json::from_str(text).unwrap();
        assert_eq!(payload.canonical_json(), text);
    }
}
