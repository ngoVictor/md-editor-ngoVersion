//! PNG commit and independent, offline WebView2 system print windows.
use base64::Engine;
use std::{
    collections::HashMap,
    fs,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::Manager;
static WINDOWS: Mutex<Option<HashMap<String, tempfile::TempDir>>> = Mutex::new(None);
static NEXT: AtomicU64 = AtomicU64::new(0);
pub fn cleanup(label: &str) {
    if let Some(windows) = WINDOWS.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        windows.remove(label);
    }
}
#[tauri::command]
pub async fn save_png(path: String, data_base64: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::local_path::validate_local(&path)?;
        if !std::path::Path::new(&path)
            .extension()
            .is_some_and(|s| s.eq_ignore_ascii_case("png"))
            || data_base64.len() > 86 * 1024 * 1024
        {
            return Err("Invalid PNG destination or size".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data_base64)
            .map_err(|e| e.to_string())?;
        if bytes.len() < 24
            || bytes.len() > 64 * 1024 * 1024
            || !bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        {
            return Err("Invalid PNG data".into());
        }
        let w = u32::from_be_bytes(bytes[16..20].try_into().unwrap()) as u64;
        let h = u32::from_be_bytes(bytes[20..24].try_into().unwrap()) as u64;
        if w == 0 || h == 0 || w * h > 16_000_000 {
            return Err("PNG exceeds 16 megapixels".into());
        }
        crate::write_atomic(&path, &bytes, None, true)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn print_html(window: tauri::WebviewWindow, html: String) -> Result<(), String> {
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || open_print(&app, html))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(windows)]
fn open_print(app: &tauri::AppHandle, html: String) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_16, COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM,
    };
    use windows::core::Interface;
    if html.trim().is_empty() || html.len() > 16 * 1024 * 1024 {
        return Err("Print HTML limit: 16 MB".into());
    }
    let temp = tempfile::Builder::new()
        .prefix("md-editor-print-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let input = temp.path().join("print.html");
    let csp = r#"<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'">"#;
    fs::write(&input, format!("<!doctype html>{csp}{html}")).map_err(|e| e.to_string())?;
    let url = tauri::Url::from_file_path(input).map_err(|_| "Invalid print path")?;
    let expected = url.clone();
    let navigation = url.clone();
    let label = format!("print-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    {
        let mut state = WINDOWS.lock().map_err(|e| e.to_string())?;
        let entries = state.get_or_insert_with(HashMap::new);
        if entries.len() >= 4 {
            return Err("Close a print window before opening another (limit 4)".into());
        }
        entries.insert(label.clone(), temp);
    }
    let started = AtomicBool::new(false);
    let (tx, rx) = std::sync::mpsc::channel();
    let built = tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::External(url))
        .title("打印 / Print — 完成后关闭此窗口")
        .inner_size(1000.0, 760.0)
        .disable_javascript()
        .incognito(true)
        .on_navigation(move |url| url == &navigation)
        .on_page_load(move |window, payload| {
            if payload.event() != tauri::webview::PageLoadEvent::Finished
                || payload.url() != &expected
                || started.swap(true, Ordering::SeqCst)
            {
                return;
            }
            let result = tx.clone();
            let fallback = tx.clone();
            if let Err(e) = window.with_webview(move |webview| {
                let outcome = (|| -> windows::core::Result<()> {
                    unsafe {
                        let core: ICoreWebView2_16 = webview.controller().CoreWebView2()?.cast()?;
                        core.ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM)
                    }
                })();
                let _ = result.send(outcome.map_err(|e| e.to_string()));
            }) {
                let _ = fallback.send(Err(e.to_string()));
            }
        })
        .build();
    let window = match built {
        Ok(w) => w,
        Err(e) => {
            cleanup(&label);
            return Err(e.to_string());
        }
    };
    match rx
        .recv_timeout(std::time::Duration::from_secs(30))
        .map_err(|_| "Print dialog timed out".to_string())
        .and_then(|r| r)
    {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = window.destroy();
            cleanup(&label);
            Err(e)
        }
    }
}
#[cfg(not(windows))]
fn open_print(_: &tauri::AppHandle, _: String) -> Result<(), String> {
    Err("Printing requires WebView2".into())
}
