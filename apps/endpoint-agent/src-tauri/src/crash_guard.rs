use std::time::{Duration, SystemTime};

const WINDOW: Duration = Duration::from_secs(600); // 10 minutes
const MAX_UNHEALTHY_STARTS: u32 = 3;

pub struct CrashGuard {
    start_times_file: std::path::PathBuf,
}

impl CrashGuard {
    pub fn new(path: std::path::PathBuf) -> Self {
        CrashGuard {
            start_times_file: path,
        }
    }

    fn read_starts(&self) -> Vec<SystemTime> {
        std::fs::read_to_string(&self.start_times_file)
            .map(|raw| {
                raw.lines()
                    .filter_map(|l| l.parse::<u64>().ok())
                    .map(|secs| SystemTime::UNIX_EPOCH + Duration::from_secs(secs))
                    .collect()
            })
            .unwrap_or_default()
    }

    fn write_starts(&self, starts: &[SystemTime]) {
        let raw = starts
            .iter()
            .map(|t| {
                t.duration_since(SystemTime::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0)
            })
            .map(|s| s.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        let _ = std::fs::write(&self.start_times_file, raw);
    }

    /// Record an (unhealthy) start; returns true when the guard is fused.
    pub fn record_unhealthy_start(&self) -> bool {
        let now = SystemTime::now();
        let mut starts: Vec<SystemTime> = self
            .read_starts()
            .into_iter()
            .filter(|t| now.duration_since(*t).map(|d| d < WINDOW).unwrap_or(false))
            .collect();
        starts.push(now);
        self.write_starts(&starts);
        starts.len() > MAX_UNHEALTHY_STARTS as usize
    }

    /// Clear crash history after a healthy run window.
    pub fn clear(&self) {
        let _ = std::fs::remove_file(&self.start_times_file);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("aw-crash-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join("starts.txt");
        let _ = std::fs::remove_file(&p);
        p
    }

    #[test]
    fn fuses_after_four_unhealthy_starts() {
        let p = tmp("fuse");
        let g = CrashGuard::new(p.clone());
        assert!(!g.record_unhealthy_start());
        assert!(!g.record_unhealthy_start());
        assert!(!g.record_unhealthy_start());
        assert!(
            g.record_unhealthy_start(),
            "4th start within window must fuse"
        );
        let _ = p;
    }

    #[test]
    fn healthy_run_clears_history() {
        let p = tmp("clear");
        let g = CrashGuard::new(p.clone());
        g.record_unhealthy_start();
        g.record_unhealthy_start();
        g.clear();
        assert!(!g.record_unhealthy_start(), "after clear, fuse resets");
        let _ = p;
    }

    #[test]
    fn old_starts_outside_window_ignored() {
        let p = tmp("old");
        let g = CrashGuard::new(p.clone());
        // write two starts 11 minutes in the past
        let old = (SystemTime::now() - Duration::from_secs(11 * 60))
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        std::fs::write(&p, format!("{old}\n{old}")).unwrap();
        assert!(!g.record_unhealthy_start(), "old starts must not count");
        let _ = p;
    }
}
