use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BrowserMessage {
    Activate {
        tab_id: u64,
        title: String,
        registrable_domain: String,
        private_mode: bool,
    },
    Deactivate {
        tab_id: u64,
    },
    Heartbeat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HostReply {
    Ok,
    Error { message: String },
}

pub fn parse_message(raw: &[u8]) -> Result<BrowserMessage, serde_json::Error> {
    serde_json::from_slice(raw)
}

pub fn reply_ok() -> Vec<u8> {
    serde_json::to_vec(&HostReply::Ok).unwrap_or_default()
}

pub fn reply_error(message: &str) -> Vec<u8> {
    serde_json::to_vec(&HostReply::Error {
        message: message.into(),
    })
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_activate() {
        let raw = r#"{"type":"activate","tab_id":1,"title":"Hello","registrable_domain":"example.com","private_mode":false}"#;
        let msg = parse_message(raw.as_bytes()).unwrap();
        match msg {
            BrowserMessage::Activate {
                tab_id,
                registrable_domain,
                ..
            } => {
                assert_eq!(tab_id, 1);
                assert_eq!(registrable_domain, "example.com");
            }
            _ => panic!("expected activate"),
        }
    }

    #[test]
    fn private_mode_flag_preserved() {
        let raw = r#"{"type":"activate","tab_id":2,"title":"x","registrable_domain":"bank.com","private_mode":true}"#;
        let msg = parse_message(raw.as_bytes()).unwrap();
        match msg {
            BrowserMessage::Activate { private_mode, .. } => assert!(private_mode),
            _ => panic!("expected activate"),
        }
    }
}
