import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const variablesPath = path.join(root, "android", "variables.gradle");
const manifestPath = path.join(root, "android", "app", "src", "main", "AndroidManifest.xml");
const xmlDir = path.join(root, "android", "app", "src", "main", "res", "xml");

if (!fs.existsSync(variablesPath) || !fs.existsSync(manifestPath)) {
  throw new Error("Generated Capacitor Android project is incomplete.");
}

// Capacitor 8 is the supported major line for Android API 36.
let variables = fs.readFileSync(variablesPath, "utf8");
for (const [name, value] of [["minSdkVersion", 24], ["compileSdkVersion", 36], ["targetSdkVersion", 36]]) {
  const pattern = new RegExp("(\\\\b" + name + "\\\\s*=\\\\s*)\\\\d+");
  if (!pattern.test(variables)) {
    throw new Error("Could not safely locate " + name + " in variables.gradle.");
  }
  variables = variables.replace(pattern, "$1" + value);
}
fs.writeFileSync(variablesPath, variables);

let manifest = fs.readFileSync(manifestPath, "utf8");

// GeoField is intentionally offline and must not request broad device access.
const forbidden = new Set([
  "android.permission.INTERNET",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_BACKGROUND_LOCATION",
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.MANAGE_EXTERNAL_STORAGE",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_MEDIA_AUDIO",
  "android.permission.READ_MEDIA_VISUAL_USER_SELECTED"
]);

manifest = manifest.replace(/<uses-permission\\\\b[^>]*\\\\bandroid:name\\\\s*=\\\\s*["']([^"']+)["'][^>]*\\\\/?>/g,
  (tag, permission) => forbidden.has(permission) ? "" : tag);

const appTag = manifest.match(/<application\\\\b[^>]*>/s);
if (!appTag) throw new Error("Android application element was not found.");

function setAttribute(source, name, value) {
  const pattern = new RegExp("\\\\s+" + name + '="[^"]*"');
  if (pattern.test(source)) return source.replace(pattern, " " + name + '="' + value + '"');
  return source.replace(/>$/, " " + name + '="' + value + '">');
}

let application = appTag[0];
application = setAttribute(application, "android:allowBackup", "false");
application = setAttribute(application, "android:fullBackupContent", "@xml/backup_rules");
application = setAttribute(application, "android:dataExtractionRules", "@xml/data_extraction_rules");
manifest = manifest.replace(appTag[0], application);
fs.writeFileSync(manifestPath, manifest);

fs.mkdirSync(xmlDir, { recursive: true });
fs.writeFileSync(path.join(xmlDir, "backup_rules.xml"), `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
    <exclude domain="root" path="."/>
    <exclude domain="file" path="."/>
    <exclude domain="database" path="."/>
    <exclude domain="sharedpref" path="."/>
    <exclude domain="external" path="."/>
</full-backup-content>
`);
fs.writeFileSync(path.join(xmlDir, "data_extraction_rules.xml"), `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup>
        <exclude domain="root" path="."/>
        <exclude domain="file" path="."/>
        <exclude domain="database" path="."/>
        <exclude domain="sharedpref" path="."/>
        <exclude domain="external" path="."/>
    </cloud-backup>
    <device-transfer>
        <exclude domain="root" path="."/>
        <exclude domain="file" path="."/>
        <exclude domain="database" path="."/>
        <exclude domain="sharedpref" path="."/>
        <exclude domain="external" path="."/>
    </device-transfer>
</data-extraction-rules>
`);

const remainingForbidden = [...manifest.matchAll(/<uses-permission\\\\b[^>]*\\\\bandroid:name\\\\s*=\\\\s*["']([^"']+)["'][^>]*\\\\/?>/g)]
  .map(match => match[1]).filter(permission => forbidden.has(permission));
if (remainingForbidden.length) {
  throw new Error("Forbidden Android permissions remain: " + remainingForbidden.join(", "));
}

console.log("Play release configuration applied: API 36, offline permission policy, and explicit backup exclusions.");
