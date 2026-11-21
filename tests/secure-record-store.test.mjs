import test from "node:test";
import assert from "node:assert/strict";
import { SecureRecordStore, validateRecords } from "../www/secure-record-store.js";

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const normalise = (record, index = 0) => {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("invalid record");
  return { id: String(record.id || "legacy-" + index), value: String(record.value ?? "") };
};

test("migrates legacy localStorage only after encrypted write is readable", async () => {
  globalThis.localStorage = new MemoryStorage();
  const original = JSON.stringify([{ id: "a1", value: "granite" }]);
  localStorage.setItem("geofield_records", original);
  let encrypted = null;
  const plugin = {
    async save({ plaintext }) { encrypted = "cipher:" + plaintext; },
    async load() { return encrypted === null
      ? { found: false, plaintext: "" }
      : { found: true, plaintext: encrypted.slice(7) }; }
  };
  const store = new SecureRecordStore({ native: true, plugin });
  const records = await store.load(normalise);
  assert.deepEqual(records, [{ id: "a1", value: "granite" }]);
  assert.equal(localStorage.getItem("geofield_records"), null);
  assert.equal(encrypted, "cipher:" + original);
});

test("retains legacy plaintext if migration verification fails", async () => {
  globalThis.localStorage = new MemoryStorage();
  const original = JSON.stringify([{ id: "a1", value: "granite" }]);
  localStorage.setItem("geofield_records", original);
  let saved = false;
  const plugin = {
    async save() { saved = true; },
    async load() { return saved ? { found: true, plaintext: "[]" } : { found: false, plaintext: "" }; }
  };
  const store = new SecureRecordStore({ native: true, plugin });
  await assert.rejects(() => store.load(normalise), /verification failed/i);
  assert.equal(localStorage.getItem("geofield_records"), original);
});

test("does not fall back to legacy plaintext when encrypted data cannot be read", async () => {
  globalThis.localStorage = new MemoryStorage();
  const original = JSON.stringify([{ id: "a1", value: "granite" }]);
  localStorage.setItem("geofield_records", original);
  const plugin = { async load() { throw new Error("authentication tag mismatch"); } };
  const store = new SecureRecordStore({ native: true, plugin });
  await assert.rejects(() => store.load(normalise), /authentication tag mismatch/);
  assert.equal(localStorage.getItem("geofield_records"), original);
});

test("retains previous legacy data when encrypted save fails", async () => {
  globalThis.localStorage = new MemoryStorage();
  const original = JSON.stringify([{ id: "a1", value: "granite" }]);
  localStorage.setItem("geofield_records", original);
  const plugin = { async save() { throw new Error("keystore unavailable"); } };
  const store = new SecureRecordStore({ native: true, plugin });
  await assert.rejects(() => store.save([{ id: "b2", value: "basalt" }]), /keystore unavailable/);
  assert.equal(localStorage.getItem("geofield_records"), original);
});

test("rejects duplicate record IDs and oversized datasets", () => {
  assert.throws(() => validateRecords([
    { id: "same", value: "a" },
    { id: "same", value: "b" }
  ], normalise), /duplicate record IDs/i);
  assert.throws(() => validateRecords(
    Array.from({ length: 10001 }, (_, index) => ({ id: String(index), value: "" })),
    normalise
  ), /10,000/i);
});
