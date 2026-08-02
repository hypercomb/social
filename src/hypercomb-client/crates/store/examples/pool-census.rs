//! Throwaway diagnostic: count / remove members of an install-cache pool.
//!
//!   pool-census <hive dir> count  <meaning>
//!   pool-census <hive dir> remove <meaning> <member>
//!
//! Used to settle whether a lost bee is lost on the WRITE or on the LISTING.

use hypercomb_protocol::{sign_str, PoolAddr};
use hypercomb_store::{ContentStore, RedbStore};

fn main() {
    let mut args = std::env::args().skip(1);
    let dir = args.next().expect("usage: pool-census <hive dir> <cmd> …");
    let cmd = args.next().expect("count | remove");
    let meaning = args.next().expect("a pool meaning");
    let store = RedbStore::open(&dir).expect("open hive");
    let pool = PoolAddr::from_sig(sign_str(&meaning));

    match cmd.as_str() {
        "count" => {
            let members = store.pool_list(pool).expect("list pool");
            let files = members.iter().filter(|m| !m.contains('/')).count();
            let bagged = members.len() - files;
            println!("{meaning}: {} members ({files} direct, {bagged} in bags)", members.len());
            for m in members.iter().filter(|m| !m.contains('/')).take(3) {
                println!("  e.g. {m}");
            }
        }
        "remove" => {
            let member = args.next().expect("a member name");
            let gone = store.pool_remove(pool, &member).expect("remove");
            println!("removed {member}: {gone}");
        }
        other => panic!("unknown command {other}"),
    }
}
