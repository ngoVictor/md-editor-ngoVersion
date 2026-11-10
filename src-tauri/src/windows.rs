//! In-memory two-phase tab handoff. Only the source can commit/abort;
//! only the newly created window can read its payload and acknowledge readiness.
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use tauri::{Manager, WebviewWindow};

struct Transfer {
    source: String,
    payload: Value,
    ready: bool,
    committed: bool,
}
#[derive(Default)]
pub struct Transfers(Mutex<HashMap<String, Transfer>>);
static NEXT: AtomicU64 = AtomicU64::new(0);

// A closed/crashed source must not leave an invisible orphan holding document text.
pub fn cleanup_closed_window(app: &tauri::AppHandle, label: &str) {
    let state = app.state::<Transfers>();
    let Ok(mut entries) = state.0.lock() else {
        return;
    };
    let abandoned: Vec<String> = entries
        .iter()
        .filter(|(_, t)| t.source == label && !t.committed)
        .map(|(key, _)| key.clone())
        .collect();
    entries.retain(|key, t| key != label && (t.source != label || t.committed));
    drop(entries);
    for target in abandoned {
        if let Some(window) = app.get_webview_window(&target) {
            let _ = window.destroy();
        }
    }
}

#[tauri::command]
pub async fn prepare_tab_window(
    window: WebviewWindow,
    payload: Value,
    state: tauri::State<'_, Transfers>,
) -> Result<String, String> {
    if serde_json::to_vec(&payload)
        .map_err(|e| e.to_string())?
        .len()
        > 96 * 1024 * 1024
    {
        return Err("Tab transfer exceeds 96 MB".into());
    }
    let label = format!("detached-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    {
        let mut entries = state.0.lock().map_err(|e| e.to_string())?;
        if entries.values().any(|t| t.source == window.label()) {
            return Err("Transfer already in progress".into());
        }
        entries.insert(
            label.clone(),
            Transfer {
                source: window.label().into(),
                payload,
                ready: false,
                committed: false,
            },
        );
    }
    let built = tauri::WebviewWindowBuilder::new(
        window.app_handle(),
        &label,
        tauri::WebviewUrl::App("index.html?detached=1".into()),
    )
    .title("MD 编辑器")
    .inner_size(1200.0, 800.0)
    .min_inner_size(800.0, 500.0)
    .visible(false)
    .build();
    if let Err(error) = built {
        state.0.lock().map_err(|e| e.to_string())?.remove(&label);
        return Err(error.to_string());
    }
    Ok(label)
}

#[tauri::command]
pub fn receive_tab(window: WebviewWindow, state: tauri::State<Transfers>) -> Result<Value, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(window.label())
        .map(|t| t.payload.clone())
        .ok_or("Transfer not found".into())
}

#[tauri::command]
pub fn tab_window_ready(
    window: WebviewWindow,
    state: tauri::State<Transfers>,
) -> Result<(), String> {
    let mut entries = state.0.lock().map_err(|e| e.to_string())?;
    entries
        .get_mut(window.label())
        .ok_or("Transfer not found")?
        .ready = true;
    Ok(())
}

#[tauri::command]
pub fn tab_transfer_status(
    window: WebviewWindow,
    label: String,
    state: tauri::State<Transfers>,
) -> Result<bool, String> {
    let entries = state.0.lock().map_err(|e| e.to_string())?;
    let t = entries.get(&label).ok_or("Transfer not found")?;
    if t.source != window.label() {
        return Err("Wrong source window".into());
    }
    Ok(t.ready)
}

#[tauri::command]
pub fn commit_tab_window(
    window: WebviewWindow,
    label: String,
    state: tauri::State<Transfers>,
) -> Result<(), String> {
    let mut entries = state.0.lock().map_err(|e| e.to_string())?;
    let t = entries.get_mut(&label).ok_or("Transfer not found")?;
    if t.source != window.label() || !t.ready {
        return Err("Window is not ready".into());
    }
    let target = window
        .app_handle()
        .get_webview_window(&label)
        .ok_or("Window closed")?;
    target.show().map_err(|e| e.to_string())?;
    t.committed = true;
    let _ = target.set_focus();
    Ok(())
}

#[tauri::command]
pub fn finish_tab_receive(
    window: WebviewWindow,
    state: tauri::State<Transfers>,
) -> Result<bool, String> {
    let mut entries = state.0.lock().map_err(|e| e.to_string())?;
    if !entries
        .get(window.label())
        .ok_or("Transfer not found")?
        .committed
    {
        return Ok(false);
    }
    entries.remove(window.label());
    Ok(true)
}

#[tauri::command]
pub fn abort_tab_window(
    window: WebviewWindow,
    label: String,
    state: tauri::State<Transfers>,
) -> Result<(), String> {
    let entries = state.0.lock().map_err(|e| e.to_string())?;
    let Some(t) = entries.get(&label) else {
        return Ok(());
    };
    if t.source != window.label() || t.committed {
        return Err("Transfer cannot be aborted".into());
    }
    drop(entries);
    if let Some(target) = window.app_handle().get_webview_window(&label) {
        target.destroy().map_err(|e| e.to_string())?;
    }
    state.0.lock().map_err(|e| e.to_string())?.remove(&label);
    Ok(())
}

// Previews and PDF renderer windows must never receive Markdown file-open events.
pub fn editor_window(app: &tauri::AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
        .or_else(|| {
            app.webview_windows()
                .into_values()
                .find(|w| w.label().starts_with("detached-") && w.is_visible().unwrap_or(false))
        })
        .or_else(|| {
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("MD 编辑器")
            .inner_size(1200.0, 800.0)
            .min_inner_size(800.0, 500.0)
            .build()
            .ok()
        })
}
