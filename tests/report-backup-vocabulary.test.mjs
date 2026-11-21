import test from "node:test";
import assert from "node:assert/strict";
import { encryptBackupPayload, decryptBackupPayload, isEncryptedBackup } from "../www/backup-crypto.js";
import { buildProjectReport } from "../www/report-pdf.js";
import { vocabularyForField } from "../www/geology-vocabulary.js";

assert.ok(globalThis.crypto?.subtle, "Web Crypto API must be available in Node.js tests");

test("password backup round-trips and uses authenticated AES-256-GCM envelope", async () => {
  const payload = { app: "GeoField", version: 4, workspace: { schemaVersion: 1, observations: [{ id: "a", Lithology: "Granite" }] } };
  const encrypted = await encryptBackupPayload(payload, "FieldBackup-2026!");
  assert.equal(isEncryptedBackup(encrypted), true);
  assert.equal(encrypted.cipher, "AES-256-GCM");
  assert.equal(encrypted.kdf, "PBKDF2-SHA-256");
  assert.deepEqual(await decryptBackupPayload(encrypted, "FieldBackup-2026!"), payload);
});

test("encrypted backup rejects wrong passwords and modified ciphertext", async () => {
  const encrypted = await encryptBackupPayload({ data: "confidential" }, "Correct-Horse-123");
  await assert.rejects(() => decryptBackupPayload(encrypted, "wrong-password"), /incorrect|modified|corrupted/i);
  const tampered = { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -4) + "AAAA" };
  await assert.rejects(() => decryptBackupPayload(tampered, "Correct-Horse-123"), /incorrect|modified|corrupted|corrupted/i);
});

test("encrypted backup enforces a minimum password length", async () => {
  await assert.rejects(() => encryptBackupPayload({}, "short"), /10 and 256 characters/i);
});

test("PDF report creates a readable PDF with project, observation and sample content", async () => {
  const bytes = await buildProjectReport({
    project: { name: "North Ridge", code: "NR-01", coordinateSystem: "UTM", datum: "WGS 84", utmZone: "39", hemisphere: "N" },
    observations: [{ id: "obs-1", WPT_NO: "ST-01", Lithology: "Granite", Mineral: "Quartz" }],
    samples: [{ id: "s-1", code: "NR-001", sampleType: "Rock", material: "Granite" }]
  });
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  assert.ok(bytes.length > 1000);
});

test("PDF report refuses lossy conversion of non-Latin text", async () => {
  await assert.rejects(() => buildProjectReport({
    project: { name: "پروژه" }, observations: [], samples: []
  }), /XLSX export/i);
});

test("geology vocabulary supplies curated lithology, mineral and alteration terms", () => {
  assert.ok(vocabularyForField("Lithology").includes("Granite"));
  assert.ok(vocabularyForField("Mineral").includes("Chalcopyrite"));
  assert.ok(vocabularyForField("Altration").includes("Silicification"));
  assert.deepEqual(vocabularyForField("UnknownField"), []);
});
