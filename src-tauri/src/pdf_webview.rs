//! A hidden, script-disabled WebView2 for one print snapshot, never the editor DOM.
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, Sender},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::Manager;
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Job {
    source: String,
    label: String,
    cancelled: Arc<AtomicBool>,
    result: Sender<Result<(), String>>,
}
static JOB: Mutex<Option<Job>> = Mutex::new(None);
pub fn cleanup_closed_window(app: &tauri::AppHandle, label: &str) {
    let target = {
        let jobs = JOB.lock().unwrap_or_else(|e| e.into_inner());
        jobs.as_ref()
            .filter(|job| job.source == label || job.label == label)
            .map(|job| {
                job.cancelled.store(true, Ordering::SeqCst);
                let _ = job.result.send(Err("PDF export window was closed".into()));
                job.label.clone()
            })
    };
    if let Some(target) = target.filter(|target| target != label) {
        if let Some(window) = app.get_webview_window(&target) {
            let _ = window.destroy();
        }
    }
}
struct PrintWindow {
    window: tauri::WebviewWindow,
}
impl Drop for PrintWindow {
    fn drop(&mut self) {
        JOB.lock().unwrap_or_else(|e| e.into_inner()).take();
        let _ = self.window.destroy();
    }
}
#[cfg(windows)]
pub fn render(
    app: &tauri::AppHandle,
    source: &str,
    url: tauri::Url,
    output: &Path,
) -> Result<(), String> {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{ICoreWebView2Environment6, ICoreWebView2_7},
        PrintToPdfCompletedHandler,
    };
    use windows::core::{Interface, HSTRING};
    let (tx, rx) = mpsc::channel();
    let cancelled = Arc::new(AtomicBool::new(false));
    let label = format!("pdf-export-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    *JOB.lock().map_err(|e| e.to_string())? = Some(Job {
        source: source.into(),
        label: label.clone(),
        cancelled: cancelled.clone(),
        result: tx.clone(),
    });
    let expected = url.clone();
    let navigation_url = url.clone();
    let output = output.to_path_buf();
    let started = AtomicBool::new(false);
    let flag = cancelled.clone();
    let built = tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::External(url))
        .title("PDF export")
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .inner_size(1000.0, 800.0)
        .disable_javascript()
        .incognito(true)
        .on_navigation(move |url| url == &navigation_url)
        .on_page_load(move |window, payload| {
            if payload.event() != tauri::webview::PageLoadEvent::Finished
                || payload.url() != &expected
                || started.swap(true, Ordering::SeqCst)
            {
                return;
            }
            if flag.load(Ordering::SeqCst) {
                return;
            }
            let result = tx.clone();
            let fallback = tx.clone();
            let output = output.clone();
            let flag = flag.clone();
            if let Err(error) = window.with_webview(move |webview| {
                if flag.load(Ordering::SeqCst) {
                    return;
                }
                let completed = result.clone();
                let start = (|| -> windows::core::Result<()> {
                    unsafe {
                        let core: ICoreWebView2_7 = webview.controller().CoreWebView2()?.cast()?;
                        let environment: ICoreWebView2Environment6 =
                            webview.environment().cast()?;
                        let settings = environment.CreatePrintSettings()?;
                        settings.SetShouldPrintBackgrounds(true)?;
                        settings.SetShouldPrintHeaderAndFooter(false)?;
                        settings.SetPageWidth(210.0 / 25.4)?;
                        settings.SetPageHeight(297.0 / 25.4)?;
                        let handler =
                            PrintToPdfCompletedHandler::create(Box::new(move |status, success| {
                                let outcome = status.map_err(|e| e.to_string()).and_then(|_| {
                                    if success {
                                        Ok(())
                                    } else {
                                        Err("WebView2 PDF printing failed".into())
                                    }
                                });
                                let _ = completed.send(outcome);
                                Ok(())
                            }));
                        core.PrintToPdf(&HSTRING::from(output.as_os_str()), &settings, &handler)
                    }
                })();
                if let Err(error) = start {
                    let _ = result.send(Err(format!("WebView2 PDF: {error}")));
                }
            }) {
                let _ = fallback.send(Err(error.to_string()));
            }
        })
        .build();
    let window = match built {
        Ok(window) => window,
        Err(error) => {
            JOB.lock().unwrap_or_else(|e| e.into_inner()).take();
            return Err(error.to_string());
        }
    };
    let _guard = PrintWindow { window };
    if cancelled.load(Ordering::SeqCst) || app.get_webview_window(source).is_none() {
        return Err("PDF export source was closed".into());
    }
    let result = rx
        .recv_timeout(Duration::from_secs(120))
        .map_err(|_| "PDF export timed out (120 seconds)".to_string())?;
    if cancelled.load(Ordering::SeqCst) {
        return Err("PDF export was cancelled".into());
    }
    result
}
#[cfg(not(windows))]
pub fn render(_: &tauri::AppHandle, _: &str, _: tauri::Url, _: &Path) -> Result<(), String> {
    Err("PDF export requires Windows WebView2 Runtime".into())
}
