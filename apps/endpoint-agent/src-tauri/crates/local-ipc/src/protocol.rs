use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const MAX_FRAME_BYTES: usize = 64 * 1024;

#[derive(Debug, Error)]
pub enum IpcError {
    #[error("frame too large: {0} bytes (max {MAX_FRAME_BYTES})")]
    FrameTooLarge(usize),
    #[error("truncated frame")]
    Truncated,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IpcMessage {
    BrowserActive {
        browser: String,
        tab_id: String,
        registrable_domain: String,
        title: Option<String>,
    },
    BrowserInactive {
        browser: String,
        tab_id: String,
    },
    GetPolicy,
    PolicySnapshot {
        window_title_enabled: bool,
        blocked_domains: Vec<String>,
    },
    Ok,
}

pub fn write_frame(writer: &mut impl std::io::Write, msg: &IpcMessage) -> Result<(), IpcError> {
    let raw = serde_json::to_vec(msg)?;
    if raw.len() > MAX_FRAME_BYTES {
        return Err(IpcError::FrameTooLarge(raw.len()));
    }
    writer.write_all(&(raw.len() as u32).to_be_bytes())?;
    writer.write_all(&raw)?;
    writer.flush()?;
    Ok(())
}

pub fn read_frame(reader: &mut impl std::io::Read) -> Result<IpcMessage, IpcError> {
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Err(IpcError::Truncated),
        Err(e) => return Err(IpcError::Io(e)),
    }
    let len = u32::from_be_bytes(len_buf) as usize;
    if len == 0 || len > MAX_FRAME_BYTES {
        return Err(IpcError::FrameTooLarge(len));
    }
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf)?;
    Ok(serde_json::from_slice(&buf)?)
}

pub fn parse_frame(raw: &[u8]) -> Result<IpcMessage, IpcError> {
    if raw.len() > MAX_FRAME_BYTES {
        return Err(IpcError::FrameTooLarge(raw.len()));
    }
    Ok(serde_json::from_slice(raw)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let msg = IpcMessage::BrowserActive {
            browser: "chrome".into(),
            tab_id: "t1".into(),
            registrable_domain: "example.co.uk".into(),
            title: None,
        };
        let mut buf = Vec::new();
        write_frame(&mut buf, &msg).unwrap();
        let mut slice: &[u8] = &buf;
        let back = read_frame(&mut slice).unwrap();
        match back {
            IpcMessage::BrowserActive {
                registrable_domain, ..
            } => {
                assert_eq!(registrable_domain, "example.co.uk")
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn oversize_frame_rejected() {
        let msg = IpcMessage::BrowserActive {
            browser: "chrome".into(),
            tab_id: "t".into(),
            registrable_domain: "x".repeat(MAX_FRAME_BYTES),
            title: None,
        };
        let mut buf = Vec::new();
        assert!(write_frame(&mut buf, &msg).is_err());
    }

    #[test]
    fn truncated_frame_rejected() {
        let mut buf = Vec::new();
        buf.extend_from_slice(&100u32.to_be_bytes());
        buf.extend_from_slice(&[0u8; 10]);
        let mut slice: &[u8] = &buf;
        assert!(read_frame(&mut slice).is_err());
    }
}
