use local_store::LocalStore;

#[test]
fn seq_persists_across_reopen() {
    let dir = std::env::temp_dir().join(format!("aw-seq-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("q.db");
    let _ = std::fs::remove_file(&path);
    {
        let mut s = LocalStore::open(path.to_str().unwrap()).unwrap();
        assert_eq!(s.reserve_sequence().unwrap(), 1);
    }
    {
        let mut s = LocalStore::open(path.to_str().unwrap()).unwrap();
        assert_eq!(s.reserve_sequence().unwrap(), 2, "watermark must persist");
    }
    let _ = std::fs::remove_file(&path);
}
