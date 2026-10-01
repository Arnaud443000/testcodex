//! The commands shown in « Installation » (lot 37), built once here and tested. Syntax checked against
//! `claude mcp add --help` (Claude Code 2.1.285): `claude mcp add [options] <name> <commandOrUrl> [args...]`,
//! `-s, --scope <local|user|project>` (default `local` = this folder only), `claude mcp remove [-s] <name>`.
//!
//! `--scope user` makes the server available in every folder. Nothing follows the path unless Pulse's data
//! folder is not the one `pulse-mcp` finds by itself: then `--data-dir "…"` is added after it (the `--`
//! keeps those words for pulse-mcp).

use serde::Serialize;

pub const SERVER_NAME: &str = "pulse";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallCommand {
    /// Where pulse-mcp is expected (next to the app).
    pub exe_path: String,
    /// Whether the file is there (the interface explains the fallback otherwise).
    pub exe_found: bool,
    pub add: String,
    pub list: String,
    pub remove: String,
    /// `--data-dir` had to be added (Pulse's folder differs from pulse-mcp's default).
    pub with_data_dir: bool,
}

/// A path between double quotes (paths with spaces); a quote inside is escaped.
pub fn quote(path: &str) -> String {
    format!("\"{}\"", path.replace('"', "\\\""))
}

pub fn install_command(exe_path: &str, exe_found: bool, data_dir: &str, default_data_dir: Option<&str>) -> InstallCommand {
    let with_data_dir = default_data_dir != Some(data_dir);
    let mut add = format!("claude mcp add --scope user {SERVER_NAME} -- {}", quote(exe_path));
    if with_data_dir {
        add.push_str(&format!(" --data-dir {}", quote(data_dir)));
    }
    InstallCommand {
        exe_path: exe_path.to_owned(),
        exe_found,
        add,
        list: "claude mcp list".into(),
        remove: format!("claude mcp remove --scope user {SERVER_NAME}"),
        with_data_dir,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_command_quotes_paths_with_spaces_and_adds_the_folder_only_when_needed() {
        let exe = r"C:\Program Files\Pulse\pulse-mcp.exe";
        let dir = r"C:\Users\Anne Marie\AppData\Roaming\app.pulse.journal";
        let c = install_command(exe, true, dir, Some(dir));
        assert_eq!(c.add, r#"claude mcp add --scope user pulse -- "C:\Program Files\Pulse\pulse-mcp.exe""#);
        assert_eq!(c.remove, "claude mcp remove --scope user pulse");
        assert_eq!(c.list, "claude mcp list");
        assert!(!c.with_data_dir);
        let other = install_command(exe, false, r"D:\Pulse data", Some(dir));
        assert_eq!(other.add, r#"claude mcp add --scope user pulse -- "C:\Program Files\Pulse\pulse-mcp.exe" --data-dir "D:\Pulse data""#);
        assert!(other.with_data_dir && !other.exe_found);
        assert_eq!(quote(r#"/tmp/a"b"#), r#""/tmp/a\"b""#);
    }
}
