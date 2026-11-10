//! Independent read-only windows. Payloads contain paths/positions only, never document drafts.
use crate::resources::{inspect_link_resource, Kind};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{Manager, WebviewWindow};
const MAX_WINDOWS: usize = 12;
static NEXT: AtomicU64 = AtomicU64::new(0);
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    path: String,
    line: u32,
    column: u32,
    initial_error: String,
    lang: String,
}
impl Request {
    fn validate(&self) -> Result<(), String> {
        if self.line == 0
            || self.line > 10_000_000
            || self.column == 0
            || self.column > 1_000_000
            || self.path.len() > 32768
            || self.initial_error.len() > 8192
            || !["zh-CN", "zh-TW", "en"].contains(&self.lang.as_str())
        {
            return Err("Invalid preview request".into());
        }
        Ok(())
    }
}
#[derive(Default)]
pub struct Previews(Mutex<HashMap<String, Request>>);
pub fn cleanup(app: &tauri::AppHandle, label: &str) {
    app.state::<Previews>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(label);
}
#[tauri::command]
pub async fn open_source_preview(
    window: WebviewWindow,
    mut request: Request,
    state: tauri::State<'_, Previews>,
) -> Result<(), String> {
    if window.label() != "main" && !window.label().starts_with("detached-") {
        return Err("Only editor windows can open previews".into());
    }
    request.validate()?;
    let resource = inspect_link_resource(request.path.clone())?;
    if !matches!(resource.kind, Kind::Source | Kind::Document) {
        return Err("Only text resources can be previewed".into());
    }
    request.path = resource.path;
    let title = format!(
        "{} — {}",
        std::path::Path::new(&request.path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy(),
        match request.lang.as_str() {
            "en" => "Read-only preview",
            "zh-TW" => "唯讀預覽",
            _ => "只读预览",
        }
    );
    let label = format!("preview-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    {
        let mut entries = state.0.lock().map_err(|e| e.to_string())?;
        if entries.len() >= MAX_WINDOWS {
            return Err(
                "最多同时打开 12 个预览窗口，请先关闭不需要的窗口 / Preview window limit: 12"
                    .into(),
            );
        }
        entries.insert(label.clone(), request);
    }
    // No parent/owner and no always-on-top: the editor remains independently usable.
    let built = tauri::WebviewWindowBuilder::new(
        window.app_handle(),
        &label,
        tauri::WebviewUrl::App("preview.html".into()),
    )
    .title(title)
    .inner_size(1000.0, 700.0)
    .min_inner_size(520.0, 360.0)
    .resizable(true)
    .decorations(true)
    .always_on_top(false)
    .center()
    .build();
    if let Err(error) = built {
        state
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&label);
        return Err(error.to_string());
    }
    Ok(())
}
#[tauri::command]
pub fn receive_source_preview(
    window: WebviewWindow,
    state: tauri::State<Previews>,
) -> Result<Request, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(window.label())
        .cloned()
        .ok_or("Preview request not found".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requests_reject_unbounded_positions_payloads_and_invalid_language() {
        let mut request = Request {
            path: "D:/file.ts".into(),
            line: 1,
            column: 1,
            initial_error: String::new(),
            lang: "zh-CN".into(),
        };
        assert!(request.validate().is_ok());
        request.line = 0;
        assert!(request.validate().is_err());
        request.line = 1;
        request.initial_error = "x".repeat(8193);
        assert!(request.validate().is_err());
        request.initial_error.clear();
        request.lang = "invalid".into();
        assert!(request.validate().is_err());
    }
}
