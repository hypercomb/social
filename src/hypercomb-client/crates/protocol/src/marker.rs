//! Markers — the entries inside a lineage sigbag.
//!
//! A bag is a sig-named directory of zero-padded 8-digit marker files:
//!
//! ```text
//! <root>/<lineageSig>/00000000
//! <root>/<lineageSig>/00000001
//! ```
//!
//! **The maximum marker is the head.** Filenames carry no other meaning. There
//! is no separate head pointer to keep in sync, and therefore none to corrupt.
//!
//! A marker is *meta* — it names which layer a revision points at. The layer
//! itself is root content. Because the marker IS the revision, versioning, undo
//! and shareability come for free.

use serde_json::{Map, Value};

use crate::layer::Layer;
use crate::sig::{looks_like_sig, sign, LayerSig};

/// Width of a marker filename. `00000000`, `00000001`, …
pub const MARKER_WIDTH: usize = 8;

/// Render a marker index as its filename.
pub fn marker_filename(index: u32) -> String {
    format!("{index:0MARKER_WIDTH$}")
}

/// Parse a marker filename back to its index. Returns `None` for anything that
/// is not a marker (so a stray file in a bag is ignored rather than fatal).
pub fn marker_index(filename: &str) -> Option<u32> {
    if filename.len() != MARKER_WIDTH || !filename.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    filename.parse().ok()
}

/// A revision entry in a lineage bag.
#[derive(Debug, Clone, PartialEq)]
pub enum Marker {
    /// The modern shape: a pointer record naming which layer this revision is,
    /// plus any additional named signature fields carried on the same revision
    /// (decorations, context, receipts).
    Pointer {
        layer: LayerSig,
        fields: Map<String, Value>,
    },
    /// The legacy shape: the marker bytes ARE the layer JSON. The layer's
    /// signature is the hash of those bytes.
    LegacyInline { layer: LayerSig },
}

impl Marker {
    /// The layer this revision points at, whichever shape it takes.
    pub fn layer(&self) -> LayerSig {
        match self {
            Self::Pointer { layer, .. } | Self::LegacyInline { layer } => *layer,
        }
    }

    /// Is this the legacy shape? Such markers should be migrated to pointer
    /// records opportunistically on read.
    pub fn is_legacy(&self) -> bool {
        matches!(self, Self::LegacyInline { .. })
    }

    /// A pointer record for a layer.
    pub fn pointer(layer: LayerSig) -> Self {
        Self::Pointer {
            layer,
            fields: Map::new(),
        }
    }

    /// The bytes to write for this marker.
    ///
    /// **Always emits a pointer record**, including for a marker parsed from
    /// the legacy shape. Legacy markers are read, never written.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut map = Map::new();
        map.insert("layer".into(), Value::String(self.layer().to_hex()));
        if let Self::Pointer { fields, .. } = self {
            for (key, value) in fields {
                if key != "layer" {
                    map.insert(key.clone(), value.clone());
                }
            }
        }
        serde_json::to_vec(&Value::Object(map)).expect("Map is always serializable")
    }

    /// Parse marker bytes, handling both shapes.
    ///
    /// Detection rule: parse; if the result has a `layer` field matching
    /// `^[0-9a-f]{64}$` it is a pointer record. Otherwise the bytes *are* the
    /// layer and its signature is `sha256(bytes)`.
    ///
    /// A `name` field is not a pointer marker — `name` belongs on the layer,
    /// which lives in the content pool, never on the marker.
    pub fn parse(bytes: &[u8]) -> Self {
        if let Ok(Value::Object(map)) = serde_json::from_slice::<Value>(bytes) {
            if let Some(Value::String(layer)) = map.get("layer") {
                if looks_like_sig(layer) {
                    if let Ok(sig) = layer.parse() {
                        let mut fields = map.clone();
                        fields.remove("layer");
                        return Self::Pointer {
                            layer: LayerSig::from_sig(sig),
                            fields,
                        };
                    }
                }
            }
        }
        // Legacy: the bytes are the layer.
        Self::LegacyInline {
            layer: LayerSig::from_sig(sign(bytes)),
        }
    }

    /// Parse a legacy marker's bytes as the layer they contain. Returns `None`
    /// for a pointer record, whose layer lives elsewhere and must be fetched by
    /// signature.
    pub fn inline_layer(bytes: &[u8]) -> Option<Layer> {
        match Self::parse(bytes) {
            Self::LegacyInline { .. } => Layer::from_json(bytes).ok(),
            Self::Pointer { .. } => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filenames_are_eight_digits_and_round_trip() {
        assert_eq!(marker_filename(0), "00000000");
        assert_eq!(marker_filename(42), "00000042");
        assert_eq!(marker_index("00000042"), Some(42));
        assert_eq!(marker_index("not-a-marker"), None);
        assert_eq!(marker_index("0000042"), None);
    }

    #[test]
    fn lexicographic_order_matches_numeric_order() {
        // This is what makes "the max filename is the head" correct.
        let mut names: Vec<_> = [7u32, 100, 2, 99999999].iter().map(|n| marker_filename(*n)).collect();
        names.sort();
        assert_eq!(names.last().unwrap(), "99999999");
        assert_eq!(names.first().unwrap(), "00000002");
    }

    #[test]
    fn pointer_records_round_trip() {
        let layer = Layer::empty("demo").sig();
        let marker = Marker::pointer(layer);
        let parsed = Marker::parse(&marker.to_bytes());
        assert_eq!(parsed.layer(), layer);
        assert!(!parsed.is_legacy());
    }

    #[test]
    fn legacy_inline_markers_are_detected_and_hashed() {
        let layer = Layer::empty("demo");
        let bytes = layer.canonical_json().into_bytes();
        let marker = Marker::parse(&bytes);
        assert!(marker.is_legacy());
        // The layer sig is the hash of the marker bytes themselves.
        assert_eq!(marker.layer(), layer.sig());
        assert_eq!(Marker::inline_layer(&bytes).unwrap(), layer);
    }

    #[test]
    fn a_legacy_marker_is_rewritten_as_a_pointer() {
        // Read both shapes; write only pointer records.
        let bytes = Layer::empty("demo").canonical_json().into_bytes();
        let rewritten = Marker::parse(&bytes).to_bytes();
        assert!(!Marker::parse(&rewritten).is_legacy());
    }

    #[test]
    fn extra_fields_survive_the_round_trip() {
        let layer = Layer::empty("demo").sig();
        let mut fields = Map::new();
        fields.insert("decorations".into(), Value::String("a".repeat(64)));
        let marker = Marker::Pointer { layer, fields };
        match Marker::parse(&marker.to_bytes()) {
            Marker::Pointer { fields, .. } => {
                assert_eq!(fields.get("decorations").unwrap(), &Value::String("a".repeat(64)));
            }
            other => panic!("expected pointer, got {other:?}"),
        }
    }

    #[test]
    fn a_name_field_does_not_make_it_a_pointer() {
        let marker = Marker::parse(br#"{"name":"legacy layer"}"#);
        assert!(marker.is_legacy());
    }
}
