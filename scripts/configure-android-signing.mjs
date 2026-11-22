import fs from "node:fs";
import path from "node:path";

const gradlePath = path.join(process.cwd(), "android", "app", "build.gradle");
if (!fs.existsSync(gradlePath)) throw new Error("android/app/build.gradle was not found.");

for (const name of ["ANDROID_KEYSTORE_PATH", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"]) {
  if (!process.env[name]) throw new Error("Missing required release-signing environment variable: " + name);
}

let gradle = fs.readFileSync(gradlePath, "utf8");
if (!/android\s*\{/.test(gradle)) throw new Error("Android Gradle configuration is not in the expected format.");
if (!/buildTypes\s*\{/.test(gradle)) throw new Error("Android buildTypes block was not found.");

if (!/signingConfigs\s*\{/.test(gradle)) {
  gradle = gradle.replace(/(buildTypes\s*\{)/, `signingConfigs {
        release {
            storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }
    }

    $1`);
}

const buildTypesIndex = gradle.search(/buildTypes\s*\{/);
const releaseMatch = /release\s*\{/.exec(gradle.slice(buildTypesIndex));
if (!releaseMatch) throw new Error("The release build type was not found.");
const releaseIndex = buildTypesIndex + releaseMatch.index;
const releaseOpen = gradle.indexOf("{", releaseIndex);
let depth = 0, releaseClose = -1;
for (let i = releaseOpen; i < gradle.length; i++) {
  if (gradle[i] === "{") depth++;
  else if (gradle[i] === "}" && --depth === 0) { releaseClose = i; break; }
}
if (releaseClose < 0) throw new Error("The release build type block is incomplete.");
const releaseBlock = gradle.slice(releaseOpen, releaseClose + 1);
if (!/signingConfig\s+signingConfigs\.release/.test(releaseBlock)) {
  gradle = gradle.slice(0, releaseOpen + 1) + "\n            signingConfig signingConfigs.release" + gradle.slice(releaseOpen + 1);
}
fs.writeFileSync(gradlePath, gradle);
console.log("Android release signing configuration applied.");
