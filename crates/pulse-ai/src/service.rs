//! The screenshot analysis end to end, in three steps so the database lock is never held
//! during the network call:
//! 1. [`prepare_analysis`] (database): option on, consent given and confirmed, screenshot there
//!    and under the API limit; builds the request from `pulse_core::ai` only.
//! 2. [`run_analysis`] (no database): reads the key from the vault, calls the provider.
//! 3. [`store_analysis`] (database): saves the comment.
//!
//! Every check that can fail without the network comes first: when the option is off, neither
//! the vault nor the provider is touched.

use crate::{AiError, AnalysisReply, ImageRequest, Provider};
use pulse_core::ai::{self, AnalysisPrompt, ImagePayload, NewScreenshotNote, ScreenshotImage, ScreenshotNote, SentFieldKey};
use pulse_core::rusqlite::Connection;
use pulse_core::{trades, CoreError};
use pulse_vault::{ApiKey, KeyFormatError, Vault, VaultError};
use std::fmt;
use std::path::Path;

#[derive(Debug, Clone, PartialEq)]
pub enum ServiceError {
    Disabled,
    ConsentRequired,
    NoScreenshot,
    ImageTooLarge,
    NoKey,
    KeyFormat,
    VaultUnavailable,
    VaultFailure,
    Ai(AiError),
    /// A database or validation error of pulse-core (its message holds no key and no AI answer).
    Core(String),
}

impl ServiceError {
    /// The code the interface translates (`ai:<code>`); `None` for a pulse-core error.
    pub fn code(&self) -> Option<&'static str> {
        Some(match self {
            ServiceError::Disabled => "disabled",
            ServiceError::ConsentRequired => "consentRequired",
            ServiceError::NoScreenshot => "noScreenshot",
            ServiceError::ImageTooLarge => "imageTooLarge",
            ServiceError::NoKey => "noKey",
            ServiceError::KeyFormat => "keyFormat",
            ServiceError::VaultUnavailable => "vaultUnavailable",
            ServiceError::VaultFailure => "vaultFailure",
            ServiceError::Ai(e) => e.code(),
            ServiceError::Core(_) => return None,
        })
    }
}

impl fmt::Display for ServiceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match (self, self.code()) {
            (ServiceError::Core(msg), _) => f.write_str(msg),
            (_, Some(code)) => write!(f, "ai:{code}"),
            _ => unreachable!(),
        }
    }
}

impl From<CoreError> for ServiceError {
    fn from(e: CoreError) -> Self {
        ServiceError::Core(e.to_string())
    }
}

impl From<VaultError> for ServiceError {
    fn from(e: VaultError) -> Self {
        match e {
            VaultError::Unavailable => ServiceError::VaultUnavailable,
            VaultError::Failure => ServiceError::VaultFailure,
        }
    }
}

impl From<KeyFormatError> for ServiceError {
    fn from(_: KeyFormatError) -> Self {
        ServiceError::KeyFormat
    }
}

/// Everything needed to send, and nothing more.
pub struct PreparedAnalysis {
    pub trade_id: i64,
    pub model: String,
    prompt: AnalysisPrompt,
    image: ImagePayload,
    sent: Vec<SentFieldKey>,
}

impl fmt::Debug for PreparedAnalysis {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "PreparedAnalysis(trade {}, {}, {:?}, {:?})", self.trade_id, self.model, self.image, self.sent)
    }
}

/// Step 1. `confirmed` is the user's click on "Envoyer" in the per-send confirmation.
pub fn prepare_analysis(conn: &Connection, data_dir: &Path, trade_id: i64, confirmed: bool) -> Result<PreparedAnalysis, ServiceError> {
    let settings = ai::get_settings(conn)?;
    if !settings.enabled {
        return Err(ServiceError::Disabled);
    }
    if settings.consent_at.is_none() || !confirmed {
        return Err(ServiceError::ConsentRequired);
    }
    let trade = trades::get(conn, trade_id)?;
    let image = match ai::load_screenshot_image(data_dir, trade.data.screenshot_path.as_deref())? {
        ScreenshotImage::Ready(image) => image,
        ScreenshotImage::Missing => return Err(ServiceError::NoScreenshot),
        ScreenshotImage::TooLarge => return Err(ServiceError::ImageTooLarge),
    };
    let context = ai::screenshot_context(conn, data_dir, trade_id)?;
    Ok(PreparedAnalysis {
        trade_id,
        model: settings.model,
        prompt: ai::screenshot_prompt(&context),
        image,
        sent: context.fields.iter().map(|f| f.key).collect(),
    })
}

/// Step 2: the key is read from the vault just before the call and dropped (wiped) right after.
pub fn run_analysis(prepared: &PreparedAnalysis, vault: &dyn Vault, provider: &dyn Provider) -> Result<AnalysisReply, ServiceError> {
    let key = vault.load()?.ok_or(ServiceError::NoKey)?;
    let request = ImageRequest {
        model: &prepared.model,
        system: &prepared.prompt.system,
        image_media_type: prepared.image.media_type,
        image_base64: &prepared.image.base64,
        text: &prepared.prompt.user_text,
    };
    provider.analyze_image(&key, &request).map_err(ServiceError::Ai)
}

/// Step 3.
pub fn store_analysis(
    conn: &Connection,
    prepared: &PreparedAnalysis,
    provider_id: &str,
    reply: &AnalysisReply,
    now_ms: i64,
) -> Result<ScreenshotNote, ServiceError> {
    let note = NewScreenshotNote {
        trade_id: prepared.trade_id,
        provider: provider_id.to_owned(),
        model: reply.model.clone(),
        sent: prepared.sent.clone(),
        content: reply.text.clone(),
    };
    Ok(ai::insert_note(conn, &note, now_ms)?)
}

/// The model to test, if the option is on (database step of the connection test).
pub fn connection_model(conn: &Connection) -> Result<String, ServiceError> {
    let settings = ai::get_settings(conn)?;
    if !settings.enabled {
        return Err(ServiceError::Disabled);
    }
    Ok(settings.model)
}

/// Network step of the connection test: no trading data is sent.
pub fn run_check(model: &str, vault: &dyn Vault, provider: &dyn Provider) -> Result<(), ServiceError> {
    let key = vault.load()?.ok_or(ServiceError::NoKey)?;
    provider.check(&key, model).map_err(ServiceError::Ai)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeyStatus {
    pub vault_available: bool,
    pub stored: bool,
}

/// Whether a key is stored, never the key.
pub fn key_status(vault: &dyn Vault) -> KeyStatus {
    match vault.load() {
        Ok(key) => KeyStatus { vault_available: true, stored: key.is_some() },
        Err(VaultError::Unavailable) => KeyStatus { vault_available: false, stored: false },
        Err(VaultError::Failure) => KeyStatus { vault_available: vault.is_available(), stored: false },
    }
}

/// Saves or replaces the key. Works whether the option is on or off (no network either way).
pub fn save_key(vault: &dyn Vault, raw: &str) -> Result<(), ServiceError> {
    let key = ApiKey::parse(raw)?;
    Ok(vault.save(&key)?)
}

pub fn delete_key(vault: &dyn Vault) -> Result<(), ServiceError> {
    Ok(vault.delete()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use pulse_core::accounts::{self, NewAccount};
    use pulse_core::ai::AiSettingsUpdate;
    use pulse_core::trades::{Direction, TradeData};
    use pulse_core::{db, instruments, money};
    use pulse_vault::{MemoryVault, Unavailable};
    use std::sync::Mutex;

    const NOW: i64 = 1_700_000_000_000;
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfake-but-recognizable";

    /// Records every call; answers with a canned reply or error.
    struct FakeProvider {
        calls: Mutex<Vec<String>>,
        answer: Result<AnalysisReply, AiError>,
    }

    impl FakeProvider {
        fn answering(answer: Result<AnalysisReply, AiError>) -> Self {
            FakeProvider { calls: Mutex::new(Vec::new()), answer }
        }
        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl Provider for FakeProvider {
        fn id(&self) -> &'static str {
            "fake"
        }
        fn check(&self, key: &ApiKey, model: &str) -> Result<(), AiError> {
            self.calls.lock().unwrap().push(format!("check {model} {}", key.expose()));
            self.answer.clone().map(|_| ())
        }
        fn analyze_image(&self, key: &ApiKey, r: &ImageRequest) -> Result<AnalysisReply, AiError> {
            self.calls.lock().unwrap().push(format!("analyze {} {} {} | {}", r.model, key.expose(), r.image_media_type, r.text));
            self.answer.clone()
        }
    }

    /// A vault that counts reads, to prove it is not touched when the option is off.
    #[derive(Default)]
    struct CountingVault {
        inner: MemoryVault,
        reads: Mutex<u32>,
    }

    impl Vault for CountingVault {
        fn is_available(&self) -> bool {
            true
        }
        fn load(&self) -> Result<Option<ApiKey>, VaultError> {
            *self.reads.lock().unwrap() += 1;
            self.inner.load()
        }
        fn save(&self, key: &ApiKey) -> Result<(), VaultError> {
            self.inner.save(key)
        }
        fn delete(&self) -> Result<(), VaultError> {
            self.inner.delete()
        }
    }

    fn reply() -> AnalysisReply {
        AnalysisReply { text: "## Contexte visible\n- Range.".into(), model: "claude-opus-5-5".into() }
    }

    fn setup(with_screenshot: bool) -> (tempfile::TempDir, Connection, i64) {
        let dir = tempfile::tempdir().unwrap();
        let conn = db::open_in_memory().unwrap();
        let account = accounts::create(
            &conn,
            &NewAccount { name: "Compte".into(), kind: "personal".into(), broker: String::new(), currency: "USD".into(), initial_capital: money::parse("c", "10000").unwrap() },
        )
        .unwrap();
        let instrument = instruments::get_by_symbol(&conn, "EURUSD").unwrap().unwrap();
        let mut t = TradeData::new(account.id, instrument.id, Direction::Short, money::parse("s", "1").unwrap(), money::parse("e", "1.0842").unwrap(), NOW);
        t.thesis = "Rejet de la résistance".into();
        if with_screenshot {
            std::fs::create_dir_all(dir.path().join("screenshots")).unwrap();
            std::fs::write(dir.path().join("screenshots/a.png"), PNG).unwrap();
            t.screenshot_path = Some("screenshots/a.png".into());
        }
        let id = trades::create(&conn, &t).unwrap().id;
        (dir, conn, id)
    }

    fn turn_on(conn: &Connection, consent: bool) {
        ai::set_settings(conn, &AiSettingsUpdate { enabled: true, model: "claude-opus-5-5".into() }).unwrap();
        if consent {
            ai::record_consent(conn, NOW).unwrap();
        }
    }

    #[test]
    fn when_the_option_is_off_neither_the_vault_nor_the_network_is_touched() {
        let (dir, conn, id) = setup(true);
        let vault = CountingVault::default();
        vault.save(&ApiKey::parse("sk-test-key").unwrap()).unwrap();
        assert_eq!(prepare_analysis(&conn, dir.path(), id, true).unwrap_err(), ServiceError::Disabled);
        assert_eq!(connection_model(&conn).unwrap_err(), ServiceError::Disabled);
        assert_eq!(*vault.reads.lock().unwrap(), 0);
        assert_eq!(ServiceError::Disabled.to_string(), "ai:disabled");
    }

    #[test]
    fn nothing_is_sent_without_the_first_consent_and_the_per_send_confirmation() {
        let (dir, conn, id) = setup(true);
        turn_on(&conn, false);
        assert_eq!(prepare_analysis(&conn, dir.path(), id, true).unwrap_err(), ServiceError::ConsentRequired);
        ai::record_consent(&conn, NOW).unwrap();
        assert_eq!(prepare_analysis(&conn, dir.path(), id, false).unwrap_err(), ServiceError::ConsentRequired);
        assert!(prepare_analysis(&conn, dir.path(), id, true).is_ok());
    }

    #[test]
    fn a_trade_without_screenshot_is_refused_before_the_network() {
        let (dir, conn, id) = setup(false);
        turn_on(&conn, true);
        assert_eq!(prepare_analysis(&conn, dir.path(), id, true).unwrap_err(), ServiceError::NoScreenshot);
        assert!(matches!(prepare_analysis(&conn, dir.path(), 999, true).unwrap_err(), ServiceError::Core(_)));
    }

    #[test]
    fn the_full_analysis_sends_the_context_and_stores_a_comment() {
        let (dir, conn, id) = setup(true);
        turn_on(&conn, true);
        let vault = MemoryVault::default();
        let provider = FakeProvider::answering(Ok(reply()));
        let prepared = prepare_analysis(&conn, dir.path(), id, true).unwrap();
        assert!(!format!("{prepared:?}").contains("Rejet"), "Debug prints no content");
        assert_eq!(run_analysis(&prepared, &vault, &provider).unwrap_err(), ServiceError::NoKey);
        assert!(provider.calls().is_empty(), "no key, no call");

        save_key(&vault, " sk-test-key ").unwrap();
        let answer = run_analysis(&prepared, &vault, &provider).unwrap();
        let call = &provider.calls()[0];
        assert!(call.starts_with("analyze claude-opus-5-5 sk-test-key image/png | "), "{call}");
        assert!(call.contains("vente (short)") && call.contains("Rejet de la résistance"));
        let note = store_analysis(&conn, &prepared, provider.id(), &answer, NOW).unwrap();
        assert_eq!((note.provider.as_str(), note.model.as_str(), note.content.as_str()), ("fake", "claude-opus-5-5", "## Contexte visible\n- Range."));
        assert_eq!(note.sent, [SentFieldKey::Instrument, SentFieldKey::Direction, SentFieldKey::EntryPrice, SentFieldKey::Thesis]);

        // A new analysis starts from the trade alone: the stored comment is never sent back.
        let again = prepare_analysis(&conn, dir.path(), id, true).unwrap();
        run_analysis(&again, &vault, &provider).unwrap();
        assert!(!provider.calls()[1].contains("Contexte visible"));
    }

    #[test]
    fn provider_and_vault_errors_keep_their_codes_and_store_nothing() {
        let (dir, conn, id) = setup(true);
        turn_on(&conn, true);
        let prepared = prepare_analysis(&conn, dir.path(), id, true).unwrap();
        let vault = MemoryVault::default();
        save_key(&vault, "sk-test-key").unwrap();
        let err = run_analysis(&prepared, &vault, &FakeProvider::answering(Err(AiError::RateLimited))).unwrap_err();
        assert_eq!(err.to_string(), "ai:rateLimited");
        assert_eq!(run_analysis(&prepared, &Unavailable, &FakeProvider::answering(Ok(reply()))).unwrap_err(), ServiceError::VaultUnavailable);
        assert!(ai::list_notes(&conn, id).unwrap().is_empty());
    }

    #[test]
    fn the_connection_test_uses_the_chosen_model_and_the_stored_key() {
        let (_dir, conn, _id) = setup(false);
        turn_on(&conn, false);
        ai::set_settings(&conn, &AiSettingsUpdate { enabled: true, model: "claude-haiku-4-5".into() }).unwrap();
        let vault = MemoryVault::default();
        let provider = FakeProvider::answering(Ok(reply()));
        let model = connection_model(&conn).unwrap();
        assert_eq!(run_check(&model, &vault, &provider).unwrap_err(), ServiceError::NoKey);
        save_key(&vault, "sk-test-key").unwrap();
        run_check(&model, &vault, &provider).unwrap();
        assert_eq!(provider.calls(), ["check claude-haiku-4-5 sk-test-key"]);
        assert_eq!(run_check(&model, &vault, &FakeProvider::answering(Err(AiError::InvalidKey))).unwrap_err().to_string(), "ai:invalidKey");
    }

    #[test]
    fn key_management_reports_state_without_the_key() {
        let vault = MemoryVault::default();
        assert_eq!(key_status(&vault), KeyStatus { vault_available: true, stored: false });
        assert_eq!(save_key(&vault, "sk with space").unwrap_err(), ServiceError::KeyFormat);
        save_key(&vault, "sk-test-key").unwrap();
        assert_eq!(key_status(&vault), KeyStatus { vault_available: true, stored: true });
        delete_key(&vault).unwrap();
        assert!(!key_status(&vault).stored);
        assert_eq!(key_status(&Unavailable), KeyStatus { vault_available: false, stored: false });
        assert_eq!(save_key(&Unavailable, "sk-test-key").unwrap_err().to_string(), "ai:vaultUnavailable");
    }
}
