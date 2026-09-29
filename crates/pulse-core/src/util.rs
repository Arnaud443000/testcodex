use crate::error::{CoreError, Result};

/// Declares an enum stored as TEXT in SQLite and serialized as the same text in JSON.
macro_rules! text_enum {
    ($(#[$meta:meta])* $name:ident { $($variant:ident => $text:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, serde::Serialize, serde::Deserialize)]
        pub enum $name {
            $(#[serde(rename = $text)] $variant),+
        }

        impl $name {
            pub const ALL: &'static [$name] = &[$($name::$variant),+];

            pub fn as_str(self) -> &'static str {
                match self { $($name::$variant => $text),+ }
            }

            pub fn parse(s: &str) -> Option<Self> {
                match s { $($text => Some($name::$variant),)+ _ => None }
            }
        }

        impl rusqlite::types::ToSql for $name {
            fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
                Ok(self.as_str().into())
            }
        }

        impl rusqlite::types::FromSql for $name {
            fn column_result(v: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
                let s = v.as_str()?;
                $name::parse(s).ok_or_else(|| {
                    rusqlite::types::FromSqlError::Other(format!("unknown {} {s:?}", stringify!($name)).into())
                })
            }
        }
    };
}
pub(crate) use text_enum;

/// Trims and collapses inner whitespace; errors when nothing is left.
pub(crate) fn clean_text(field: &str, s: &str) -> Result<String> {
    let cleaned = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.is_empty() {
        return Err(CoreError::Invalid(format!("{field} is required")));
    }
    Ok(cleaned)
}

/// Key used to detect duplicates regardless of case and spacing
/// ("Breakout  NY" and "breakout ny" are the same tag).
pub(crate) fn name_key(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

pub(crate) fn check_range(field: &str, v: Option<u8>, lo: u8, hi: u8) -> Result<()> {
    match v {
        Some(x) if !(lo..=hi).contains(&x) => {
            Err(CoreError::Invalid(format!("{field} must be between {lo} and {hi}")))
        }
        _ => Ok(()),
    }
}

/// SQL condition restricting `column` to the given ids. When empty (the default
/// "all accounts" view) it keeps the active accounts only: archived accounts keep
/// their history but are reached by naming them explicitly.
/// Ids are integers, so formatting them inline is injection-safe.
pub(crate) fn ids_condition(column: &str, ids: &[i64]) -> String {
    if ids.is_empty() {
        return format!("{column} IN (SELECT id FROM accounts WHERE archived = 0)");
    }
    let list: Vec<String> = ids.iter().map(i64::to_string).collect();
    format!("{column} IN ({})", list.join(","))
}

/// UTC offsets in the world range from −12:00 to +14:00.
pub(crate) fn check_tz_offset(minutes: i32) -> Result<()> {
    if !(-840..=840).contains(&minutes) {
        return Err(CoreError::Invalid("time zone offset must be between -14:00 and +14:00".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_key_ignores_case_and_spacing() {
        assert_eq!(name_key("  Breakout   NY "), "breakout ny");
        assert_eq!(name_key("Émotion"), name_key("ÉMOTION"));
    }

    #[test]
    fn clean_text_rejects_blank() {
        assert!(clean_text("name", " \t ").is_err());
        assert_eq!(clean_text("name", " a   b ").unwrap(), "a b");
    }
}
