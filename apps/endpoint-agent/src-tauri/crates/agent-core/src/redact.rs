pub fn redact_title(title: &str) -> String {
    if title.chars().count() > 256 {
        title.chars().take(256).collect()
    } else {
        title.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncates_long_title() {
        let t = "x".repeat(300);
        assert_eq!(redact_title(&t).chars().count(), 256);
    }
}
