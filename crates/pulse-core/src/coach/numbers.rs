//! Spots the numbers of an AI answer that do not come from Pulse (lot 21, see CLAUDE.md, « Chiffres
//! repérables »). The AI must quote the tools' results as given; a number of the answer is accepted when
//! it equals, once rounded to the decimals written, a number the AI was given in this conversation (tool
//! results, the question, the context line), or that number × 100 (a fraction written as a percentage).
//! This flags, it proves nothing: a number can match by chance.

use serde_json::Value;

/// Integers up to this value, written without `%`, are not checked (« 2 pertes », « 3 pistes », lists).
const SMALL_INTEGER: f64 = 10.0;
/// At most this many numbers are listed under an answer.
const MAX_LISTED: usize = 20;

const MONTHS: [&str; 24] = [
    "janvier", "février", "fevrier", "mars", "avril", "mai", "juin", "juillet", "août", "aout", "septembre", "octobre",
    "novembre", "décembre", "decembre", "janv", "févr", "fevr", "avr", "juil", "sept", "oct", "nov", "déc",
];
const WEEKDAYS: [&str; 7] = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

/// A number read in a text.
#[derive(Debug, Clone, PartialEq)]
struct Token {
    /// As written (sign, separators, `%` or `R` included), for the list shown to the user.
    raw: String,
    value: f64,
    decimals: usize,
    percent: bool,
    /// Part of a date, a time, an identifier (M15, US30) or a year: never checked.
    exempt: bool,
}

/// Every number the AI was given; built from the conversation's non-AI content.
#[derive(Debug, Default, Clone)]
pub struct AllowedNumbers {
    values: Vec<f64>,
}

impl AllowedNumbers {
    /// Collects the numbers of a JSON value: numbers as such, and every number written inside its strings
    /// (tool results travel as JSON text; questions and context lines are plain text).
    pub fn add_json(&mut self, v: &Value) {
        match v {
            Value::Number(n) => {
                if let Some(f) = n.as_f64() {
                    self.values.push(f);
                }
            }
            Value::String(s) => self.add_text(s),
            Value::Array(items) => items.iter().for_each(|i| self.add_json(i)),
            Value::Object(map) => map.values().for_each(|i| self.add_json(i)),
            _ => {}
        }
    }

    /// Every number of a text, date and time parts included (a day given by a tool may be quoted).
    pub fn add_text(&mut self, text: &str) {
        for t in tokens(text) {
            self.values.push(t.value);
        }
        // Digit runs alone too: "2026-09-29" gives 2026, 9 and 29.
        let mut run = String::new();
        for c in text.chars().chain(std::iter::once(' ')) {
            if c.is_ascii_digit() {
                run.push(c);
            } else if !run.is_empty() {
                if let Ok(v) = run.parse::<f64>() {
                    self.values.push(v);
                }
                run.clear();
            }
        }
    }

    fn matches(&self, t: &Token) -> bool {
        let written = t.value.abs();
        let tolerance = 0.5 * 10f64.powi(-(t.decimals as i32)) + 1e-9;
        self.values.iter().any(|&a| [a.abs(), (a * 100.0).abs()].iter().any(|c| (c - written).abs() <= tolerance))
    }
}

/// The numbers of `answer` that match nothing in `allowed`, as written, in order, without repeats.
pub fn unverified(answer: &str, allowed: &AllowedNumbers) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for t in tokens(answer) {
        if t.exempt || (!t.percent && t.decimals == 0 && t.value.abs() <= SMALL_INTEGER) || allowed.matches(&t) {
            continue;
        }
        if !out.contains(&t.raw) && out.len() < MAX_LISTED {
            out.push(t.raw);
        }
    }
    out
}

fn is_sign(c: char) -> bool {
    matches!(c, '-' | '+' | '−' | '–')
}

fn is_group_space(c: char) -> bool {
    matches!(c, ' ' | '\u{a0}' | '\u{202f}')
}

fn tokens(text: &str) -> Vec<Token> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let prev = i.checked_sub(1).map(|p| chars[p]);
        let signed = is_sign(c) && chars.get(i + 1).is_some_and(|n| n.is_ascii_digit()) && !prev.is_some_and(|p| p.is_alphanumeric());
        if !(c.is_ascii_digit() || signed) || prev.is_some_and(|p| p.is_ascii_digit()) {
            i += 1;
            continue;
        }
        let start = i;
        let negative = signed && c != '+';
        if signed {
            i += 1;
        }
        // Digits, thousands groups ("1 234", "1,234") and one decimal separator.
        let mut body = String::new();
        while i < chars.len() {
            let ch = chars[i];
            if ch.is_ascii_digit() {
                body.push(ch);
                i += 1;
            } else if (ch == ',' || ch == '.' || is_group_space(ch)) && chars.get(i + 1).is_some_and(|n| n.is_ascii_digit()) {
                // A space only groups thousands when exactly three digits follow.
                if is_group_space(ch) {
                    let three = (1..=3).all(|k| chars.get(i + k).is_some_and(|d| d.is_ascii_digit()))
                        && !chars.get(i + 4).is_some_and(|d| d.is_ascii_digit());
                    if !three {
                        break;
                    }
                }
                body.push(ch);
                i += 1;
            } else {
                break;
            }
        }
        let prev_char = start.checked_sub(1).map(|p| chars[p]);
        let next = chars.get(i).copied();
        let after_next = chars.get(i + 1).copied();
        // Date, time or identifier: "2026-09-29", "14:30", "12/09", "M15", "3M", "14h".
        let mut exempt = prev_char.is_some_and(|p| p.is_alphabetic() || matches!(p, '/' | ':' | '-' | '_'))
            || next.is_some_and(|n| matches!(n, '/' | ':' | '-' | '_') && after_next.is_some_and(|a| a.is_ascii_digit()));
        let mut percent = false;
        let mut unit_len = 0;
        // Look past spaces for a unit.
        let mut j = i;
        while chars.get(j).is_some_and(|&s| is_group_space(s)) {
            j += 1;
        }
        match chars.get(j) {
            Some('%') => {
                percent = true;
                unit_len = j + 1 - i;
            }
            Some('R') if !chars.get(j + 1).is_some_and(|a| a.is_alphabetic()) => unit_len = j + 1 - i,
            Some(&l) if l.is_alphabetic() && j == i => {
                // Glued to a word ("3M", "2e", "14h", "10k"): not a quoted value.
                exempt = true;
            }
            _ => {}
        }
        let (value, decimals) = parse_number(&body);
        let word_after = following_word(&chars, i);
        let word_before = preceding_word(&chars, start);
        if decimals == 0 && !percent {
            if (1900.0..=2100.0).contains(&value) && body.chars().all(|d| d.is_ascii_digit()) {
                exempt = true;
            }
            if MONTHS.contains(&word_after.as_str()) || WEEKDAYS.contains(&word_before.as_str()) {
                exempt = true;
            }
        }
        let raw: String = chars[start..i + unit_len].iter().collect();
        out.push(Token { raw: raw.trim().to_owned(), value: if negative { -value } else { value }, decimals, percent, exempt });
        i += unit_len;
    }
    out
}

/// Reads "1 234,56", "1,234.56", "0,58", "1.5": with both separators the last one is the decimal point;
/// with one kind only, it is decimal unless it repeats in groups of three ("1,234,567").
fn parse_number(body: &str) -> (f64, usize) {
    let cleaned: String = body.chars().filter(|c| !is_group_space(*c)).collect();
    let last_comma = cleaned.rfind(',');
    let last_dot = cleaned.rfind('.');
    let decimal_at = match (last_comma, last_dot) {
        (Some(c), Some(d)) => Some(c.max(d)),
        (Some(p), None) | (None, Some(p)) => {
            let sep = cleaned.as_bytes()[p] as char;
            let parts: Vec<&str> = cleaned.split(sep).collect();
            let grouped = parts.len() > 2 && parts[1..].iter().all(|g| g.len() == 3);
            (!grouped).then_some(p)
        }
        (None, None) => None,
    };
    let (int_part, frac_part) = match decimal_at {
        Some(p) => (&cleaned[..p], &cleaned[p + 1..]),
        None => (cleaned.as_str(), ""),
    };
    let digits: String = int_part.chars().filter(|c| c.is_ascii_digit()).collect();
    let text = if frac_part.is_empty() { digits } else { format!("{digits}.{frac_part}") };
    (text.parse().unwrap_or(0.0), frac_part.len())
}

fn following_word(chars: &[char], mut i: usize) -> String {
    while chars.get(i).is_some_and(|c| is_group_space(*c)) {
        i += 1;
    }
    chars[i.min(chars.len())..].iter().take_while(|c| c.is_alphabetic()).collect::<String>().to_lowercase()
}

fn preceding_word(chars: &[char], start: usize) -> String {
    let mut end = start;
    while end > 0 && is_group_space(chars[end - 1]) {
        end -= 1;
    }
    let mut begin = end;
    while begin > 0 && chars[begin - 1].is_alphabetic() {
        begin -= 1;
    }
    chars[begin..end].iter().collect::<String>().to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn allowed(v: Value) -> AllowedNumbers {
        let mut a = AllowedNumbers::default();
        a.add_json(&v);
        a
    }

    #[test]
    fn reads_french_and_english_numbers() {
        let t = tokens("Win rate 58,3 %, PnL −1 234,50 USD, R moyen +0.45R, 1,234.5 ou 1,234,567 ; 1 500 trades");
        let v: Vec<(f64, usize, bool)> = t.iter().map(|t| (t.value, t.decimals, t.percent)).collect();
        assert_eq!(v, [(58.3, 1, true), (-1234.5, 2, false), (0.45, 2, false), (1234.5, 1, false), (1_234_567.0, 0, false), (1500.0, 0, false)]);
        assert_eq!(t[0].raw, "58,3 %");
        assert_eq!(t[2].raw, "+0.45R");
    }

    #[test]
    fn quoted_values_rounded_as_written_are_accepted() {
        let a = allowed(json!({ "winRate": 0.5833, "netPnl": "-1234.567", "expectancyR": 0.4512, "tradeCount": 24 }));
        let answer = "Sur 24 trades : win rate de 58,3 % (ou 58 %), PnL net de −1 234,57 USD, expectancy de +0,45 R.";
        assert!(unverified(answer, &a).is_empty(), "{:?}", unverified(answer, &a));
    }

    #[test]
    fn a_number_absent_from_the_results_is_listed_once() {
        let a = allowed(json!({ "winRate": 0.5833, "netPnl": "120.5" }));
        let answer = "Win rate 58,33 %, PnL 120,50 ; vous auriez gagné 42 % de plus, soit 42 % et 350 USD.";
        assert_eq!(unverified(answer, &a), ["42 %", "350"]);
        // A computed difference is not a result either.
        assert_eq!(unverified("Écart de 12,4 points.", &allowed(json!({ "a": 0.62, "b": 0.496 }))), ["12,4"]);
    }

    #[test]
    fn dates_times_years_identifiers_and_small_integers_are_not_checked() {
        let a = AllowedNumbers::default();
        let answer = "Le 2026-09-22 à 14:30, le 12/09, lundi 22 et le 29 septembre 2026, sur M15 et US30, 3M, 14h, 2 pertes puis 3 trades.";
        assert!(unverified(answer, &a).is_empty(), "{:?}", unverified(answer, &a));
        // But 11 and any percentage are.
        assert_eq!(unverified("11 trades, 5 %", &a), ["11", "5 %"]);
    }

    #[test]
    fn numbers_inside_the_given_text_and_dates_are_allowed() {
        let mut a = AllowedNumbers::default();
        a.add_text("Aujourd'hui : 2026-09-29. Pourquoi je perds 15 % le vendredi ?");
        a.add_json(&json!({ "day": "2026-09-22", "count": 17 }));
        assert!(unverified("Vous parlez de 15 % ; 17 trades le 22.", &a).is_empty());
    }

    #[test]
    fn a_fraction_matches_its_percentage_and_signs_are_ignored() {
        let a = allowed(json!({ "maxDrawdownPct": 0.1234, "delta": "-45.2" }));
        assert!(unverified("Drawdown max 12,34 %, soit une baisse de 45,2.", &a).is_empty());
        assert!(unverified("Drawdown max 12,3 % ; +45,2", &a).is_empty());
        assert_eq!(unverified("Drawdown max 12,5 %", &a), ["12,5 %"]);
    }

    #[test]
    fn an_empty_answer_or_no_number_gives_nothing() {
        assert!(unverified("", &AllowedNumbers::default()).is_empty());
        assert!(unverified("Pas de données sur cette période.", &AllowedNumbers::default()).is_empty());
    }
}
