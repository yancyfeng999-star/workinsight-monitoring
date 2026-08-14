// Platform abstraction: collectors produce Observations; engine consumes them.
// macOS must run AppKit/NSWorkspace calls on the main thread via run_on_main_thread.
use agent_core::observation::Observation;

pub trait ObservationSource {
    fn poll(&self) -> Vec<Observation>;
}
