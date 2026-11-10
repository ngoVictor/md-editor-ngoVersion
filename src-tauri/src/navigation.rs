//! Read-only, one-directory-at-a-time navigation. No recursive native jobs or mutations.
use crate::local_path::validate_local;
use serde::Serialize;
use std::fs;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    name: String,
    path: String,
    directory: bool,
}
#[derive(Serialize)]
pub struct Listing {
    entries: Vec<Entry>,
    truncated: bool,
}
fn list(path: &str) -> Result<Listing, String> {
    validate_local(path)?;
    let path = fs::canonicalize(path).map_err(|e| e.to_string())?;
    let text = path.to_string_lossy();
    validate_local(text.strip_prefix("\\\\?\\").unwrap_or(&text))?;
    let mut entries = Vec::new();
    let mut truncated = false;
    for (visited, entry) in fs::read_dir(path).map_err(|e| e.to_string())?.enumerate() {
        if visited >= 2000 {
            truncated = true;
            break;
        }
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.')
            || ["node_modules", "target", "dist", "$RECYCLE.BIN"].contains(&name.as_str())
        {
            continue;
        }
        let Ok(metadata) = entry.path().symlink_metadata() else {
            continue;
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                continue;
            }
        }
        if !metadata.is_file() && !metadata.is_dir() {
            continue;
        }
        let entry_path = entry.path();
        let text = entry_path.to_string_lossy();
        entries.push(Entry {
            name,
            path: text.strip_prefix("\\\\?\\").unwrap_or(&text).into(),
            directory: metadata.is_dir(),
        });
    }
    entries.sort_by(|a, b| {
        b.directory
            .cmp(&a.directory)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(Listing { entries, truncated })
}
#[tauri::command]
pub async fn list_directory(path: String) -> Result<Listing, String> {
    tauri::async_runtime::spawn_blocking(move || list(&path))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn navigation_is_bounded_and_skips_build_folders() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("node_modules")).unwrap();
        fs::create_dir(dir.path().join("子目录")).unwrap();
        fs::write(dir.path().join("中 文.md"), "keep").unwrap();
        let result = list(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(result.entries.len(), 2);
        assert!(result.entries[0].directory);
        assert_eq!(
            fs::read_to_string(dir.path().join("中 文.md")).unwrap(),
            "keep"
        );
        assert!(list("\\\\server\\share").is_err());
    }
}
