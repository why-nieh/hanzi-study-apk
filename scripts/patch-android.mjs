#!/usr/bin/env node
/**
 * Android 工程补丁：
 * 1. gradle.properties: 堆内存抬到 4G
 * 2. app/build.gradle: 音频/图片不压缩（音频可 seek）、lint 不阻断
 * 3. 图标：scripts/icons/mipmap-* 覆盖 Capacitor 默认图标 + 背景色
 * 4. 校验 assets 里站点文件数量，过少直接报错退出（防出空壳）
 *
 * 用法: node scripts/patch-android.mjs [android 目录，默认 ./android]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, cpSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const androidDir = join(projRoot, process.argv[2] || "android");
const appDir = join(androidDir, "app");

if (!existsSync(join(androidDir, "app", "build.gradle"))) {
  console.error(`[patch] 找不到 ${androidDir}/app/build.gradle，先跑 npx cap add android`);
  process.exit(1);
}

/* 1. gradle.properties 堆内存 */
const gpPath = join(androidDir, "gradle.properties");
let gp = readFileSync(gpPath, "utf8");
if (!/-Xmx4096m/.test(gp)) {
  if (/org\.gradle\.jvmargs=.*/.test(gp)) gp = gp.replace(/org\.gradle\.jvmargs=.*/g, "org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1g");
  else gp += "\norg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1g\n";
  writeFileSync(gpPath, gp);
  console.log("[gradle.properties] 堆内存 -> 4G");
}

/* 2. app/build.gradle */
const bgPath = join(appDir, "build.gradle");
let bg = readFileSync(bgPath, "utf8");
if (!bg.includes("[patch-android]")) {
  // noCompress：直接追加进模板自带的 defaultConfig > aaptOptions 块
  const before = bg;
  bg = bg.replace(
    /(aaptOptions\s*\{[^}]*ignoreAssetsPattern[^}]*?)(\n(\s*)\})/,
    `$1\n$3// [patch-android] 媒体资源不压缩，保证音频可随机 seek\n$3noCompress 'mp3', 'webp', 'ico'\n$2`
  );
  // lint 放行：插进 android{} 块内（buildTypes 之前，缩进与块内一致）
  const lintInject = `    // [patch-android] lint 不阻断构建
    lint {
        abortOnError false
        checkReleaseBuilds false
    }

`;
  bg = bg.replace(/(    buildTypes \{)/, `${lintInject}$1`);
  if (bg === before) {
    console.error("[patch] build.gradle 结构与预期不符，未做修改 —— 请人工检查");
    process.exit(1);
  }
  writeFileSync(bgPath, bg);
  console.log("[build.gradle] noCompress + lint 放行");
}

/* 3. 图标覆盖 */
const resDir = join(appDir, "src", "main", "res");
const iconsSrc = join(projRoot, "scripts", "icons");
if (existsSync(iconsSrc)) {
  for (const d of readdirSync(join(iconsSrc)).filter(n => n.startsWith("mipmap-"))) {
    const dst = join(resDir, d);
    cpSync(join(iconsSrc, d), dst, { recursive: true });
  }
  // adaptive icon 背景色（Capacitor 模板是 values/ic_launcher_background.xml 里的 color）
  const bgXml = join(resDir, "values", "ic_launcher_background.xml");
  if (existsSync(bgXml)) {
    writeFileSync(bgXml, `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#FFC94D</color>
</resources>
`);
    console.log("[icon] 背景色 -> #FFC94D");
  }
  console.log("[icon] mipmap 图标已覆盖");
} else {
  console.warn("[icon] 找不到 scripts/icons，使用 Capacitor 默认图标");
}

/* 4. assets 完整性校验 */
const assetsPublic = join(appDir, "src", "main", "assets", "public");
if (!existsSync(assetsPublic)) {
  console.error("[patch] 找不到 assets/public —— 先跑 npx cap sync android");
  process.exit(1);
}
let files = 0;
(function count(dir) {
  for (const n of readdirSync(dir, { withFileTypes: true })) {
    if (n.isDirectory()) count(join(dir, n.name));
    else files++;
  }
})(assetsPublic);
console.log(`[assets] 共 ${files} 个文件`);
if (files < 200) {
  console.error("[patch] assets 文件数异常（应约 235），中止构建，别出空壳 APK");
  process.exit(1);
}
console.log("[patch] Android 工程补丁完成");
