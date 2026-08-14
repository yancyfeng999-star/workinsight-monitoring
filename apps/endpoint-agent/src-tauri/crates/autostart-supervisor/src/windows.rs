use std::process::Command;

use crate::AutostartStatus;

const TASK_NAME: &str = "WorkInsightAgent";

pub fn task_name_starts_with_workinsight() -> bool {
    TASK_NAME.starts_with("WorkInsight")
}

/// Register a current-user Logon Trigger Task Scheduler task (no elevation,
/// no SYSTEM). Fails if the binary path does not exist.
pub fn register(binary_path: &str, delay_seconds: u32) -> Result<(), String> {
    if !std::path::Path::new(binary_path).exists() {
        return Err(format!("binary not found: {binary_path}"));
    }
    let xml = format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <Delay>PT{delay}S</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>"{binary_path}"</Command>
      <Arguments>--background</Arguments>
    </Exec>
  </Actions>
</Task>"#
    );
    let out = Command::new("schtasks")
        .args(["/Create", "/F", "/TN", TASK_NAME, "/XML", "-"])
        .stdin(std::process::Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!(
            "schtasks failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    let _ = xml;
    Ok(())
}

pub fn unregister() -> Result<(), String> {
    let out = Command::new("schtasks")
        .args(["/Delete", "/F", "/TN", TASK_NAME])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!(
            "schtasks delete failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(())
}

pub fn status() -> AutostartStatus {
    let out = Command::new("schtasks")
        .args(["/Query", "/TN", TASK_NAME])
        .output()
        .map_err(|e| e.to_string())
        .unwrap_or_default();
    if out.status.success() {
        AutostartStatus::Enabled
    } else {
        AutostartStatus::Disabled
    }
}
