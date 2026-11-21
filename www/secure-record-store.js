const LEGACY_STORAGE_KEY = "geofield_records";
const MAX_RECORDS = 10000;
const MAX_RECORDS_BYTES = 10 * 1024 * 1024;

function validatePayloadSize(records) {
  if (!Array.isArray(records)) throw new Error("The stored data structure is invalid.");
  if (records.length > MAX_RECORDS) throw new Error("The data contains more than 10,000 records.");
  const serialized = JSON.stringify(records);
  if (new TextEncoder().encode(serialized).length > MAX_RECORDS_BYTES) {
    throw new Error("The data exceeds the 10 MB storage limit.");
  }
  return serialized;
}

export function validateRecords(records, normaliseRecord) {
  if (!Array.isArray(records)) throw new Error("The backup file structure is invalid.");
  if (records.length > MAX_RECORDS) throw new Error("The backup contains too many records (maximum 10,000).");

  const validated = records.map((record, index) => normaliseRecord(record, index));
  const ids = new Set();
  for (const record of validated) {
    if (ids.has(record.id)) throw new Error("The data contains duplicate record IDs.");
    ids.add(record.id);
  }
  validatePayloadSize(validated);
  return validated;
}

export class SecureRecordStore {
  constructor({ native, plugin }) {
    this.native = Boolean(native);
    this.plugin = plugin;
  }

  async load(normaliseRecord) {
    if (this.native) {
      // The native plugin reads only the encrypted app-private file. A decryption
      // error is fatal: never fall back to plaintext or replace unreadable data.
      const secure = await this.plugin.load();
      if (secure.found) {
        const parsed = JSON.parse(secure.plaintext);
        return validateRecords(parsed, normaliseRecord);
      }

      // One-time migration from the previous localStorage format. The legacy
      // value is removed only after encrypted write and read-back verification.
      const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacyRaw === null) return [];
      const legacyParsed = JSON.parse(legacyRaw);
      const legacyRecords = Array.isArray(legacyParsed)
        ? legacyParsed
        : legacyParsed?.records;
      const validated = validateRecords(legacyRecords, normaliseRecord);
      const plaintext = JSON.stringify(validated);

      await this.plugin.save({ plaintext });
      const verification = await this.plugin.load();
      if (!verification.found || verification.plaintext !== plaintext) {
        throw new Error("Encrypted migration verification failed. The original data was retained.");
      }

      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return validated;
    }

    // Browser preview only. Android builds must use the native Keystore plugin.
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw);
    const records = Array.isArray(parsed) ? parsed : parsed?.records;
    return validateRecords(records, normaliseRecord);
  }

  async save(records) {
    const serialized = validatePayloadSize(records);
    if (this.native) {
      await this.plugin.save({ plaintext: serialized });
      // Remove any legacy plaintext only after the encrypted save has succeeded.
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return;
    }
    localStorage.setItem(LEGACY_STORAGE_KEY, serialized);
  }
}
