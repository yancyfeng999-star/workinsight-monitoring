use crate::contract::Privacy;

#[derive(Debug, Clone, Default)]
pub struct Policy {
    pub version: u32,
    pub blocklist_domains: Vec<String>,
    pub blocklist_app_ids: Vec<String>,
    pub title_enabled: bool,
}

impl Policy {
    pub fn is_private(&self, private: bool) -> bool {
        private
    }

    pub fn domain_blocked(&self, domain: &str) -> bool {
        self.blocklist_domains
            .iter()
            .any(|d| d == domain || domain.ends_with(&format!(".{d}")))
    }

    pub fn app_blocked(&self, app_id: &str) -> bool {
        self.blocklist_app_ids.iter().any(|d| d == app_id)
    }

    pub fn should_drop(
        &self,
        private: bool,
        domain: Option<&str>,
        app_id: &str,
    ) -> Option<Privacy> {
        if self.is_private(private) {
            return Some(Privacy::Private);
        }
        if let Some(d) = domain {
            if self.domain_blocked(d) {
                return Some(Privacy::Normal);
            }
        }
        if self.app_blocked(app_id) {
            return Some(Privacy::Normal);
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_mode_always_drops() {
        let p = Policy::default();
        assert_eq!(
            p.should_drop(true, None, "com.apple.finder"),
            Some(Privacy::Private)
        );
    }

    #[test]
    fn blocklist_domain_drops() {
        let p = Policy {
            blocklist_domains: vec!["bank.example.com".into()],
            ..Default::default()
        };
        assert_eq!(
            p.should_drop(false, Some("bank.example.com"), "com.apple.Safari"),
            Some(Privacy::Normal)
        );
        assert_eq!(
            p.should_drop(false, Some("other.example.com"), "com.apple.Safari"),
            None
        );
    }

    #[test]
    fn blocklist_app_drops() {
        let p = Policy {
            blocklist_app_ids: vec!["com.1password.1password".into()],
            ..Default::default()
        };
        assert_eq!(
            p.should_drop(false, None, "com.1password.1password"),
            Some(Privacy::Normal)
        );
        assert_eq!(p.should_drop(false, None, "com.apple.finder"), None);
    }
}
