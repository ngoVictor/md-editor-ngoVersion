//! Export sinks never change Markdown identity or dirty state.
#[tauri::command]
pub fn save_html(path: String, html: String) -> Result<(), String> {
    let extension = std::path::Path::new(&path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !["html", "htm"].contains(&extension.as_str()) {
        return Err("HTML export requires .html or .htm".into());
    }
    if html.len() > 16 * 1024 * 1024 {
        return Err("HTML export exceeds 16 MB".into());
    }
    super::write_atomic(&path, html.as_bytes(), None, true)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn html_export_is_utf8_atomic_and_cannot_overwrite_markdown() {
        let root = std::env::temp_dir().join(format!("md-html-export-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("test.HTML");
        let markdown = root.join("keep.md");
        std::fs::write(&markdown, "keep").unwrap();
        save_html(
            path.to_string_lossy().into_owned(),
            "<!doctype html>中文".into(),
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "<!doctype html>中文"
        );
        assert!(save_html(markdown.to_string_lossy().into_owned(), "overwrite".into()).is_err());
        assert_eq!(std::fs::read_to_string(&markdown).unwrap(), "keep");
        assert!(save_html(
            path.to_string_lossy().into_owned(),
            "x".repeat(16 * 1024 * 1024 + 1)
        )
        .is_err());
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "<!doctype html>中文"
        );
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 2);
        std::fs::remove_dir_all(root).unwrap();
    }
}
