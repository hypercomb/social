//! Inspect a hive on disk.
//!
//! Used to verify from outside the app that the renderer really reached the
//! native store — the smoke page's checks are only meaningful if something
//! independent can see their effects.
//!
//!     cargo run -p hypercomb-host --example inspect -- <hive dir>

use hypercomb_host::Host;

fn main() {
    let dir = std::env::args().nth(1).expect("usage: inspect <hive dir>");
    let host = Host::open(&dir).expect("opening the hive");

    println!("hive: {}", host.root().display());

    // Artifacts the smoke page is expected to have written.
    /// A probe returns a detail string when the artifact is present.
    type Probe<'a> = Box<dyn Fn() -> Option<String> + 'a>;

    let expectations: Vec<(&str, Probe)> = vec![
        // The smoke page writes content it never commits into a layer. That
        // content is an orphan by definition, and the page's own collection
        // check reclaims it — so its ABSENCE is the correct outcome, and
        // asserting it survived would be asserting the GC is broken.
        (
            "uncommitted renderer content was reclaimed",
            Box::new(|| {
                let sig = hypercomb_protocol::sign(b"hello from the renderer").to_hex();
                match host.has(&sig) {
                    Ok(false) => Some("collected, as designed".into()),
                    Ok(true) => None,
                    Err(_) => None,
                }
            }),
        ),
        (
            "clipboard pool member",
            Box::new(|| {
                host.pool_get("clipboard", "entry")
                    .ok()
                    .flatten()
                    .map(|b| String::from_utf8_lossy(&b).to_string())
            }),
        ),
        (
            "bees pool member (colliding address)",
            Box::new(|| {
                host.pool_get("bees", "drone")
                    .ok()
                    .flatten()
                    .map(|b| String::from_utf8_lossy(&b).to_string())
            }),
        ),
        (
            "host-check/place bag head",
            Box::new(|| {
                host.head(&["host-check".into(), "place".into()])
                    .ok()
                    .flatten()
                    .map(|h| format!("index {} -> {}", h.index, &h.layer[..16]))
            }),
        ),
        (
            "bees bag head (same address as the pool)",
            Box::new(|| {
                host.head(&["bees".into()])
                    .ok()
                    .flatten()
                    .map(|h| format!("index {} -> {}", h.index, &h.layer[..16]))
            }),
        ),
        (
            "the renderer's own verdict",
            Box::new(|| {
                host.pool_get("hostcheck:results", "verdict")
                    .ok()
                    .flatten()
                    .and_then(|b| {
                        let verdict = String::from_utf8_lossy(&b).to_string();
                        // A recorded FAIL is not a pass. Treat it as missing so
                        // this program's exit code means what it says.
                        verdict.starts_with("PASS").then_some(verdict)
                    })
            }),
        ),
    ];

    let mut missing = 0;
    for (name, probe) in expectations {
        match probe() {
            Some(detail) => println!("  ok      {name}  [{detail}]"),
            None => {
                missing += 1;
                println!("  MISSING {name}");
            }
        }
    }

    println!();
    let root = host.raw_root_entries().unwrap_or_default();
    let (dirs, files): (Vec<_>, Vec<_>) = root.iter().partition(|e| e.directory);
    println!("  totals: {} content, {} sig-named directories", files.len(), dirs.len());
    for entry in dirs {
        let inside = host.raw_dir_entries(&entry.name).unwrap_or_default();
        let markers = inside.iter().filter(|e| e.name.len() == 8 && e.name.chars().all(|c| c.is_ascii_digit())).count();
        println!(
            "    {}… {} markers, {} pool members",
            &entry.name[..16],
            markers,
            inside.len() - markers,
        );
    }

    println!();
    if missing == 0 {
        println!("all renderer artifacts present — the window reached the native store");
    } else {
        println!("{missing} missing");
        std::process::exit(1);
    }
}
