use std::io::{self, Read, Write};

use browser_bridge::protocol::{parse_message, reply_error, reply_ok};
use local_ipc::protocol::IpcMessage;

const MAX_MSG_BYTES: usize = 64 * 1024;
const IPC_PATH: &str = "/tmp/com.workinsight.agent.bridge.sock";
const IPC_PATH_APP_DATA: &str =
    "Library/Application Support/com.workinsight.agent/agent-bridge.sock";

fn ipc_socket_path() -> String {
    if let Ok(home) = std::env::var("HOME") {
        let p = std::path::Path::new(&home).join(IPC_PATH_APP_DATA);
        if p.exists() {
            return p.to_string_lossy().into_owned();
        }
    }
    IPC_PATH.to_string()
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let mut reader = stdin.lock();

    loop {
        let mut len_buf = [0u8; 4];
        match reader.read_exact(&mut len_buf) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => break,
            Err(e) => {
                eprintln!("read length failed: {e}");
                break;
            }
        }
        let len = u32::from_ne_bytes(len_buf) as usize;
        if len == 0 || len > MAX_MSG_BYTES {
            let _ = write_reply(&mut stdout, &reply_error("message too large"));
            continue;
        }
        let mut buf = vec![0u8; len];
        if reader.read_exact(&mut buf).is_err() {
            break;
        }
        match parse_message(&buf) {
            Ok(msg) => {
                // Forward to the agent over same-user local IPC. The agent is
                // the single owner of queue/identity/sequence; the host only
                // relays and acknowledges.
                let ipc_msg = match msg {
                    browser_bridge::protocol::BrowserMessage::Activate {
                        tab_id,
                        title,
                        registrable_domain,
                        private_mode,
                    } => {
                        if private_mode {
                            let _ = write_reply(&mut stdout, &reply_error("private mode rejected"));
                            continue;
                        }
                        IpcMessage::BrowserActive {
                            browser: "chrome".into(),
                            tab_id: tab_id.to_string(),
                            registrable_domain,
                            title: (!title.is_empty()).then_some(title),
                        }
                    }
                    browser_bridge::protocol::BrowserMessage::Deactivate { tab_id } => {
                        IpcMessage::BrowserInactive {
                            browser: "chrome".into(),
                            tab_id: tab_id.to_string(),
                        }
                    }
                    browser_bridge::protocol::BrowserMessage::Heartbeat => IpcMessage::Ok,
                };
                match forward(&ipc_msg) {
                    Ok(true) => {
                        let _ = write_reply(&mut stdout, &reply_ok());
                    }
                    Ok(false) => {
                        let _ = write_reply(&mut stdout, &reply_error("agent not available"));
                    }
                    Err(e) => {
                        let _ = write_reply(&mut stdout, &reply_error(&format!("ipc error: {e}")));
                    }
                }
            }
            Err(e) => {
                let _ = write_reply(&mut stdout, &reply_error(&format!("invalid message: {e}")));
            }
        }
    }
}

fn forward(msg: &IpcMessage) -> io::Result<bool> {
    use std::os::unix::net::UnixStream;
    let Ok(mut stream) = UnixStream::connect(ipc_socket_path()) else {
        return Ok(false);
    };
    let mut buf = Vec::new();
    local_ipc::protocol::write_frame(&mut buf, msg).map_err(io::Error::other)?;
    stream.write_all(&buf)?;
    stream.flush()?;
    // read ack
    let mut resp_buf = Vec::new();
    let mut tmp = [0u8; 4096];
    let n = stream.read(&mut tmp)?;
    resp_buf.extend_from_slice(&tmp[..n]);
    Ok(!resp_buf.is_empty())
}

fn write_reply(stdout: &mut impl Write, payload: &[u8]) -> io::Result<()> {
    let len = (payload.len() as u32).to_ne_bytes();
    stdout.write_all(&len)?;
    stdout.write_all(payload)?;
    stdout.flush()
}
