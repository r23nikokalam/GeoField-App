import * as XLSX from "xlsx";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Geolocation } from "@capacitor/geolocation";
import { encryptBackupPayload, decryptBackupPayload, isEncryptedBackup } from "./backup-crypto.js";
import { buildProjectReport } from "./report-pdf.js";
import { vocabularyForField } from "./geology-vocabulary.js";
import { SecureRecordStore, validateRecords } from "./secure-record-store.js";
import { createProject, createSample, migrateLegacyRecords, validateWorkspace } from "./domain-model.js";

const SecureStorage = registerPlugin("SecureStorage");
const recordStore = new SecureRecordStore({
  native: Capacitor.isNativePlatform(),
  plugin: SecureStorage
});

const sections = [
  { name: "Project", fields: ["FID","Id","WPT_NO","Date","Geologist","Profile_No"] },
  { name: "Coordinate", fields: ["X_UTM","Y_UTM","Z_UTM","GPS_Latitude","GPS_Longitude","GPS_Accuracy_m","GPS_Altitude_m","GPS_Timestamp"] },
  { name: "Geology", fields: ["Lithology","colour","colour Modifier","Contact","Altration","Weak","Moderate","Strong","Mineral","Structur"] },
  { name: "Layer Structure", fields: ["Azimut_lay","Dip","DDirection","Length","Thickness"] },
  { name: "Fault", fields: ["Type_Fault","Azim_Fault","Dip_Fault","Dddirection_Fault"] },
  { name: "Sample", fields: ["Anlz","Anlz_Typ","Index_mine","Pic_Num"] },
  { name: "Describe", fields: ["Describe"] }
];
const fieldNames = sections.flatMap(section => section.fields);
const $ = id => document.getElementById(id);
let rows = [];
let workspace = null;
let activeProjectId = null;
let editingId = null;
let activeSection = null;
let draft = null;
let storageReady = false;
let editingSampleId = null;
let backupPasswordResolver = null;
let backupPasswordNeedsConfirmation = false;

const MAX_BACKUP_BYTES = 15 * 1024 * 1024;
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

  const item = { id: rawId, projectId: typeof legacy.projectId === "string" ? legacy.projectId : "" };
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

function finishBackupPassword(value) {
  const resolve = backupPasswordResolver;
  backupPasswordResolver = null;
  const dialog = $("backupPasswordDialog");
  if (dialog.open && typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
  $("backupPasswordForm").reset();
  resolve?.(value);
}

function requestBackupPassword(confirmPassword = false) {
  return new Promise(resolve => {
    if (backupPasswordResolver) finishBackupPassword(null);
    backupPasswordResolver = resolve;
    backupPasswordNeedsConfirmation = confirmPassword;
    $("backupPasswordTitle").textContent = confirmPassword ? "Create Encrypted Backup" : "Restore Encrypted Backup";
    $("backupPasswordHint").textContent = confirmPassword
      ? "Choose a password between 10 and 256 characters. GeoField does not store it; losing it makes this backup unrecoverable."
      : "Enter the password used when this backup was created.";
    $("backupPasswordConfirmField").hidden = !confirmPassword;
    $("backupPasswordConfirm").required = confirmPassword;
    $("backupPasswordInput").autocomplete = confirmPassword ? "new-password" : "current-password";
    $("backupPasswordError").textContent = "";
    $("backupPasswordInput").value = "";
    $("backupPasswordConfirm").value = "";
    const dialog = $("backupPasswordDialog");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    $("backupPasswordInput").focus();
  });
}

$("backupPasswordForm").addEventListener("submit", event => {
  event.preventDefault();
  const password = $("backupPasswordInput").value;
  if (password.length < 10 || password.length > 256) {
    $("backupPasswordError").textContent = "Password must contain 10 to 256 characters.";
    return;
  }
  if (backupPasswordNeedsConfirmation && password !== $("backupPasswordConfirm").value) {
    $("backupPasswordError").textContent = "The passwords do not match.";
    $("backupPasswordConfirm").focus();
    return;
  }
  finishBackupPassword(password);
});
$("backupPasswordCancel").addEventListener("click", () => finishBackupPassword(null));
$("backupPasswordDialog").addEventListener("cancel", event => {
  event.preventDefault();
  finishBackupPassword(null);
});

const PREFERENCES_KEY = "geofield_ui_preferences";

function applyDisplayPreferences() {
  let preferences = {};
  try {
    preferences = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "{}");
  } catch { preferences = {}; }
  const dark = preferences.darkMode === true;
  const scale = Number.isFinite(Number(preferences.fontScale))
    ? Math.min(1.3, Math.max(0.9, Number(preferences.fontScale))) : 1;
  document.body.classList.toggle("dark-mode", dark);
  document.documentElement.style.setProperty("--font-scale", String(scale));
  $("darkModeToggle").checked = dark;
  $("fontScale").value = String(scale);
  $("fontScaleValue").textContent = Math.round(scale * 100) + "%";
}

function saveDisplayPreferences() {
  const preferences = {
    darkMode: $("darkModeToggle").checked,
    fontScale: Number($("fontScale").value)
  };
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch (error) {
    console.warn("Display preferences could not be saved:", error);
  }
  applyDisplayPreferences();
}

function setControlsEnabled(enabled) {
  document.querySelectorAll("button, input, textarea, select").forEach(element => {
    element.disabled = !enabled;
  });
}

function renderProjects() {
  const select = $("activeProject");
  if (!select || !workspace) return;
  select.innerHTML = workspace.projects.map(project =>
    '<option value="' + escapeHtml(project.id) + '">' + escapeHtml(project.name) + '</option>'
  ).join("");
  if (activeProjectId && workspace.projects.some(project => project.id === activeProjectId)) {
    select.value = activeProjectId;
  } else {
    activeProjectId = workspace.projects[0]?.id || null;
    select.value = activeProjectId || "";
  }
  const hasProject = Boolean(activeProjectId);
  $("projectName").disabled = !storageReady;
  $("addProject").disabled = !storageReady;
  $("editProject").disabled = !storageReady || !hasProject;
  $("deleteProject").disabled = !storageReady || !hasProject ||
    rows.some(record => record.projectId === activeProjectId) ||
    workspace.samples.some(sample => sample.projectId === activeProjectId) ||
    workspace.projects.length <= 1;
  $("activeProject").disabled = !storageReady || !hasProject;
  $("saveBtn").disabled = !storageReady || !hasProject;
}

function renderSamples() {
  const form = $("sampleForm");
  const list = $("sampleList");
  const projectSamples = (workspace?.samples || []).filter(sample => sample.projectId === activeProjectId);
  const projectRows = rows.filter(record => record.projectId === activeProjectId);
  $("sampleObservation").innerHTML = '<option value="">Not linked</option>' + projectRows.map(record => {
    const label = record.WPT_NO || record.Profile_No || record.Lithology || record.id;
    return '<option value="' + escapeHtml(record.id) + '">' + escapeHtml(label) + '</option>';
  }).join("");
  form.querySelectorAll("input,select,textarea,button").forEach(element => {
    element.disabled = !storageReady || !activeProjectId;
  });
  if (!projectSamples.length) {
    list.innerHTML = '<div class="empty">No samples registered in this project.</div>';
    return;
  }
  list.innerHTML = projectSamples.slice().reverse().map(sample => {
    const linked = sample.observationId
      ? projectRows.find(record => record.id === sample.observationId)
      : null;
    return '<article class="record"><h3>' + escapeHtml(sample.code) +
      ' <span class="small">— ' + escapeHtml(sample.sampleType || "Sample") + '</span></h3>' +
      (sample.material ? '<p><b>Material:</b> ' + escapeHtml(sample.material) + '</p>' : '') +
      (linked ? '<p><b>Observation:</b> ' + escapeHtml(linked.WPT_NO || linked.Profile_No || linked.id) + '</p>' : '') +
      (sample.notes ? '<p>' + escapeHtml(sample.notes) + '</p>' : '') +
      '<div class="actions"><button type="button" class="secondary" data-edit-sample="' +
      escapeHtml(sample.id) + '">Edit</button><button type="button" class="danger" data-delete-sample="' +
      escapeHtml(sample.id) + '">Delete Sample</button></div></article>';
  }).join("");
}

function render() {
  const projectRows = rows.filter(record => record.projectId === activeProjectId);
  const query = $("recordSearch").value.trim().toLocaleLowerCase();
  const geologist = $("filterGeologist").value.trim().toLocaleLowerCase();
  const lithology = $("filterLithology").value.trim().toLocaleLowerCase();
  const dateFrom = $("filterDateFrom").value;
  const dateTo = $("filterDateTo").value;
  const filteredRows = projectRows.filter(record => {
    if (query && ![record.id, ...fieldNames.map(key => record[key] || "")]
      .join(" ").toLocaleLowerCase().includes(query)) return false;
    if (geologist && !String(record.Geologist || "").toLocaleLowerCase().includes(geologist)) return false;
    if (lithology && !String(record.Lithology || "").toLocaleLowerCase().includes(lithology)) return false;
    const date = String(record.Date || "").slice(0, 10);
    if (dateFrom && (!date || date < dateFrom)) return false;
    if (dateTo && (!date || date > dateTo)) return false;
    return true;
  });
  $("count").textContent = filteredRows.length.toLocaleString("en-US") +
    " of " + projectRows.length.toLocaleString("en-US") + " records";
  if (!filteredRows.length) {
    $("records").innerHTML = '<div class="empty">No observations match the current filters.</div>';
    return;
  }
  $("records").innerHTML = filteredRows.slice().reverse().map(record => {
    const title = record.WPT_NO || record.Profile_No || record.Lithology || record.Id || "Saved observation";
    const summaryKeys = ["Date","Geologist","Lithology","X_UTM","Y_UTM","Z_UTM","GPS_Latitude","GPS_Longitude","Mineral","Describe"];
    const summary = summaryKeys.filter(key => record[key]).slice(0, 6)
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
  const nextWorkspace = validateWorkspace({
    ...workspace,
    observations: validated
  });
  await recordStore.saveWorkspace(nextWorkspace, validateWorkspace);
  workspace = nextWorkspace;
  rows = validated;
}

function setSection(sectionName) {
  const section = sections.find(item => item.name === sectionName);
  if (!section) return;
  saveActiveSection();
  activeSection = sectionName;
  $("fieldsPanel").hidden = false;
  $("gpsControls").hidden = section.name !== "Coordinate";
  $("sectionTitle").textContent = section.name;
  $("fieldsGrid").innerHTML = section.fields.map(key => {
    const safeId = "field-" + fieldNames.indexOf(key);
    const isLong = key === "Describe";
    const suggestions = vocabularyForField(key);
    const listId = "vocab-" + fieldNames.indexOf(key);
    const inputMarkup = isLong
      ? '<textarea id="' + safeId + '" data-field="' + escapeHtml(key) + '" rows="3"></textarea>'
      : '<input id="' + safeId + '" data-field="' + escapeHtml(key) + '" type="text" autocomplete="off"' +
        (suggestions.length ? ' list="' + listId + '"' : '') + '>';
    const datalistMarkup = suggestions.length
      ? '<datalist id="' + listId + '">' + suggestions.map(value => '<option value="' + escapeHtml(value) + '"></option>').join("") + '</datalist>'
      : "";
    return `
      <div class="field">
        <label for="${safeId}">${escapeHtml(key)}</label>
        ${inputMarkup}
        ${datalistMarkup}
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
  if (!activeProjectId) throw new Error("Select or create a project before saving an observation.");
  const existing = editingId ? rows.find(record => record.id === editingId) : null;
  const item = {
    id: editingId || (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : (() => { throw new Error("Secure random ID generation is unavailable on this device."); })()),
    projectId: existing?.projectId || activeProjectId
  };
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
  $("gpsControls").hidden = true;
  $("gpsStatus").textContent = "";
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
  activeProjectId = record.projectId;
  renderProjects();
  renderSamples();
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

$("darkModeToggle").addEventListener("change", saveDisplayPreferences);
$("fontScale").addEventListener("input", saveDisplayPreferences);
applyDisplayPreferences();

$("activeProject").addEventListener("change", () => {
  if (!storageReady) return;
  activeProjectId = $("activeProject").value;
  resetSampleForm();
  renderSamples();
  render();
  resetForm();
});
$("addProject").addEventListener("click", async () => {
  if (!storageReady) return;
  const name = $("projectName").value.trim();
  if (!name) {
    alert("Enter a project name.");
    return;
  }
  try {
    const project = createProject({ name });
    const nextWorkspace = validateWorkspace({
      ...workspace,
      projects: [...workspace.projects, project]
    });
    await recordStore.saveWorkspace(nextWorkspace, validateWorkspace);
    workspace = nextWorkspace;
    activeProjectId = project.id;
    $("projectName").value = "";
    renderProjects();
    renderSamples();
    render();
    resetForm();
  } catch (error) {
    alert("The project could not be created: " + error.message);
  }
});

$("editProject").addEventListener("click", () => {
  if (!storageReady || !activeProjectId) return;
  const project = workspace.projects.find(item => item.id === activeProjectId);
  if (!project) return;
  $("editProjectName").value = project.name;
  $("editProjectCode").value = project.code;
  $("editProjectClient").value = project.client;
  $("editProjectArea").value = project.area;
  $("editProjectDescription").value = project.description;
  $("editCoordinateSystem").value = project.coordinateSystem || "Unknown";
  $("editDatum").value = project.datum || "";
  $("editUtmZone").value = project.utmZone || "";
  $("editHemisphere").value = project.hemisphere || "";
  $("editHorizontalUnit").value = project.horizontalUnit || "";
  $("editVerticalDatum").value = project.verticalDatum || "";
  $("editElevationUnit").value = project.elevationUnit || "";
  $("projectEditForm").hidden = false;
});
$("cancelProjectEdit").addEventListener("click", () => {
  $("projectEditForm").reset();
  $("projectEditForm").hidden = true;
});
$("projectEditForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!storageReady || !activeProjectId) return;
  try {
    const current = workspace.projects.find(item => item.id === activeProjectId);
    if (!current) throw new Error("The selected project no longer exists.");
    const updated = createProject({
      ...current,
      name: $("editProjectName").value,
      code: $("editProjectCode").value,
      client: $("editProjectClient").value,
      area: $("editProjectArea").value,
      description: $("editProjectDescription").value,
      coordinateSystem: $("editCoordinateSystem").value,
      datum: $("editDatum").value,
      utmZone: $("editUtmZone").value,
      hemisphere: $("editHemisphere").value,
      horizontalUnit: $("editHorizontalUnit").value,
      verticalDatum: $("editVerticalDatum").value,
      elevationUnit: $("editElevationUnit").value,
      updatedAt: new Date().toISOString()
    });
    const nextWorkspace = validateWorkspace({
      ...workspace,
      projects: workspace.projects.map(item => item.id === activeProjectId ? updated : item)
    });
    await recordStore.saveWorkspace(nextWorkspace, validateWorkspace);
    workspace = nextWorkspace;
    $("projectEditForm").hidden = true;
    $("projectEditForm").reset();
    renderProjects();
    render();
  } catch (error) {
    alert("Project details could not be saved: " + error.message);
  }
});
$("deleteProject").addEventListener("click", async () => {
  if (!storageReady || !activeProjectId || workspace.projects.length <= 1) return;
  const hasObservations = rows.some(record => record.projectId === activeProjectId);
  const hasSamples = workspace.samples.some(sample => sample.projectId === activeProjectId);
  if (hasObservations || hasSamples) {
    alert("This project contains observations or samples. Export or remove those records before deleting the project.");
    return;
  }
  const project = workspace.projects.find(item => item.id === activeProjectId);
  if (!project || !confirm('Delete the empty project "' + project.name + '"?')) return;
  try {
    const nextWorkspace = validateWorkspace({
      ...workspace,
      projects: workspace.projects.filter(item => item.id !== activeProjectId)
    });
    await recordStore.saveWorkspace(nextWorkspace, validateWorkspace);
    workspace = nextWorkspace;
    activeProjectId = workspace.projects[0].id;
    $("projectEditForm").hidden = true;
    renderProjects();
    renderSamples();
    render();
    resetForm();
  } catch (error) {
    alert("The project could not be deleted: " + error.message);
  }
});

function resetSampleForm() {
  editingSampleId = null;
  $("sampleForm").reset();
  $("saveSampleBtn").textContent = "Save Sample";
  $("cancelSampleEdit").classList.add("hidden");
}

$("cancelSampleEdit").addEventListener("click", resetSampleForm);
$("sampleForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!storageReady || !activeProjectId) return;
  try {
    const existing = editingSampleId ? workspace.samples.find(item => item.id === editingSampleId) : null;
    if (editingSampleId && !existing) throw new Error("The sample no longer exists.");
    const normalizedCode = $("sampleCode").value.trim().toLocaleLowerCase();
    if (workspace.samples.some(item => item.projectId === activeProjectId &&
        item.id !== editingSampleId && item.code.trim().toLocaleLowerCase() === normalizedCode)) {
      throw new Error("A sample with this code already exists in the active project.");
    }
    const sample = createSample({
      id: existing?.id,
      code: $("sampleCode").value,
      sampleType: $("sampleType").value,
      material: $("sampleMaterial").value,
      observationId: $("sampleObservation").value,
      notes: $("sampleNotes").value,
      projectId: existing?.projectId || activeProjectId,
      collectedAt: existing?.collectedAt || new Date().toISOString()
    });
    const nextWorkspace = validateWorkspace({
      ...workspace,
      samples: existing
        ? workspace.samples.map(item => item.id === editingSampleId ? sample : item)
        : [...workspace.samples, sample]
    });
    await recordStore.saveWorkspace(nextWorkspace, validateWorkspace);
    workspace = nextWorkspace;
    resetSampleForm();
    renderSamples();
  } catch (error) {
    alert("The sample could not be saved: " + error.message);
  }
});

$("sampleList").addEventListener("click", async event => {
  const editButton = event.target.closest("[data-edit-sample]");
  const deleteButton = event.target.closest("[data-delete-sample]");
  if (!storageReady) return;
  if (editButton) {
    const sample = workspace.samples.find(item => item.id === editButton.dataset.editSample);
    if (!sample) return;
    editingSampleId = sample.id;
    $("sampleCode").value = sample.code;
    $("sampleType").value = sample.sampleType;
    $("sampleMaterial").value = sample.material;
    $("sampleObservation").value = sample.observationId;
    $("sampleNotes").value = sample.notes;
    $("saveSampleBtn").textContent = "Save Changes";
    $("cancelSampleEdit").classList.remove("hidden");
    $("sampleForm").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (!deleteButton || !confirm("Delete this sample record?")) return;
  try {
    const nextWorkspace = validateWorkspace({
      ...workspace,
      samples: workspace.samples.filter(sample => sample.id !== deleteButton.dataset.deleteSample)
    });
    await recordStore.saveWorkspace(nextWorkspace, validateWorkspace);
    workspace = nextWorkspace;
    if (editingSampleId === deleteButton.dataset.deleteSample) resetSampleForm();
    renderSamples();
  } catch (error) {
    alert("The sample could not be deleted: " + error.message);
  }
});
$("gpsCapture").addEventListener("click", async () => {
  if (!storageReady || activeSection !== "Coordinate") return;
  const button = $("gpsCapture");
  const status = $("gpsStatus");
  button.disabled = true;
  status.textContent = "Requesting current position…";
  try {
    if (Capacitor.isNativePlatform()) {
      let permission = await Geolocation.checkPermissions();
      if (permission.location !== "granted" && permission.coarseLocation !== "granted") {
        permission = await Geolocation.requestPermissions();
      }
      if (permission.location !== "granted" && permission.coarseLocation !== "granted") {
        throw new Error("Location permission was not granted.");
      }
    }
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0
    });
    if (!draft) draft = {};
    draft.GPS_Latitude = position.coords.latitude.toFixed(7);
    draft.GPS_Longitude = position.coords.longitude.toFixed(7);
    draft.GPS_Accuracy_m = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy.toFixed(1) : "";
    draft.GPS_Altitude_m = Number.isFinite(position.coords.altitude) ? position.coords.altitude.toFixed(1) : "";
    draft.GPS_Timestamp = new Date(position.timestamp || Date.now()).toISOString();
    fillActiveSection(draft);
    status.textContent = "Captured in WGS 84 (EPSG:4326). Accuracy: " +
      (draft.GPS_Accuracy_m ? draft.GPS_Accuracy_m + " m" : "unknown") +
      ". Review before saving the observation.";
  } catch (error) {
    console.error("GPS capture failed:", error);
    status.textContent = "Position unavailable: " + (error.message || "Check location services and permissions.");
  } finally {
    button.disabled = !storageReady;
  }
});

$("sectionList").addEventListener("click", event => {
  if (!storageReady) return;
  const button = event.target.closest("[data-section]");
  if (!button) return;
  if (!draft) draft = {};
  setSection(button.dataset.section);
});
$("fieldsGrid").addEventListener("input", updateProgress);
["recordSearch","filterGeologist","filterLithology","filterDateFrom","filterDateTo"].forEach(id => {
  $(id).addEventListener("input", render);
});

$("entryForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!storageReady) return;
  try {
    const item = collectForm();
    if (!fieldNames.some(key => item[key])) {
      alert("Please complete at least one field.");
      return;
    }
    const nextRows = editingId
      ? rows.map(record => record.id === editingId ? item : record)
      : [...rows, item];
    await persist(nextRows);
    renderSamples();
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
      const nextWorkspace = validateWorkspace({
        ...workspace,
        observations: validateRecords(nextRows, normaliseRecord),
        samples: workspace.samples.map(sample =>
          sample.observationId === del.dataset.delete ? { ...sample, observationId: "" } : sample)
      });
      await recordStore.saveWorkspace(nextWorkspace, validateWorkspace);
      workspace = nextWorkspace;
      rows = nextWorkspace.observations;
      renderSamples();
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
  const project = workspace.projects.find(item => item.id === activeProjectId);
  if (!project) return;
  const projectRows = rows.filter(record => record.projectId === activeProjectId);
  const projectSamples = workspace.samples.filter(sample => sample.projectId === activeProjectId);
  if (!projectRows.length && !projectSamples.length) {
    alert("There are no observations or samples in this project to export yet.");
    return;
  }
  try {
    const book = XLSX.utils.book_new();
    const projectData = [
      ["Project Property", "Value"],
      ["Project Name", project.name],
      ["Project Code", project.code],
      ["Client", project.client],
      ["Project Area", project.area],
      ["Description", project.description],
      ["Coordinate System", project.coordinateSystem || "Unknown"],
      ["Horizontal Datum", project.datum || "Unknown"],
      ["UTM Zone", project.utmZone || "Unknown"],
      ["Hemisphere", project.hemisphere || "Unknown"],
      ["Horizontal Unit", project.horizontalUnit || "Unknown"],
      ["Vertical Datum", project.verticalDatum || "Unknown"],
      ["Elevation Unit", project.elevationUnit || "Unknown"],
      ["Created At", project.createdAt],
      ["Last Updated", project.updatedAt],
      ["Exported At", new Date().toISOString()]
    ];
    const projectSheet = XLSX.utils.aoa_to_sheet(projectData);
    projectSheet["!cols"] = [{ wch: 24 }, { wch: 48 }];
    XLSX.utils.book_append_sheet(book, projectSheet, "Project");

    const observationHeaders = ["Record ID", ...fieldNames];
    const observationData = [
      observationHeaders,
      ...projectRows.map(record => [record.id, ...fieldNames.map(key => record[key] || "")])
    ];
    const observationSheet = XLSX.utils.aoa_to_sheet(observationData);
    observationSheet["!cols"] = observationHeaders.map(() => ({ wch: 20 }));
    XLSX.utils.book_append_sheet(book, observationSheet, "Observations");

    const sampleHeaders = ["Sample ID", "Sample Code", "Sample Type", "Material", "Observation ID", "Notes", "Collected At"];
    const sampleData = [
      sampleHeaders,
      ...projectSamples.map(sample => [
        sample.id, sample.code, sample.sampleType, sample.material,
        sample.observationId, sample.notes, sample.collectedAt
      ])
    ];
    const sampleSheet = XLSX.utils.aoa_to_sheet(sampleData);
    sampleSheet["!cols"] = sampleHeaders.map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(book, sampleSheet, "Samples");

    const bytes = XLSX.write(book, { bookType: "xlsx", type: "array" });
    const safeCode = (project.code || project.name || "Project").replace(/[^a-z0-9_-]+/gi, "-");
    await saveFile(new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }), "GeoField-" + safeCode + "-Export.xlsx");
  } catch (error) {
    console.error(error);
    alert("Failed to create or save the Excel file: " + error.message);
  }
});
$("exportPdf").addEventListener("click", async () => {
  if (!storageReady) return;
  const project = workspace.projects.find(item => item.id === activeProjectId);
  if (!project) return;
  try {
    const observations = rows.filter(record => record.projectId === activeProjectId);
    const samples = workspace.samples.filter(sample => sample.projectId === activeProjectId);
    const bytes = await buildProjectReport({ project, observations, samples });
    const safeCode = (project.code || project.name || "Project").replace(/[^a-z0-9_-]+/gi, "-");
    await saveFile(new Blob([bytes], { type: "application/pdf" }), "GeoField-" + safeCode + "-Report.pdf");
  } catch (error) {
    console.error("PDF report generation failed:", error);
    alert("The PDF report could not be generated: " + error.message);
  }
});

$("backup").addEventListener("click", async () => {
  if (!storageReady) return;
  const password = await requestBackupPassword(true);
  if (password === null) return;
  try {
    const payload = { app: "GeoField", version: 4, workspace };
    const encrypted = await encryptBackupPayload(payload, password);
    const blob = new Blob([JSON.stringify(encrypted, null, 2)], { type: "application/json" });
    await saveFile(blob, "GeoField-Encrypted-Backup.json");
  } catch (error) {
    alert("Failed to create the encrypted backup: " + error.message);
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
    if (file.size > MAX_BACKUP_BYTES) throw new Error("The backup file exceeds the 15 MB size limit.");
    let parsed = JSON.parse(await file.text());
    if (isEncryptedBackup(parsed)) {
      const password = await requestBackupPassword(false);
      if (password === null) return;
      parsed = await decryptBackupPayload(parsed, password);
    } else if (!confirm("This is a legacy unencrypted backup. Continue restoring it? New backups created by GeoField are password-encrypted.")) {
      return;
    }
    let incomingWorkspace;
    if (parsed && typeof parsed === "object" && parsed.workspace) {
      incomingWorkspace = validateWorkspace(parsed.workspace);
    } else if (parsed && typeof parsed === "object" &&
               Object.prototype.hasOwnProperty.call(parsed, "schemaVersion")) {
      incomingWorkspace = validateWorkspace(parsed);
    } else {
      const incoming = Array.isArray(parsed) ? parsed : parsed?.records;
      incomingWorkspace = migrateLegacyRecords(validateRecords(incoming, normaliseRecord));
    }
    if (!confirm("Restore " + incomingWorkspace.observations.length +
        " observations across " + incomingWorkspace.projects.length +
        " projects? Current data will be replaced with the backup.")) return;
    await recordStore.saveWorkspace(incomingWorkspace, validateWorkspace);
    workspace = incomingWorkspace;
    rows = workspace.observations;
    activeProjectId = workspace.projects[0]?.id || null;
    renderProjects();
    renderSamples();
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
  const projectRows = rows.filter(record => record.projectId === activeProjectId);
  if (!storageReady || !projectRows.length) return;
  if (confirm("Permanently delete all observations in this project?")) {
    try {
      const retained = rows.filter(record => record.projectId !== activeProjectId);
      const nextWorkspace = validateWorkspace({
        ...workspace,
        observations: retained,
        samples: workspace.samples.filter(sample => sample.projectId !== activeProjectId)
      });
      await recordStore.saveWorkspace(nextWorkspace, validateWorkspace);
      workspace = nextWorkspace;
      rows = retained;
      renderSamples();
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
  const status = $("storageStatus");
  try {
    workspace = await recordStore.loadWorkspace({
      validateWorkspace,
      migrateLegacyRecords,
      normaliseRecord
    });
    if (!workspace.projects.length) {
      const initialProject = createProject({ name: "Field Project", code: "FIELD-001" });
      workspace = validateWorkspace({ ...workspace, projects: [initialProject] });
      await recordStore.saveWorkspace(workspace, validateWorkspace);
    }
    rows = workspace.observations;
    activeProjectId = workspace.projects[0]?.id || null;
    storageReady = true;
    renderProjects();
    renderSamples();
    render();
    setControlsEnabled(true);
    renderProjects();
    renderSamples();
  } catch (error) {
    console.error("GeoField secure storage initialization failed:", error);
    status.textContent = "Storage initialization failed. Editing is locked to protect your existing data. Do not clear app data or reinstall the app. " + error.message;
    status.classList.add("storage-error");
    status.hidden = false;
    storageReady = false;
    setControlsEnabled(false);
  }
}

initializeStorage();
