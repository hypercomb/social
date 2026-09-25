//! A host name is an actionable location. Its hash names a bag; the highest
//! marker names the current activation layer. This reader does not mint a
//! second registry or infer an activation from bytes merely being held.

use hypercomb_protocol::{sign, sign_str};
use serde_json::{json, Value};

use crate::{is_sig, HiveSource};

const MAX_LAYER_BYTES: usize = 64 * 1024;

/// Normalize a wire Host header without accepting a path, user info, or a
/// second authority. Port is retained for visitor fetches but never hashed.
fn authority(raw: &str) -> Option<(String, String)> {
    let raw = raw.trim();
    if raw.is_empty() || raw.len() > 259 || raw.contains(['/', '@', '[', ']', '%', ' ']) {
        return None;
    }
    let (host, port) = match raw.rsplit_once(':') {
        Some((host, port)) if !host.contains(':') => {
            let number: u16 = port.parse().ok()?;
            if number == 0 || port.is_empty() || !port.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            (host, Some(number))
        }
        Some(_) => return None,
        None => (raw, None),
    };
    let hostname = host.to_ascii_lowercase();
    if hostname.len() > 253 || hostname.ends_with('.') || hostname.split('.').any(|label| {
        label.is_empty() || label.len() > 63 || label.starts_with('-') || label.ends_with('-')
            || !label.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    }) {
        return None;
    }
    let full = port.map_or_else(|| hostname.clone(), |number| format!("{hostname}:{number}"));
    Some((hostname, full))
}

/// The descriptor used by a visitor shell, only while the requested location
/// has an enabled layer and the selected payload root is already held here.
pub(super) fn site_descriptor(hive: &dyn HiveSource, host: &str) -> Option<Vec<u8>> {
    let (hostname, full_host) = authority(host)?;
    let bag = sign_str(&hostname).to_hex();
    let latest = hive.entries(&bag)?.into_iter()
        .filter(|name| name.len() == 8 && name.bytes().all(|b| b.is_ascii_digit()))
        .max()?;
    let marker: Value = serde_json::from_slice(&hive.entry(&bag, &latest)?).ok()?;
    let layer_sig = marker.get("layer")?.as_str()?;
    if !is_sig(layer_sig) { return None; }
    let bytes = hive.content(layer_sig)?;
    if bytes.len() > MAX_LAYER_BYTES || sign(&bytes).to_hex() != layer_sig { return None; }
    let layer: Value = serde_json::from_slice(&bytes).ok()?;
    if layer.get("name")?.as_str()? != "host:activation"
        || layer.get("enabled")?.as_bool()? != true
        || layer.get("localRoute")?.as_str()? != hostname { return None; }
    let pubkey = layer.get("pubkey")?.as_str()?;
    let head = layer.get("head")?.as_str()?;
    let lineage = layer.get("lineage")?.as_str()?;
    if !is_sig(pubkey) || !is_sig(head) { return None; }
    let segments: Vec<&str> = lineage.split('/').collect();
    if segments.is_empty() || segments.iter().any(|segment| segment.is_empty()) { return None; }
    // The toggle alone is not a deployment. Refuse a descriptor until its
    // selected root is actually in this hive and still hashes to its name.
    // The visitor shell and its used dependency closure are separate gates;
    // this descriptor cannot assert that those are runnable yet.
    let root = hive.content(head)?;
    if sign(&root).to_hex() != head { return None; }
    serde_json::to_vec(&json!({
        "title": segments.last(), "pubkey": pubkey, "head": head,
        "lineage": lineage, "segments": segments, "hosts": [full_host],
    })).ok()
}
