//! Signatures — the universal reference primitive.
//!
//! A signature is the SHA-256 of content bytes. No salt, no prefix, no length
//! framing, no domain separation. Text is hashed as UTF-8.
//!
//! # Why these are distinct types
//!
//! The TypeScript tree addresses everything as a bare 64-hex `string`. That is
//! the direct cause of its worst bug class: a pool address and a lineage bag
//! address are *indistinguishable at the type level*, so code that prunes bags
//! can silently destroy a pool. It has happened — `/flatten` on a colliding
//! bare-word address hard-deleted one.
//!
//! Here they are separate types that do not convert implicitly. A function that
//! prunes bags takes a [`BagAddr`] and cannot be handed a [`PoolAddr`]. The bug
//! class stops being a matter of discipline and becomes a compile error.
//!
//! # Why raw bytes rather than hex
//!
//! A [`Sig`] is 32 raw bytes: half the memory of a hex string, no parsing on
//! every comparison, and `Copy`. Hex is a *display* concern and lives only at
//! the edges — [`Display`] and [`FromStr`].

use core::fmt;
use core::str::FromStr;

use sha2::{Digest, Sha256};

/// A content signature: SHA-256 of the content bytes.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Sig([u8; 32]);

impl Sig {
    /// Length of the hex rendering. Mirrors `SignatureService.SIGNATURE_LENGTH`.
    pub const HEX_LEN: usize = 64;

    /// The signature of zero bytes — `e3b0c442…`.
    ///
    /// This is also the **root lineage bag address**, because the root's
    /// lineage key is the empty string. That collision is real and
    /// load-bearing; code that walks the root must not treat the empty hash as
    /// "nothing". See `documentation/protocol/conformance.md` §1.
    pub fn empty() -> Self {
        sign(&[])
    }

    pub const fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    pub const fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    /// Lowercase hex, always 64 characters.
    pub fn to_hex(self) -> String {
        let mut out = String::with_capacity(Self::HEX_LEN);
        for byte in self.0 {
            out.push(char::from_digit((byte >> 4) as u32, 16).unwrap());
            out.push(char::from_digit((byte & 0x0f) as u32, 16).unwrap());
        }
        out
    }
}

/// Sign arbitrary bytes.
///
/// **Unicode normalization is deliberately NOT applied here.** This hashes
/// exactly the bytes it is given. Normalization happens upstream, in
/// [`crate::lineage::canonicalize_segment`], and nowhere else. A composed and a
/// decomposed `café` are therefore different *signatures* but the same *bag* —
/// getting that backwards silently forks either content identity or a user's
/// history.
pub fn sign(bytes: &[u8]) -> Sig {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Sig(hasher.finalize().into())
}

/// Sign a string's UTF-8 bytes.
pub fn sign_str(text: &str) -> Sig {
    sign(text.as_bytes())
}

impl fmt::Display for Sig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_hex())
    }
}

impl fmt::Debug for Sig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Sig({})", self.to_hex())
    }
}

/// Failure to parse a signature from hex.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SigParseError {
    /// Not exactly 64 characters.
    BadLength(usize),
    /// Contained a character outside `[0-9a-fA-F]`.
    BadDigit(char),
}

impl fmt::Display for SigParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BadLength(n) => write!(f, "expected {} hex chars, got {n}", Sig::HEX_LEN),
            Self::BadDigit(c) => write!(f, "invalid hex digit {c:?}"),
        }
    }
}

impl std::error::Error for SigParseError {}

impl FromStr for Sig {
    type Err = SigParseError;

    fn from_str(text: &str) -> Result<Self, Self::Err> {
        if text.len() != Self::HEX_LEN {
            return Err(SigParseError::BadLength(text.len()));
        }
        let mut out = [0u8; 32];
        let bytes = text.as_bytes();
        for (i, slot) in out.iter_mut().enumerate() {
            let hi = hex_val(bytes[i * 2])?;
            let lo = hex_val(bytes[i * 2 + 1])?;
            *slot = (hi << 4) | lo;
        }
        Ok(Self(out))
    }
}

fn hex_val(byte: u8) -> Result<u8, SigParseError> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        b'A'..=b'F' => Ok(byte - b'A' + 10),
        other => Err(SigParseError::BadDigit(other as char)),
    }
}

/// Does this string look like a signature? Mirrors the `/^[0-9a-f]{64}$/i`
/// test used when distinguishing a pointer marker from a legacy inline one.
pub fn looks_like_sig(text: &str) -> bool {
    text.len() == Sig::HEX_LEN && text.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Collect every signature-shaped string anywhere inside a JSON value.
///
/// Mirrors `Store.collectSignatures`. Used for GC reachability: a layer's slots
/// are an open set, so a signature may be nested at any depth in any shape, and
/// there is no schema to consult. The only safe rule is "anything that looks
/// like a signature is treated as a reference".
///
/// This deliberately **over-approximates**. A 64-hex string that happens not to
/// be a reference will keep content alive that could have been swept. That is
/// the safe direction to be wrong in — the opposite mistake deletes a user's
/// data.
pub fn collect_signatures(value: &serde_json::Value, out: &mut std::collections::BTreeSet<Sig>) {
    match value {
        serde_json::Value::String(text) => {
            if let Ok(sig) = text.parse::<Sig>() {
                out.insert(sig);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_signatures(item, out);
            }
        }
        serde_json::Value::Object(map) => {
            for (key, item) in map {
                // Keys can be signatures too — a manifest keyed by content sig.
                if let Ok(sig) = key.parse::<Sig>() {
                    out.insert(sig);
                }
                collect_signatures(item, out);
            }
        }
        _ => {}
    }
}

/// Collect every signature referenced by a byte payload, if it is JSON.
///
/// Non-JSON content (an image, an audio file) references nothing and yields an
/// empty set — which is correct: only structured content can point at other
/// content.
pub fn collect_signatures_in(bytes: &[u8]) -> std::collections::BTreeSet<Sig> {
    let mut out = std::collections::BTreeSet::new();
    if let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) {
        collect_signatures(&value, &mut out);
    }
    out
}

/// Declares a newtype over [`Sig`] with no implicit conversion back.
macro_rules! sig_newtype {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(Sig);

        impl $name {
            /// Wrap a signature as this address kind. Deliberately explicit —
            /// every call site is a place where a claim about *what a signature
            /// addresses* is being made, and should be reviewable as such.
            pub const fn from_sig(sig: Sig) -> Self {
                Self(sig)
            }

            /// The underlying signature. Also explicit, so widening back to an
            /// untyped signature is visible in review.
            pub const fn sig(self) -> Sig {
                self.0
            }

            pub fn to_hex(self) -> String {
                self.0.to_hex()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                fmt::Display::fmt(&self.0, f)
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}({})", stringify!($name), self.0.to_hex())
            }
        }
    };
}

sig_newtype! {
    /// A signature known to address a **layer**.
    LayerSig
}

sig_newtype! {
    /// The address of a **lineage sigbag** — `sha256(lineage_key(segments))`.
    ///
    /// Shares the flat root namespace with [`PoolAddr`] and, for a bare-word
    /// pool meaning, is byte-identical to one. Nothing on disk distinguishes
    /// them; consult the pool registry before treating a directory as a bag.
    BagAddr
}

sig_newtype! {
    /// The address of a **pool of meaning** — `sha256(meaning)`.
    PoolAddr
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_signs_as_the_well_known_root() {
        assert_eq!(
            Sig::empty().to_hex(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn hex_round_trips() {
        let sig = sign_str("hypercomb");
        assert_eq!(sig.to_hex().parse::<Sig>().unwrap(), sig);
    }

    #[test]
    fn hex_is_lowercase_and_64_long() {
        let hex = sign_str("anything").to_hex();
        assert_eq!(hex.len(), Sig::HEX_LEN);
        assert!(hex.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)));
    }

    #[test]
    fn parse_rejects_bad_input() {
        assert!(matches!("abc".parse::<Sig>(), Err(SigParseError::BadLength(3))));
        assert!(matches!("z".repeat(64).parse::<Sig>(), Err(SigParseError::BadDigit('z'))));
    }

    #[test]
    fn signatures_are_found_at_any_depth_and_in_keys() {
        let a = sign_str("a").to_hex();
        let b = sign_str("b").to_hex();
        let c = sign_str("c").to_hex();
        let json = format!(
            r#"{{"name":"x","children":["{a}"],"deep":{{"nested":[{{"ref":"{b}"}}]}},"{c}":1}}"#
        );

        let found = collect_signatures_in(json.as_bytes());
        assert_eq!(found.len(), 3);
        for hex in [a, b, c] {
            assert!(found.contains(&hex.parse::<Sig>().unwrap()));
        }
    }

    #[test]
    fn non_json_content_references_nothing() {
        // An image points at nothing. Only structured content can.
        assert!(collect_signatures_in(&[0xff, 0xd8, 0xff, 0xe0]).is_empty());
    }

    #[test]
    fn sign_does_not_normalize_unicode() {
        // Composed vs decomposed cafe-acute. Same grapheme, different bytes,
        // and therefore DIFFERENT signatures. Normalization is a lineage-key
        // concern only.
        let composed = "caf\u{e9}";
        let decomposed = "cafe\u{301}";
        assert_ne!(sign_str(composed), sign_str(decomposed));
    }
}
