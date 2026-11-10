use base64::Engine as _;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
mod assets;
mod export;
mod history;
mod local_path;
mod navigation;
mod output;
mod pdf;
mod pdf_webview;
mod preview_windows;
mod resources;
mod windows;
static SAVE_LOCK: Mutex<()> = Mutex::new(());

/// 启动时从命令行参数传入的文件路径
struct StartupFile(Mutex<Option<String>>);

/// 允许打开/保存的扩展名（与前端 dialog/拖拽过滤口径一致）
const ALLOWED_EXTS: &[&str] = &["md", "markdown", "mdown", "txt"];

/// 打开文件大小上限：Vditor/WebView 不是为大文件设计，超限直接报错而不是拖死界面
const MAX_OPEN_BYTES: u64 = 20 * 1024 * 1024;
const MAX_DOCX_BYTES: usize = 64 * 1024 * 1024;
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

struct FileSnapshot {
    bytes: Vec<u8>,
    mtime_ms: u64,
    size: u64,
    path_key: String,
    fingerprint: String,
}

/// 路径扩展名是否在允许范围内（大小写不敏感）
fn has_allowed_ext(path: &str) -> bool {
    match std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
    {
        Some(ext) => ALLOWED_EXTS.iter().any(|a| a.eq_ignore_ascii_case(ext)),
        None => false,
    }
}

/// 从一组命令行参数中提取首个「扩展名合法且文件存在」的 markdown 路径。
/// 双击 .md 时 Windows 把路径作为参数传入；单实例二次启动转发时复用同一逻辑。
fn extract_md_from_args(mut args: impl Iterator<Item = String>) -> Option<String> {
    args.next(); // 跳过程序自身路径
    args.find(|a| has_allowed_ext(a) && std::path::Path::new(a).is_file())
}

/// 取本进程启动参数中的文件路径（前端 invoke 兜底读取用）
fn extract_md_arg() -> Option<String> {
    extract_md_from_args(std::env::args())
}

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn content_fingerprint(bytes: &[u8]) -> String {
    // FNV-1a 64-bit：不作为安全哈希，只作为本地并发修改检测的稳定内容身份。
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn path_key(path: &str) -> Result<String, String> {
    let input = Path::new(path);
    let resolved = fs::canonicalize(input)
        .or_else(|_| {
            let parent = input.parent().unwrap_or_else(|| Path::new("."));
            let file_name = input.file_name().ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::InvalidInput, "路径缺少文件名")
            })?;
            Ok::<PathBuf, std::io::Error>(fs::canonicalize(parent)?.join(file_name))
        })
        .map_err(|error| error.to_string())?;
    let normalized = resolved.to_string_lossy().replace('/', "\\");
    #[cfg(windows)]
    {
        Ok(normalized.to_lowercase())
    }
    #[cfg(not(windows))]
    {
        Ok(normalized)
    }
}

/// Identity without reading content, including a missing file in an existing directory.
#[tauri::command]
fn file_path_key(path: String) -> Result<String, String> {
    if !has_allowed_ext(&path) {
        return Err("不支持的文件类型（仅 md/markdown/mdown/txt）".into());
    }
    path_key(&path)
}

fn read_document_bytes(reader: impl Read, initial_size: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::with_capacity(initial_size.min(MAX_OPEN_BYTES) as usize);
    reader
        .take(MAX_OPEN_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_OPEN_BYTES {
        return Err("文件读取期间超过 20 MB 打开上限".into());
    }
    Ok(bytes)
}

fn read_once(path: &str) -> Result<FileSnapshot, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let before = file.metadata().map_err(|error| error.to_string())?;
    if before.len() > MAX_OPEN_BYTES {
        return Err(format!(
            "文件过大（{} MB），已超过 {} MB 打开上限",
            before.len() / 1024 / 1024,
            MAX_OPEN_BYTES / 1024 / 1024
        ));
    }
    let bytes = read_document_bytes(&file, before.len())?;
    let after = file.metadata().map_err(|error| error.to_string())?;
    if before.len() != after.len()
        || mtime_ms(&before) != mtime_ms(&after)
        || bytes.len() as u64 != after.len()
    {
        return Err("FILE_READ_CHANGED".into());
    }
    Ok(FileSnapshot {
        fingerprint: content_fingerprint(&bytes),
        bytes,
        mtime_ms: mtime_ms(&after),
        size: after.len(),
        path_key: path_key(path)?,
    })
}

fn read_snapshot(path: &str) -> Result<FileSnapshot, String> {
    // 连续两次读取内容指纹一致才提交快照。仅比较 mtime/size 会漏掉保留时间戳的同长度改写。
    for _ in 0..3 {
        let first = match read_once(path) {
            Ok(snapshot) => snapshot,
            Err(error) if error == "FILE_READ_CHANGED" => continue,
            Err(error) => return Err(error),
        };
        let second = match read_once(path) {
            Ok(snapshot) => snapshot,
            Err(error) if error == "FILE_READ_CHANGED" => continue,
            Err(error) => return Err(error),
        };
        if first.fingerprint == second.fingerprint
            && first.size == second.size
            && first.path_key == second.path_key
        {
            return Ok(second);
        }
    }
    Err("文件读取期间持续发生外部修改，请稍后重试".into())
}

pub(crate) fn decode_markdown(bytes: &[u8]) -> Result<(String, String), String> {
    if let Some(text) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8(text.to_vec())
            .map(|text| (text, "UTF-8(BOM)".into()))
            .map_err(|_| "UTF-8 BOM 文件包含无效字节，请先确认原文件编码".into());
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return Ok((text.into(), "UTF-8".into()));
    }
    let (text, bad) = encoding_rs::GBK.decode_without_bom_handling(bytes);
    if bad {
        return Err("文件无法按 UTF-8/GBK 无损解码，请先确认原文件编码".into());
    }
    Ok((text.into_owned(), "GBK".into()))
}

/// 一致性读取文件，自动探测编码：UTF-8 BOM / UTF-8 / 回落 GBK。
/// 返回正文、编码、mtime、size、规范路径身份和内容指纹。
#[tauri::command]
fn open_file(path: String) -> Result<(String, String, u64, u64, String, String), String> {
    if !has_allowed_ext(&path) {
        return Err("不支持的文件类型（仅 md/markdown/mdown/txt）".into());
    }
    let snapshot = read_snapshot(&path)?;
    let (content, enc) = decode_markdown(&snapshot.bytes)?;
    Ok((
        content,
        enc,
        snapshot.mtime_ms,
        snapshot.size,
        snapshot.path_key,
        snapshot.fingerprint,
    ))
}

/// 返回可选的一致磁盘基线；不存在返回 None，其他错误正常上抛。
#[tauri::command]
fn file_stat(path: String) -> Result<Option<(u64, u64, String, String)>, String> {
    if !has_allowed_ext(&path) {
        return Err("不支持的文件类型（仅 md/markdown/mdown/txt）".into());
    }
    if !Path::new(&path).exists() {
        return Ok(None);
    }
    let snapshot = read_snapshot(&path)?;
    Ok(Some((
        snapshot.mtime_ms,
        snapshot.size,
        snapshot.path_key,
        snapshot.fingerprint,
    )))
}

fn ensure_expected(path: &str, expected: Option<&str>, force: bool) -> Result<(), String> {
    if force {
        return Ok(());
    }
    match (expected, Path::new(path).exists()) {
        (None, false) => Ok(()),
        (None, true) => Err("FILE_CHANGED: 保存目标已存在或刚被创建".into()),
        (Some(_), false) => Err("FILE_CHANGED: 原文件已被删除或移动".into()),
        (Some(wanted), true) => {
            let actual = read_snapshot(path)?.fingerprint;
            if actual == wanted {
                Ok(())
            } else {
                Err("FILE_CHANGED: 文件内容已在外部改变".into())
            }
        }
    }
}

fn unique_temp_path(path: &str) -> Result<PathBuf, String> {
    let target = Path::new(path);
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let name = target
        .file_name()
        .and_then(|item| item.to_str())
        .ok_or("路径缺少文件名")?;
    for _ in 0..100 {
        let serial = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(".{name}.{}.{}.tmp", std::process::id(), serial));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("无法分配唯一临时文件名".into())
}

fn write_atomic(
    path: &str,
    bytes: &[u8],
    expected: Option<&str>,
    force: bool,
) -> Result<(), String> {
    ensure_expected(path, expected, force)?;
    let temp = unique_temp_path(path)?;
    let result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        ensure_expected(path, expected, force)?;
        fs::rename(&temp, path).map_err(|error| error.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

/// compare-and-save：期望指纹与写入在同一 Rust 命令中核对，并在 rename 前复核。
#[tauri::command]
fn save_file(
    path: String,
    content: String,
    allow_empty: bool,
    expected_fingerprint: Option<String>,
    force: bool,
) -> Result<(u64, u64, String, String), String> {
    save_file_with_history(
        path,
        content,
        allow_empty,
        expected_fingerprint,
        force,
        history::DATA_ROOT.get().map(PathBuf::as_path),
    )
}

fn save_file_with_history(
    path: String,
    content: String,
    allow_empty: bool,
    expected_fingerprint: Option<String>,
    force: bool,
    history_root: Option<&Path>,
) -> Result<(u64, u64, String, String), String> {
    let _guard = SAVE_LOCK.lock().map_err(|_| "保存队列不可用")?;
    if !has_allowed_ext(&path) {
        return Err("不支持的保存路径（仅 md/markdown/mdown/txt）".into());
    }
    // 防护：默认拒绝用空内容覆盖非空文件（Vditor IR 模式 getValue 在 lute/异步未就绪时可能返回空串，
    // 避免空写把原文件清零）。新文件（不存在）或原本就空的文件允许写空；前端显式确认清空时放行。
    if content.trim().is_empty()
        && !allow_empty
        && Path::new(&path).exists()
        && !read_snapshot(&path)?.bytes.is_empty()
    {
        return Err("拒绝写入空内容（原文件非空，疑似编辑器取值异常）".into());
    }
    if content.len() as u64 > MAX_OPEN_BYTES {
        return Err("保存内容超过 20 MB 安全上限".into());
    }
    ensure_expected(&path, expected_fingerprint.as_deref(), force)?;
    history::archive_before_save(history_root, &path, content.as_bytes())?;
    write_atomic(
        &path,
        content.as_bytes(),
        expected_fingerprint.as_deref(),
        force,
    )?;
    let snapshot = read_snapshot(&path)?;
    if snapshot.fingerprint != content_fingerprint(content.as_bytes()) {
        return Err("FILE_CHANGED: 文件在保存后被外部修改".into());
    }
    Ok((
        snapshot.mtime_ms,
        snapshot.size,
        snapshot.path_key,
        snapshot.fingerprint,
    ))
}

/// 取启动时命令行传入的文件路径（前端启动后 invoke 兜底读取）
#[tauri::command]
fn get_startup_file(state: tauri::State<StartupFile>) -> Option<String> {
    state.0.lock().ok()?.clone()
}

/// 写 docx 文件（导出 Word 用）：前端把 docx 字节 base64 编码后传入，解码写盘。
/// base64 传输与现有 save_file 的 String 模式一致（避免二进制 IPC 的兼容面）；
/// 与 save_file 一致采用临时文件 + rename 原子写，避免写入中断损坏已有 .docx。
#[tauri::command]
fn save_docx(path: String, data_base64: String) -> Result<(), String> {
    if !path.to_lowercase().ends_with(".docx") {
        return Err("不支持的导出路径（仅 .docx）".into());
    }
    if data_base64.trim().len() > MAX_DOCX_BYTES.div_ceil(3) * 4 {
        return Err("docx 数据超过 64 MB 安全写入上限".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.trim())
        .map_err(|e| format!("docx 数据解码失败：{e}"))?;
    if bytes.len() > MAX_DOCX_BYTES {
        return Err("docx 数据超过 64 MB 安全写入上限".into());
    }
    write_atomic(&path, &bytes, None, true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let startup = extract_md_arg();

    tauri::Builder::default()
        // 单实例必须第一个注册：程序已运行时再次双击 .md，把文件路径转发给已运行实例
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let file = extract_md_from_args(argv.iter().cloned());
            if let Some(f) = file {
                // 转发给前端（运行中场景）；同时写入 StartupFile——若主实例尚未完成
                // 前端监听注册（启动窗口期），boot 后 get_startup_file 兜底读取，事件不丢
                if let Ok(mut sf) = app.state::<StartupFile>().0.lock() {
                    *sf = Some(f.clone());
                }
                if let Some(w) = windows::editor_window(app) {
                    let _ = app.emit_to(w.label(), "open-file", f);
                }
            }
            // 无论二次启动是否带文件参数，都把主窗口唤起/聚焦：
            // 用户双击 exe 本体时不应"毫无反应"，文件转发场景也一并聚焦。
            if let Some(w) = windows::editor_window(app) {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        // 外链用系统默认浏览器打开。关闭 opener 自带的 JS 注入：链接点击由前端 link.ts 统一
        // 接管（内链滚动/外链 invoke plugin:opener|open_url），避免两套逻辑重复处理同一点击。
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .manage(windows::Transfers::default())
        .manage(preview_windows::Previews::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                windows::cleanup_closed_window(window.app_handle(), window.label());
                pdf_webview::cleanup_closed_window(window.app_handle(), window.label());
                preview_windows::cleanup(window.app_handle(), window.label());
                output::cleanup(window.label());
            }
        })
        .manage(StartupFile(Mutex::new(startup)))
        .setup(|app| {
            let root = app.path().app_local_data_dir()?;
            fs::create_dir_all(&root)?;
            let _ = history::DATA_ROOT.set(root);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_file,
            file_path_key,
            file_stat,
            save_file,
            save_docx,
            export::save_html,
            assets::read_export_image,
            assets::store_image,
            navigation::list_directory,
            output::save_png,
            output::print_html,
            pdf::render_pdf,
            preview_windows::open_source_preview,
            preview_windows::receive_source_preview,
            resources::inspect_link_resource,
            resources::read_link_text,
            resources::open_link_resource,
            resources::open_link_in_editor,
            history::list_versions,
            history::read_version,
            get_startup_file,
            windows::prepare_tab_window,
            windows::receive_tab,
            windows::tab_window_ready,
            windows::tab_transfer_status,
            windows::commit_tab_window,
            windows::finish_tab_receive,
            windows::abort_tab_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    // 测试产品代码本身（非镜像副本）：use super::* 直访私有函数，零可见性改动
    use super::*;
    use std::fs;

    #[test]
    fn identity_query_handles_deleted_documents_and_rejects_other_types() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("identity.md");
        fs::write(&path, "draft baseline").unwrap();
        let key = file_path_key(path.to_string_lossy().into_owned()).unwrap();
        fs::remove_file(&path).unwrap();
        assert_eq!(
            file_path_key(path.to_string_lossy().into_owned()).unwrap(),
            key
        );
        assert!(file_path_key(dir.path().join("run.exe").to_string_lossy().into_owned()).is_err());
    }

    #[test]
    fn document_read_is_bounded_even_if_initial_size_is_small() {
        let oversized = std::io::repeat(b'x');
        assert!(read_document_bytes(oversized, 1)
            .unwrap_err()
            .contains("上限"));
        assert_eq!(read_document_bytes(&b"small"[..], 1).unwrap(), b"small");
    }

    #[test]
    fn invalid_encodings_are_not_silently_replaced() {
        assert!(decode_markdown(&[0xef, 0xbb, 0xbf, 0xff]).is_err());
        assert!(decode_markdown(&[0x81]).is_err());
        assert_eq!(
            decode_markdown(&[0xd6, 0xd0]).unwrap(),
            ("中".into(), "GBK".into())
        );
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.md");
        let bytes = [0xef, 0xbb, 0xbf, 0xff];
        fs::write(&path, bytes).unwrap();
        assert!(open_file(path.to_string_lossy().into_owned()).is_err());
        assert_eq!(fs::read(path).unwrap(), bytes);
    }

    fn save_for_test(
        path: &Path,
        content: &str,
        allow_empty: bool,
    ) -> Result<(u64, u64, String, String), String> {
        let expected = if path.exists() {
            Some(read_snapshot(path.to_str().unwrap())?.fingerprint)
        } else {
            None
        };
        save_file(
            path.to_str().unwrap().to_string(),
            content.into(),
            allow_empty,
            expected,
            false,
        )
    }

    fn assert_no_temp_files(dir: &Path) {
        let leftovers: Vec<_> = fs::read_dir(dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "临时文件应被清理: {leftovers:?}");
    }

    #[test]
    fn ext_whitelist_normal() {
        for e in ["a.md", "a.markdown", "a.mdown", "a.txt"] {
            assert!(has_allowed_ext(e), "{e} 应通过");
        }
    }
    #[test]
    fn ext_uppercase_case_insensitive() {
        assert!(has_allowed_ext("README.MD"));
        assert!(has_allowed_ext("C:\\dir\\X.TXT"));
        assert!(has_allowed_ext("a.MdOwN"));
    }
    #[test]
    fn ext_no_extension_rejected() {
        assert!(!has_allowed_ext("README"));
        assert!(!has_allowed_ext(""));
    }
    #[test]
    fn ext_double_extension_rejected() {
        assert!(!has_allowed_ext("evil.md.exe"));
        assert!(!has_allowed_ext("evil.txt.bat"));
    }
    #[test]
    fn ext_dot_only_rejected() {
        assert!(!has_allowed_ext("."));
        assert!(!has_allowed_ext("file."));
    }
    #[test]
    fn ext_non_whitelisted_rejected() {
        assert!(!has_allowed_ext("a.docx"));
        assert!(!has_allowed_ext("a.html"));
        assert!(!has_allowed_ext("a.exe"));
    }
    #[test]
    fn ext_traversal_passes_ext_check() {
        // 路径穿越防护不在扩展名校验层（由前端正则+OS+用户选择兜底），此处仅验末段合法即通过
        assert!(has_allowed_ext("../evil.md"));
        assert!(!has_allowed_ext("../evil.exe"));
    }

    #[test]
    fn extract_picks_first_existing_md() {
        // 跳过程序名，取首个存在且扩展名合法的路径
        let dir = std::env::temp_dir().join("md_verify_extract");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let md = dir.join("real.md");
        fs::write(&md, "x").unwrap();
        let md_str = md.to_str().unwrap().to_string();
        let args = vec![
            "prog.exe".to_string(),
            "notexist.md".to_string(),
            md_str.clone(),
        ];
        assert_eq!(extract_md_from_args(args.into_iter()), Some(md_str));
        assert_eq!(
            extract_md_from_args(vec!["prog.exe".to_string()].into_iter()),
            None
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_atomic_overwrite_md() {
        let dir = std::env::temp_dir().join("md_verify_save1");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("a.md");
        fs::write(&p, "原内容").unwrap();
        save_for_test(&p, "新内容", false).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "新内容");
        assert_no_temp_files(&dir);
        let _ = fs::remove_dir_all(&dir);
    }
    #[test]
    fn save_refuses_non_whitelisted() {
        let dir = std::env::temp_dir().join("md_verify_save2");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("evil.exe");
        let err = save_for_test(&p, "x", false).unwrap_err();
        assert!(err.contains("不支持的保存路径"), "实际错误: {err}");
        assert!(!p.exists());
        let _ = fs::remove_dir_all(&dir);
    }
    #[test]
    fn save_refuses_double_ext() {
        let dir = std::env::temp_dir().join("md_verify_save3");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("trap.md.exe");
        assert!(save_for_test(&p, "x", false).is_err());
        assert!(!p.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    // ===== 以下移植自原 tests/logic.rs（镜像副本），改为直测产品函数，单一来源 =====
    fn tempdir() -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        let id = format!(
            "md_edit_test_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        p.push(id);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn ext_multi_dot_md_passes() {
        // 仅看最后一段扩展名：tar.md / notes.md 合法
        assert!(has_allowed_ext("archive.tar.md"));
        assert!(has_allowed_ext("my.notes.md"));
    }

    #[test]
    fn extract_skips_disallowed_and_nonexistent() {
        let dir = tempdir();
        let real = dir.join("real.md");
        fs::write(&real, "x").unwrap();
        let got = extract_md_from_args(
            vec![
                "prog.exe".into(),
                "F:/no/such.exe".into(),
                dir.join("noexist.md").to_str().unwrap().into(),
                real.to_str().unwrap().into(),
            ]
            .into_iter(),
        );
        assert_eq!(got.as_deref(), Some(real.to_str().unwrap()));
    }

    #[test]
    fn extract_none_when_all_illegal() {
        let got = extract_md_from_args(
            vec!["prog.exe".into(), "a.exe".into(), "b.html".into()].into_iter(),
        );
        assert!(got.is_none());
    }

    #[test]
    fn save_atomic_overwrite_existing() {
        let dir = tempdir();
        let p = dir.join("exist.md");
        let old: String = (0..100).map(|i| format!("OLD_LINE_{}\n", i)).collect();
        fs::write(&p, &old).unwrap();
        save_for_test(&p, "NEW_CONTENT", false).unwrap();
        let got = fs::read_to_string(&p).unwrap();
        assert_eq!(got, "NEW_CONTENT");
        assert!(!got.contains("OLD_LINE"));
        assert_no_temp_files(&dir);
    }

    #[test]
    fn save_atomic_no_bom_written() {
        let dir = tempdir();
        let p = dir.join("nobom.md");
        save_for_test(&p, "中文", false).unwrap();
        let bytes = fs::read(&p).unwrap();
        assert!(!bytes.starts_with(&[0xEF, 0xBB, 0xBF]), "不应写 BOM");
    }

    #[test]
    fn save_refuses_empty_overwrite_nonempty() {
        // P0-1：空内容不能覆盖非空文件
        let dir = tempdir();
        let p = dir.join("nonempty.md");
        fs::write(&p, "有内容").unwrap();
        let err = save_for_test(&p, "", false).unwrap_err();
        assert!(err.contains("拒绝写入空内容"), "实际错误: {err}");
        assert_eq!(fs::read_to_string(&p).unwrap(), "有内容"); // 原文件未被破坏
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_allows_empty_when_file_new() {
        // 新文件（不存在）允许写空
        let dir = tempdir();
        let p = dir.join("new.md");
        save_for_test(&p, "", false).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_allow_empty_overwrites_nonempty() {
        // allow_empty=true 时允许用空内容覆盖非空文件（前端「确认清空」后调用）
        let dir = tempdir();
        let p = dir.join("clear.md");
        fs::write(&p, "有内容").unwrap();
        save_for_test(&p, "", true).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_utf8_no_bom() {
        let dir = tempdir();
        let p = dir.join("a.md");
        fs::write(&p, "# 标题\n中文内容").unwrap();
        let (c, enc, _mtime, size, key, fingerprint) =
            open_file(p.to_str().unwrap().to_string()).unwrap();
        assert_eq!(enc, "UTF-8");
        assert_eq!(c, "# 标题\n中文内容");
        assert!(size > 0);
        assert!(!key.is_empty());
        assert!(!fingerprint.is_empty());
    }

    #[test]
    fn open_utf8_bom_stripped() {
        let dir = tempdir();
        let p = dir.join("b.md");
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("# 标题".as_bytes());
        fs::write(&p, &bytes).unwrap();
        let (c, enc, _mtime, _size, _key, _fingerprint) =
            open_file(p.to_str().unwrap().to_string()).unwrap();
        assert_eq!(enc, "UTF-8(BOM)");
        assert_eq!(c, "# 标题");
    }

    #[test]
    fn open_gbk_fallback() {
        let dir = tempdir();
        let p = dir.join("g.md");
        let (gbk, _, _) = encoding_rs::GBK.encode("中文");
        fs::write(&p, &*gbk).unwrap();
        let (c, enc, _mtime, _size, _key, _fingerprint) =
            open_file(p.to_str().unwrap().to_string()).unwrap();
        assert_eq!(enc, "GBK");
        assert_eq!(c, "中文");
    }

    #[test]
    fn open_empty_file_utf8() {
        let dir = tempdir();
        let p = dir.join("e.md");
        fs::write(&p, "").unwrap();
        let (c, enc, _mtime, _size, _key, _fingerprint) =
            open_file(p.to_str().unwrap().to_string()).unwrap();
        assert_eq!(enc, "UTF-8");
        assert_eq!(c, "");
    }

    #[test]
    fn save_docx_writes_decoded_bytes() {
        let dir = tempdir();
        let p = dir.join("out.docx");
        let payload = b"PK\x03\x04fake-docx-content";
        let b64 = base64::engine::general_purpose::STANDARD.encode(payload);
        save_docx(p.to_str().unwrap().to_string(), b64).unwrap();
        let written = fs::read(&p).unwrap();
        assert_eq!(written, payload, "写入内容应为 base64 解码后的原始字节");
        assert_no_temp_files(&dir);
    }

    #[test]
    fn save_docx_rejects_non_docx() {
        let dir = tempdir();
        let p = dir.join("out.md");
        let b64 = base64::engine::general_purpose::STANDARD.encode(b"x");
        let r = save_docx(p.to_str().unwrap().to_string(), b64);
        assert!(r.is_err(), "非 .docx 扩展名应被拒绝");
        assert!(!p.exists(), "拒绝时不应写文件");
    }

    #[test]
    fn save_docx_rejects_bad_base64() {
        let dir = tempdir();
        let p = dir.join("out.docx");
        let r = save_docx(p.to_str().unwrap().to_string(), "!!!not-base64!!!".into());
        assert!(r.is_err(), "非法 base64 应报错");
        assert!(!p.exists());
    }

    #[test]
    fn file_stat_reports_size_and_mtime() {
        let dir = tempdir();
        let p = dir.join("stat.md");
        fs::write(&p, "abc").unwrap();
        let (mtime, size, key, fingerprint) =
            file_stat(p.to_str().unwrap().to_string()).unwrap().unwrap();
        assert_eq!(size, 3);
        assert!(mtime > 0, "mtime 应为 Unix 毫秒时间戳");
        assert!(!key.is_empty());
        assert_eq!(fingerprint, content_fingerprint(b"abc"));
        assert!(file_stat(dir.join("stat.exe").to_str().unwrap().to_string()).is_err());
    }

    #[test]
    fn file_stat_missing_returns_none() {
        let dir = tempdir();
        let p = dir.join("missing.md");
        assert!(file_stat(p.to_str().unwrap().to_string())
            .unwrap()
            .is_none());
    }

    #[test]
    fn compare_and_save_rejects_external_change_even_same_size() {
        let dir = tempdir();
        let p = dir.join("conflict.md");
        fs::write(&p, "AAAA").unwrap();
        let expected = read_snapshot(p.to_str().unwrap()).unwrap().fingerprint;
        fs::write(&p, "BBBB").unwrap();
        let error = save_file(
            p.to_str().unwrap().to_string(),
            "LOCAL".into(),
            false,
            Some(expected),
            false,
        )
        .unwrap_err();
        assert!(error.contains("FILE_CHANGED"));
        assert_eq!(fs::read_to_string(&p).unwrap(), "BBBB");
    }

    #[test]
    fn compare_and_save_rejects_unexpected_existing_target() {
        let dir = tempdir();
        let p = dir.join("appeared.md");
        fs::write(&p, "external").unwrap();
        let error = save_file(
            p.to_str().unwrap().to_string(),
            "local".into(),
            false,
            None,
            false,
        )
        .unwrap_err();
        assert!(error.contains("FILE_CHANGED"));
        assert_eq!(fs::read_to_string(&p).unwrap(), "external");
    }

    #[test]
    fn compare_and_save_force_overwrites_conflict() {
        let dir = tempdir();
        let p = dir.join("force.md");
        fs::write(&p, "external").unwrap();
        save_file(
            p.to_str().unwrap().to_string(),
            "local".into(),
            false,
            Some("stale".into()),
            true,
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "local");
        assert_no_temp_files(&dir);
    }

    #[test]
    fn path_key_collapses_dot_segments() {
        let dir = tempdir();
        let p = dir.join("identity.md");
        fs::write(&p, "x").unwrap();
        let alias = dir.join(".").join("identity.md");
        assert_eq!(
            path_key(p.to_str().unwrap()).unwrap(),
            path_key(alias.to_str().unwrap()).unwrap()
        );
    }

    #[test]
    fn open_rejects_oversized_file() {
        let dir = tempdir();
        let p = dir.join("huge.md");
        let f = fs::File::create(&p).unwrap();
        f.set_len(MAX_OPEN_BYTES + 1).unwrap();
        let err = open_file(p.to_str().unwrap().to_string()).unwrap_err();
        assert!(err.contains("文件过大"), "实际错误: {err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_archives_raw_gbk_and_archive_failure_does_not_overwrite() {
        let dir = tempdir();
        let path = dir.join("gbk.md");
        let root = dir.join("archives");
        fs::write(&path, [0xd6, 0xd0, 0xce, 0xc4]).unwrap();
        let before = read_snapshot(path.to_str().unwrap()).unwrap();
        save_file_with_history(
            path.to_string_lossy().into_owned(),
            "new".into(),
            false,
            Some(before.fingerprint),
            false,
            Some(&root),
        )
        .unwrap();
        let versions = history::list_at(&root, &before.path_key).unwrap();
        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0].encoding, "GBK");
        let blocked = dir.join("not-a-directory");
        fs::write(&blocked, b"block").unwrap();
        let error = save_file_with_history(
            path.to_string_lossy().into_owned(),
            "must not write".into(),
            false,
            Some(content_fingerprint(b"new")),
            false,
            Some(&blocked),
        )
        .unwrap_err();
        assert!(error.contains("归档失败"));
        assert_eq!(fs::read(&path).unwrap(), b"new");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn whitespace_clear_requires_explicit_confirmation() {
        let dir = tempdir();
        let path = dir.join("space.md");
        fs::write(&path, "keep").unwrap();
        assert!(save_file(
            path.to_string_lossy().into_owned(),
            "\n".into(),
            false,
            Some(content_fingerprint(b"keep")),
            false
        )
        .is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "keep");
        fs::remove_dir_all(dir).unwrap();
    }
}
