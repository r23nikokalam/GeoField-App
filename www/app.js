import * as XLSX from "xlsx";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

const fields = [
  ["rockColor","رنگ سنگ"],["unitName","نام واحد"],["minerals","کانی‌های موجود"],
  ["alterations","دگرسانی‌های آن"],["sample","نمونه برداشت‌شده"],
  ["notes","توضیحات بیشتر"],["analysis","نوع آنالیز نمونه"]
];
const $ = id => document.getElementById(id);
let rows = [];
let editingId = null;
try { rows = JSON.parse(localStorage.getItem("geofield_records") || "[]"); } catch { rows = []; }

function persist(){ localStorage.setItem("geofield_records", JSON.stringify(rows)); }
function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
function render(){
  $("count").textContent = `${rows.length.toLocaleString("fa-IR")} رکورد`;
  if(!rows.length){ $("records").innerHTML = '<div class="empty">هنوز مشاهده‌ای ثبت نشده است.</div>'; return; }
  $("records").innerHTML = rows.slice().reverse().map(r => `
    <article class="record">
      <h3>${escapeHtml(r.unitName)} <span class="meta">— ${escapeHtml(r.rockColor)}</span></h3>
      ${fields.slice(2).map(([key,label]) => r[key] ? `<p><b>${label}:</b> ${escapeHtml(r[key])}</p>` : "").join("")}
      <div class="actions">
        <button type="button" class="secondary" data-edit="${escapeHtml(r.id)}">ویرایش</button>
        <button type="button" class="danger" data-delete="${escapeHtml(r.id)}">حذف</button>
      </div>
    </article>`).join("");
}
function resetForm(){
  $("entryForm").reset(); editingId=null;
  $("formTitle").textContent="ثبت مشاهده جدید";
  $("saveBtn").textContent="ذخیره مشاهده";
  $("cancelEdit").classList.add("hidden");
}
$("entryForm").addEventListener("submit", e => {
  e.preventDefault();
  const item = {id: editingId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()))};
  for(const [key] of fields) item[key] = $(key).value.trim();
  if(editingId){ rows = rows.map(r => r.id === editingId ? item : r); }
  else { rows.push(item); }
  persist(); render(); resetForm();
});
$("cancelEdit").addEventListener("click", resetForm);
$("records").addEventListener("click", e => {
  const edit = e.target.closest("[data-edit]");
  const del = e.target.closest("[data-delete]");
  if(edit){
    const item = rows.find(r => r.id === edit.dataset.edit);
    if(!item) return;
    for(const [key] of fields) $(key).value = item[key] || "";
    editingId = item.id;
    $("formTitle").textContent="ویرایش مشاهده";
    $("saveBtn").textContent="ذخیره تغییرات";
    $("cancelEdit").classList.remove("hidden");
    window.scrollTo({top:0,behavior:"smooth"});
  }
  if(del && confirm("این مشاهده حذف شود؟")){
    rows = rows.filter(r => r.id !== del.dataset.delete); persist(); render();
    if(editingId === del.dataset.delete) resetForm();
  }
});
async function saveFile(blob, filename, mime){
  if(Capacitor.isNativePlatform()){
    const data = await blob.arrayBuffer();
    let binary = ""; const bytes = new Uint8Array(data);
    for(let i=0;i<bytes.length;i+=0x8000) binary += String.fromCharCode(...bytes.subarray(i,i+0x8000));
    const base64 = btoa(binary);
    const saved = await Filesystem.writeFile({path:filename,data:base64,directory:Directory.Cache});
    await Share.share({title:filename,text:"فایل خروجی GeoField",url:saved.uri,dialogTitle:"ذخیره یا ارسال فایل"});
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href=url; a.download=filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
$("exportXlsx").addEventListener("click", async ()=>{
  if(!rows.length){ alert("هنوز رکوردی برای خروجی وجود ندارد."); return; }
  try{
    const data = [fields.map(([,label])=>label), ...rows.map(r=>fields.map(([key])=>r[key] || ""))];
    const sheet = XLSX.utils.aoa_to_sheet(data);
    sheet["!cols"] = fields.map(()=>({wch:22}));
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book,sheet,"مشاهدات");
    const bytes = XLSX.write(book,{bookType:"xlsx",type:"array"});
    await saveFile(new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),"GeoField-Observations.xlsx");
  }catch(err){ console.error(err); alert("ساخت یا ذخیره فایل Excel ناموفق بود: "+err.message); }
});
$("backup").addEventListener("click", async ()=>{
  try{
    const blob = new Blob([JSON.stringify({app:"GeoField",version:1,records:rows},null,2)],{type:"application/json"});
    await saveFile(blob,"GeoField-Backup.json","application/json");
  }catch(err){ alert("ساخت فایل پشتیبان ناموفق بود: "+err.message); }
});
$("restoreBtn").addEventListener("click",()=>$("restoreFile").click());
$("restoreFile").addEventListener("change",async e=>{
  const file=e.target.files?.[0]; if(!file) return;
  try{
    const parsed=JSON.parse(await file.text());
    const incoming=Array.isArray(parsed)?parsed:parsed.records;
    if(!Array.isArray(incoming)) throw new Error("ساختار فایل پشتیبان معتبر نیست.");
    if(!confirm(`تعداد ${incoming.length} رکورد بازیابی شود؟ داده‌های فعلی با داده‌های فایل جایگزین می‌شوند.`)) return;
    rows=incoming.map((r,i)=>{
      const item={id:String(r.id || ("restored-"+Date.now()+"-"+i))};
      for(const [key] of fields) item[key]=String(r[key] ?? "");
      return item;
    });
    persist(); render(); resetForm(); alert("بازیابی با موفقیت انجام شد.");
  }catch(err){ alert("خواندن فایل ناموفق بود: "+err.message); }
  finally{ e.target.value=""; }
});
$("clearAll").addEventListener("click",()=>{
  if(!rows.length) return;
  if(confirm("تمام مشاهدات برای همیشه از این دستگاه حذف شوند؟")){
    rows=[];persist();render();resetForm();
  }
});
render();