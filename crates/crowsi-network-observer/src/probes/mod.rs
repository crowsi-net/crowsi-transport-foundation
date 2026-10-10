//! Built-in probes with no privileged or external network operations.

mod proc_net_dev;
mod sample;

pub use proc_net_dev::ProcNetDevProbe;
pub use sample::SampleProbe;
