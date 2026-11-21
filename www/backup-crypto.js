const FORMAT = "GeoFieldEncryptedBackup";
const VERSION = 1;
const ITERATIONS = 310000;
const MAX_ITERATIONS = 600000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("The encrypted backup has invalid binary data.");
  }
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function requireCrypto() {
  if (!globalThis.crypto?.subtle || typeof globalThis.crypto.getRandomValues !== "function") {
    throw new Error("Secure cryptography is unavailable on this device or browser.");
  }
}

async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptBackupPayload(payload, password) {
  requireCrypto();
  if (typeof password !== "string" || password.length < 10 || password.length > 256) {
    throw new Error("Use a backup password between 10 and 256 characters.");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const additionalData = encoder.encode("GeoField:GeoFieldEncryptedBackup:v1");
  const plaintext = encoder.encode(JSON.stringify(payload));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData, tagLength: 128 }, key, plaintext
  );
  return {
    app: "GeoField",
    format: FORMAT,
    version: VERSION,
    cipher: "AES-256-GCM",
    kdf: "PBKDF2-SHA-256",
    iterations: ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted))
  };
}

export async function decryptBackupPayload(envelope, password) {
  requireCrypto();
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) ||
      envelope.app !== "GeoField" || envelope.format !== FORMAT ||
      envelope.version !== VERSION || envelope.cipher !== "AES-256-GCM" ||
      envelope.kdf !== "PBKDF2-SHA-256" ||
      !Number.isInteger(envelope.iterations) ||
      envelope.iterations < 100000 || envelope.iterations > MAX_ITERATIONS) {
    throw new Error("Unsupported or invalid encrypted GeoField backup.");
  }
  if (typeof password !== "string" || !password.length || password.length > 256) {
    throw new Error("A backup password is required.");
  }
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) {
    throw new Error("The encrypted backup is incomplete or corrupted.");
  }
  try {
    const key = await deriveKey(password, salt, envelope.iterations);
    const additionalData = encoder.encode("GeoField:GeoFieldEncryptedBackup:v1");
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData, tagLength: 128 }, key, ciphertext
    );
    return JSON.parse(decoder.decode(plaintext));
  } catch {
    throw new Error("The password is incorrect or the backup has been modified or corrupted.");
  }
}

export function isEncryptedBackup(value) {
  return Boolean(value && typeof value === "object" &&
    value.format === FORMAT && value.app === "GeoField");
}
