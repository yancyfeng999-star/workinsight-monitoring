use crate::contract::{Activity, Event, Source, MAX_SEGMENT_SECONDS};
use chrono::{DateTime, Duration, Utc};

#[derive(Debug, Clone)]
pub struct PendingSegment {
    pub key: String,
    pub activity: Activity,
    pub started_at: DateTime<Utc>,
    pub last_seen_at: DateTime<Utc>,
    pub source: Source,
}

impl PendingSegment {
    pub fn new(key: String, activity: Activity, now: DateTime<Utc>, source: Source) -> Self {
        PendingSegment {
            key,
            activity,
            started_at: now,
            last_seen_at: now,
            source,
        }
    }
}

pub struct Segmenter {
    pub pending: Option<PendingSegment>,
    pub flush_after: Duration,
}

impl Segmenter {
    pub fn new(flush_after: Duration) -> Self {
        Segmenter {
            pending: None,
            flush_after,
        }
    }

    pub fn touch(&mut self, now: DateTime<Utc>) {
        if let Some(p) = &mut self.pending {
            p.last_seen_at = now;
        }
    }

    pub fn push(
        &mut self,
        key: String,
        activity: Activity,
        source: Source,
        now: DateTime<Utc>,
    ) -> Vec<Event> {
        let mut out = Vec::new();
        if let Some(p) = &self.pending {
            if p.key != key || now - p.last_seen_at > self.flush_after {
                out.push(self.close(now));
            }
        }
        match &self.pending {
            None => {
                self.pending = Some(PendingSegment::new(key, activity, now, source));
            }
            Some(p) if p.key == key => {
                let p = self.pending.as_mut().unwrap();
                p.last_seen_at = now;
            }
            _ => unreachable!(),
        }
        out
    }

    pub fn close(&mut self, now: DateTime<Utc>) -> Event {
        let p = self.pending.take().expect("no pending segment");
        let ended = now.max(p.last_seen_at);
        Event {
            schema_version: 1,
            event_id: crate::generate_event_id(),
            org_id: String::new(),
            device_id: String::new(),
            subject_id: String::new(),
            sequence_no: 0,
            source: p.source,
            started_at: p.started_at,
            ended_at: ended.min(p.started_at + Duration::seconds(MAX_SEGMENT_SECONDS)),
            timezone: String::new(),
            payload: crate::EventPayload::FocusSegment {
                activity: p.activity,
            },
            privacy: crate::Privacy::Normal,
            agent: crate::AgentInfo {
                version: String::new(),
                os: String::new(),
            },
        }
    }

    pub fn flush(&mut self, now: DateTime<Utc>) -> Vec<Event> {
        if self.pending.is_some() {
            vec![self.close(now)]
        } else {
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn act(name: &str) -> Activity {
        Activity {
            app_id: name.into(),
            app_name: name.into(),
            window_title: None,
            browser: None,
            registrable_domain: None,
            url_path: None,
        }
    }

    #[test]
    fn merge_adjacent_same_key() {
        let mut s = Segmenter::new(Duration::seconds(30));
        let t0 = Utc::now();
        assert!(s.push("a".into(), act("A"), Source::System, t0).is_empty());
        let t1 = t0 + Duration::seconds(10);
        assert!(s.push("a".into(), act("A"), Source::System, t1).is_empty());
        let t2 = t1 + Duration::seconds(10);
        let evts = s.push("b".into(), act("B"), Source::System, t2);
        assert_eq!(evts.len(), 1);
        assert_eq!(evts[0].duration_seconds(), 20);
    }

    #[test]
    fn flush_after_idle_gap() {
        let mut s = Segmenter::new(Duration::seconds(30));
        let t0 = Utc::now();
        s.push("a".into(), act("A"), Source::System, t0);
        let t1 = t0 + Duration::seconds(60);
        let evts = s.push("a".into(), act("A"), Source::System, t1);
        assert_eq!(evts.len(), 1);
    }

    #[test]
    fn flush_returns_pending() {
        let mut s = Segmenter::new(Duration::seconds(30));
        let t0 = Utc::now();
        s.push("a".into(), act("A"), Source::System, t0);
        let evts = s.flush(t0 + Duration::seconds(5));
        assert_eq!(evts.len(), 1);
        assert_eq!(evts[0].duration_seconds(), 5);
    }
}
