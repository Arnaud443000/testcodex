use crate::Result;
use std::fmt;
use zeroize::Zeroizing;

/// A password as typed (UTF-8, taken as is). Wiped when dropped; never printed.
#[derive(Clone)]
pub struct Password(Zeroizing<String>);

impl Password {
    /// Takes ownership of the string so that its buffer is wiped with the password.
    pub fn new(text: String) -> Self {
        Password(Zeroizing::new(text))
    }

    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Password {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Password(***)")
    }
}

/// The random data key (256 bits) that encrypts the database and the screenshots. It is stored
/// only wrapped by the password key, in the header of the encrypted file.
#[derive(Clone, PartialEq, Eq)]
pub struct DataKey(pub(crate) Zeroizing<[u8; 32]>);

impl DataKey {
    pub fn generate() -> Result<Self> {
        let mut key = Zeroizing::new([0u8; 32]);
        crate::random(key.as_mut())?;
        Ok(DataKey(key))
    }

    pub(crate) fn bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl fmt::Debug for DataKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("DataKey(***)")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_never_prints_a_secret() {
        let p = Password::new("correct horse battery".into());
        assert_eq!(format!("{p:?}"), "Password(***)");
        let k = DataKey::generate().unwrap();
        assert_eq!(format!("{k:?}"), "DataKey(***)");
    }

    #[test]
    fn generated_keys_differ() {
        assert_ne!(DataKey::generate().unwrap(), DataKey::generate().unwrap());
    }
}
