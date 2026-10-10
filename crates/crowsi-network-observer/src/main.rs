use std::env;
use std::error::Error;
use std::io::{self, Write};

use crowsi_network_observer::probes::{ProcNetDevProbe, SampleProbe};
use crowsi_network_observer::{collect, now_rfc3339};

const SAMPLE_TIME: &str = "2026-08-01T00:00:00.000Z";

fn main() {
    if let Err(error) = run() {
        eprintln!("network observation failed: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let command = env::args().nth(1).unwrap_or_else(|| "sample".to_owned());
    let batch = match command.as_str() {
        "sample" => collect(&SampleProbe, SAMPLE_TIME)?,
        "observe" => {
            let generated_at = now_rfc3339();
            collect(&ProcNetDevProbe, &generated_at)?
        }
        "--help" | "-h" | "help" => {
            println!("usage: crowsi-network-observer [sample|observe]");
            return Ok(());
        }
        _ => return Err("unknown command; expected sample or observe".into()),
    };
    let stdout = io::stdout();
    let mut output = stdout.lock();
    serde_json::to_writer_pretty(&mut output, &batch)?;
    writeln!(output)?;
    Ok(())
}
