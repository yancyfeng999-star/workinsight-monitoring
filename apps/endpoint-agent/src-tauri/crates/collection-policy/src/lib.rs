use agent_core::contract::Privacy;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionPolicy {
    pub version: u32,
    pub title_enabled: bool,
    pub work_hours: Option<(u8, u8)>,
    pub blocklist_domains: Vec<String>,
    pub blocklist_app_ids: Vec<String>,
}

impl Default for CollectionPolicy {
    fn default() -> Self {
        CollectionPolicy {
            version: 1,
            title_enabled: false,
            work_hours: None,
            blocklist_domains: vec![
                "onepassword.com".into(),
                "1password.com".into(),
                "bitwarden.com".into(),
                "bankofamerica.com".into(),
                "icbc.com.cn".into(),
                "cmbchina.com".into(),
                "alipay.com".into(),
                "mail.google.com".into(),
                "qq.com".into(),
                "126.com".into(),
                "163.com".into(),
                "outlook.com".into(),
                "government.za".into(),
                "usa.gov".into(),
                "localhost".into(),
            ],
            blocklist_app_ids: vec![
                "com.1password.1password".into(),
                "com.agilebits.onepassword7".into(),
                "com.bitwarden.desktop".into(),
                "com.apple.Passwords".into(),
            ],
        }
    }
}

impl CollectionPolicy {
    pub fn should_drop(
        &self,
        private_mode: bool,
        app_id: &str,
        domain: Option<&str>,
    ) -> Option<Privacy> {
        if private_mode {
            return Some(Privacy::Private);
        }
        if self.blocklist_app_ids.iter().any(|id| id == app_id) {
            return Some(Privacy::Normal);
        }
        if let Some(d) = domain {
            if self
                .blocklist_domains
                .iter()
                .any(|b| d == b || d.ends_with(&format!(".{b}")))
            {
                return Some(Privacy::Normal);
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_blocklists() {
        let p = CollectionPolicy::default();
        assert_eq!(
            p.should_drop(false, "com.1password.1password", None),
            Some(Privacy::Normal)
        );
        assert_eq!(p.should_drop(false, "com.apple.finder", None), None);
        assert_eq!(
            p.should_drop(false, "com.google.Chrome", Some("bankofamerica.com")),
            Some(Privacy::Normal)
        );
        assert_eq!(
            p.should_drop(false, "com.google.Chrome", Some("example.com")),
            None
        );
        assert_eq!(
            p.should_drop(true, "com.google.Chrome", Some("example.com")),
            Some(Privacy::Private)
        );
    }

    #[test]
    fn subdomain_matches() {
        let p = CollectionPolicy::default();
        assert_eq!(
            p.should_drop(false, "com.google.Chrome", Some("secure.bankofamerica.com")),
            Some(Privacy::Normal)
        );
    }
}
