//! Read-only link resources and explicitly selected code editors. Markdown writes stay unchanged.
use crate::local_path::validate_local;
use serde::Serialize;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use tauri_plugin_opener::OpenerExt;
const TEXT_EXTS: &[&str] = &[
    "ts",
    "tsx",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "rs",
    "py",
    "java",
    "c",
    "h",
    "cpp",
    "hpp",
    "cs",
    "go",
    "rb",
    "php",
    "swift",
    "kt",
    "kts",
    "vue",
    "svelte",
    "json",
    "jsonc",
    "toml",
    "yaml",
    "yml",
    "xml",
    "html",
    "htm",
    "css",
    "scss",
    "sass",
    "less",
    "sql",
    "sh",
    "ps1",
    "bat",
    "cmd",
    "ini",
    "cfg",
    "conf",
    "log",
    "csv",
    "gitignore",
    "gitattributes",
    "editorconfig",
    "env",
    "lock",
];
const EXTERNAL_EXTS: &[&str] = &[
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "png", "jpg",
    "jpeg", "gif", "webp", "bmp", "tif", "tiff", "ico", "svg",
];
const MAX_PREVIEW: u64 = 2 * 1024 * 1024;
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Document,
    Source,
    External,
    Directory,
}
#[derive(Serialize)]
pub struct Resource {
    pub(crate) path: String,
    pub(crate) kind: Kind,
}
fn file_kind(path: &Path) -> Result<Kind, String> {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ["md", "markdown", "mdown", "txt"].contains(&ext.as_str()) {
        return Ok(Kind::Document);
    }
    if TEXT_EXTS.contains(&ext.as_str())
        || [
            ".gitignore",
            ".gitattributes",
            ".editorconfig",
            ".env",
            "dockerfile",
            "makefile",
            "license",
        ]
        .contains(&name.as_str())
    {
        return Ok(Kind::Source);
    }
    if EXTERNAL_EXTS.contains(&ext.as_str()) {
        return Ok(Kind::External);
    }
    Err("不支持此文件类型；程序和快捷方式不能从文档链接运行 / Unsupported file type".into())
}
fn resolve(path: &str) -> Result<Resource, String> {
    validate_local(path)?;
    // Canonicalize first: a link named image.png must not launch a program through a symlink.
    let canonical = fs::canonicalize(path).map_err(|e| e.to_string())?;
    let display = canonical.to_string_lossy();
    let readable = display
        .strip_prefix("\\\\?\\")
        .unwrap_or(&display)
        .to_string();
    validate_local(&readable)?;
    let kind = if canonical.is_dir() {
        Kind::Directory
    } else if canonical.is_file() {
        file_kind(&canonical)?
    } else {
        return Err("Not a regular file or directory".into());
    };
    Ok(Resource {
        path: readable,
        kind,
    })
}
#[tauri::command]
pub fn inspect_link_resource(path: String) -> Result<Resource, String> {
    resolve(&path)
}
#[derive(Serialize)]
pub struct TextPreview {
    path: String,
    content: String,
    encoding: String,
}
#[tauri::command]
pub fn read_link_text(path: String) -> Result<TextPreview, String> {
    let resource = resolve(&path)?;
    if !matches!(resource.kind, Kind::Source | Kind::Document) {
        return Err("This file is not a text preview".into());
    }
    let file = fs::File::open(&resource.path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > MAX_PREVIEW {
        return Err("只读预览上限为 2 MB，请使用代码编辑器打开 / Preview exceeds 2 MB".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_PREVIEW + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_PREVIEW {
        return Err("Preview exceeds 2 MB".into());
    }
    let (content, encoding) = decode_text(&bytes)?;
    Ok(TextPreview {
        path: resource.path,
        content,
        encoding,
    })
}
fn decode_text(bytes: &[u8]) -> Result<(String, String), String> {
    let (content, encoding) =
        if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
            if !bytes.len().is_multiple_of(2) {
                return Err("Invalid UTF-16 text".into());
            }
            let little = bytes[0] == 0xff;
            let units = bytes[2..]
                .as_chunks::<2>()
                .0
                .iter()
                .map(|p| {
                    if little {
                        u16::from_le_bytes([p[0], p[1]])
                    } else {
                        u16::from_be_bytes([p[0], p[1]])
                    }
                })
                .collect::<Vec<_>>();
            (
                String::from_utf16(&units).map_err(|e| e.to_string())?,
                if little { "UTF-16LE" } else { "UTF-16BE" },
            )
        } else {
            let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
            match std::str::from_utf8(bytes) {
                Ok(text) => (text.into(), "UTF-8"),
                Err(_) => {
                    let (text, _, bad) = encoding_rs::GBK.decode(bytes);
                    if bad {
                        return Err("Unsupported text encoding".into());
                    }
                    (text.into_owned(), "GBK")
                }
            }
        };
    if content
        .chars()
        .any(|c| c == '\0' || (c.is_control() && !matches!(c, '\r' | '\n' | '\t' | '\u{000c}')))
    {
        return Err("Binary content cannot be previewed as text".into());
    }
    Ok((content, encoding.into()))
}
#[tauri::command]
pub fn open_link_resource(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let resource = resolve(&path)?;
    if !matches!(resource.kind, Kind::External | Kind::Directory) {
        return Err("Source files must use a code editor or read-only preview".into());
    }
    app.opener()
        .open_path(resource.path, None::<&str>)
        .map_err(|e| e.to_string())
}
fn editor_arguments(
    editor: &Path,
    path: &str,
    line: u32,
    column: u32,
) -> Result<Vec<String>, String> {
    let name = editor
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let line = line.clamp(1, 10_000_000);
    let column = column.clamp(1, 1_000_000);
    match name.as_str() {
        "code.exe" | "code - insiders.exe" | "cursor.exe" | "vscodium.exe" => {
            Ok(vec!["--goto".into(), format!("{path}:{line}:{column}")])
        }
        "notepad++.exe" => Ok(vec![
            format!("-n{line}"),
            format!("-c{column}"),
            path.into(),
        ]),
        "notepad.exe" => Ok(vec![path.into()]),
        _ => Err(
            "请选择 VS Code、Cursor、VSCodium、Notepad++ 或记事本 / Choose a supported text editor"
                .into(),
        ),
    }
}
#[tauri::command]
pub fn open_link_in_editor(
    path: String,
    editor: String,
    line: u32,
    column: u32,
) -> Result<(), String> {
    let resource = resolve(&path)?;
    if !matches!(resource.kind, Kind::Source | Kind::Document) {
        return Err("Not a source/text document".into());
    }
    validate_local(&editor)?;
    let exe = PathBuf::from(&editor);
    if !exe.is_file() {
        return Err("Selected code editor no longer exists".into());
    }
    let args = editor_arguments(&exe, &resource.path, line, column)?;
    let mut cmd = Command::new(exe);
    cmd.args(args)
        .env_remove("ELECTRON_RUN_AS_NODE")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.spawn().map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths_reject_unc_devices_ads_and_relative() {
        for path in [
            r"\\server\a.ts",
            r"\\?\C:\a.ts",
            r"C:\a.ts:payload",
            r"..\a.ts",
            r"C:a.ts",
        ] {
            assert!(validate_local(path).is_err(), "{path}");
        }
        assert!(validate_local(r"C:\code\中文 空格.ts").is_ok());
    }
    #[test]
    fn executable_links_never_become_default_application_targets() {
        for name in ["run.exe", "run.lnk", "run.url", "run.msi", "image.png.exe"] {
            assert!(file_kind(Path::new(name)).is_err());
        }
        for name in [
            "run.js",
            "run.py",
            "run.ps1",
            "run.bat",
            "config.json",
            ".gitignore",
        ] {
            assert_eq!(file_kind(Path::new(name)).unwrap(), Kind::Source);
        }
        assert_eq!(file_kind(Path::new("sample.pdf")).unwrap(), Kind::External);
    }
    #[test]
    fn text_decoding_preserves_whitespace_and_rejects_binary() {
        assert_eq!(decode_text(b"a\r\n  b\r\n").unwrap().0, "a\r\n  b\r\n");
        assert_eq!(decode_text(&[0xff, 0xfe, 0x2d, 0x4e]).unwrap().0, "中");
        assert_eq!(decode_text(&[0xd6, 0xd0]).unwrap().0, "中");
        assert!(decode_text(b"x\0y").is_err());
    }
    #[test]
    fn editor_arguments_are_separate_and_scripts_cannot_be_selected_as_editors() {
        assert_eq!(
            editor_arguments(Path::new("Code.exe"), r"C:\x y\a.ts", 12, 3).unwrap(),
            vec!["--goto", r"C:\x y\a.ts:12:3"]
        );
        assert!(editor_arguments(Path::new("powershell.exe"), "a.ts", 1, 1).is_err());
        assert!(editor_arguments(Path::new("cmd.exe"), "a.ts", 1, 1).is_err());
    }
    #[test]
    fn preview_limits_and_types_are_independent_from_markdown_writes() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("sample.ts");
        fs::write(&path, "const x = 1;\r\n").unwrap();
        let preview = read_link_text(path.to_string_lossy().into_owned()).unwrap();
        assert_eq!(preview.content, "const x = 1;\r\n");
        let f = fs::File::create(&path).unwrap();
        f.set_len(MAX_PREVIEW + 1).unwrap();
        assert!(read_link_text(path.to_string_lossy().into_owned()).is_err());
    }
}
