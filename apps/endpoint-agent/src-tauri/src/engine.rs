use agent_core::contract::{
    Activity, AgentInfo, Event, EventPayload, PresenceState, Privacy, Source, StateChange,
};
use agent_core::observation::{BrowserKind, Observation};
use chrono::{DateTime, Duration, Utc};
use collection_policy::CollectionPolicy;
use local_store::LocalStore;

const CHECKPOINT_INTERVAL: Duration = Duration::minutes(5);
const OBSERVATION_GAP: Duration = Duration::seconds(15);

#[derive(Clone)]
pub struct EngineIdentity {
    pub org_id: String,
    pub device_id: String,
    pub subject_id: String,
}

#[derive(Clone)]
struct CurrentState {
    key: String,
    activity: Activity,
    last_observed_at: DateTime<Utc>,
    checkpoint_started_at: DateTime<Utc>,
}

pub struct AgentEngine {
    store: LocalStore,
    identity: Option<EngineIdentity>,
    agent: AgentInfo,
    policy: CollectionPolicy,
    current: Option<CurrentState>,
    browser: Option<(BrowserKind, String, String)>,
    pending_events: Vec<Event>,
}

impl AgentEngine {
    pub fn new(store: LocalStore, agent: AgentInfo, policy: CollectionPolicy) -> Self {
        AgentEngine {
            store,
            identity: None,
            agent,
            policy,
            current: None,
            browser: None,
            pending_events: Vec::new(),
        }
    }

    pub fn enroll(&mut self, org_id: String, device_id: String, subject_id: String) {
        self.identity = Some(EngineIdentity {
            org_id,
            device_id,
            subject_id,
        });
    }

    pub fn is_enrolled(&self) -> bool {
        self.identity.is_some()
    }

    pub fn handle(&mut self, obs: Observation) {
        if self.identity.is_none() {
            return;
        }
        match obs {
            Observation::Foreground {
                observed_at,
                app_id,
                app_name,
                window_title,
            } => {
                self.observe_foreground(observed_at, app_id, app_name, window_title);
            }
            Observation::BrowserActive {
                observed_at,
                browser,
                tab_id,
                registrable_domain,
                title,
            } => {
                self.observe_browser_active(
                    observed_at,
                    browser,
                    tab_id,
                    registrable_domain,
                    title,
                );
            }
            Observation::BrowserInactive {
                observed_at,
                browser,
                tab_id,
            } => {
                self.observe_browser_inactive(observed_at, browser, tab_id);
            }
            Observation::StateChanged { observed_at, state } => {
                self.observe_state(observed_at, state);
            }
        }
    }

    /// Close the current segment. `now` is the observation time that caused the
    /// closure; if the gap since last confirmation exceeds OBSERVATION_GAP the
    /// segment ends at last_observed_at (no invented duration), otherwise it
    /// extends to `now`.
    fn close_current(&mut self, now: DateTime<Utc>) {
        let snapshot = self.current.as_ref().map(|c| {
            let end = if now - c.last_observed_at > OBSERVATION_GAP {
                c.last_observed_at
            } else {
                now
            };
            (c.checkpoint_started_at, end, c.activity.clone())
        });
        self.current = None;
        if let Some((start, end, act)) = snapshot {
            if end > start {
                let identity = self.identity.clone().expect("enrolled");
                let ev = self.build_event(start, end, &act, &identity);
                self.pending_events.push(ev);
            }
        }
    }

    fn observe_foreground(
        &mut self,
        now: DateTime<Utc>,
        app_id: String,
        app_name: String,
        window_title: Option<String>,
    ) {
        let identity = self.identity.clone().expect("enrolled");
        let mut activity = Activity {
            app_id,
            app_name,
            window_title: None,
            browser: None,
            registrable_domain: None,
            url_path: None,
        };
        if self.policy.title_enabled {
            activity.window_title = window_title.map(|t| t.chars().take(256).collect());
        }
        if self
            .policy
            .should_drop(false, &activity.app_id, None)
            .is_some()
        {
            self.close_current(now);
            return;
        }
        let key = activity.app_id.clone();

        let same_key = self.current.as_ref().map(|c| c.key == key).unwrap_or(false);
        if !same_key {
            self.close_current(now);
            self.current = Some(CurrentState {
                key,
                activity,
                last_observed_at: now,
                checkpoint_started_at: now,
            });
            return;
        }

        if let Some(c) = &mut self.current {
            c.last_observed_at = now;
        }
        // browser enrichment: domain from active browser tab applies to browser segment
        let domain = self.browser.as_ref().map(|(_, _, d)| d.clone());
        if let Some(d) = domain {
            let is_browser = self
                .current
                .as_ref()
                .map(|c| is_browser_app(&c.activity.app_id))
                .unwrap_or(false);
            if is_browser {
                let c = self.current.as_mut().unwrap();
                if c.activity.registrable_domain != Some(d.clone()) {
                    let start = c.checkpoint_started_at;
                    let end = c.last_observed_at;
                    let mut enriched = c.activity.clone();
                    enriched.registrable_domain = Some(d.clone());
                    c.activity.registrable_domain = Some(d);
                    c.checkpoint_started_at = now;
                    let ev = self.build_event(start, end, &enriched, &identity);
                    self.pending_events.push(ev);
                }
            }
        }

        // checkpoint: unchanged activity every 5 minutes
        if let Some(c) = &mut self.current {
            if now - c.checkpoint_started_at >= CHECKPOINT_INTERVAL {
                let start = c.checkpoint_started_at;
                let end = c.last_observed_at;
                let act = c.activity.clone();
                c.checkpoint_started_at = now;
                let ev = self.build_event(start, end, &act, &identity);
                self.pending_events.push(ev);
            }
        }
    }

    fn observe_browser_active(
        &mut self,
        now: DateTime<Utc>,
        browser: BrowserKind,
        tab_id: String,
        registrable_domain: String,
        title: Option<String>,
    ) {
        let identity = self.identity.clone().expect("enrolled");
        if self
            .policy
            .should_drop(false, "com.google.Chrome", Some(&registrable_domain))
            .is_some()
        {
            self.browser = None;
            return;
        }
        let same_tab = matches!(&self.browser, Some((b, t, _)) if *b == browser && *t == tab_id);
        self.browser = Some((browser, tab_id, registrable_domain.clone()));
        if !same_tab {
            let is_browser = self
                .current
                .as_ref()
                .map(|c| is_browser_app(&c.activity.app_id))
                .unwrap_or(false);
            if is_browser {
                let snapshot = self.current.as_ref().map(|c| {
                    let end = if now - c.last_observed_at > OBSERVATION_GAP {
                        c.last_observed_at
                    } else {
                        now
                    };
                    (c.checkpoint_started_at, end, c.activity.clone())
                });
                if let Some((start, end, mut enriched)) = snapshot {
                    enriched.registrable_domain = Some(registrable_domain.clone());
                    if end > start {
                        let ev = self.build_event(start, end, &enriched, &identity);
                        self.pending_events.push(ev);
                    }
                    if let Some(c) = &mut self.current {
                        c.activity.registrable_domain = Some(registrable_domain.clone());
                        c.checkpoint_started_at = now;
                        c.last_observed_at = now;
                    }
                }
            }
        }
        let _ = title;
    }

    fn observe_browser_inactive(
        &mut self,
        now: DateTime<Utc>,
        _browser: BrowserKind,
        _tab_id: String,
    ) {
        let identity = self.identity.clone().expect("enrolled");
        self.browser = None;
        let is_browser = self
            .current
            .as_ref()
            .map(|c| is_browser_app(&c.activity.app_id))
            .unwrap_or(false);
        if is_browser {
            let snapshot = self.current.as_ref().map(|c| {
                let end = if now - c.last_observed_at > OBSERVATION_GAP {
                    c.last_observed_at
                } else {
                    now
                };
                (c.checkpoint_started_at, end, c.activity.clone())
            });
            if let Some((start, end, act)) = snapshot {
                if end > start {
                    let ev = self.build_event(start, end, &act, &identity);
                    self.pending_events.push(ev);
                }
            }
            if let Some(c) = &mut self.current {
                c.checkpoint_started_at = now;
                c.last_observed_at = now;
            }
        }
    }

    fn observe_state(&mut self, now: DateTime<Utc>, state: PresenceState) {
        let identity = self.identity.clone().expect("enrolled");
        // lock/sleep events are presence evidence: activity extends to the lock
        // moment, not to last foreground observation.
        let snapshot = self
            .current
            .as_ref()
            .map(|c| (c.checkpoint_started_at, now, c.activity.clone()));
        self.current = None;
        if let Some((start, end, act)) = snapshot {
            if end > start {
                let ev = self.build_event(start, end, &act, &identity);
                self.pending_events.push(ev);
            }
        }
        self.browser = None;
        let state_event = Event {
            schema_version: 1,
            event_id: agent_core::generate_event_id(),
            org_id: identity.org_id.clone(),
            device_id: identity.device_id.clone(),
            subject_id: identity.subject_id.clone(),
            sequence_no: self.store.reserve_sequence().unwrap_or(1),
            source: Source::System,
            started_at: now,
            ended_at: now + Duration::milliseconds(500),
            timezone: String::new(),
            payload: EventPayload::StateChange {
                state: StateChange {
                    presence: state,
                    started_at: now,
                },
            },
            privacy: Privacy::Normal,
            agent: self.agent.clone(),
        };
        self.pending_events.push(state_event);
    }

    fn build_event(
        &mut self,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        activity: &Activity,
        identity: &EngineIdentity,
    ) -> Event {
        let mut ev = Event {
            schema_version: 1,
            event_id: agent_core::generate_event_id(),
            org_id: identity.org_id.clone(),
            device_id: identity.device_id.clone(),
            subject_id: identity.subject_id.clone(),
            sequence_no: self.store.reserve_sequence().unwrap_or(1),
            source: Source::System,
            started_at: start,
            ended_at: end,
            timezone: String::new(),
            payload: EventPayload::FocusSegment {
                activity: activity.clone(),
            },
            privacy: Privacy::Normal,
            agent: self.agent.clone(),
        };
        if ev.ended_at <= ev.started_at {
            ev.ended_at = ev.started_at + Duration::seconds(1);
        }
        ev
    }

    pub fn flush(&mut self) {
        let identity = match &self.identity {
            Some(i) => i.clone(),
            None => return,
        };
        let snapshot = self
            .current
            .as_ref()
            .filter(|c| c.last_observed_at > c.checkpoint_started_at)
            .map(|c| {
                (
                    c.checkpoint_started_at,
                    c.last_observed_at,
                    c.activity.clone(),
                )
            });
        self.current = None;
        if let Some((start, end, act)) = snapshot {
            let ev = self.build_event(start, end, &act, &identity);
            self.pending_events.push(ev);
        }
        let events = std::mem::take(&mut self.pending_events);
        for ev in events {
            let _ = self.store.push(&ev);
        }
    }

    pub fn into_store(self) -> LocalStore {
        self.store
    }

    pub fn store_mut(&mut self) -> &mut LocalStore {
        &mut self.store
    }
}

fn is_browser_app(app_id: &str) -> bool {
    app_id == "com.google.Chrome"
        || app_id == "com.microsoft.edgemac"
        || app_id.contains("chrome")
        || app_id.contains("edge")
}
