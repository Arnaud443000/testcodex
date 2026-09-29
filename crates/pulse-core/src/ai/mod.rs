//! Optional AI, local side only (lot 20, spec 3.5.4): settings, the exact list of what
//! leaves the computer for a trade, the text of the request, and the stored comments.
//! There is no network code here: the HTTPS client lives in the `pulse-ai` crate and the
//! API key in the Windows credential store (`pulse-vault`). See CLAUDE.md, "IA optionnelle".

mod context;
mod notes;
mod settings;

pub use context::{
    load_screenshot_image, screenshot_context, screenshot_prompt, AnalysisPrompt, ImagePayload, ScreenshotContext, ScreenshotImage,
    SentField, SentFieldKey, MAX_IMAGE_BASE64_BYTES,
};
pub use notes::{delete_note, insert_note, list_notes, NewScreenshotNote, ScreenshotNote};
pub use settings::{get_settings, record_consent, set_settings, validate_model, AiSettings, AiSettingsUpdate, DEFAULT_MODEL, SUGGESTED_MODELS};

#[cfg(test)]
mod tests;
