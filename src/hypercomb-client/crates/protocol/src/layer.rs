//! Layers — the unit of mutation — and their canonical byte form.
//!
//! A layer's signature is the SHA-256 of its canonical JSON. When any field
//! changes the bytes change, the signature changes, and the cascade propagates
//! to the root. Undo restores the layer's bytes and therefore restores every
//! slot at once.
//!
//! # Canonical form
//!
//! - `name` is always present and always **first**. It is the layer's only
//!   intrinsic.
//! - Every other field is a **slot** — an open set contributed by registered
//!   subsystems. Slots follow `name` in alphabetical order by key, so byte
//!   output is stable regardless of registration or mutation order.
//! - `children` is **just another slot**. It gets no special positioning. Code
//!   that hardcodes it produces wrong bytes the moment a slot sorting before
//!   `c` appears.
//! - Slot values pass through untouched — each slot owns its own internal
//!   canonical form.
//! - Dropped entirely: `null`, empty arrays, empty objects. This is the
//!   *sparse-layer invariant*: an empty field must not change the signature.
//!
//! Byte form is compact JSON — no whitespace, `,` and `:` separators with no
//! spaces.
//!
//! The empty layer minted on a bag's first touch is therefore `{"name":""}`,
//! with no `children` key at all.
//!
//! # A constant not to port
//!
//! `history.service.ts` exports `EMPTY_LAYER_CONTENT_SIG = a8a9aaac…`,
//! documented as the hash of `{"children":[],"name":""}`. That is inconsistent
//! with the canonicalizer, which drops empty arrays and puts `name` first, and
//! so emits `{"name":""}` → `1390696a…`. The constant has no live consumers.
//! It is deliberately absent here.

use std::collections::BTreeMap;

use serde_json::Value;

use crate::sig::{sign, LayerSig};

/// The root's display name, used when a layer has no path segments.
pub const ROOT_NAME: &str = "/";

/// A layer: a name plus an open set of slots.
///
/// Slots live in a [`BTreeMap`], so the required alphabetical ordering is
/// structural — the canonical form cannot be got wrong by forgetting to sort.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Layer {
    /// The layer's only intrinsic. Always serialized first.
    pub name: String,
    /// Open slot bag. `children` is one of these, with no special status.
    pub slots: BTreeMap<String, Value>,
}

impl Layer {
    /// The empty layer minted on a bag's first touch — name only, no slots.
    pub fn empty(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            slots: BTreeMap::new(),
        }
    }

    /// Set a slot. Values that are "empty" by the sparse-layer invariant are
    /// dropped rather than stored, so `set(k, [])` and never setting `k` are
    /// indistinguishable — as they must be, since they sign identically.
    pub fn set(&mut self, slot: impl Into<String>, value: Value) -> &mut Self {
        let slot = slot.into();
        if is_droppable(&value) {
            self.slots.remove(&slot);
        } else {
            self.slots.insert(slot, value);
        }
        self
    }

    pub fn get(&self, slot: &str) -> Option<&Value> {
        self.slots.get(slot)
    }

    /// The `children` slot as layer signatures, if present.
    ///
    /// Child order is **content** — it is the user-visible order of tiles and is
    /// never sorted.
    pub fn children(&self) -> Vec<String> {
        match self.slots.get("children") {
            Some(Value::Array(items)) => items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect(),
            _ => Vec::new(),
        }
    }

    /// The exact bytes hashed to produce this layer's signature.
    pub fn canonical_json(&self) -> String {
        let mut out = String::from("{\"name\":");
        push_json_string(&mut out, &self.name);
        for (key, value) in &self.slots {
            if is_droppable(value) {
                continue;
            }
            out.push(',');
            push_json_string(&mut out, key);
            out.push(':');
            // serde_json's compact writer matches JSON.stringify's separators
            // and string escaping for all values we carry.
            out.push_str(&serde_json::to_string(value).expect("Value is always serializable"));
        }
        out.push('}');
        out
    }

    /// This layer's signature — what a parent stores in its `children` array.
    pub fn sig(&self) -> LayerSig {
        LayerSig::from_sig(sign(self.canonical_json().as_bytes()))
    }

    /// Parse a layer from its canonical (or any equivalent) JSON bytes.
    pub fn from_json(bytes: &[u8]) -> Result<Self, serde_json::Error> {
        let value: Value = serde_json::from_slice(bytes)?;
        let mut layer = Layer::default();
        if let Value::Object(map) = value {
            for (key, value) in map {
                if key == "name" {
                    layer.name = value.as_str().unwrap_or_default().to_string();
                } else if !is_droppable(&value) {
                    layer.slots.insert(key, value);
                }
            }
        }
        Ok(layer)
    }
}

/// Is this value dropped by the sparse-layer invariant?
fn is_droppable(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::Array(items) => items.is_empty(),
        Value::Object(map) => map.is_empty(),
        _ => false,
    }
}

/// Append a JSON string literal. Delegates to serde_json so escaping matches
/// exactly rather than being reimplemented.
fn push_json_string(out: &mut String, text: &str) {
    out.push_str(&serde_json::to_string(text).expect("str is always serializable"));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn empty_layer_has_no_children_key() {
        assert_eq!(Layer::empty("").canonical_json(), r#"{"name":""}"#);
    }

    #[test]
    fn name_comes_first_and_slots_sort_after_it() {
        let mut layer = Layer::empty("x");
        layer.set("zebra", json!(1));
        layer.set("apple", json!(2));
        layer.set("children", json!(["a"]));
        assert_eq!(
            layer.canonical_json(),
            r#"{"name":"x","apple":2,"children":["a"],"zebra":1}"#
        );
    }

    #[test]
    fn empties_are_dropped() {
        let mut layer = Layer::empty("x");
        layer.set("nothing", json!([]));
        layer.set("blank", json!({}));
        layer.set("nil", Value::Null);
        layer.set("kept", json!(1));
        assert_eq!(layer.canonical_json(), r#"{"name":"x","kept":1}"#);
    }

    #[test]
    fn setting_an_empty_slot_signs_identically_to_never_setting_it() {
        let mut with_empty = Layer::empty("leaf");
        with_empty.set("children", json!([]));
        assert_eq!(with_empty.sig(), Layer::empty("leaf").sig());
    }

    #[test]
    fn child_order_is_content_and_is_never_sorted() {
        let mut layer = Layer::empty("ordered");
        layer.set("children", json!(["f", "a"]));
        assert_eq!(layer.canonical_json(), r#"{"name":"ordered","children":["f","a"]}"#);
        assert_eq!(layer.children(), vec!["f", "a"]);
    }

    #[test]
    fn children_has_no_positional_privilege() {
        // A slot sorting before 'c' must precede children. Hardcoding children
        // first would produce different bytes here.
        let mut layer = Layer::empty("x");
        layer.set("children", json!(["s"]));
        layer.set("aaa", json!(1));
        assert!(layer.canonical_json().starts_with(r#"{"name":"x","aaa":1,"children""#));
    }

    #[test]
    fn round_trips_through_json() {
        let mut layer = Layer::empty("日本語 🐝");
        layer.set("children", json!(["a"]));
        layer.set("notes", json!({ "body": "hello" }));
        let parsed = Layer::from_json(layer.canonical_json().as_bytes()).unwrap();
        assert_eq!(parsed, layer);
        assert_eq!(parsed.sig(), layer.sig());
    }
}
