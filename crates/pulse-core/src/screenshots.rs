//! Trade screenshots (spec 3.1.4): image files kept in the `screenshots`
//! folder of the application data directory; a trade stores only the relative
//! path. The UI sends and receives images as base64 text.

use crate::error::{CoreError, Result};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub const DIR: &str = "screenshots";
pub const MAX_BYTES: usize = 15 * 1024 * 1024;

fn invalid<T>(msg: &str) -> Result<T> {
    Err(CoreError::Invalid(msg.into()))
}

/// (extension, MIME type, first bytes of a genuine file)
const FORMATS: [(&str, &str, &[u8]); 4] = [
    ("png", "image/png", b"\x89PNG\r\n\x1a\n"),
    ("jpg", "image/jpeg", b"\xff\xd8\xff"),
    ("webp", "image/webp", b"RIFF"),
    ("gif", "image/gif", b"GIF8"),
];

/// Saves an image sent as base64 and returns its path relative to `data_dir`.
/// The format is taken from the file contents, not from the name.
pub fn save_base64(data_dir: &Path, base64: &str) -> Result<String> {
    let bytes = decode(base64)?;
    if bytes.is_empty() {
        return invalid("the image is empty");
    }
    if bytes.len() > MAX_BYTES {
        return invalid("the image is larger than 15 MB");
    }
    let Some((ext, _, _)) = FORMATS.iter().find(|(_, _, magic)| bytes.starts_with(magic)) else {
        return invalid("unsupported image format (use PNG, JPEG, WebP or GIF)");
    };
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let name = format!("shot-{nanos}-{}.{ext}", COUNTER.fetch_add(1, Ordering::Relaxed));
    fs::create_dir_all(data_dir.join(DIR)).map_err(io)?;
    fs::write(data_dir.join(DIR).join(&name), bytes).map_err(io)?;
    Ok(format!("{DIR}/{name}"))
}

/// Reads a saved screenshot as a `data:` URL the UI can display.
pub fn read_data_url(data_dir: &Path, rel: &str) -> Result<String> {
    let (bytes, mime) = read_image(data_dir, rel)?;
    Ok(format!("data:{mime};base64,{}", encode(&bytes)))
}

/// Reads a saved screenshot and its MIME type (taken from the contents). Only files of the
/// `screenshots` folder can be read: the relative path is checked character by character.
pub fn read_image(data_dir: &Path, rel: &str) -> Result<(Vec<u8>, &'static str)> {
    let name = rel.strip_prefix("screenshots/").unwrap_or("");
    let safe = !name.is_empty()
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && !name.starts_with('.');
    if !safe {
        return invalid("invalid screenshot path");
    }
    let bytes = fs::read(data_dir.join(DIR).join(name)).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => CoreError::NotFound(format!("screenshot {rel}")),
        _ => io(e),
    })?;
    let mime = FORMATS
        .iter()
        .find(|(_, _, magic)| bytes.starts_with(magic))
        .map(|(_, mime, _)| *mime)
        .unwrap_or("application/octet-stream");
    Ok((bytes, mime))
}

fn io(e: std::io::Error) -> CoreError {
    CoreError::Invalid(format!("cannot access the screenshot file: {e}"))
}

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub(crate) fn encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// Accepts optional `data:...;base64,` prefix, padding and line breaks.
pub(crate) fn decode(input: &str) -> Result<Vec<u8>> {
    let body = input.split_once(',').filter(|(head, _)| head.starts_with("data:")).map_or(input, |(_, b)| b);
    let mut out = Vec::with_capacity(body.len() / 4 * 3);
    let (mut acc, mut bits) = (0u32, 0);
    for c in body.chars().filter(|c| !c.is_whitespace()).take_while(|&c| c != '=') {
        let v = ALPHABET.iter().position(|&a| a as char == c).ok_or_else(|| CoreError::Invalid("invalid base64 image".into()))?;
        acc = acc << 6 | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits & 0xff) as u8);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfake-but-recognizable";

    #[test]
    fn base64_matches_the_rfc_4648_vectors() {
        for (plain, coded) in [("", ""), ("f", "Zg=="), ("fo", "Zm8="), ("foo", "Zm9v"), ("foob", "Zm9vYg=="), ("fooba", "Zm9vYmE="), ("foobar", "Zm9vYmFy")] {
            assert_eq!(encode(plain.as_bytes()), coded);
            assert_eq!(decode(coded).unwrap(), plain.as_bytes());
        }
        assert_eq!(decode("data:image/png;base64,Zm9v").unwrap(), b"foo");
        assert!(decode("Zm9*").is_err());
    }

    #[test]
    fn saves_then_reads_back_the_same_image() {
        let dir = tempfile::tempdir().unwrap();
        let rel = save_base64(dir.path(), &encode(PNG)).unwrap();
        assert!(rel.starts_with("screenshots/shot-") && rel.ends_with(".png"));
        let url = read_data_url(dir.path(), &rel).unwrap();
        assert_eq!(url, format!("data:image/png;base64,{}", encode(PNG)));
        // Two saves never overwrite each other.
        assert_ne!(rel, save_base64(dir.path(), &encode(PNG)).unwrap());
    }

    #[test]
    fn refuses_non_images_and_empty_or_huge_files() {
        let dir = tempfile::tempdir().unwrap();
        assert!(save_base64(dir.path(), &encode(b"just text")).is_err());
        assert!(save_base64(dir.path(), "").is_err());
        let mut big = PNG.to_vec();
        big.resize(MAX_BYTES + 1, 0);
        assert!(save_base64(dir.path(), &encode(&big)).is_err());
    }

    #[test]
    fn reading_refuses_paths_outside_the_screenshot_folder() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("secret.txt"), "x").unwrap();
        for bad in ["../secret.txt", "screenshots/../secret.txt", "secret.txt", "/etc/passwd", "screenshots/", "screenshots/a/b.png", "screenshots/..\\x", "screenshots/.hidden"] {
            assert!(matches!(read_data_url(dir.path(), bad), Err(CoreError::Invalid(_))), "{bad}");
        }
        assert!(matches!(read_data_url(dir.path(), "screenshots/missing.png"), Err(CoreError::NotFound(_))));
    }
}
