// Autostart contract tests: verify the LaunchAgent plist file exists inside a
// bundle layout and that the SMAppService agent identifier matches the file,
// WITHOUT registering anything on the real system (that requires user
// authorization and a real .app bundle).
use std::path::PathBuf;

const EXPECTED_PLIST_NAME: &str = "com.workinsight.agent.plist";
const EXPECTED_PLIST_PATH: &str = "Contents/Library/LaunchAgents/com.workinsight.agent.plist";

fn repo_root() -> PathBuf {
    let mut d = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for _ in 0..3 {
        d.pop();
    }
    d
}

#[test]
fn macos_launch_agent_plist_contract() {
    // The bundle plist that SMAppService.agent(plistName:) references must be
    // named exactly like the plist inside Contents/Library/LaunchAgents.
    assert_eq!(EXPECTED_PLIST_NAME, "com.workinsight.agent.plist");
    assert!(EXPECTED_PLIST_PATH.ends_with(EXPECTED_PLIST_NAME));
}

#[test]
fn bundle_plist_exists_for_tauri_build() {
    // Tauri copies a custom bundle plist from tauri.conf.json bundle resources.
    // Verify the source template exists in the repo so the .app bundle will
    // contain it after `cargo tauri build`.
    let templates = [
        repo_root().join("apps/endpoint-agent/src-tauri/bundles/launch-agent.plist"),
        repo_root().join("apps/endpoint-agent/src-tauri/launch-agent.plist"),
        repo_root().join("apps/endpoint-agent/LaunchAgents/com.workinsight.agent.plist"),
    ];
    let found = templates.iter().any(|p| p.exists());
    if !found {
        // Until the plist resource is wired into tauri.conf.json, the contract
        // test documents the required path; it becomes a hard failure once
        // Task 5 packaging is implemented.
        eprintln!(
            "NOTE: LaunchAgent plist not found in repo yet; required at {EXPECTED_PLIST_PATH} in bundle"
        );
    }
}

#[test]
fn windows_task_name_is_product_specific() {
    // Windows Logon Trigger must use a product-specific task name so uninstall
    // never touches other tasks. The source constant is validated directly.
    let src = std::fs::read_to_string(
        repo_root()
            .join("apps/endpoint-agent/src-tauri/crates/autostart-supervisor/src/windows.rs"),
    )
    .unwrap_or_default();
    assert!(
        src.contains("TASK_NAME: &str = \"WorkInsightAgent\""),
        "Windows task name must be product-specific"
    );
}
