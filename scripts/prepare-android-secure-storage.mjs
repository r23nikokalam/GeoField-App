import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const javaRoot = path.join(root, "android", "app", "src", "main", "java");
const manifestPath = path.join(root, "android", "app", "src", "main", "AndroidManifest.xml");
const pluginSource = path.join(root, "native", "android", "SecureStoragePlugin.java");

function findFile(directory, filename) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, filename);
      if (found) return found;
    } else if (entry.isFile() && entry.name === filename) {
      return full;
    }
  }
  return null;
}

if (!fs.existsSync(javaRoot)) throw new Error("Generated Android Java source directory was not found.");
const activityPath = findFile(javaRoot, "MainActivity.java");
if (!activityPath) throw new Error("Capacitor MainActivity.java was not found; refusing to build without SecureStorage registration.");

let activity = fs.readFileSync(activityPath, "utf8");
const packageMatch = activity.match(/^package\s+([\w.]+);/m);
if (!packageMatch) throw new Error("Could not determine the Android application package.");
const packageName = packageMatch[1];
const packagePath = path.join(javaRoot, ...packageName.split("."));
fs.mkdirSync(packagePath, { recursive: true });

let plugin = fs.readFileSync(pluginSource, "utf8");
plugin = plugin.replace(/^package\s+[\w.]+;/m, "package " + packageName + ";");
fs.writeFileSync(path.join(packagePath, "SecureStoragePlugin.java"), plugin);

if (!activity.includes("registerPlugin(SecureStoragePlugin.class)")) {
  if (!activity.includes("import android.os.Bundle;")) {
    activity = activity.replace(/^(package\s+[\w.]+;)/m, "$1\nimport android.os.Bundle;");
  }
  const classOpen = /public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{/;
  if (!classOpen.test(activity)) throw new Error("Unexpected MainActivity structure; plugin registration was not applied.");
  if (/public\s+void\s+onCreate\s*\(\s*Bundle\s+savedInstanceState\s*\)/.test(activity)) {
    activity = activity.replace(
      /(public\s+void\s+onCreate\s*\(\s*Bundle\s+savedInstanceState\s*\)\s*\{)/,
      "$1\n        registerPlugin(SecureStoragePlugin.class);"
    );
  } else {
    activity = activity.replace(
      classOpen,
      "$&\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        registerPlugin(SecureStoragePlugin.class);\n        super.onCreate(savedInstanceState);\n    }"
    );
  }
  fs.writeFileSync(activityPath, activity);
}

if (!fs.existsSync(manifestPath)) throw new Error("AndroidManifest.xml was not found.");
let manifest = fs.readFileSync(manifestPath, "utf8");

// Capacitor Geolocation requires these declarations before it can request
// Android runtime permissions for approximate or precise location.
for (const permission of [
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_FINE_LOCATION"
]) {
  if (!manifest.includes(`android:name="${permission}"`)) {
    manifest = manifest.replace(/<application\b/, `<uses-permission android:name="${permission}" />\n    <application`);
  }
}
const applicationTag = manifest.match(/<application\b[^>]*>/s);
if (!applicationTag) throw new Error("Android application manifest tag was not found.");
if (/android:allowBackup\s*=/.test(applicationTag[0])) {
  manifest = manifest.replace(/android:allowBackup\s*=\s*["'][^"']*["']/, 'android:allowBackup="false"');
} else {
  manifest = manifest.replace(/<application\b/, '<application android:allowBackup="false"');
}
fs.writeFileSync(manifestPath, manifest);
console.log("SecureStoragePlugin registered; Android app backup disabled.");
