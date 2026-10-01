//! `pulse-mcp`: started by the user's MCP client (for example `claude mcp add pulse -- "…\pulse-mcp.exe"`).
//! Stdout carries the protocol only; messages for humans go to stderr.

use pulse_mcp::{server, BridgeBackend};
use std::io::{self, BufReader, Write};
use std::path::PathBuf;
use std::process::ExitCode;

const HELP: &str = "pulse-mcp — serveur MCP local et en lecture seule de Pulse (lot 37).

À lancer par votre client MCP, pas à la main. Exemple avec Claude Code :
  claude mcp add --scope user pulse -- \"C:\\Program Files\\Pulse\\pulse-mcp.exe\"

Options :
  --data-dir <dossier>   dossier de données de Pulse (par défaut : celui de l'application)
  --version              affiche la version
  --help                 affiche cette aide

L'accès doit être activé dans Pulse (Paramètres > Accès MCP (Claude Code)).";

fn main() -> ExitCode {
    let mut args = std::env::args_os().skip(1);
    let mut data_dir: Option<PathBuf> = None;
    while let Some(arg) = args.next() {
        match arg.to_str() {
            Some("--help" | "-h") => {
                println!("{HELP}");
                return ExitCode::SUCCESS;
            }
            Some("--version" | "-V") => {
                println!("pulse-mcp {}", env!("CARGO_PKG_VERSION"));
                return ExitCode::SUCCESS;
            }
            Some("--data-dir") => match args.next() {
                Some(dir) => data_dir = Some(PathBuf::from(dir)),
                None => {
                    eprintln!("pulse-mcp : --data-dir attend un dossier.");
                    return ExitCode::from(2);
                }
            },
            _ => {
                eprintln!("pulse-mcp : argument inconnu {:?} (voir --help).", arg);
                return ExitCode::from(2);
            }
        }
    }
    let Some(data_dir) = data_dir.or_else(pulse_mcp::default_data_dir) else {
        eprintln!("pulse-mcp : dossier de données introuvable ; précisez --data-dir.");
        return ExitCode::from(2);
    };
    let backend = BridgeBackend::new(&data_dir);
    let stdin = io::stdin();
    let result = server::serve(BufReader::new(stdin.lock()), io::stdout().lock(), &backend, io::stderr());
    let _ = io::stderr().flush();
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("pulse-mcp : arrêt ({e}).");
            ExitCode::FAILURE
        }
    }
}
