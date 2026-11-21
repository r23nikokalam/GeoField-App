# GeoField storage security

## Android record storage

- Capacitor Android, Core, and CLI are pinned to 7.6.10, which includes the fix for GHSA-rvm3-566m-v7fv.

- Observation records are serialized in the WebView process only while the app is running.
- On Android, the app calls the local Capacitor `SecureStorage` plugin. The plugin encrypts the record payload with AES-256-GCM.
- The AES key is generated and retained by Android Keystore under the alias `GeoField.RecordEncryption.v1`; the key is not exported to JavaScript.
- The encrypted payload is written to the app-private files directory through Android `AtomicFile`, so a failed write does not intentionally replace the previous file.
- A fresh random 96-bit GCM IV is stored with each ciphertext. GCM authentication detects tampering.
- Android app backup is disabled because a restored ciphertext without its original Keystore key cannot be decrypted.

## Migration from older versions

On first launch of this build, the native plugin checks for an encrypted record file. If none exists, the app reads the previous `geofield_records` localStorage value, validates and normalizes the records, writes an encrypted copy, reads it back, and compares the plaintext. Only after successful verification does it remove the old plaintext localStorage value.

If encrypted data cannot be read or migration verification fails, the app locks editing and does not fall back to empty data or overwrite the existing source. The old plaintext value is retained if migration has not been verified.

## User backups

New user-initiated JSON backups are portable and encrypted independently of the Android Keystore:

- AES-256-GCM authenticated encryption.
- PBKDF2-HMAC-SHA-256 with 310,000 iterations and a fresh random 16-byte salt.
- A fresh random 12-byte GCM nonce for every backup.
- Password length is 10–256 characters. The password is never stored by GeoField.
- The password is not recoverable. If it is lost, the encrypted backup cannot be restored.
- Restore authenticates the ciphertext and metadata; wrong passwords or modified files are rejected.
- Older plaintext JSON backups remain importable for compatibility after an explicit warning, but new exports are encrypted.

Because the backup key is derived from the user's password rather than the device Keystore, the backup can be restored on another supported device. The Android workspace itself remains protected by the Android Keystore-backed storage.

## Important limitations

- Android Keystore protects the encryption key at rest. Hardware-backed key storage depends on the device and is not guaranteed on every Android model.
- Clearing app data or uninstalling the app removes the app-private encrypted file and its Keystore key. Export a JSON backup before doing either.
- The browser preview does not have Android Keystore access and therefore uses browser localStorage; it is not an encrypted deployment.
- This implementation still requires successful CI builds, device-level migration tests, and security review before being described as production-audited.
