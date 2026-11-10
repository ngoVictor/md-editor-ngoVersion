// Shared local-drive path policy; no resource classification or IO.
pub fn validate_local(path: &str) -> Result<(), String> {
    let value = path.replace('/', "\\");
    let bytes = value.as_bytes();
    if bytes.len() < 3
        || !bytes[0].is_ascii_alphabetic()
        || bytes[1] != b':'
        || bytes[2] != b'\\'
        || value[2..].contains(':')
        || value
            .chars()
            .any(|c| c.is_control() || matches!(c, '<' | '>' | '"' | '|' | '?' | '*'))
    {
        return Err("Only local drive paths are supported".into());
    }
    Ok(())
}
