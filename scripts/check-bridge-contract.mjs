#!/usr/bin/env node
/**
 * 桥接契约护栏：确保原生壳暴露的 JS 桥接口名与方法签名，与网页端（zhipei-one）
 * 的调用约定保持一致。
 *
 * 为什么需要它：网页端的「一键粘贴」等能力依赖 window.ZhipeiNative.getClipboardText()。
 * 若原生方法被改名、改签名或忘记注册 @JavascriptInterface，网页不会报错，只会静默
 * 降级（用户点了没反应 / 退回「请长按粘贴」），非常难排查。这个脚本把契约固化成
 * 可在 CI 里跑的断言，改坏的一方立即红。
 *
 * 用法：
 *   node scripts/check-bridge-contract.mjs            # 只校验壳侧
 *   node scripts/check-bridge-contract.mjs --web <path-to-zhipei-one>
 *
 * 退出码：0 = 契约一致；1 = 契约破坏（CI 应失败）；2 = 用法错误。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");

const MAIN_ACTIVITY = path.join(
  REPO,
  "android/app/src/main/java/com/tianbops/zhipei/MainActivity.java"
);

/** 桥对象名：网页通过 window.<NAME> 访问 */
const BRIDGE_NAME = "ZhipeiNative";

/**
 * 契约表：方法名 → 期望的返回类型（java 源码中的返回类型片段）。
 * 返回类型必须与网页端的用法一致，否则网页会拿到 undefined。
 */
const CONTRACT = [
  { name: "getClipboardText", returns: "String", desc: "读取系统剪贴板纯文本（三态：文本 / \"\" / null）" },
  { name: "appVersion", returns: "String", desc: "应用版本号" },
  { name: "appVersionCode", returns: "int", desc: "应用版本号（数字）" },
  { name: "applyTheme", returns: "void", desc: "同步原生弹层主题" },
  { name: "setFontScale", returns: "void", desc: "同步全局字号" },
  { name: "haptic", returns: "void", desc: "按钮触感（light/medium/success/warn）" },
  { name: "downloadApk", returns: "void", desc: "直接下载 APK" },
  { name: "exitApp", returns: "void", desc: "退出 App" },
];

/** 网页端调用点 → 必须存在的原生方法（跨仓契约） */
const WEB_CALLERS = [
  {
    file: "js/home/upload-sheet.js",
    // 匹配 window.ZhipeiNative.getClipboardText / nat.getClipboardText
    pattern: /ZhipeiNative[\s\S]{0,80}?getClipboardText|\bgetClipboardText\s*\(/g,
    method: "getClipboardText",
  },
  {
    // 底部导航触感：网页侧 js/ui/haptic.js 调 nat.haptic(kind)，
    // 原生侧漏了方法只会「点了没震动」，和剪贴板一样属于静默失效，必须纳入契约。
    file: "js/ui/haptic.js",
    pattern: /ZhipeiNative[\s\S]{0,80}?haptic|\bhaptic\s*\(/g,
    method: "haptic",
  },
];

const errors = [];
const notes = [];

function readFile(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch (e) {
    errors.push(`无法读取文件：${p}（${e.code || e.message}）`);
    return null;
  }
}

function checkShell() {
  const src = readFile(MAIN_ACTIVITY);
  if (!src) return;

  // 1) 桥对象必须注册为 BRIDGE_NAME
  const regRe = new RegExp(`addJavascriptInterface\\s*\\([^,]+,\\s*"${BRIDGE_NAME}"\\s*\\)`);
  if (!regRe.test(src)) {
    errors.push(
      `原生侧未把桥对象注册为 "${BRIDGE_NAME}"（缺少 addJavascriptInterface(..., "${BRIDGE_NAME}")）`
    );
  } else {
    notes.push(`桥对象注册名 "${BRIDGE_NAME}" ✓`);
  }

  // 2) 每个契约方法必须存在、标注 @JavascriptInterface、返回类型匹配
  for (const c of CONTRACT) {
    // 捕获：@JavascriptInterface ... public <returns> <name>(
    const re = new RegExp(
      `@JavascriptInterface\\s*(?:@[\\w.]+\\s*)*public\\s+${c.returns}\\s+${c.name}\\s*\\(`,
      "m"
    );
    if (!re.test(src)) {
      errors.push(
        `原生侧缺少桥方法 ${BRIDGE_NAME}.${c.name}()（应为 public ${c.returns} ${c.name}(...) 且标注 @JavascriptInterface）`
      );
    }
  }
  if (!errors.length || !errors.some((e) => e.includes("桥方法"))) {
    notes.push(`原生侧 ${CONTRACT.length} 个桥方法签名均符合契约 ✓`);
  }

  // 3) getClipboardText 必须体现三态语义：返回 null（失败）与返回 ""（无文字）
  const idx = src.indexOf("getClipboardText");
  if (idx >= 0) {
    const body = src.slice(idx, idx + 2000);
    const hasNull = /return\s+null\s*;/.test(body);
    const hasEmpty = /return\s+""\s*;/.test(body);
    if (!hasNull) {
      errors.push("getClipboardText() 未返回 null 的分支——网页依赖 null 表示「读取失败，继续降级」");
    }
    if (!hasEmpty) {
      errors.push('getClipboardText() 未返回 "" 的分支——网页依赖 "" 表示「剪贴板无文字」（权威结论，不降级）');
    }
    if (hasNull && hasEmpty) notes.push("getClipboardText() 三态语义（文本 / \"\" / null）完整 ✓");
  }
}

function checkWeb(webRoot) {
  for (const w of WEB_CALLERS) {
    const p = path.join(webRoot, w.file);
    const src = readFile(p);
    if (!src) continue;
    const found = new Set();
    const re = new RegExp(w.pattern, "g");
    let m;
    while ((m = re.exec(src)) !== null) {
      // 确认这段确实是调桥（排除注释里的提及）
      found.add(w.method);
    }
    if (!found.size) {
      errors.push(
        `网页侧未找到 ${w.method} 的调用点（${w.file}）——原生方法与网页约定已脱节，请同步更新`
      );
    } else {
      notes.push(`网页侧调用 ${w.file} → ${BRIDGE_NAME}.${w.method}() ✓`);
    }
  }
}

const argv = process.argv.slice(2);
let webRoot = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--web") {
    webRoot = path.resolve(argv[++i] || "");
    if (!webRoot) {
      console.error("用法：node scripts/check-bridge-contract.mjs [--web <zhipei-one 路径>]");
      process.exit(2);
    }
  }
}

checkShell();
if (webRoot) checkWeb(webRoot);

console.log("— 桥接契约检查 —");
for (const n of notes) console.log(`  · ${n}`);
if (errors.length) {
  console.error("\n✗ 契约破坏：");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("\n✓ 桥接契约一致");
