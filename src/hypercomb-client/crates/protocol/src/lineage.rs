//! Lineage keys — the canonical preimage of a place's address.
//!
//! A sigbag's identity IS its ancestry: `bag = sha256(lineage_key(segments))`.
//!
//! # Why canonicalize
//!
//! Two paths a human reads as "the same place" must hash identically, or their
//! history and mesh slot silently fork. Names arrive from many sources — typed,
//! pasted, shared links, AI, back/forward URLs — carrying invisible variation:
//! en-dash vs hyphen, non-breaking vs normal space, smart vs straight quotes,
//! doubled spaces, trailing punctuation. All of it is folded away *before*
//! hashing so equivalent names converge on one bag.
//!
//! # The rule
//!
//! Per segment: NFC-normalize, replace every **run** of non-(letter|number)
//! with a single `-`, strip edge hyphens. Then drop segments that were empty to
//! begin with and join the rest with `/`.
//!
//! Case is preserved. Letters and digits of *any* script survive, so `日本語`
//! and `café` keep their identity — folding to ASCII would collapse every
//! non-Latin name into one bag. Collapsing separator runs to a hyphen rather
//! than deleting them preserves word boundaries, so `AB-CD` cannot collide with
//! a real `ABCD`.
//!
//! The rule is idempotent: canonicalizing an already-canonical segment is a
//! no-op, so it is safe to apply at any join site.
//!
//! # Scope
//!
//! Sig-side only. The URL, the explorer path, and on-disk display names stay
//! lossless — `My-Tile` still *displays* as `My-Tile`. Only the hashed preimage
//! is folded.

use unicode_normalization::UnicodeNormalization;

use crate::sig::{sign_str, BagAddr};

/// Canonicalize one lineage segment.
///
/// May return `""` for a segment that is entirely symbols or emoji (no letters
/// or digits). Callers building a path key must **not** silently drop such a
/// segment — see [`lineage_key`].
pub fn canonicalize_segment(raw: &str) -> String {
    let normalized: String = raw.nfc().collect();

    // Every run of non-(letter|number) becomes a single '-'.
    let mut out = String::with_capacity(normalized.len());
    let mut in_separator = false;
    for ch in normalized.chars() {
        if ch.is_alphabetic() || ch.is_numeric() {
            out.push(ch);
            in_separator = false;
        } else if !in_separator {
            out.push('-');
            in_separator = true;
        }
    }

    // Strip edge hyphens. Whitespace has already become '-' by this point.
    out.trim_matches('-').to_string()
}

/// The canonical key for a lineage path — the exact preimage hashed into a
/// sigbag address.
///
/// # The symbol-only guard
///
/// If a **non-empty** raw segment canonicalizes to `""` (a symbol- or
/// emoji-only name), it falls back to its trimmed raw form rather than being
/// dropped. Dropping it would shorten the path and collide with the parent —
/// or, for a single such segment at the root, collapse the key to `""` and
/// collide with the empty-content root signature.
///
/// This guard is not optional. Omit it and the first tile a user names `🐝`
/// writes its history into the root's bag.
pub fn lineage_key<S: AsRef<str>>(segments: &[S]) -> String {
    segments
        .iter()
        .map(|raw| {
            let raw = raw.as_ref();
            let canonical = canonicalize_segment(raw);
            if canonical.is_empty() {
                raw.trim().to_string()
            } else {
                canonical
            }
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

/// The **legacy** pre-canonicalization key: trim, drop empties, join. No
/// punctuation folding.
///
/// Used **only** for migration: when canonicalization changes a lineage's key,
/// the bag stored under this old address is unioned into the canonical one. It
/// is never a write destination.
pub fn raw_lineage_key<S: AsRef<str>>(segments: &[S]) -> String {
    segments
        .iter()
        .map(|s| s.as_ref().trim())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

/// The lineage sigbag address for a path.
pub fn bag_addr<S: AsRef<str>>(segments: &[S]) -> BagAddr {
    BagAddr::from_sig(sign_str(&lineage_key(segments)))
}

/// The **legacy** bag address for a path — a read-only migration source.
///
/// Only meaningfully different from [`bag_addr`] when canonicalization changed
/// the key; that difference is exactly the migration surface to union over.
pub fn legacy_bag_addr<S: AsRef<str>>(segments: &[S]) -> BagAddr {
    BagAddr::from_sig(sign_str(&raw_lineage_key(segments)))
}

/// Did canonicalization re-address this path? If so, [`legacy_bag_addr`] holds
/// content that must be unioned in on read.
pub fn re_addressed<S: AsRef<str>>(segments: &[S]) -> bool {
    lineage_key(segments) != raw_lineage_key(segments)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_key_is_empty_and_signs_as_the_empty_hash() {
        let empty: [&str; 0] = [];
        assert_eq!(lineage_key(&empty), "");
        assert_eq!(bag_addr(&empty).sig(), crate::sig::Sig::empty());
    }

    #[test]
    fn is_idempotent() {
        for name in ["my-cool-tile", "Chapter-1", "a-b"] {
            assert_eq!(canonicalize_segment(name), name);
        }
    }

    #[test]
    fn separator_runs_collapse_to_one_hyphen() {
        // A RUN collapses, so these must converge.
        assert_eq!(canonicalize_segment("a--b"), "a-b");
        assert_eq!(canonicalize_segment("a   b"), "a-b");
        assert_eq!(canonicalize_segment("a...b"), "a-b");
        // ...but a boundary is still preserved, so this stays distinct.
        assert_ne!(canonicalize_segment("a-b"), canonicalize_segment("ab"));
    }

    #[test]
    fn edge_separators_are_stripped() {
        assert_eq!(canonicalize_segment("  padded  "), "padded");
        assert_eq!(canonicalize_segment("trailing..."), "trailing");
        assert_eq!(canonicalize_segment("...leading"), "leading");
    }

    #[test]
    fn nfc_folds_decomposed_forms_together() {
        assert_eq!(canonicalize_segment("caf\u{e9}"), canonicalize_segment("cafe\u{301}"));
    }

    #[test]
    fn non_latin_letters_and_digits_survive() {
        assert_eq!(canonicalize_segment("日本語"), "日本語");
        assert_eq!(canonicalize_segment("Chapter 1"), "Chapter-1");
    }

    #[test]
    fn case_is_preserved() {
        assert_eq!(canonicalize_segment("MyTile"), "MyTile");
    }

    #[test]
    fn symbol_only_segment_falls_back_to_raw_and_never_collapses_to_root() {
        assert_eq!(canonicalize_segment("🐝"), "");
        assert_eq!(lineage_key(&["🐝"]), "🐝");
        // The whole point of the guard: this must NOT be the root bag.
        assert_ne!(bag_addr(&["🐝"]).sig(), crate::sig::Sig::empty());
        // ...nor may it shorten a path and collide with the parent.
        assert_eq!(lineage_key(&["🐝", "child"]), "🐝/child");
    }

    #[test]
    fn empty_segments_are_dropped() {
        assert_eq!(lineage_key(&["", "real"]), "real");
    }

    #[test]
    fn slash_in_a_name_cannot_forge_a_path_separator() {
        // '/' is a separator character, so it folds INTO the segment rather
        // than splitting it. One segment in, one segment out.
        assert_eq!(lineage_key(&["a/b"]), "a-b");
    }

    #[test]
    fn colon_can_never_appear_in_a_key() {
        // This is what makes colon-scoped pool meanings collision-proof.
        assert!(!lineage_key(&["websites:menu"]).contains(':'));
    }
}
