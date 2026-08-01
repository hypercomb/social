//! Resolve one location's head from a closed hive: `head <hive dir> <segment>…`
//! The durability oracle: if this prints a head after the app is killed, the
//! commit survived; if the app then can't see it, the loss is in the READ
//! path, not the store.

use hypercomb_host::Host;

fn main() {
    let mut args = std::env::args().skip(1);
    let dir = args.next().expect("usage: head <hive dir> <segment>...");
    let segments: Vec<String> = args.collect();
    let host = Host::open(&dir).expect("open hive");

    println!("bag {}", host.bag_address(&segments));
    match host.head(&segments).expect("head lookup") {
        Some(head) => {
            println!("head index {} -> layer {}", head.index, head.layer);
            match host.get(&head.layer) {
                Ok(Some(bytes)) => println!("layer bytes: {}", String::from_utf8_lossy(&bytes)),
                Ok(None) => println!("LAYER BYTES MISSING — marker points at absent content"),
                Err(e) => println!("layer read error: {e}"),
            }
        }
        None => println!("NO HEAD — nothing committed here"),
    }
}
