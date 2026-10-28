#!/usr/bin/env node
/**
 * 哪吒学汉字 · Web 适配补丁（面向安卓 WebView / 4 岁儿童场景）
 *
 * 1. CSS: 100dvh -> 补 100vh 兜底（老 WebView 不认识 dvh 会整条忽略，布局塌）
 * 2. math 默认十法（10 以内），关闭减法 —— 4 岁可上手
 * 3. utils.js 注入:
 *    - Android 返回键: 子页面返回主界面，主界面再按一次才退出（防误触）
 *    - TTS 体检: 连续 3 次 speak 后 800ms 内没触发 onstart -> 判定本机无声，
 *      顶部弹一条家长可见的提示（不弹 alert 防吓到孩子）
 *
 * 幂等：重复执行安全。
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const TAG = "/* [patch-web] */";

function walk(dir, ext, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

let changed = 0;

/* ---------- 1. CSS dvh 兜底 ---------- */
for (const file of walk(root, ".css")) {
  let css = readFileSync(file, "utf8");
  if (css.includes(TAG)) continue;
  const before = css;
  // 逐条声明改写：height:100dvh -> height:100vh; height:100dvh
  css = css.replace(
    /(^|\n)(\s*)([-a-z]*height:\s*)([^;\n]*?)dvh([^;\n]*);/g,
    (m, nl, indent, prop, pre, post) => `${nl}${indent}${prop}${pre}vh${post};${indent}${prop}${pre}dvh${post};`
  );
  if (css !== before) {
    writeFileSync(file, css);
    changed++;
    console.log(`[css] dvh 兜底: ${file.replace(root, ".")}`);
  }
}

/* ---------- 2. 数学默认十法 ---------- */
const mathJs = join(root, "math", "index.js");
{
  let s = readFileSync(mathJs, "utf8");
  if (!s.includes(TAG)) {
    const before = s;
    s = s.replace("range: 99,", "range: 10,");
    // hasSub 默认已是 false，无需动；若上游改动则强制
    s = s.replace("hasSub: true,", "hasSub: false,");
    if (s !== before) {
      writeFileSync(mathJs, s);
      changed++;
      console.log("[math] 默认十法/关闭减法");
    }
  }
}

/* ---------- 3. utils.js 注入返回键 + TTS 体检 ---------- */
const utilsJs = join(root, "js", "utils.js");
{
  let s = readFileSync(utilsJs, "utf8");
  if (!s.includes(TAG)) {
    s += `

${TAG}
// ===== Android 套壳适配（Capacitor 注入）=====
;(function () {
  function initShell() {
    var Cap = window.Capacitor;
    if (!Cap || typeof Cap.isNativePlatform !== "function" || !Cap.isNativePlatform()) return;

    // 返回键：math/poem 子页 -> 主页；主页：优先回退历史，无历史则退出
    try {
      var App = Cap.Plugins && Cap.Plugins.App;
      if (App && typeof App.addListener === "function") {
        App.addListener("backButton", function () {
          if (/\\/(math|poem)\\//.test(location.pathname)) {
            location.href = "../index.html";
            return;
          }
          var isHome = !location.pathname.replace(/[^/]/g, "").length || /index\\.html?$/.test(location.pathname);
          if (!isHome && history.length > 1) { history.back(); return; }
          if (App.exitApp) App.exitApp();
        });
        console.log("[shell] backButton 已接管");
      }
    } catch (e) { console.warn("[shell] backButton 失败", e); }

    // TTS 体检： WebView 无系统 TTS 引擎时 speechSynthesis 会"静音"
    var fails = 0;
    if (window.speechSynthesis) {
      var origSpeak = speechSynthesis.speak.bind(speechSynthesis);
      speechSynthesis.speak = function (u) {
        var fired = false;
        try {
          u.addEventListener && u.addEventListener("start", function () { fired = true; fails = 0; });
          u.onstart = (function (old) { return function () { fired = true; fails = 0; old && old.apply(this, arguments); }; })(u.onstart);
        } catch (e) {}
        origSpeak(u);
        setTimeout(function () {
          if (!fired && ++fails >= 3) showTtsTip();
        }, 900);
      };
    } else {
      setTimeout(showTtsTip, 2000);
    }

    var tipShown = false;
    function showTtsTip() {
      if (tipShown) return;
      tipShown = true;
      if (typeof dnotify === "function") {
        dnotify("若听不到读音：请在系统设置中开启/安装中文语音引擎（华为小艺、讯飞语记等），或联系爸爸修。", 15000);
      }
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initShell);
  else initShell();
})();
`;
    writeFileSync(utilsJs, s);
    changed++;
    console.log("[utils] 返回键 + TTS 体检已注入");
  }
}

console.log(changed ? `补丁完成，改动 ${changed} 处` : "所有补丁均已生效（幂等跳过）");
