//! `hypercomb-serve` — a hive, hosted, with no desktop attached.
//!
//! ```text
//! hypercomb-serve --hive /var/lib/hypercomb/hive --shell /srv/hypercomb/shell
//!                 [--port 4270] [--bind 0.0.0.0] [--local]
//! ```
//!
//! This is the server deployment of the same host the desktop app runs from its
//! Hive menu. Same crate, same contract, same checker:
//!
//! ```text
//! node hypercomb-shim/host/check-host.mjs http://your-host:4270
//! ```
//!
//! **It terminates no TLS and has no configuration language.** A host answers
//! GET, has no secret, no session and no state, so everything an operator would
//! reach for a config file for — certificates, virtual hosts, rate limits —
//! belongs to the thing in front of it (Caddy, nginx, a tunnel), which already
//! does it better. What cannot be delegated is the contract in `lib.rs`, and
//! that is all this binary is.
//!
//! **One writer per hive.** The store is a single memory-mapped database, and
//! the desktop app holds it open while it runs. Point this at a hive directory
//! nothing else has open — a server's own hive, or a replica.

use std::net::IpAddr;
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;

fn main() -> ExitCode {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let flag = |name: &str| -> Option<String> {
        argv.iter()
            .position(|a| a == name)
            .and_then(|at| argv.get(at + 1))
            .cloned()
    };
    if argv.iter().any(|a| a == "--help" || a == "-h") {
        eprintln!("{USAGE}");
        return ExitCode::SUCCESS;
    }

    let Some(hive_dir) = flag("--hive").map(PathBuf::from) else {
        eprintln!("{USAGE}");
        eprintln!("\nerror: --hive is required — the directory holding the hive's store");
        return ExitCode::from(2);
    };
    let Some(shell) = flag("--shell").map(PathBuf::from) else {
        eprintln!("{USAGE}");
        eprintln!(
            "\nerror: --shell is required — a built hypercomb-shim dist/ (npm run build:shim)",
        );
        return ExitCode::from(2);
    };

    // A shell that is not a shim build produces a host that passes a smoke test
    // and fails every client, so say it here rather than at the first visitor.
    if !shell.join("index.html").is_file() || !shell.join("pin").is_file() {
        eprintln!(
            "error: {} is not a shim build — it must hold index.html and pin",
            shell.display(),
        );
        eprintln!("       build one with: npm run build:shim   (from src/)");
        return ExitCode::from(2);
    }

    let port: u16 = match flag("--port").as_deref().map(str::parse) {
        Some(Ok(port)) => port,
        Some(Err(_)) => {
            eprintln!("error: --port must be a number");
            return ExitCode::from(2);
        }
        None => 4270,
    };
    let bind: IpAddr = if argv.iter().any(|a| a == "--local") {
        hypercomb_serve::LOOPBACK
    } else {
        match flag("--bind").as_deref().map(str::parse) {
            Some(Ok(address)) => address,
            Some(Err(_)) => {
                eprintln!("error: --bind must be an IP address, e.g. 0.0.0.0 or ::");
                return ExitCode::from(2);
            }
            None => hypercomb_serve::ANY,
        }
    };

    let host = match hypercomb_host::Host::open(&hive_dir) {
        Ok(host) => host,
        Err(e) => {
            eprintln!("error: opening the hive at {}: {e}", hive_dir.display());
            eprintln!("       is another process (the desktop app) holding it open?");
            return ExitCode::from(1);
        }
    };

    let serving = match hypercomb_serve::serve(&shell, Arc::new(host), bind, port) {
        Ok(serving) => serving,
        Err(e) => {
            eprintln!("error: binding {bind}:{port}: {e}");
            return ExitCode::from(1);
        }
    };

    println!("hive    {}", hive_dir.display());
    println!("shell   {}", shell.display());
    println!("serving {}", serving.addr());
    println!("open    {}", serving.lan_url());
    println!("verify  node hypercomb-shim/host/check-host.mjs {}", serving.lan_url());

    // Nothing to do on this thread — the listener owns its own. Park rather
    // than spin; the process ends on a signal, and a host has no state to flush.
    loop {
        std::thread::sleep(std::time::Duration::from_secs(3600));
    }
}

const USAGE: &str = "\
hypercomb-serve — serve a hive over HTTP

    hypercomb-serve --hive <dir> --shell <dir> [--port <n>] [--bind <ip>] [--local]

    --hive   the directory holding the hive (a redb store), opened read-only in
             practice: this binary has no write path
    --shell  a built hypercomb-shim dist/ — the shell, /pin and the bundled
             packages a first-time visitor boots from
    --port   default 4270
    --bind   default 0.0.0.0 (every interface); --local is 127.0.0.1
";
