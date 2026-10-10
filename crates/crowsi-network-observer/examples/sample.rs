use crowsi_network_observer::collect;
use crowsi_network_observer::probes::SampleProbe;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let batch = collect(&SampleProbe, "2026-08-01T00:00:00.000Z")?;
    println!("{}", serde_json::to_string_pretty(&batch)?);
    Ok(())
}
