//! Pools of meaning, and telling them apart from lineage bags.
//!
//! # The hazard
//!
//! The storage root is an **untagged union** of two kinds of sig-named
//! directory:
//!
//! ```text
//! pool address = sha256(meaning)
//! bag address  = sha256(lineage_key(segments))
//! ```
//!
//! `lineage_key` preserves letters and digits, so for a **bare-word** meaning
//! the two preimages are byte-identical and the addresses *are the same
//! directory*. Nothing on disk distinguishes them. Code that walks the root and
//! assumes "sig-named dir = lineage bag" will treat a pool as a bag, and code
//! that prunes a bag will destroy the pool's members. This has happened.
//!
//! As of the conformance census, **21 of 27 registered meanings collide** with a
//! same-named root tile.
//!
//! # Why a fixed list cannot work
//!
//! A hardcoded denylist goes stale the moment any module mints a pool — and
//! modules are the whole point of the architecture. Four separate copies of such
//! a list had already drifted in the TypeScript tree.
//!
//! So this registry is both **seeded** with the census known at build time and
//! **self-extending**: deriving an address registers it. Anything that walks,
//! prunes, or enumerates the root must consult it.
//!
//! # The colon rule
//!
//! `lineage_key` folds every non-letter/number to `-`, so a `:` can never appear
//! in a lineage key. A colon-carrying meaning is therefore collision-proof *by
//! construction*.
//!
//! **Every new pool meaning must carry a colon.** [`BARE_WORD_MEANINGS`] is
//! frozen and may only shrink. Renaming a meaning is not a code change but a
//! data migration — `sign()` of a new spelling mints a different address forever
//! and strands every existing member.

use std::collections::HashMap;

use crate::lineage::lineage_key;
use crate::sig::{sign_str, PoolAddr, Sig};

/// Bare-word meanings — the ones that DO collide with a same-named root tile.
///
/// **Frozen. This list may only shrink**, as meanings are migrated to
/// colon-carrying spellings with a drain plan. Never add to it; a new meaning
/// takes a colon. Mirrors `BARE_WORD_POOL_MEANINGS` in
/// `hypercomb-core/src/core/pool-registry.ts`.
pub const BARE_WORD_MEANINGS: &[&str] = &[
    "authored",
    "bees",
    "clipboard",
    "computation",
    "dependencies",
    "host-push",
    "host-receipts",
    "manifests",
    "optimization",
    "overrides",
    "patches",
    "push",
    "receipts",
    "registry",
    "roots",
    "structure",
    "temporary",
    "threads",
    "translations",
    "viewport",
    "visual-optimization",
];

/// Colon-scoped meanings — collision-proof by construction.
///
/// An entry here *reserves a spelling*; it does not assert the pool exists or
/// has members. The spelling is the expensive half.
pub const SCOPED_MEANINGS: &[&str] = &[
    "pheromones:deposits",
    "substrate:references",
    "substrate:sources",
    "tutorial:artifacts",
    "usage:dwell",
    "websites:menu",
];

/// Would a meaning collide with a lineage bag for a same-named root tile?
///
/// True for every bare word. False for anything carrying a colon — which is the
/// entire reason the colon rule exists.
pub fn collides_with_lineage(meaning: &str) -> bool {
    sign_str(meaning) == sign_str(&lineage_key(&[meaning]))
}

/// Is this spelling safe to mint as a *new* pool meaning?
///
/// New meanings must carry a colon. Enforced here so a mistake is caught at the
/// call site rather than discovered when a `/flatten` deletes a pool.
pub fn is_valid_new_meaning(meaning: &str) -> bool {
    !meaning.is_empty() && meaning.contains(':') && !collides_with_lineage(meaning)
}

/// The registry of known pool addresses.
///
/// Seeded with the full census, and self-extending — [`PoolRegistry::address`]
/// registers as a side effect of addressing, so a pool minted by a module this
/// binary has never heard of still identifies itself the first time it is used.
#[derive(Debug, Clone)]
pub struct PoolRegistry {
    by_meaning: HashMap<String, PoolAddr>,
    by_address: HashMap<Sig, String>,
}

impl Default for PoolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl PoolRegistry {
    /// A registry seeded with every meaning known at build time.
    pub fn new() -> Self {
        let mut registry = Self {
            by_meaning: HashMap::new(),
            by_address: HashMap::new(),
        };
        for meaning in BARE_WORD_MEANINGS.iter().chain(SCOPED_MEANINGS) {
            registry.address(meaning);
        }
        registry
    }

    /// The address of a meaning. **Deriving registers it** — no module has to
    /// remember to opt in.
    pub fn address(&mut self, meaning: &str) -> PoolAddr {
        if let Some(known) = self.by_meaning.get(meaning) {
            return *known;
        }
        let sig = sign_str(meaning);
        let addr = PoolAddr::from_sig(sig);
        self.by_meaning.insert(meaning.to_string(), addr);
        self.by_address.insert(sig, meaning.to_string());
        addr
    }

    /// Is this signature the address of a known pool?
    ///
    /// A `true` answer means the directory is **not (only)** a lineage bag —
    /// callers that prune, enumerate, or rewrite bags must leave it alone.
    ///
    /// A `false` answer is *not* proof it is a bag: an unregistered pool minted
    /// by another implementation reads as unknown. Treat unknown sig-named
    /// directories conservatively.
    pub fn is_pool(&self, sig: Sig) -> bool {
        self.by_address.contains_key(&sig)
    }

    /// The meaning behind an address, for diagnostics and labelling a listing.
    pub fn meaning_of(&self, sig: Sig) -> Option<&str> {
        self.by_address.get(&sig).map(String::as_str)
    }

    /// Every known pool address.
    pub fn addresses(&self) -> impl Iterator<Item = PoolAddr> + '_ {
        self.by_meaning.values().copied()
    }

    /// Every known meaning.
    pub fn meanings(&self) -> impl Iterator<Item = &str> {
        self.by_address.values().map(String::as_str)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_bare_word_collides_and_every_scoped_one_does_not() {
        for meaning in BARE_WORD_MEANINGS {
            assert!(collides_with_lineage(meaning), "{meaning} should collide");
        }
        for meaning in SCOPED_MEANINGS {
            assert!(!collides_with_lineage(meaning), "{meaning} must not collide");
        }
    }

    #[test]
    fn new_meanings_must_carry_a_colon() {
        assert!(is_valid_new_meaning("swarm:receipts"));
        assert!(!is_valid_new_meaning("swarm"));
        assert!(!is_valid_new_meaning(""));
    }

    #[test]
    fn deriving_an_address_registers_it() {
        let mut registry = PoolRegistry::new();
        let addr = registry.address("brand:new");
        assert!(registry.is_pool(addr.sig()));
        assert_eq!(registry.meaning_of(addr.sig()), Some("brand:new"));
    }

    #[test]
    fn seeded_with_the_full_census() {
        let registry = PoolRegistry::new();
        assert_eq!(
            registry.meanings().count(),
            BARE_WORD_MEANINGS.len() + SCOPED_MEANINGS.len()
        );
    }

    #[test]
    fn a_bare_word_pool_and_its_tile_are_the_same_address() {
        // Documenting the hazard rather than asserting it away: `bees` the pool
        // and a root tile named "bees" are ONE directory.
        let mut registry = PoolRegistry::new();
        let pool = registry.address("bees");
        let bag = crate::lineage::bag_addr(&["bees"]);
        assert_eq!(pool.sig(), bag.sig());
    }
}
