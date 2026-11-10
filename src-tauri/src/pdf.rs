//! Snapshot PDF export: WebView2 rendering is isolated from atomic file commit.
use std::{fs, path::Path, sync::Mutex};
static PRINT_LOCK: Mutex<()> = Mutex::new(());
const MAX_HTML: usize = 16 * 1024 * 1024;
const MAX_PDF: u64 = 64 * 1024 * 1024;
fn validate_request(path: &str, html: &str) -> Result<(), String> {
    if !Path::new(path)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
    {
        return Err("PDF export requires .pdf".into());
    }
    if html.trim().is_empty() || html.len() > MAX_HTML {
        return Err("PDF input must be nonempty and at most 16 MB".into());
    }
    Ok(())
}
fn commit_pdf(path: &str, output: &Path) -> Result<(), String> {
    let size = fs::metadata(output)
        .map_err(|e| format!("PDF was not produced: {e}"))?
        .len();
    if size > MAX_PDF {
        return Err("PDF export exceeds 64 MB".into());
    }
    let bytes = fs::read(output).map_err(|e| e.to_string())?;
    if !bytes.starts_with(b"%PDF-") || !bytes.windows(5).rev().take(1024).any(|s| s == b"%%EOF") {
        return Err("PDF renderer produced an invalid file".into());
    }
    super::write_atomic(path, &bytes, None, true)
}
fn print_pdf(
    app: tauri::AppHandle,
    source: String,
    path: String,
    html: String,
) -> Result<(), String> {
    validate_request(&path, &html)?;
    let _lock = PRINT_LOCK
        .try_lock()
        .map_err(|_| "Another PDF export is running")?;
    let temp = tempfile::Builder::new()
        .prefix("md-editor-pdf-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let input = temp.path().join("input.html");
    let output = temp.path().join("output.pdf");
    // Defense in depth for resource loading; the frontend also removes active HTML.
    let csp = r#"<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'">"#;
    fs::write(&input, format!("<!doctype html>{csp}{html}")).map_err(|e| e.to_string())?;
    let url = tauri::Url::from_file_path(&input).map_err(|_| "Invalid PDF temporary path")?;
    super::pdf_webview::render(&app, &source, url, &output)?;
    commit_pdf(&path, &output)
}
#[tauri::command]
pub async fn render_pdf(
    window: tauri::WebviewWindow,
    path: String,
    html: String,
) -> Result<(), String> {
    use tauri::Manager;
    let app = window.app_handle().clone();
    let source = window.label().to_string();
    // Only the worker waits; COM and window work remain on the UI thread.
    tauri::async_runtime::spawn_blocking(move || print_pdf(app, source, path, html))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pdf_input_is_bounded_and_cannot_overwrite_markdown() {
        assert!(validate_request("keep.md", "html").is_err());
        assert!(validate_request("out.pdf", " ").is_err());
        assert!(validate_request("out.pdf", &"x".repeat(MAX_HTML + 1)).is_err());
        assert!(validate_request("out.PDF", "html").is_ok());
    }
    #[test]
    fn invalid_or_missing_pdf_preserves_destination() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("out.pdf");
        let output = dir.path().join("temporary.pdf");
        fs::write(&dest, "keep").unwrap();
        assert!(commit_pdf(dest.to_str().unwrap(), &output).is_err());
        fs::write(&output, "%PDF-truncated").unwrap();
        assert!(commit_pdf(dest.to_str().unwrap(), &output).is_err());
        assert_eq!(fs::read_to_string(dest).unwrap(), "keep");
    }
    #[test]
    fn successful_pdf_commit_is_atomic() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("out.pdf");
        let output = dir.path().join("temporary.pdf");
        fs::write(&dest, "old").unwrap();
        fs::write(&output, "%PDF-1.7\nfixture\n%%EOF\n").unwrap();
        commit_pdf(dest.to_str().unwrap(), &output).unwrap();
        assert_eq!(fs::read(dest).unwrap(), fs::read(output).unwrap());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
    }
}
