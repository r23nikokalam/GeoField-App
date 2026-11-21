import * as XLSX from "xlsx";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

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

function normaliseRecord(source, index = 0) {
  const legacy = source && typeof source === "object" ? { ...source } : {};
  const item = { id: String(legacy.id || ("restored-" + Date.now() + "-" + index)) };
  for (const key of fieldNames) item[key] = String(legacy[key] ?? "");

  // Preserve the previous seven-field format and map its values into the closest matching columns.
  if (Object.keys(legacy).some(key => ["rockColor","unitName","minerals","alterations","sample","notes","analysis"].includes(key))) {
    item._legacy = legacy._legacy || {
      rockColor: String(legacy.rockColor ?? ""),
      unitName: String(legacy.unitName ?? ""),
      minerals: String(legacy.minerals ?? ""),
      alterations: String(legacy.alterations ?? ""),
      sample: String(legacy.sample ?? ""),
      notes: String(legacy.notes ?? ""),
      analysis: String(legacy.analysis ?? "")
    };
    if (!item.Lithology) item.Lithology = String(legacy.unitName ?? "");
    if (!item.colour) item.colour = String(legacy.rockColor ?? "");
    if (!item.Mineral) item.Mineral = String(legacy.minerals ?? "");
    if (!item.Altration) item.Altration = String(legacy.alterations ?? "");
    if (!item.Index_mine) item.Index_mine = String(legacy.sample ?? "");
    if (!item.Anlz_Typ) item.Anlz_Typ = String(legacy.analysis ?? "");
    if (!item.Describe) item.Describe = String(legacy.notes ?? "");
  } else if (legacy._legacy) {
    item._legacy = legacy._legacy;
  }
  return item;
}

try {
  const stored = JSON.parse(localStorage.getItem("geofield_records") || "[]");
  if (Array.isArray(stored)) rows = stored.map(normaliseRecord);
} catch {
  rows = [];
}

function persist() {
  localStorage.setItem("geofield_records", JSON.stringify(rows));
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
}
function render() {
  $("count").textContent = rows.length.toLocaleString("fa-IR") + " رکورد";
  if (!rows.length) {
    $("records").innerHTML = '<div class="empty">هنوز مشاهده‌ای ثبت نشده است.</div>';
    return;
  }
  $("records").innerHTML = rows.slice().reverse().map(record => {
    const title = record.WPT_NO || record.Profile_No || record.Lithology || record.Id || "مشاهده ثبت‌شده";
    const summaryKeys = ["Date","Geologist","Lithology","X_UTM","Y_UTM","Z_UTM","Mineral","Describe"];
    const summary = summaryKeys.filter(key => record[key]).slice(0, 5)
      .map(key => '<p><b>' + escapeHtml(key) + ':</b> ' + escapeHtml(record[key]) + '</p>').join("");
    const filled = fieldNames.filter(key => record[key]).length;
    return `
      <article class="record">
        <h3>${escapeHtml(title)} <span class="small">— ${filled} فیلد تکمیل‌شده</span></h3>
        ${summary}
        <div class="actions">
          <button type="button" class="secondary" data-edit="${escapeHtml(record.id)}">ویرایش</button>
          <button type="button" class="danger" data-delete="${escapeHtml(record.id)}">حذف</button>
        </div>
      </article>`;
  }).join("");
}
function setSection(sectionName) {
  const section = sections.find(item => item.name === sectionName);
  if (!section) return;
  saveActiveSection();
  activeSection = sectionName;
  $("fieldsPanel").hidden = false;
  $("sectionTitle").textContent = section.name;
  $("fieldsGrid").innerHTML = section.fields.map((key, index) => {
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
  $("fieldProgress").textContent = complete.toLocaleString("fa-IR") + " از " + section.fields.length.toLocaleString("fa-IR");
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
  $("saveBtn").textContent = "ذخیره مشاهده";
  $("cancelEdit").classList.add("hidden");
  document.querySelectorAll(".section-btn").forEach(button => button.classList.remove("active"));
}
function beginEdit(id) {
  const record = rows.find(item => item.id === id);
  if (!record) return;
  resetForm();
  draft = { ...record };
  editingId = id;
  $("saveBtn").textContent = "ذخیره تغییرات";
  $("cancelEdit").classList.remove("hidden");
  setSection("Project");
  fillActiveSection(record);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("sectionList").addEventListener("click", event => {
  const button = event.target.closest("[data-section]");
  if (!button) return;
  if (!draft) draft = {};
  setSection(button.dataset.section);
});
$("fieldsGrid").addEventListener("input", updateProgress);

$("entryForm").addEventListener("submit", event => {
  event.preventDefault();
  const item = collectForm();
  if (!fieldNames.some(key => item[key])) {
    alert("حداقل یک فیلد را تکمیل کنید.");
    return;
  }
  if (editingId) rows = rows.map(record => record.id === editingId ? item : record);
  else rows.push(item);
  persist();
  render();
  resetForm();
});
$("cancelEdit").addEventListener("click", resetForm);

$("records").addEventListener("click", event => {
  const edit = event.target.closest("[data-edit]");
  const del = event.target.closest("[data-delete]");
  if (edit) beginEdit(edit.dataset.edit);
  if (del && confirm("این مشاهده حذف شود؟")) {
    rows = rows.filter(record => record.id !== del.dataset.delete);
    persist();
    render();
    if (editingId === del.dataset.delete) resetForm();
  }
});

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
    await Share.share({ title: filename, text: "فایل خروجی GeoField", url: saved.uri, dialogTitle: "ذخیره یا ارسال فایل" });
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

$("exportXlsx").addEventListener("click", async () => {
  if (!rows.length) {
    alert("هنوز رکوردی برای خروجی وجود ندارد.");
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
    alert("ساخت یا ذخیره فایل Excel ناموفق بود: " + error.message);
  }
});

$("backup").addEventListener("click", async () => {
  try {
    const blob = new Blob([JSON.stringify({ app: "GeoField", version: 2, records: rows }, null, 2)], {
      type: "application/json"
    });
    await saveFile(blob, "GeoField-Backup.json");
  } catch (error) {
    alert("ساخت فایل پشتیبان ناموفق بود: " + error.message);
  }
});

$("restoreBtn").addEventListener("click", () => $("restoreFile").click());
$("restoreFile").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = Array.isArray(parsed) ? parsed : parsed.records;
    if (!Array.isArray(incoming)) throw new Error("ساختار فایل پشتیبان معتبر نیست.");
    if (!confirm("تعداد " + incoming.length + " رکورد بازیابی شود؟ داده‌های فعلی با داده‌های فایل جایگزین می‌شوند.")) return;
    rows = incoming.map(normaliseRecord);
    persist();
    render();
    resetForm();
    alert("بازیابی با موفقیت انجام شد.");
  } catch (error) {
    alert("خواندن فایل ناموفق بود: " + error.message);
  } finally {
    event.target.value = "";
  }
});

$("clearAll").addEventListener("click", () => {
  if (!rows.length) return;
  if (confirm("تمام مشاهدات برای همیشه از این دستگاه حذف شوند؟")) {
    rows = [];
    persist();
    render();
    resetForm();
  }
});

render();