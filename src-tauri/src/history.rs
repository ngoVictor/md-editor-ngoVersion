//! Immutable raw-byte archives, kept separate from editor undo and live documents.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

pub static DATA_ROOT: OnceLock<PathBuf> = OnceLock::new();
static SERIAL: AtomicU64 = AtomicU64::new(0);
const MAX_BYTES: u64 = 20 * 1024 * 1024;
const RETENTION_MS: u64 = 30 * 24 * 60 * 60 * 1000;
const MAX_TOTAL_BYTES: u64 = 64 * 1024 * 1024;
const MAGIC: &[u8; 8] = b"ALEIHST1";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub id: String,
    pub modified_ms: u64,
    pub encoding: String,
    pub size: u64,
}
#[derive(Serialize, Deserialize)]
struct Header {
    version: u8,
    path_key: String,
    info: VersionInfo,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn group(root: &Path, key: &str) -> PathBuf {
    root.join("history-v1")
        .join(format!("{:x}", Sha256::digest(key.as_bytes())))
}
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() < 100 && id.bytes().all(|b| b.is_ascii_digit() || b == b'-')
}
fn encoding(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        "UTF-8(BOM)"
    } else if std::str::from_utf8(bytes).is_ok() {
        "UTF-8"
    } else {
        "GBK"
    }
}
fn read_archive(path: &Path, key: &str, with_bytes: bool) -> Result<(Header, Vec<u8>), String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    if size > MAX_BYTES + 65548 {
        return Err("历史文件超过安全上限".into());
    }
    let mut prefix = [0u8; 12];
    file.read_exact(&mut prefix).map_err(|e| e.to_string())?;
    if &prefix[..8] != MAGIC {
        return Err("历史文件格式不受支持".into());
    }
    let length = u32::from_le_bytes(prefix[8..].try_into().unwrap()) as usize;
    if length > 65536 {
        return Err("历史文件元数据过大".into());
    }
    let mut metadata = vec![0; length];
    file.read_exact(&mut metadata).map_err(|e| e.to_string())?;
    let header: Header = serde_json::from_slice(&metadata).map_err(|e| e.to_string())?;
    if header.version != 1
        || header.path_key != key
        || header.info.size > MAX_BYTES
        || size != 12 + length as u64 + header.info.size
    {
        return Err("历史文件身份或长度校验失败".into());
    }
    let mut bytes = Vec::new();
    if with_bytes {
        file.take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
    }
    Ok((header, bytes))
}
pub fn list_at(root: &Path, key: &str) -> Result<Vec<VersionInfo>, String> {
    let dir = group(root, key);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|s| s.to_str()) != Some("version") {
            continue;
        }
        let (header, _) = read_archive(&path, key, false)?;
        if path.file_stem().and_then(|s| s.to_str()) != Some(header.info.id.as_str()) {
            return Err("历史文件标识校验失败".into());
        }
        entries.push(header.info);
    }
    entries.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then(b.id.cmp(&a.id)));
    Ok(entries)
}
pub fn prune_at(root: &Path, key: &str, now: u64) -> Result<(), String> {
    let mut kept = 0;
    let mut total = 0;
    for info in list_at(root, key)? {
        if now.saturating_sub(info.modified_ms) > RETENTION_MS
            || kept >= 50
            || total + info.size > MAX_TOTAL_BYTES
        {
            fs::remove_file(group(root, key).join(format!("{}.version", info.id)))
                .map_err(|e| e.to_string())?;
        } else {
            kept += 1;
            total += info.size;
        }
    }
    Ok(())
}
pub fn archive_at(root: &Path, key: &str, bytes: &[u8], now: u64) -> Result<(), String> {
    if bytes.len() as u64 > MAX_BYTES {
        return Err("历史内容超过 20 MB".into());
    }
    prune_at(root, key, now)?;
    if let Some(last) = list_at(root, key)?.first() {
        let (_, previous) = read_archive(
            &group(root, key).join(format!("{}.version", last.id)),
            key,
            true,
        )?;
        if previous == bytes {
            return Ok(());
        }
    }
    let dir = group(root, key);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let id = format!(
        "{now:020}-{}-{:020}",
        std::process::id(),
        SERIAL.fetch_add(1, Ordering::Relaxed)
    );
    let info = VersionInfo {
        id: id.clone(),
        modified_ms: now,
        encoding: encoding(bytes).into(),
        size: bytes.len() as u64,
    };
    let metadata = serde_json::to_vec(&Header {
        version: 1,
        path_key: key.into(),
        info,
    })
    .map_err(|e| e.to_string())?;
    if metadata.len() > 65536 {
        return Err("历史路径元数据过大".into());
    }
    let temp = dir.join(format!("{id}.tmp"));
    let target = dir.join(format!("{id}.version"));
    let result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        file.write_all(MAGIC).map_err(|e| e.to_string())?;
        file.write_all(&(metadata.len() as u32).to_le_bytes())
            .map_err(|e| e.to_string())?;
        file.write_all(&metadata).map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temp, target).map_err(|e| e.to_string())?;
        prune_at(root, key, now)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}
pub fn archive_before_save(
    root: Option<&Path>,
    path: &str,
    new_bytes: &[u8],
) -> Result<(), String> {
    let Some(root) = root else {
        return Ok(());
    }; // unit tests supply an explicit isolated root
    if !Path::new(path).exists() {
        return Ok(());
    }
    let snapshot = super::read_snapshot(path)?;
    if snapshot.bytes == new_bytes {
        return Ok(());
    }
    archive_at(root, &snapshot.path_key, &snapshot.bytes, now_ms())
        .map_err(|e| format!("历史归档失败，原文件未覆盖：{e}"))
}
#[tauri::command]
pub fn list_versions(path: String) -> Result<Vec<VersionInfo>, String> {
    if !super::has_allowed_ext(&path) {
        return Err("不支持的文件类型".into());
    }
    let root = DATA_ROOT.get().ok_or("历史目录未初始化")?;
    let key = super::path_key(&path)?;
    // Listing is read-only; retention runs as part of archive creation.
    list_at(root, &key)
}
#[tauri::command]
pub fn read_version(path: String, id: String) -> Result<String, String> {
    if !super::has_allowed_ext(&path) || !valid_id(&id) {
        return Err("历史版本参数无效".into());
    }
    let root = DATA_ROOT.get().ok_or("历史目录未初始化")?;
    let key = super::path_key(&path)?;
    let (_, bytes) = read_archive(&group(root, &key).join(format!("{id}.version")), &key, true)?;
    super::decode_markdown(&bytes).map(|(text, _)| text)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "alei-history-test-{}-{}",
            std::process::id(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        ))
    }
    #[test]
    fn raw_bytes_identity_and_unique_names() {
        let root = root();
        let gbk = [0xd6, 0xd0, 0xce, 0xc4];
        archive_at(&root, "a", &gbk, 1).unwrap();
        archive_at(&root, "a", b"two", 1).unwrap();
        archive_at(&root, "b", b"other", 1).unwrap();
        let versions = list_at(&root, "a").unwrap();
        assert_eq!(versions.len(), 2);
        assert_eq!(list_at(&root, "b").unwrap().len(), 1);
        let info = versions.iter().find(|i| i.encoding == "GBK").unwrap();
        assert_eq!(
            read_archive(
                &group(&root, "a").join(format!("{}.version", info.id)),
                "a",
                true
            )
            .unwrap()
            .1,
            gbk
        );
        assert!(read_archive(
            &group(&root, "a").join(format!("{}.version", info.id)),
            "b",
            true
        )
        .is_err());
        assert!(!valid_id("../../escape"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn deduplicate_and_actually_delete_expired_and_excess_files() {
        let root = root();
        archive_at(&root, "a", b"same", 1).unwrap();
        archive_at(&root, "a", b"same", 2).unwrap();
        assert_eq!(list_at(&root, "a").unwrap().len(), 1);
        prune_at(&root, "a", RETENTION_MS + 2).unwrap();
        assert!(list_at(&root, "a").unwrap().is_empty());
        for n in 0..55 {
            archive_at(&root, "a", &[n], 100 + u64::from(n)).unwrap();
        }
        assert_eq!(list_at(&root, "a").unwrap().len(), 50);
        assert_eq!(fs::read_dir(group(&root, "a")).unwrap().count(), 50);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn corrupt_archive_fails_visibly() {
        let root = root();
        archive_at(&root, "a", b"one", 1).unwrap();
        let info = list_at(&root, "a").unwrap().remove(0);
        fs::write(
            group(&root, "a").join(format!("{}.version", info.id)),
            b"broken",
        )
        .unwrap();
        assert!(list_at(&root, "a").is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
