//! Bounded offline image reads for captured export snapshots. Never fetch a URL.
use crate::local_path::validate_local;
use base64::Engine;
use std::{fs, io::Read};
const MAX_IMAGE: u64 = 4 * 1024 * 1024;
fn image_path(source: Option<&str>, raw: &str) -> Result<std::path::PathBuf, String> {
    let value = raw.replace('\\', "/");
    if value.starts_with("//") {
        return Err("Network images are disabled".into());
    }
    let drive = value.as_bytes().get(1) == Some(&b':') && value.as_bytes().get(2) == Some(&b'/');
    let url = if drive {
        validate_local(&value)?;
        tauri::Url::parse(&format!("file:///{value}")).map_err(|e| e.to_string())?
    } else if value.to_ascii_lowercase().starts_with("file:") {
        tauri::Url::parse(&value).map_err(|e| e.to_string())?
    } else {
        if value.contains(':') {
            return Err("Only local images are supported".into());
        }
        let source = source.ok_or("Save document before using relative images")?;
        validate_local(source)?;
        tauri::Url::from_file_path(source)
            .map_err(|_| "Invalid source path")?
            .join(&value)
            .map_err(|e| e.to_string())?
    };
    if url.scheme() != "file"
        || url.host_str().is_some_and(|h| !h.is_empty())
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Unsupported image URL".into());
    }
    let path = url.to_file_path().map_err(|_| "Invalid local image path")?;
    validate_local(&path.to_string_lossy())?;
    Ok(path)
}
fn mime(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Ok("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Ok("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Ok("image/webp")
    } else {
        Err("Unsupported raster image (PNG/JPEG/GIF/WebP only)".into())
    }
}
#[tauri::command]
pub async fn read_export_image(
    source_path: Option<String>,
    reference: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || read_image(source_path.as_deref(), &reference))
        .await
        .map_err(|e| e.to_string())?
}
pub(crate) fn read_image(source: Option<&str>, reference: &str) -> Result<String, String> {
    let candidate = image_path(source, reference)?;
    let path = fs::canonicalize(candidate).map_err(|e| e.to_string())?;
    let readable = path.to_string_lossy();
    validate_local(readable.strip_prefix("\\\\?\\").unwrap_or(&readable))?;
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !["png", "jpg", "jpeg", "gif", "webp"].contains(&ext.as_str()) {
        return Err("Unsupported image extension".into());
    }
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > MAX_IMAGE {
        return Err("Image exceeds 4 MB".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_IMAGE + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_IMAGE {
        return Err("Image exceeds 4 MB".into());
    }
    Ok(format!(
        "data:{};base64,{}",
        mime(&bytes)?,
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths_use_snapshot_and_reject_network_devices_and_ads() {
        assert!(image_path(Some("D:/docs/a.md"), "https://example.com/a.png").is_err());
        for path in [
            "//server/a.png",
            "file://server/a.png",
            "D:/a.png:stream",
            "data:image/png;base64,AA",
            "a.png?x",
        ] {
            assert!(image_path(Some("D:/docs/a.md"), path).is_err(), "{path}");
        }
        assert_eq!(
            image_path(Some("D:/docs/a.md"), "../%E4%B8%AD%20%E6%96%87.png").unwrap(),
            std::path::PathBuf::from("D:/中 文.png")
        );
        assert!(image_path(None, "a.png").is_err());
    }
    #[test]
    fn raster_reads_reject_spoofs_and_large_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.png");
        fs::write(&path, b"<svg onload='alert(1)'/>").unwrap();
        assert!(read_image(None, path.to_str().unwrap()).is_err());
        fs::write(&path, b"\x89PNG\r\n\x1a\nfixture").unwrap();
        assert!(read_image(None, path.to_str().unwrap())
            .unwrap()
            .starts_with("data:image/png;base64,"));
        fs::File::create(&path)
            .unwrap()
            .set_len(MAX_IMAGE + 1)
            .unwrap();
        assert!(read_image(None, path.to_str().unwrap()).is_err());
    }
}

// Content-addressed assets are only created, never overwrite an existing resource.
fn write_asset(directory: &std::path::Path, data: &str) -> Result<std::path::PathBuf, String> {
    use sha2::{Digest, Sha256};
    use std::io::Write;
    if data.len() > 6 * 1024 * 1024 {
        return Err("Image exceeds 4 MB".into());
    }
    let (_, encoded) = data.split_once(";base64,").ok_or("Invalid image data")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_IMAGE {
        return Err("Image exceeds 4 MB".into());
    }
    let extension = match mime(&bytes)? {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        _ => "webp",
    };
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let canonical = fs::canonicalize(directory).map_err(|e| e.to_string())?;
    let readable = canonical.to_string_lossy();
    validate_local(readable.strip_prefix("\\\\?\\").unwrap_or(&readable))?;
    let target = directory.join(format!("{:x}.{extension}", Sha256::digest(&bytes)));
    if target.exists() {
        if fs::read(&target).map_err(|e| e.to_string())? == bytes {
            return Ok(target);
        }
        return Err("Asset name is occupied by different content".into());
    }
    let mut temp = tempfile::NamedTempFile::new_in(directory).map_err(|e| e.to_string())?;
    temp.write_all(&bytes).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    match temp.persist_noclobber(&target) {
        Ok(_) => Ok(target),
        Err(_) if fs::read(&target).ok().as_deref() == Some(&bytes) => Ok(target),
        Err(e) => Err(e.to_string()),
    }
}
#[tauri::command]
pub async fn store_image(
    app: tauri::AppHandle,
    source_path: Option<String>,
    data: String,
) -> Result<String, String> {
    use tauri::Manager;
    let staging = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("image-drafts");
    tauri::async_runtime::spawn_blocking(move || {
        let directory = if let Some(ref path) = source_path {
            validate_local(path)?;
            let path = std::path::Path::new(path);
            if !path.extension().is_some_and(|e| {
                ["md", "markdown", "mdown", "txt"]
                    .iter()
                    .any(|x| e.eq_ignore_ascii_case(x))
            }) {
                return Err("Invalid document extension".into());
            }
            path.parent()
                .ok_or("Missing document directory")?
                .join("assets")
        } else {
            staging
        };
        let path = write_asset(&directory, &data)?;
        if source_path.is_some() {
            Ok(format!(
                "assets/{}",
                path.file_name().unwrap().to_string_lossy()
            ))
        } else {
            tauri::Url::from_file_path(path)
                .map(|u| u.to_string())
                .map_err(|_| "Invalid asset path".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod asset_write_tests {
    use super::*;
    #[test]
    fn content_addressed_assets_are_reused_and_never_clobbered() {
        let dir = tempfile::tempdir().unwrap();
        let uri = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\nfixture")
        );
        let first = write_asset(dir.path(), &uri).unwrap();
        assert_eq!(write_asset(dir.path(), &uri).unwrap(), first);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
        fs::write(&first, "occupied").unwrap();
        assert!(write_asset(dir.path(), &uri).is_err());
        assert_eq!(fs::read_to_string(&first).unwrap(), "occupied");
        assert!(write_asset(dir.path(), "data:image/png;base64,aGVsbG8=").is_err());
    }
}
