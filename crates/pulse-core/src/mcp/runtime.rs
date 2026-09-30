//! State of the access in the running app (lot 37): the bridge, when it started, when it ends, why it last
//! stopped. Pure logic around [`Bridge`] with an injectable clock; the shell calls [`McpRuntime::tick`]
//! regularly and [`McpRuntime::stop`] when Pulse locks or closes.

use super::bridge::{Bridge, BridgeHost, Clock, Limits};
use super::settings::{error, McpSettings};
use crate::error::Result;
use serde::Serialize;
use std::path::Path;
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StopReason {
    /// « Couper l'accès maintenant » or the switch.
    Manual,
    /// The chosen duration ran out.
    Expired,
    /// Pulse locked (by hand or after inactivity).
    Locked,
    /// Pulse is closing.
    Closed,
    /// The consent was withdrawn, or no exposed account is left.
    Settings,
}

/// `now` at or past the end: the access goes off (the end instant itself is excluded).
pub fn expired(expires_at: Option<i64>, now: i64) -> bool {
    expires_at.is_some_and(|end| now >= end)
}

#[derive(Default)]
pub struct McpRuntime {
    bridge: Option<Bridge>,
    started_at: Option<i64>,
    expires_at: Option<i64>,
    last_stop: Option<(StopReason, i64)>,
    autostart_done: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub active: bool,
    pub started_at: Option<i64>,
    pub expires_at: Option<i64>,
    /// Calls answered during this activation.
    pub calls: u64,
    /// Calls refused by the per-minute limit during this activation.
    pub refused: u64,
    pub last_call_at: Option<i64>,
    pub last_stop_reason: Option<StopReason>,
    pub last_stop_at: Option<i64>,
}

impl McpRuntime {
    pub fn new() -> McpRuntime {
        McpRuntime::default()
    }

    pub fn is_active(&self) -> bool {
        self.bridge.is_some()
    }

    /// Turns the access on (or on again: the old bridge is stopped first, so the token is always new).
    /// `exposed` = the accounts the tools may read now. Errors: `mcp:consentRequired`, `mcp:noAccount`.
    pub fn start(&mut self, settings: &McpSettings, exposed: &[i64], data_dir: &Path, host: Arc<dyn BridgeHost>, limits: Limits, clock: Clock) -> Result<()> {
        if settings.consent_at.is_none() {
            return Err(error("consentRequired"));
        }
        if exposed.is_empty() {
            return Err(error("noAccount"));
        }
        let now = clock();
        if let Some(old) = self.bridge.take() {
            old.stop();
        }
        self.bridge = Some(Bridge::start(data_dir, host, limits, clock)?);
        self.started_at = Some(now);
        self.expires_at = settings.duration.expires_at(now);
        self.last_stop = None;
        Ok(())
    }

    /// Closes the port and removes the endpoint file. Returns whether it was on.
    pub fn stop(&mut self, reason: StopReason, now: i64) -> bool {
        let Some(bridge) = self.bridge.take() else { return false };
        bridge.stop();
        self.started_at = None;
        self.expires_at = None;
        self.last_stop = Some((reason, now));
        true
    }

    /// Called regularly: stops the access when its duration has run out. Returns whether it stopped.
    pub fn tick(&mut self, now: i64) -> bool {
        if self.is_active() && expired(self.expires_at, now) {
            return self.stop(StopReason::Expired, now);
        }
        false
    }

    /// True once per run of the app: « Rester activé au prochain démarrage » is applied at the first
    /// opening of the database (at launch, or at the first unlock of an encrypted database).
    pub fn take_autostart(&mut self) -> bool {
        !std::mem::replace(&mut self.autostart_done, true)
    }

    pub fn status(&self) -> RuntimeStatus {
        let stats = self.bridge.as_ref().map(Bridge::stats).unwrap_or_default();
        RuntimeStatus {
            active: self.is_active(),
            started_at: self.started_at,
            expires_at: self.expires_at,
            calls: stats.calls,
            refused: stats.refused,
            last_call_at: stats.last_call_at,
            last_stop_reason: self.last_stop.map(|(r, _)| r),
            last_stop_at: self.last_stop.map(|(_, at)| at),
        }
    }
}
