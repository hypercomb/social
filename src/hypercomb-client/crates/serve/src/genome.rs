//! # The gate's allow-list: the participant's CURRENT state, nothing older
//!
//! (jwize, 2026-10-01, `documentation/layer-pattern-audit.md` rule 6: "only
//! the GENOME leaves; history never does"; 2026-10-18: "only the head
//! identifier is exposed".) The store behind a host is the participant's whole
//! hive — every earlier layer of every tile, every restore point, every pool.
//! A host may give out exactly what the CURRENT hive reaches:
//!
//! - the head marker of each location the current tree reaches, and the layer
//!   it names — never the generation a parent still carries (under leaf-only
//!   history a parent's child sig is a stale hint; the location's own head is
//!   the truth, `active-genome.ts` `visitLayer`);
//! - the resources those layers reach, followed through JSON, skipping the
//!   REFERENT fields (`prev`, a restore point's `seal`, identities) — pointers
//!   at the past, never part of the present.
//!
//! Derived HERE, from the layers, on purpose: the browser's `computed:genome`
//! record is a derived cache, and a derived cache is never load-bearing
//! (optimize-phase.md rule 3). A host that has no such record — or a stale
//! one — must still answer exactly.
//!
//! ## Two widenings, both bounded
//!
//! - **Public history, by the hive's own mark** (jwize 2026-10-24, "go with
//!   a-d"). A location whose CURRENT head layer carries a `publish:history`
//!   decoration with `payload.public === true` (`hypercomb-essentials`
//!   `publish-history.ts`; the worker reads the same mark) also gives up its
//!   history: every marker of its lineage bag, and the closure of the layer
//!   each one names (referents still skipped). The mark is read off the head
//!   only — a mark in an earlier version opens nothing — and anything absent
//!   or unreadable is head only. The OPERATOR may decline: a gate built
//!   `head_only` never reads the mark.
//! - **A grace window when the genome moves.** What the PREVIOUS collection
//!   admitted stays admitted for [`GRACE`] after it was superseded, so a
//!   visitor or an install walking a closure mid-edit finishes it. Then it is
//!   refused like anything never held.
//!
//! Content admitted only by either widening is never answered as
//! `immutable` (see `lib.rs` `resolve_with`): it is admitted for now, not for
//! good.
//!
//! Signatures are immutable, so what one names is memoized for good; a
//! collection only re-reads each location's head. The lists below mirror
//! core (`CHILD_SLOTS`, `REFERENT_FIELDS`, `HOME_MOLECULE_NAME`);
//! `hypercomb-core/src/core/native-genome-lists.spec.ts` fails the
//! TypeScript suite the moment they drift.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use hypercomb_protocol::lineage::re_addressed;
use hypercomb_protocol::{bag_addr, legacy_bag_addr, sign_str, Marker};
use serde_json::Value;

use crate::{is_sig, HiveSource};

/// The slots whose arrays are a location's children — `CHILD_SLOTS` in
/// `hypercomb-core/src/core/level-roster.ts`.
pub(crate) const CHILD_SLOTS: &[&str] = &["cells", "layers", "children"];

/// Sig-shaped fields that point AT something and are never carried —
/// `REFERENT_FIELDS` in `hypercomb-core/src/core/edge-registry.ts`.
pub(crate) const REFERENT_FIELDS: &[&str] = &["groupSig", "targetSig", "prev", "pubkey", "seal"];

/// The home page's molecule — `HOME_MOLECULE_NAME` in core
/// (`molecule-address.ts`): the root location's bag is `sign('root-entries')`.
/// The empty path's bag, `sign('')`, is its legacy mirror.
const HOME_MOLECULE: &str = "root-entries";

/// A path deeper than this is a cycle or garbage, not a hive.
const MAX_DEPTH: usize = 64;

/// The decoration kind that opens a location's history — shared with the
/// worker and the client (`PUBLISH_HISTORY_DECORATION_KIND`).
const PUBLISH_HISTORY: &str = "publish:history";

/// How long what a superseded collection admitted stays admitted.
pub const GRACE: Duration = Duration::from_secs(10 * 60);

/// Why a signature may be served — which decides how long it may be cached.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Admission {
    /// The current tree reaches it: admitted for as long as it stays current.
    Current,
    /// Only a location's PUBLIC history reaches it — the hive may turn that
    /// off at any time.
    History,
    /// Only a superseded collection reached it, within [`GRACE`].
    Grace,
}

/// What the current hive admits.
#[derive(Debug, Default)]
pub struct Genome {
    content: HashMap<String, Admission>,
    heads: HashSet<(String, String)>,
    /// Markers of locations whose history is public — every one, the head
    /// included.
    markers: HashSet<(String, String)>,
}

impl Genome {
    /// May `/<sig>` be served?
    pub fn admits_content(&self, sig: &str) -> bool {
        self.content.contains_key(sig)
    }

    /// Why `/<sig>` may be served, if it may.
    pub fn admission(&self, sig: &str) -> Option<Admission> {
        self.content.get(sig).copied()
    }

    /// May `/<dir>/<entry>` be served — is it the head marker of a location
    /// the current tree reaches?
    pub fn admits_head(&self, dir: &str, entry: &str) -> bool {
        self.heads.contains(&(dir.to_string(), entry.to_string()))
    }

    /// May `/<dir>/<entry>` be served as a marker of a location whose
    /// history is public?
    pub fn admits_marker(&self, dir: &str, entry: &str) -> bool {
        self.markers.contains(&(dir.to_string(), entry.to_string()))
    }

    /// Admit `sig` at `level`, never lowering what it already has.
    fn admit(&mut self, sig: String, level: Admission) {
        match level {
            Admission::Current => {
                self.content.insert(sig, level);
            }
            _ => {
                self.content.entry(sig).or_insert(level);
            }
        }
    }
}

/// What a superseded collection admitted, and when it was superseded.
#[derive(Debug, Clone, Default)]
pub(crate) struct Grace {
    content: HashMap<String, Instant>,
    entries: HashMap<(String, String), Instant>,
    /// The earliest supersession held, so a request can tell in one
    /// comparison whether anything has expired.
    oldest: Option<Instant>,
}

fn within(since: Instant, now: Instant) -> bool {
    now.saturating_duration_since(since) < GRACE
}

impl Grace {
    fn retain(&mut self, now: Instant) {
        self.content.retain(|_, since| within(*since, now));
        self.entries.retain(|_, since| within(*since, now));
        self.oldest = self.content.values().chain(self.entries.values()).min().copied();
    }

    fn any_expired(&self, now: Instant) -> bool {
        self.oldest.is_some_and(|oldest| !within(oldest, now))
    }

    /// Everything `old` admitted that `new` no longer does, superseded `now`.
    fn retire(&mut self, old: &Genome, new: &Genome, now: Instant) {
        for sig in old.content.keys() {
            if !new.admits_content(sig) {
                self.content.insert(sig.clone(), now);
                self.oldest.get_or_insert(now);
            }
        }
        for entry in old.heads.iter().chain(&old.markers) {
            if !new.heads.contains(entry) && !new.markers.contains(entry) {
                self.entries.insert(entry.clone(), now);
                self.oldest.get_or_insert(now);
            }
        }
    }
}

/// What one request may be given: the current collection, and what earlier
/// ones admitted that is still inside the grace window at `now`.
#[derive(Debug, Clone)]
pub(crate) struct Admits {
    genome: Arc<Genome>,
    grace: Arc<Grace>,
    now: Instant,
}

impl Admits {
    /// A collection with no past — what a one-shot `resolve` answers from.
    pub(crate) fn only(genome: Arc<Genome>) -> Self {
        Admits { genome, grace: Arc::default(), now: Instant::now() }
    }

    /// The current collection.
    #[cfg(test)]
    pub(crate) fn genome(&self) -> &Arc<Genome> {
        &self.genome
    }

    /// Why `/<sig>` may be served, if it may.
    pub(crate) fn content(&self, sig: &str) -> Option<Admission> {
        self.genome.admission(sig).or_else(|| {
            self.grace
                .content
                .get(sig)
                .is_some_and(|since| within(*since, self.now))
                .then_some(Admission::Grace)
        })
    }

    #[cfg(test)]
    pub(crate) fn admits_content(&self, sig: &str) -> bool {
        self.content(sig).is_some()
    }

    /// May `/<dir>/<entry>` be served? `is_head` says whether it is that
    /// directory's head marker right now.
    pub(crate) fn admits_entry(&self, dir: &str, entry: &str, is_head: bool) -> bool {
        (is_head && self.genome.admits_head(dir, entry))
            || self.genome.admits_marker(dir, entry)
            || self
                .grace
                .entries
                .get(&(dir.to_string(), entry.to_string()))
                .is_some_and(|since| within(*since, self.now))
    }
}

/// What one signature names, read once. Immutable because the name IS the
/// hash.
#[derive(Debug, Clone, Default)]
struct Facts {
    /// A layer's `name`.
    name: Option<String>,
    /// A meta envelope's layer payload (`{meta:1, layer:<sig>}`).
    payload: Option<String>,
    /// A layer's children: the sigs in its top-level child slots.
    children: Vec<String>,
    /// Everything else a layer reaches (non-child slots, referents skipped).
    slots: Vec<String>,
    /// Everything the value reaches, as a resource (referents skipped).
    all: Vec<String>,
    /// A layer's `decorations` slot: the record sigs it wears.
    decorations: Vec<String>,
    /// Is this value a `publish:history` record whose payload says
    /// `public: true`? Anything else — another kind, `public: false`, a
    /// missing payload — is not.
    opens_history: bool,
}

fn signature(text: &str) -> Option<String> {
    let lower = text.trim().to_ascii_lowercase();
    is_sig(&lower).then_some(lower)
}

fn harvest(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::String(text) => out.extend(signature(text)),
        Value::Array(items) => items.iter().for_each(|item| harvest(item, out)),
        Value::Object(fields) => {
            for (key, item) in fields {
                if !REFERENT_FIELDS.contains(&key.as_str()) {
                    harvest(item, out);
                }
            }
        }
        _ => {}
    }
}

fn facts_of(bytes: &[u8]) -> Facts {
    let opens = bytes.iter().find(|b| !b.is_ascii_whitespace());
    if !matches!(opens, Some(b'{') | Some(b'[')) {
        return Facts::default();
    }
    let Ok(value) = serde_json::from_slice::<Value>(bytes) else {
        return Facts::default();
    };
    let mut facts = Facts::default();
    harvest(&value, &mut facts.all);
    if let Value::Object(fields) = &value {
        if fields.get("meta").and_then(Value::as_u64) == Some(1) {
            let payloads: Vec<&str> = ["layer", "resource", "dependency", "bee"]
                .into_iter()
                .filter(|kind| fields.contains_key(*kind))
                .collect();
            if payloads == ["layer"] {
                facts.payload = fields.get("layer").and_then(Value::as_str).and_then(signature);
            }
        }
        facts.name = fields.get("name").and_then(Value::as_str).map(|n| n.trim().to_string());
        if let Some(Value::Array(items)) = fields.get("decorations") {
            facts.decorations = items.iter().filter_map(Value::as_str).filter_map(signature).collect();
        }
        facts.opens_history = fields.get("kind").and_then(Value::as_str) == Some(PUBLISH_HISTORY)
            && fields.get("payload").and_then(|payload| payload.get("public")).and_then(Value::as_bool)
                == Some(true);
        for (key, item) in fields {
            if key == "name" || REFERENT_FIELDS.contains(&key.as_str()) {
                continue;
            }
            match item {
                Value::Array(items) if CHILD_SLOTS.contains(&key.as_str()) => {
                    facts.children.extend(items.iter().filter_map(Value::as_str).filter_map(signature));
                }
                _ => harvest(item, &mut facts.slots),
            }
        }
    }
    facts
}

/// The bags a location's markers live in: the canonical bag first, then the
/// legacy one it unions from.
fn bags_of(path: &[String]) -> Vec<String> {
    let mut dirs = Vec::new();
    if path.is_empty() {
        dirs.push(sign_str(HOME_MOLECULE).to_hex());
        dirs.push(bag_addr::<&str>(&[]).to_hex());
    } else {
        dirs.push(bag_addr(path).to_hex());
        if re_addressed(path) {
            dirs.push(legacy_bag_addr(path).to_hex());
        }
    }
    dirs
}

/// The head of a signature directory: its max 8-digit marker and that
/// marker's bytes.
fn head_of(hive: &dyn HiveSource, dir: &str) -> Option<(String, Vec<u8>)> {
    hive.head(dir)
}

struct Walk<'a> {
    hive: &'a dyn HiveSource,
    memo: &'a mut HashMap<String, Facts>,
    genome: Genome,
    locations: HashSet<(String, String)>,
    resources: HashSet<String>,
    /// The operator declined public history: the mark is never read.
    head_only: bool,
    /// What `resource` admits at — `Current` until the history pass.
    level: Admission,
    /// Locations (paths) whose current head opens their history.
    public: Vec<Vec<String>>,
}

impl Walk<'_> {
    fn facts(&mut self, sig: &str) -> Option<Facts> {
        if let Some(held) = self.memo.get(sig) {
            return Some(held.clone());
        }
        let bytes = self.hive.content(sig)?;
        let facts = facts_of(&bytes);
        self.memo.insert(sig.to_string(), facts.clone());
        Some(facts)
    }

    /// A child's name, through an envelope when it is one — read to address
    /// the child, never admitted (a carried child sig may be a stale hint).
    fn name_of(&mut self, sig: &str) -> Option<String> {
        let facts = self.facts(sig)?;
        let facts = match facts.payload {
            Some(payload) => self.facts(&payload)?,
            None => facts,
        };
        facts.name.filter(|name| !name.is_empty())
    }

    /// Where a location's history lives, and its head: the canonical bag,
    /// else the legacy one it unions from.
    fn location(&self, path: &[String]) -> Option<(String, String, Vec<u8>)> {
        bags_of(path)
            .into_iter()
            .find_map(|dir| head_of(self.hive, &dir).map(|(head, bytes)| (dir, head, bytes)))
    }

    /// Does this layer's head open its location's history? Only a record it
    /// wears that READS as `publish:history` with `public: true` does — an
    /// unreadable record, or none, is head only.
    fn opens_history(&mut self, layer: &Facts) -> bool {
        if self.head_only {
            return false;
        }
        layer
            .decorations
            .iter()
            .any(|record| self.facts(record).is_some_and(|facts| facts.opens_history))
    }

    /// A public location's history: every marker of its bag (canonical and
    /// legacy — the location unions both) and the closure of the layer each
    /// names. Walking the markers is the whole history, so referents stay
    /// skipped here too.
    fn history(&mut self, path: &[String]) {
        for dir in bags_of(path) {
            let Some(names) = self.hive.entries(&dir) else { continue };
            for name in names {
                if hypercomb_protocol::marker_index(&name).is_none() {
                    continue;
                }
                let Some(bytes) = self.hive.entry(&dir, &name) else { continue };
                self.genome.markers.insert((dir.clone(), name));
                match Marker::parse(&bytes) {
                    Marker::Pointer { layer, .. } => self.resource(&layer.to_hex()),
                    // The layer rides inside the marker: what it reaches.
                    Marker::LegacyInline { .. } => {
                        for reached in facts_of(&bytes).all {
                            self.resource(&reached);
                        }
                    }
                }
            }
        }
    }

    /// Every public location's history, admitted as history — after the
    /// current pass, so nothing current is lowered.
    fn histories(&mut self) {
        self.level = Admission::History;
        for path in std::mem::take(&mut self.public) {
            self.history(&path);
        }
        self.level = Admission::Current;
    }

    fn resource(&mut self, sig: &str) {
        let mut pending = vec![sig.to_string()];
        while let Some(sig) = pending.pop() {
            if !self.resources.insert(sig.clone()) {
                continue;
            }
            let Some(facts) = self.facts(&sig) else { continue };
            self.genome.admit(sig, self.level);
            pending.extend(facts.all);
        }
    }

    fn layer(&mut self, path: Vec<String>, carried: Option<&str>) {
        if path.len() > MAX_DEPTH {
            return;
        }
        let (dir, sig, inline) = match self.location(&path) {
            Some((dir, head, bytes)) => {
                self.genome.heads.insert((dir.clone(), head));
                match Marker::parse(&bytes) {
                    Marker::Pointer { layer, .. } => (dir, layer.to_hex(), None),
                    // The layer rides inside the marker itself.
                    Marker::LegacyInline { layer } => (dir, layer.to_hex(), Some(facts_of(&bytes))),
                }
            }
            None => match carried {
                Some(carried) => (String::new(), carried.to_string(), None),
                None => return,
            },
        };
        if !self.locations.insert((dir.clone(), sig.clone())) {
            return;
        }
        let facts = match inline {
            Some(facts) => facts,
            None => match self.facts(&sig) {
                Some(facts) => {
                    self.genome.admit(sig.clone(), Admission::Current);
                    facts
                }
                None => return,
            },
        };
        let facts = match facts.payload.clone() {
            Some(payload) => match self.facts(&payload) {
                Some(target) => {
                    self.genome.admit(payload, Admission::Current);
                    target
                }
                None => return,
            },
            None => facts,
        };
        // A location held at a bag whose head wears the mark: its history is
        // public. A carried-only generation has no bag, so no history.
        if !dir.is_empty() && self.opens_history(&facts) {
            self.public.push(path.clone());
        }
        for reached in &facts.slots {
            self.resource(reached);
        }
        for child in &facts.children {
            if let Some(name) = self.name_of(child) {
                let mut next = path.clone();
                next.push(name);
                self.layer(next, Some(child));
            }
        }
    }
}

impl Walk<'_> {
    /// A door's creation, through its envelope when it is one: does its head
    /// layer wear the mark?
    fn creation_opens_history(&mut self, creation: &str) -> bool {
        let Some(facts) = self.facts(creation) else { return false };
        let facts = match facts.payload.clone() {
            Some(payload) => match self.facts(&payload) {
                Some(target) => target,
                None => return false,
            },
            None => facts,
        };
        self.opens_history(&facts)
    }

    /// THE DOORS. A hostname's bag, `sign(<hostname>)`, whose head is a
    /// `host:activation` layer for that same hostname, says which creation
    /// that host serves (hypercomb-runtime `host-activation.ts`). The door
    /// itself is current state; an ENABLED door's creation — its `head`
    /// and the merkle closure under it, referents skipped — is what the
    /// participant chose to serve. A disabled door gives up only itself.
    fn doors(&mut self) {
        let pages: HashSet<String> = self.locations.iter().map(|(dir, _)| dir.clone()).collect();
        for dir in self.hive.bags() {
            // A page's bag is a location, never a hostname's door.
            if pages.contains(&dir) {
                continue;
            }
            let Some((head, bytes)) = head_of(self.hive, &dir) else { continue };
            let Marker::Pointer { layer, .. } = Marker::parse(&bytes) else { continue };
            let sig = layer.to_hex();
            let Some(facts) = self.facts(&sig) else { continue };
            if facts.name.as_deref() != Some("host:activation") {
                continue;
            }
            let Some(door) = self.hive.content(&sig).and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else {
                continue;
            };
            let route = door.get("localRoute").and_then(Value::as_str).unwrap_or("");
            if route.is_empty() || sign_str(route).to_hex() != dir {
                continue;
            }
            self.genome.heads.insert((dir, head));
            self.genome.admit(sig, Admission::Current);
            if door.get("enabled").and_then(Value::as_bool) == Some(true) {
                if let Some(creation) = door.get("head").and_then(Value::as_str).and_then(signature) {
                    self.resource(&creation);
                    // The creation a door opens is a published location in
                    // its own right: when ITS head wears the mark, the
                    // history of the location it was published from — the
                    // door's `lineage` — is public too.
                    if self.creation_opens_history(&creation) {
                        let lineage = door.get("lineage").and_then(Value::as_str).unwrap_or("");
                        let path: Vec<String> =
                            lineage.split('/').filter(|s| !s.is_empty()).map(str::to_string).collect();
                        self.public.push(path);
                    }
                }
            }
        }
    }
}

/// THE DOOR A HOSTNAME OPENS, as the page carries it (`#hc-door`, the
/// record the Cloudflare worker injects — hypercomb-web `main.visitor.ts`
/// `readDoor`): `{layer, pubkey, lineage, title}`, where `layer` is the head
/// the visitor opens. Only an ENABLED `host:activation` for exactly this
/// hostname, at the head of its bag `sign(<hostname>)`, is a door.
pub fn door_for(hive: &dyn HiveSource, host: &str) -> Option<Value> {
    let (_, bytes) = head_of(hive, &sign_str(host).to_hex())?;
    let Marker::Pointer { layer, .. } = Marker::parse(&bytes) else { return None };
    let door: Value = serde_json::from_slice(&hive.content(&layer.to_hex())?).ok()?;
    let field = |key: &str| door.get(key).and_then(Value::as_str).unwrap_or("").to_string();
    if field("name") != "host:activation"
        || field("localRoute") != host
        || door.get("enabled").and_then(Value::as_bool) != Some(true)
    {
        return None;
    }
    let head = signature(&field("head"))?;
    let lineage = field("lineage");
    let title = lineage.rsplit('/').next().unwrap_or("").to_string();
    Some(serde_json::json!({
        "layer": head,
        "pubkey": field("pubkey"),
        "lineage": lineage,
        "title": title,
    }))
}

/// Collect what the current hive admits, memoizing what each signature names.
/// `head_only` is the operator declining public history whatever the hive's
/// mark says.
fn collect_into(hive: &dyn HiveSource, memo: &mut HashMap<String, Facts>, head_only: bool) -> Genome {
    let mut walk = Walk {
        hive,
        memo,
        genome: Genome::default(),
        locations: HashSet::new(),
        resources: HashSet::new(),
        head_only,
        level: Admission::Current,
        public: Vec::new(),
    };
    walk.layer(Vec::new(), None);
    walk.doors();
    walk.histories();
    walk.genome
}

/// Collect once, with nothing remembered, honouring each location's
/// `publish:history` mark — the pure form `resolve` uses.
pub fn collect(hive: &dyn HiveSource) -> Genome {
    collect_with(hive, false)
}

/// [`collect`], or head only whatever the marks say when `head_only`.
pub fn collect_with(hive: &dyn HiveSource, head_only: bool) -> Genome {
    collect_into(hive, &mut HashMap::new(), head_only)
}

/// For a source that cannot say when it changed: how long one collection
/// answers before the heads are read again — an edit can leave a superseded
/// version admitted for at most this long. A source that counts its writes
/// (the desktop app's store) is re-derived on the first request after any
/// write, and never otherwise.
const FRESH: Duration = Duration::from_secs(1);

/// A memo past this many signatures is dropped and rebuilt, so a host that
/// runs for weeks over a growing hive cannot grow without bound.
const MEMO_LIMIT: usize = 500_000;

/// The running host's gate: one collection at a time, reused while fresh,
/// and what superseded collections admitted, held for [`GRACE`].
#[derive(Debug, Default)]
pub(crate) struct Gate {
    held: Mutex<GateState>,
    head_only: bool,
}

#[derive(Debug, Default)]
struct GateState {
    at: Option<Instant>,
    writes: Option<u64>,
    genome: Arc<Genome>,
    grace: Arc<Grace>,
    memo: HashMap<String, Facts>,
}

impl Gate {
    /// A gate that honours each location's `publish:history` mark, or —
    /// `head_only` — one that never reads it.
    pub(crate) fn new(head_only: bool) -> Self {
        Gate { held: Mutex::default(), head_only }
    }

    pub(crate) fn current(&self, hive: &dyn HiveSource) -> Admits {
        self.current_at(hive, Instant::now())
    }

    /// [`Gate::current`] as of `now` — the clock is the caller's, so a test
    /// can step past the grace window without waiting it out.
    pub(crate) fn current_at(&self, hive: &dyn HiveSource, now: Instant) -> Admits {
        let mut state = self.held.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let writes = hive.writes();
        let unchanged = match (writes, state.writes) {
            (Some(now), Some(then)) => now == then,
            _ => state.at.is_some_and(|at| now.saturating_duration_since(at) < FRESH),
        };
        if !(state.at.is_some() && unchanged) {
            if state.memo.len() > MEMO_LIMIT {
                state.memo.clear();
            }
            let head_only = self.head_only;
            let GateState { memo, .. } = &mut *state;
            let genome = Arc::new(collect_into(hive, memo, head_only));
            if state.at.is_some() {
                let old = std::mem::replace(&mut state.genome, genome);
                let GateState { genome, grace, .. } = &mut *state;
                let grace = Arc::make_mut(grace);
                grace.retain(now);
                grace.retire(&old, genome, now);
            } else {
                state.genome = genome;
            }
            state.at = Some(now);
            state.writes = writes;
        } else if state.grace.any_expired(now) {
            Arc::make_mut(&mut state.grace).retain(now);
        }
        Admits { genome: state.genome.clone(), grace: state.grace.clone(), now }
    }
}
