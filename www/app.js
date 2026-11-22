import * as XLSX from "xlsx";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { SecureRecordStore, validateRecords } from "./secure-record-store.js";

const SecureStorage = registerPlugin("SecureStorage");
const recordStore = new SecureRecordStore({
  native: Capacitor.isNativePlatform(),
  plugin: SecureStorage
});

const sections = [
  { name: "Project", fields: ["FID","Id","WPT_NO","Date","Geologist","Profile_No"] },
  { name: "Coordinate", fields: ["X_UTM","Y_UTM","Z_UTM"] },
  { name: "Geology", fields: ["Lithology","colour","colour Modifier","Contact","Altration","Weak","Moderate","Strong","Mineral","Structur"] },
  { name: "Layer Structure", fields: ["Azimut_lay","Dip","DDirection","Length","Thickness"] },
  { name: "Fault", fields: ["Type_Fault","Azim_Fault","Dip_Fault","Dddirection_Fault"] },
  { name: "Sample", fields: ["Anlz","Anlz_Typ","Index_mine","Pic_Num"] },
  { name: "Describe", fields: ["Describe"] }
];
const fieldNames = sections.flatMap(section => section.fields);
const $ = id => document.getElementById(id);
let rows = [];
let editingId = null;
let activeSection = null;
let draft = null;
let storageReady = false;

const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
const MAX_FIELD_LENGTH = 20000;
const MAX_ID_LENGTH = 128;

function normaliseRecord(source, index = 0) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("A record has an invalid structure.");
  }

  const legacy = source;
  if (legacy.id !== undefined && legacy.id !== null &&
      typeof legacy.id !== "string" && typeof legacy.id !== "number") {
    throw new Error("A record ID has an unsupported value.");
  }
  const rawId = String(legacy.id || ("restored-" + index));
  if (!rawId.trim() || rawId.length > MAX_ID_LENGTH) throw new Error("A record ID is invalid or too long.");

  const item = { id: rawId };
  for (const key of fieldNames) {
    const value = legacy[key] ?? "";
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new Error("A field contains an unsupported value.");
    }
    const textValue = String(value);
    if (textValue.length > MAX_FIELD_LENGTH) throw new Error("A field exceeds the allowed length.");
    item[key] = textValue;
  }

  const legacyKeys = ["rockColor","unitName","minerals","alterations","sample","notes","analysis"];
  if (legacy._legacy !== undefined && legacy._legacy !== null &&
      (typeof legacy._legacy !== "object" || Array.isArray(legacy._legacy))) {
    throw new Error("The preserved legacy data has an invalid structure.");
  }
  const legacyText = key => {
    const value = legacy[key] ?? "";
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new Error("A legacy field contains an unsupported value.");
    }
    const textValue = String(value);
    if (textValue.length > MAX_FIELD_LENGTH) throw new Error("A legacy field exceeds the allowed length.");
    return textValue;
  };
  if (legacyKeys.some(key => Object.prototype.hasOwnProperty.call(legacy, key))) {
    const prior = legacy._legacy && typeof legacy._legacy === "object" ? legacy._legacy : legacy;
    const preserved = {};
    for (const key of legacyKeys) {
      const value = prior[key] ?? "";
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        throw new Error("A legacy field contains an unsupported value.");
      }
      preserved[key] = String(value);
      if (preserved[key].length > MAX_FIELD_LENGTH) throw new Error("A legacy field exceeds the allowed length.");
    }
    item._legacy = preserved;
    if (!item.Lithology) item.Lithology = legacyText("unitName");
    if (!item.colour) item.colour = legacyText("rockColor");
    if (!item.Mineral) item.Mineral = legacyText("minerals");
    if (!item.Altration) item.Altration = legacyText("alterations");
    if (!item.Index_mine) item.Index_mine = legacyText("sample");
    if (!item.Anlz_Typ) item.Anlz_Typ = legacyText("analysis");
    if (!item.Describe) item.Describe = legacyText("notes");
  } else if (legacy._legacy && typeof legacy._legacy === "object" && !Array.isArray(legacy._legacy)) {
    item._legacy = {};
    for (const key of legacyKeys) {
      const value = legacy._legacy[key] ?? "";
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        throw new Error("A legacy field contains an unsupported value.");
      }
      item._legacy[key] = String(value);
      if (item._legacy[key].length > MAX_FIELD_LENGTH) throw new Error("A legacy field exceeds the allowed length.");
    }
  }

  for (const key of fieldNames) {
    if (item[key].length > MAX_FIELD_LENGTH) {
      throw new Error("A field exceeds the allowed length.");
    }
  }
  return item;
}

function setControlsEnabled(enabled) {
  document.querySelectorAll("button, input, textarea").forEach(element => {
    element.disabled = !enabled;
  });
}

function render() {
  $("count").textContent = rows.length.toLocaleString("en-US") + " records";
  if (!rows.length) {
    $("records").innerHTML = '<div class="empty">No observations have been recorded yet.</div>';
    return;
  }
  $("records").innerHTML = rows.slice().reverse().map(record => {
    const title = record.WPT_NO || record.Profile_No || record.Lithology || record.Id || "Saved observation";
    const summaryKeys = ["Date","Geologist","Lithology","X_UTM","Y_UTM","Z_UTM","Mineral","Describe"];
    const summary = summaryKeys.filter(key => record[key]).slice(0, 5)
      .map(key => '<p><b>' + escapeHtml(key) + ':</b> ' + escapeHtml(record[key]) + '</p>').join("");
    const filled = fieldNames.filter(key => record[key]).length;
    return `
      <article class="record">
        <h3>${escapeHtml(title)} <span class="small">— ${filled} fields completed</span></h3>
        ${summary}
        <div class="actions">
          <button type="button" class="secondary" data-edit="${escapeHtml(record.id)}">Edit</button>
          <button type="button" class="danger" data-delete="${escapeHtml(record.id)}">Delete</button>
        </div>
      </article>`;
  }).join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
}

async function persist(nextRows = rows) {
  const validated = validateRecords(nextRows, normaliseRecord);
  await recordStore.save(validated);
  rows = validated;
}

function setSection(sectionName) {
  const section = sections.find(item => item.name === sectionName);
  if (!section) return;
  saveActiveSection();
  activeSection = sectionName;
  $("fieldsPanel").hidden = false;
  $("sectionTitle").textContent = section.name;
  $("fieldsGrid").innerHTML = section.fields.map(key => {
    const safeId = "field-" + fieldNames.indexOf(key);
    const isLong = key === "Describe";
    return `
      <div class="field">
        <label for="${safeId}">${escapeHtml(key)}</label>
        ${isLong
          ? '<textarea id="' + safeId + '" data-field="' + escapeHtml(key) + '" rows="3"></textarea>'
          : '<input id="' + safeId + '" data-field="' + escapeHtml(key) + '" type="text" autocomplete="off">'}
      </div>`;
  }).join("");
  if (draft) {
    for (const key of section.fields) {
      const element = document.querySelector('[data-field="' + CSS.escape(key) + '"]');
      if (element) element.value = draft[key] || "";
    }
  }
  document.querySelectorAll(".section-btn").forEach(button => {
    button.classList.toggle("active", button.dataset.section === sectionName);
  });
  updateProgress();
}

function updateProgress() {
  if (!activeSection) return;
  const section = sections.find(item => item.name === activeSection);
  const complete = section.fields.filter(key => {
    const element = document.querySelector('[data-field="' + CSS.escape(key) + '"]');
    return element && element.value.trim();
  }).length;
  $("fieldProgress").textContent = complete.toLocaleString("en-US") + " of " + section.fields.length.toLocaleString("en-US");
}

function fillActiveSection(record) {
  if (!activeSection) return;
  const section = sections.find(item => item.name === activeSection);
  for (const key of section.fields) {
    const element = document.querySelector('[data-field="' + CSS.escape(key) + '"]');
    if (element) element.value = record[key] || "";
  }
  updateProgress();
}

function saveActiveSection() {
  if (!activeSection || !draft) return;
  const section = sections.find(item => item.name === activeSection);
  for (const key of section.fields) {
    const element = document.querySelector('[data-field="' + CSS.escape(key) + '"]');
    if (element) draft[key] = element.value.trim();
  }
}

function collectForm() {
  saveActiveSection();
  const item = { id: editingId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())) };
  const existing = editingId ? rows.find(record => record.id === editingId) : null;
  if (existing?._legacy) item._legacy = existing._legacy;
  for (const key of fieldNames) item[key] = String(draft?.[key] ?? "");
  return item;
}

function resetForm() {
  editingId = null;
  activeSection = null;
  draft = null;
  $("entryForm").reset();
  $("fieldsPanel").hidden = true;
  $("fieldsGrid").innerHTML = "";
  $("sectionTitle").textContent = "";
  $("fieldProgress").textContent = "";
  $("saveBtn").textContent = "Save Observation";
  $("cancelEdit").classList.add("hidden");
  document.querySelectorAll(".section-btn").forEach(button => button.classList.remove("active"));
}

function beginEdit(id) {
  const record = rows.find(item => item.id === id);
  if (!record) return;
  resetForm();
  draft = { ...record };
  editingId = id;
  $("saveBtn").textContent = "Save Changes";
  $("cancelEdit").classList.remove("hidden");
  setSection("Project");
  fillActiveSection(record);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function saveFile(blob, filename) {
  if (Capacitor.isNativePlatform()) {
    const data = await blob.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(data);
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const base64 = btoa(binary);
    const saved = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
    await Share.share({ title: filename, text: "GeoField export file", url: saved.uri, dialogTitle: "Save or share file" });
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

$("sectionList").addEventListener("click", event => {
  if (!storageReady) return;
  const button = event.target.closest("[data-section]");
  if (!button) return;
  if (!draft) draft = {};
  setSection(button.dataset.section);
});
$("fieldsGrid").addEventListener("input", updateProgress);

$("entryForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!storageReady) return;
  const item = collectForm();
  if (!fieldNames.some(key => item[key])) {
    alert("Please complete at least one field.");
    return;
  }
  const nextRows = editingId
    ? rows.map(record => record.id === editingId ? item : record)
    : [...rows, item];
  try {
    await persist(nextRows);
    render();
    resetForm();
  } catch (error) {
    console.error(error);
    alert("The observation could not be saved. Your previously saved records were not replaced.");
  }
});
$("cancelEdit").addEventListener("click", () => {
  if (storageReady) resetForm();
});

$("records").addEventListener("click", async event => {
  if (!storageReady) return;
  const edit = event.target.closest("[data-edit]");
  const del = event.target.closest("[data-delete]");
  if (edit) beginEdit(edit.dataset.edit);
  if (del && confirm("Delete this observation?")) {
    const nextRows = rows.filter(record => record.id !== del.dataset.delete);
    try {
      await persist(nextRows);
      render();
      if (editingId === del.dataset.delete) resetForm();
    } catch (error) {
      console.error(error);
      alert("The observation could not be deleted. Your saved records were not changed.");
    }
  }
});

$("exportXlsx").addEventListener("click", async () => {
  if (!storageReady) return;
  if (!rows.length) {
    alert("There are no records to export yet.");
    return;
  }
  try {
    const data = [fieldNames, ...rows.map(record => fieldNames.map(key => record[key] || ""))];
    const sheet = XLSX.utils.aoa_to_sheet(data);
    sheet["!cols"] = fieldNames.map(() => ({ wch: 20 }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "GeoField");
    const bytes = XLSX.write(book, { bookType: "xlsx", type: "array" });
    await saveFile(new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }), "GeoField-Observations.xlsx");
  } catch (error) {
    console.error(error);
    alert("Failed to create or save the Excel file: " + error.message);
  }
});

$("backup").addEventListener("click", async () => {
  if (!storageReady) return;
  try {
    const blob = new Blob([JSON.stringify({ app: "GeoField", version: 3, records: rows }, null, 2)], {
      type: "application/json"
    });
    await saveFile(blob, "GeoField-Backup.json");
  } catch (error) {
    alert("Failed to create the backup file: " + error.message);
  }
});

$("restoreBtn").addEventListener("click", () => {
  if (storageReady) $("restoreFile").click();
});
$("restoreFile").addEventListener("change", async event => {
  if (!storageReady) return;
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > MAX_BACKUP_BYTES) throw new Error("The backup file exceeds the 10 MB size limit.");
    const parsed = JSON.parse(await file.text());
    const incoming = Array.isArray(parsed) ? parsed : parsed?.records;
    const validated = validateRecords(incoming, normaliseRecord);
    if (!confirm("Restore " + validated.length + " records? Current data will be replaced with the data in this file.")) return;
    await persist(validated);
    render();
    resetForm();
    alert("Backup restored successfully.");
  } catch (error) {
    alert("Failed to restore the backup: " + error.message);
  } finally {
    event.target.value = "";
  }
});

$("clearAll").addEventListener("click", async () => {
  if (!storageReady || !rows.length) return;
  if (confirm("Permanently delete all observations from this device?")) {
    try {
      await persist([]);
      render();
      resetForm();
    } catch (error) {
      console.error(error);
      alert("The records could not be deleted. Your saved data was not changed.");
    }
  }
});

async function initializeStorage() {
  setControlsEnabled(false);
  try {
    rows = await recordStore.load(normaliseRecord);
    storageReady = true;
    render();
    setControlsEnabled(true);
  } catch (error) {
    console.error("GeoField secure storage initialization failed:", error);
    storageReady = false;
    setControlsEnabled(false);
  }
}

initializeStorage();
