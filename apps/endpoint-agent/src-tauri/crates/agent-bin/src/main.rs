use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use agent_core::contract::{AgentInfo, Event, Privacy, Source};
use agent_core::segment::Segmenter;
use chrono::Utc;
use collection_policy::CollectionPolicy;
use device_identity::DeviceIdentity;
use fs2::FileExt;
use local_store::LocalStore;
use tracing::{error, info, warn};

const POLL_INTERVAL: Duration = Duration::from_secs(2);
const FLUSH_AFTER: chrono::Duration = chrono::Duration::seconds(30);

static SHUTDOWN: AtomicBool = AtomicBool::new(false);

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let args: Vec<String> = std::env::args().collect();
    let data_dir = args
        .iter()
        .position(|a| a == "--data-dir")
        .and_then(|i| args.get(i + 1))
        .map(PathBuf::from)
        .unwrap_or_else(default_data_dir);
    let run_seconds = args
        .iter()
        .position(|a| a == "--run-seconds")
        .and_then(|i| args.get(i + 1))
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(u64::MAX);

    if let Err(e) = std::fs::create_dir_all(&data_dir) {
        error!("cannot create data dir: {e}");
        std::process::exit(1);
    }

    match run(&data_dir, run_seconds) {
        Ok(code) => std::process::exit(code),
        Err(e) => {
            error!("agent exited with error: {e}");
            std::process::exit(1);
        }
    }
}

fn default_data_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".workinsight")
}

fn run(data_dir: &std::path::Path, run_seconds: u64) -> Result<i32, Box<dyn std::error::Error>> {
    let identity = DeviceIdentity::load_or_create(&data_dir.join("device_id"))?;
    info!(device_id = %identity.device_id, "agent starting");

    let lock_path = data_dir.join("agent.lock");
    let lock = acquire_single_instance(&lock_path)?;

    let store_path = data_dir.join("queue.db");
    let mut store = LocalStore::open(store_path.to_str().unwrap())?;
    let policy = CollectionPolicy::default();
    let agent = AgentInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
    };
    let mut segmenter = Segmenter::new(FLUSH_AFTER);
    let clock = agent_core::time::Clock::default();

    let mut seq = store.next_sequence();
    let started = Utc::now();

    ctrlc::set_handler(|| SHUTDOWN.store(true, Ordering::SeqCst))
        .map_err(|e| format!("ctrl-c handler: {e}"))?;

    info!(run_seconds, "agent thin-slice running (Ctrl-C to stop)");

    while !SHUTDOWN.load(Ordering::SeqCst) {
        let tick_start = std::time::Instant::now();
        let now = clock.now();

        if let Some(fg) = current_foreground() {
            let key = fg.app_id.clone();
            let activity = agent_core::contract::Activity {
                app_id: fg.app_id,
                app_name: fg.app_name,
                window_title: None,
                browser: None,
                registrable_domain: None,
                url_path: None,
            };
            let events = segmenter.push(key, activity, Source::System, now);
            for mut ev in events {
                match finalize_event(&mut ev, &policy, &identity, &mut seq, &agent, &clock) {
                    Ok(()) => match store.push(&ev) {
                        Ok(()) => {}
                        Err(e) => error!("store push failed: {e}"),
                    },
                    Err(reason) => warn!("event dropped: {reason}"),
                }
            }
        }

        if now - started >= chrono::Duration::seconds(run_seconds as i64) {
            info!("run time reached, flushing");
            break;
        }

        let elapsed = tick_start.elapsed();
        if elapsed < POLL_INTERVAL {
            std::thread::sleep(POLL_INTERVAL - elapsed);
        }
    }

    let now = clock.now();
    for mut ev in segmenter.flush(now) {
        if finalize_event(&mut ev, &policy, &identity, &mut seq, &agent, &clock).is_ok() {
            let _ = store.push(&ev);
        }
    }

    let depth = store.count_unacked().unwrap_or(0);
    info!(
        queue_depth = depth,
        final_sequence = seq,
        "agent stopped cleanly"
    );
    lock.release()?;
    Ok(0)
}

fn current_foreground() -> Option<ForegroundApp> {
    #[cfg(target_os = "macos")]
    {
        collector_macos::frontmost::current().map(|a| ForegroundApp {
            app_id: a.app_id,
            app_name: a.app_name,
            window_title: a.window_title,
        })
    }
    #[cfg(target_os = "windows")]
    {
        collector_windows::foreground::current().map(|a| ForegroundApp {
            app_id: a.app_id,
            app_name: a.app_name,
            window_title: a.window_title,
        })
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        None
    }
}

struct ForegroundApp {
    app_id: String,
    app_name: String,
    #[allow(dead_code)]
    window_title: Option<String>,
}

fn finalize_event(
    ev: &mut Event,
    policy: &CollectionPolicy,
    identity: &DeviceIdentity,
    seq: &mut u64,
    agent: &AgentInfo,
    clock: &agent_core::time::Clock,
) -> Result<(), String> {
    if let agent_core::EventPayload::FocusSegment { activity } = &ev.payload {
        if policy
            .should_drop(
                false,
                &activity.app_id,
                activity.registrable_domain.as_deref(),
            )
            .is_some()
        {
            return Err("blocked by collection policy".into());
        }
    }
    *seq += 1;
    ev.event_id = agent_core::generate_event_id();
    ev.device_id = identity.device_id.clone();
    ev.sequence_no = *seq;
    ev.agent = agent.clone();
    ev.timezone = clock.tz_name.clone();
    ev.privacy = Privacy::Normal;
    agent_core::validate_event(ev)?;
    Ok(())
}

struct InstanceLock {
    file: std::fs::File,
    path: PathBuf,
}

fn acquire_single_instance(path: &PathBuf) -> Result<InstanceLock, Box<dyn std::error::Error>> {
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)?;
    file.try_lock_exclusive()?;
    Ok(InstanceLock {
        file,
        path: path.clone(),
    })
}

impl InstanceLock {
    fn release(&self) -> Result<(), std::io::Error> {
        let _ = self.file.unlock();
        let _ = std::fs::remove_file(&self.path);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_instance_lock() {
        let dir = std::env::temp_dir().join(format!("aw-lock-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("agent.lock");
        let a = acquire_single_instance(&p).unwrap();
        assert!(acquire_single_instance(&p).is_err());
        a.release().unwrap();
        assert!(acquire_single_instance(&p).is_ok());
    }
}
